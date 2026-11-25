"""Input validation: opening the CSV, header checks, row-level checks and savings-plan handling."""

from __future__ import annotations

import ast
import csv
import gzip
import io
import json
import math
import re
import sys
import zipfile
from collections.abc import Iterable, Iterator, Sequence
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import TextIO

from . import PipelineError

REQUIRED_COLUMNS: tuple[str, ...] = (
    "retailPrice",
    "armRegionName",
    "meterId",
    "meterName",
    "productName",
    "skuName",
    "serviceName",
    "serviceFamily",
    "unitOfMeasure",
    "type",
    "armSkuName",
    "reservationTerm",
    "tierMinimumUnits",
    "effectiveStartDate",
)
OPTIONAL_COLUMNS: tuple[str, ...] = ("location", "savingsPlan")

#: Fail when more than this share of the rows read is invalid (empty keys / non-numeric price).
MAX_INVALID_RATIO = 0.01
#: Nested savingsPlan cells longer than this are rejected (defensive limit for ast.literal_eval).
MAX_SAVINGS_PLAN_CELL = 20_000

SAVINGS_PLAN_TYPE = "SavingsPlans"
DEVTEST_TYPE = "DevTestConsumption"
_SAVINGS_RE = re.compile("savings", re.IGNORECASE)
_KNOWN_TYPES = {"consumption": "Consumption", "reservation": "Reservation", "devtestconsumption": DEVTEST_TYPE}


def _set_field_size_limit() -> None:
    limit = sys.maxsize
    while True:
        try:
            csv.field_size_limit(limit)
            return
        except OverflowError:
            limit //= 10


_set_field_size_limit()


# --------------------------------------------------------------------------------------------
# Opening input files (.csv, .csv.gz, .zip with one CSV) - detected by magic bytes, not names.
# --------------------------------------------------------------------------------------------

@contextmanager
def open_text(path: Path | str) -> Iterator[TextIO]:
    """Open a CSV that may be plain, gzip-compressed or a zip archive holding one CSV."""
    path = Path(path)
    if not path.is_file():
        raise PipelineError(f"input file not found: {path}")
    with open(path, "rb") as fh:
        magic = fh.read(4)
    if magic[:2] == b"\x1f\x8b":
        with gzip.open(path, "rt", encoding="utf-8-sig", newline="") as text:
            yield text
    elif magic == b"PK\x03\x04":
        with zipfile.ZipFile(path) as zf:
            member = _zip_csv_member(zf, path)
            with zf.open(member) as raw, io.TextIOWrapper(raw, encoding="utf-8-sig", newline="") as text:
                yield text
    else:
        with open(path, encoding="utf-8-sig", newline="") as text:
            yield text


def _zip_csv_member(zf: zipfile.ZipFile, path: Path) -> str:
    files = [i.filename for i in zf.infolist() if not i.is_dir() and not i.filename.startswith("__MACOSX/")]
    csvs = [f for f in files if f.lower().endswith(".csv")]
    if len(csvs) == 1:
        return csvs[0]
    if not csvs and len(files) == 1:
        return files[0]
    raise PipelineError(f"{path}: expected exactly one CSV inside the zip, found {files}")


# --------------------------------------------------------------------------------------------
# Header
# --------------------------------------------------------------------------------------------

@dataclass(frozen=True)
class Columns:
    """Positions of the columns the pipeline reads, mapped by header name."""

    index: dict[str, int]
    names: tuple[str, ...]
    location: int | None
    savings_plan: int | None
    savings_plan_headers: tuple[str, ...]

    @property
    def max_index(self) -> int:
        positions = list(self.index.values())
        positions += [p for p in (self.location, self.savings_plan) if p is not None]
        return max(positions)


def map_header(header: Sequence[str]) -> Columns:
    """Map required/optional columns by name (exact, then case-insensitive). Column order is free."""
    names = tuple(h.strip().lstrip("\ufeff").strip() for h in header)
    exact: dict[str, int] = {}
    folded: dict[str, int] = {}
    for i, name in enumerate(names):
        exact.setdefault(name, i)
        folded.setdefault(name.lower(), i)

    def find(name: str) -> int | None:
        pos = exact.get(name)
        return pos if pos is not None else folded.get(name.lower())

    missing = [c for c in REQUIRED_COLUMNS if find(c) is None]
    if missing:
        found = ", ".join(n for n in names if n) or "(none)"
        raise PipelineError(
            f"prices CSV is missing required column(s): {', '.join(missing)}. Found columns: {found}"
        )
    index = {c: find(c) for c in REQUIRED_COLUMNS}
    return Columns(
        index=index,  # type: ignore[arg-type]
        names=names,
        location=find("location"),
        savings_plan=find("savingsPlan"),
        savings_plan_headers=tuple(n for n in names if n.lower().startswith("savingsplan")),
    )


# --------------------------------------------------------------------------------------------
# Values
# --------------------------------------------------------------------------------------------

def parse_price(value: object) -> float | None:
    """A finite float, or None when the value is not numeric (NaN/inf count as non-numeric)."""
    try:
        number = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def compact_number(number: float) -> int | float:
    """0.0 -> 0, 51200.0 -> 51200 (smaller JSON, same value for JavaScript)."""
    if number.is_integer() and abs(number) < 1e15:
        return int(number)
    return number


def normalize_type(raw: str) -> str:
    """Canonical `type`: anything mentioning "savings" becomes SavingsPlans; known types get canonical case."""
    value = raw.strip()
    if _SAVINGS_RE.search(value):
        return SAVINGS_PLAN_TYPE
    return _KNOWN_TYPES.get(value.lower(), value)


def parse_savings_plan_cell(cell: str) -> list[tuple[int | float, str]]:
    """Parse a nested `savingsPlan` cell into (retailPrice, term) pairs.

    Accepts JSON (`[{"retailPrice": 0.06, "term": "1 Year"}]`) or the Python literal pandas writes
    for a list of dicts (`[{'unitPrice': 0.06, 'retailPrice': 0.06, 'term': '1 Year'}]`).
    Empty / NaN / [] -> no plans. Raises ValueError for anything unparseable.
    """
    text = cell.strip()
    if not text or text.lower() in {"nan", "none", "null", "[]"}:
        return []
    if len(text) > MAX_SAVINGS_PLAN_CELL:
        raise ValueError(f"savingsPlan cell too long ({len(text)} chars)")
    try:
        data = json.loads(text)
    except ValueError:
        try:
            data = ast.literal_eval(text)
        except (ValueError, SyntaxError, TypeError, MemoryError, RecursionError) as exc:
            raise ValueError(f"unparseable savingsPlan cell: {exc}") from None
    if isinstance(data, dict):
        data = [data]
    if not isinstance(data, list):
        raise ValueError(f"savingsPlan cell is not a list: {type(data).__name__}")
    plans: list[tuple[int | float, str]] = []
    for element in data:
        if not isinstance(element, dict):
            raise ValueError("savingsPlan element is not an object")
        raw_price = element.get("retailPrice")
        if raw_price is None:
            raw_price = element.get("unitPrice")
        price = parse_price(raw_price)
        if price is None:
            raise ValueError(f"savingsPlan element has no numeric price: {element!r}")
        term = str(element.get("term") or element.get("reservationTerm") or "").strip()
        plans.append((compact_number(price), term))
    return plans


# --------------------------------------------------------------------------------------------
# Row-level bookkeeping and thresholds
# --------------------------------------------------------------------------------------------

@dataclass
class Issues:
    """Counts a kind of problem and keeps the first few examples for the log/report."""

    label: str
    count: int = 0
    examples: list[str] = field(default_factory=list)
    max_examples: int = 5

    def add(self, example: str) -> None:
        self.count += 1
        if len(self.examples) < self.max_examples:
            self.examples.append(example)

    def describe(self) -> str:
        if not self.count:
            return f"{self.label}: 0"
        return f"{self.label}: {self.count:,} (e.g. {'; '.join(self.examples)})"


def check_row_counts(rows_read: int, invalid: Issues, min_rows: int) -> None:
    """Fail when the CSV is too small or too many of its rows are unusable."""
    if rows_read == 0:
        raise PipelineError("prices CSV has no data rows")
    if rows_read < min_rows:
        raise PipelineError(
            f"prices CSV has {rows_read:,} data rows; expected at least {min_rows:,} "
            "(is the export truncated? use --min-rows to change the threshold)"
        )
    if invalid.count / rows_read > MAX_INVALID_RATIO:
        raise PipelineError(
            f"{invalid.count:,} of {rows_read:,} rows ({invalid.count / rows_read:.1%}) are invalid "
            f"(> {MAX_INVALID_RATIO:.0%}): {invalid.describe()}"
        )


def savings_plan_orphans(rows: Iterable[Sequence[object]]) -> list[tuple[str, str]]:
    """(armSkuName, productName) pairs that have SavingsPlans rows but no Consumption row.

    `rows` are output rows of one Virtual Machines shard (see transform.COLS). Older exporter
    releases dropped the PAYG row of SKUs that have savings plans.
    """
    consumption: set[tuple[str, str]] = set()
    with_plans: set[tuple[str, str]] = set()
    for row in rows:
        key = (str(row[4]), str(row[2]))
        if row[6] == "Consumption":
            consumption.add(key)
        elif row[6] == SAVINGS_PLAN_TYPE:
            with_plans.add(key)
    return sorted(with_plans - consumption)


class SavingsPlanOrphanCheck:
    """Group observer (transform.write_shards) collecting savings_plan_orphans() for VM shards."""

    def __init__(self, service_name: str = "Virtual Machines") -> None:
        self.service_name = service_name
        self.issues = Issues(
            "Virtual Machines (region, armSkuName, productName) with SavingsPlans rows but no Consumption "
            "row (known bug of older exporter releases; the SPA treats PAYG as unavailable there)"
        )

    def __call__(self, service: str, region: str, region_key: str, main_rows: list, spot_rows: list) -> None:
        if service != self.service_name:
            return
        for arm_sku, product in savings_plan_orphans(main_rows):
            self.issues.add(f"{region_key} {arm_sku} ({product})")
