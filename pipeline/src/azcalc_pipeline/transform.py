"""One streaming pass over the prices CSV -> (service, region) groups -> columnar JSON shards.

Memory: rows are kept as tuples with interned strings (~300 bytes/row), i.e. well under 1 GB for
the full ~1.1M-row export. Groups are released as soon as their shard files are written.
"""

from __future__ import annotations

import csv
import json
import logging
import math
import sys
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import TextIO

from . import PipelineError
from .slug import assign_region_keys, assign_slugs
from .validate import (
    DEVTEST_TYPE,
    SAVINGS_PLAN_TYPE,
    Columns,
    Issues,
    compact_number,
    map_header,
    normalize_type,
    parse_price,
    parse_savings_plan_cell,
)

log = logging.getLogger(__name__)

#: Column order of every shard (the SPA reads columns by name from `cols`).
COLS: tuple[str, ...] = (
    "meterId",
    "meterName",
    "productName",
    "skuName",
    "armSkuName",
    "unitOfMeasure",
    "type",
    "reservationTerm",
    "tierMinimumUnits",
    "retailPrice",
    "effectiveStartDate",
    "isWindows",
)
(METER_ID, METER_NAME, PRODUCT, SKU, ARM_SKU, UNIT, TYPE, TERM, TIER, PRICE, DATE, WINDOWS) = range(len(COLS))

DEFAULT_PART_MAX_BYTES = 5_000_000
VIRTUAL_MACHINES = "Virtual Machines"
_TERM_TYPES = frozenset({"Reservation", SAVINGS_PLAN_TYPE})

Row = tuple  # one output row, positions as in COLS
GroupKey = tuple[str, str]  # (serviceName, armRegionName)
#: observer(serviceName, armRegionName, regionKey, main_rows, spot_rows), called once per group.
GroupObserver = Callable[[str, str, str, list, list], None]

_encode = json.JSONEncoder(ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode


def is_spot(meter_name: str, sku_name: str) -> bool:
    """Spot / Low Priority meters go to the `<region>.spot.json` companion shard."""
    meter = meter_name.lower()
    sku = sku_name.lower()
    return "spot" in meter or "low priority" in meter or "spot" in sku or "low priority" in sku


# --------------------------------------------------------------------------------------------
# Pass 1: read
# --------------------------------------------------------------------------------------------

@dataclass
class ReadStats:
    rows_read: int = 0
    rows_kept: int = 0
    filtered_region: int = 0
    filtered_service: int = 0
    devtest_dropped: int = 0
    savings_plan_expanded: int = 0
    invalid: Issues = field(
        default_factory=lambda: Issues("invalid rows dropped (empty meterId/serviceName or non-numeric retailPrice)")
    )
    savings_plan_errors: Issues = field(default_factory=lambda: Issues("unparseable savingsPlan cells (ignored)"))
    tier_errors: Issues = field(default_factory=lambda: Issues("non-numeric tierMinimumUnits (used 0)"))


@dataclass
class ReadResult:
    columns: Columns
    main: dict[GroupKey, list[Row]]
    spot: dict[GroupKey, list[Row]]
    service_family: dict[str, dict[str, int]]
    region_location: dict[str, dict[str, int]]
    stats: ReadStats


def _name_set(values: Iterable[str] | None) -> set[str] | None:
    if values is None:
        return None
    cleaned = {v.strip().lower() for v in values if v.strip()}
    return cleaned or None


def read_prices(
    stream: TextIO,
    regions: Iterable[str] | None = None,
    services: Iterable[str] | None = None,
) -> ReadResult:
    """Validate the header and group every usable row by (serviceName, armRegionName).

    regions: keep only these armRegionNames (rows with an empty region are always kept).
    services: keep only these serviceNames. Both filters are case-insensitive.
    """
    reader = csv.reader(stream)
    try:
        header = next(reader)
    except StopIteration:
        raise PipelineError("prices CSV is empty (no header row)") from None
    columns = map_header(header)
    if columns.savings_plan is not None:
        log.info("CSV has a nested 'savingsPlan' column: expanding it into SavingsPlans rows")

    ix = columns.index
    i_meter, i_meter_name, i_product = ix["meterId"], ix["meterName"], ix["productName"]
    i_sku, i_service, i_family = ix["skuName"], ix["serviceName"], ix["serviceFamily"]
    i_unit, i_type, i_arm_sku = ix["unitOfMeasure"], ix["type"], ix["armSkuName"]
    i_term, i_tier, i_price = ix["reservationTerm"], ix["tierMinimumUnits"], ix["retailPrice"]
    i_date, i_region = ix["effectiveStartDate"], ix["armRegionName"]
    i_location, i_plans = columns.location, columns.savings_plan
    width = columns.max_index + 1

    region_filter = _name_set(regions)
    service_filter = _name_set(services)

    stats = ReadStats()
    invalid = stats.invalid
    main: dict[GroupKey, list[Row]] = {}
    spot: dict[GroupKey, list[Row]] = {}
    family_counts: dict[GroupKey, int] = {}
    location_counts: dict[GroupKey, int] = {}
    type_cache: dict[str, str] = {}
    windows_cache: dict[str, int] = {}
    tier_cache: dict[str, int | float] = {"": 0}

    intern = sys.intern
    isfinite = math.isfinite
    rows_read = 0
    kept = 0
    for rec in reader:
        if not rec:
            continue
        rows_read += 1
        if len(rec) < width:
            rec.extend([""] * (width - len(rec)))

        meter_id = rec[i_meter].strip()
        service = rec[i_service].strip()
        try:
            price: float | int | None = float(rec[i_price])
        except ValueError:
            price = None
        else:
            if not isfinite(price):
                price = None
        if not meter_id or not service or price is None:
            reason = "empty meterId" if not meter_id else "empty serviceName" if not service else (
                f"retailPrice={rec[i_price]!r}"
            )
            invalid.add(f"line {reader.line_num}: {reason}")
            continue

        region = rec[i_region].strip()
        if region_filter is not None and region and region.lower() not in region_filter:
            stats.filtered_region += 1
            continue
        if service_filter is not None and service.lower() not in service_filter:
            stats.filtered_service += 1
            continue

        raw_type = rec[i_type]
        row_type = type_cache.get(raw_type)
        if row_type is None:
            row_type = type_cache[raw_type] = intern(normalize_type(raw_type))
        if row_type == DEVTEST_TYPE:
            stats.devtest_dropped += 1
            continue

        raw_tier = rec[i_tier]
        tier = tier_cache.get(raw_tier)
        if tier is None:
            parsed = parse_price(raw_tier)
            if parsed is None:
                stats.tier_errors.add(f"line {reader.line_num}: tierMinimumUnits={raw_tier!r}")
                tier = 0
            else:
                tier = tier_cache[raw_tier] = compact_number(parsed)

        product = rec[i_product]
        windows = windows_cache.get(product)
        if windows is None:
            windows = windows_cache[product] = 1 if "windows" in product.lower() else 0

        meter_name = rec[i_meter_name]
        sku_name = rec[i_sku]
        price = compact_number(price)
        row = (
            intern(meter_id),
            intern(meter_name),
            intern(product),
            intern(sku_name),
            intern(rec[i_arm_sku]),
            intern(rec[i_unit]),
            row_type,
            intern(rec[i_term].strip()) if row_type in _TERM_TYPES else "",
            tier,
            price,
            intern(rec[i_date][:10]),
            windows,
        )

        service = intern(service)
        region = intern(region)
        key = (service, region)
        target = spot if is_spot(meter_name, sku_name) else main
        bucket = target.get(key)
        if bucket is None:
            bucket = target[key] = []
        bucket.append(row)
        kept += 1

        family_key = (service, rec[i_family].strip())
        family_counts[family_key] = family_counts.get(family_key, 0) + 1
        if i_location is not None:
            location = rec[i_location].strip()
            if location:
                location_key = (region, location)
                location_counts[location_key] = location_counts.get(location_key, 0) + 1

        if i_plans is not None:
            cell = rec[i_plans]
            if cell and cell != "[]":
                try:
                    plans = parse_savings_plan_cell(cell)
                except ValueError as exc:
                    stats.savings_plan_errors.add(f"line {reader.line_num}: {exc}")
                    plans = []
                for plan_price, plan_term in plans:
                    bucket.append(row[:TYPE] + (SAVINGS_PLAN_TYPE, intern(plan_term), tier, plan_price) + row[DATE:])
                    stats.savings_plan_expanded += 1
                    kept += 1

        if rows_read % 250_000 == 0:
            log.info("read %s rows ...", f"{rows_read:,}")

    stats.rows_read = rows_read
    stats.rows_kept = kept
    return ReadResult(
        columns=columns,
        main=main,
        spot=spot,
        service_family=_nest(family_counts),
        region_location=_nest(location_counts),
        stats=stats,
    )


def _nest(counts: dict[GroupKey, int]) -> dict[str, dict[str, int]]:
    nested: dict[str, dict[str, int]] = {}
    for (outer, inner), n in counts.items():
        nested.setdefault(outer, {})[inner] = n
    return nested


def most_common(counts: dict[str, int] | None) -> str:
    """Most frequent non-empty key (ties -> alphabetical), or "" when there is none."""
    if not counts:
        return ""
    candidates = [(-n, k) for k, n in counts.items() if k]
    return min(candidates)[1] if candidates else ""


# --------------------------------------------------------------------------------------------
# Pass 2: sort, dedupe, write
# --------------------------------------------------------------------------------------------

def _sort_key(row: Row) -> tuple:
    # Contract order (productName, skuName, meterName, type, reservationTerm, tierMinimumUnits),
    # then the remaining columns so the output is fully deterministic and duplicates are adjacent.
    return (row[PRODUCT], row[SKU], row[METER_NAME], row[TYPE], row[TERM], row[TIER],
            row[METER_ID], row[ARM_SKU], row[UNIT], row[PRICE], row[DATE], row[WINDOWS])


def sort_and_dedupe(rows: list[Row]) -> tuple[list[Row], int]:
    """Sort rows as the contract says and drop exact duplicates. Returns (rows, duplicates)."""
    rows.sort(key=_sort_key)
    unique: list[Row] = []
    previous: Row | None = None
    for row in rows:
        if row == previous:
            continue
        unique.append(row)
        previous = row
    return unique, len(rows) - len(unique)


def render_shard(service: str, region_key: str, rows: Sequence[Row]) -> bytes:
    """One complete columnar shard document (compact UTF-8 JSON)."""
    return _encode({"service": service, "region": region_key, "cols": COLS, "rows": rows}).encode("utf-8")


def render_parts(service: str, region_key: str, rows: Sequence[Row], part_max_bytes: int) -> list[tuple[bytes, int]]:
    """Render a shard, split into complete documents of <= part_max_bytes when it is larger.

    Returns [(document bytes, row count)]; a single element means "no split".
    """
    whole = render_shard(service, region_key, rows)
    if len(whole) <= part_max_bytes or len(rows) <= 1:
        return [(whole, len(rows))]
    head = _encode({"service": service, "region": region_key, "cols": COLS})[:-1].encode("utf-8") + b',"rows":['
    tail = b"]}"
    empty_size = len(head) + len(tail)
    parts: list[list[bytes]] = []
    current: list[bytes] = []
    size = empty_size
    for row in rows:
        encoded = _encode(row).encode("utf-8")
        extra = len(encoded) + (1 if current else 0)
        if current and size + extra > part_max_bytes:
            parts.append(current)
            current = []
            size = empty_size
            extra = len(encoded)
        current.append(encoded)
        size += extra
    if current:
        parts.append(current)
    return [(head + b",".join(part) + tail, len(part)) for part in parts]


@dataclass
class ShardFile:
    path: str  # relative to the date root, e.g. "prices/storage/westeurope.json"
    bytes: int
    rows: int


@dataclass
class ServiceSummary:
    name: str
    slug: str
    family: str
    regions: list[str] = field(default_factory=list)  # region keys with a main shard
    rows: int = 0  # published rows, main + spot
    spot_rows: int = 0
    products: set[str] = field(default_factory=set)
    bytes: int = 0
    files: int = 0

    @property
    def has_spot(self) -> bool:
        return self.spot_rows > 0


@dataclass
class RegionSummary:
    arm_region_name: str
    key: str
    location: str
    rows: int = 0  # published rows, main + spot, all services


@dataclass
class PublishResult:
    shards: dict[str, dict[str, dict]]  # index/shards.json: slug -> regionKey -> entry
    services: list[ServiceSummary]
    regions: list[RegionSummary]
    files: list[ShardFile]
    rows_published: int
    duplicates_dropped: int
    savings_plan_rows: int
    vm_skus: set[str]


def write_shards(
    read: ReadResult,
    prices_dir: Path,
    part_max_bytes: int = DEFAULT_PART_MAX_BYTES,
    observers: Sequence[GroupObserver] = (),
) -> PublishResult:
    """Write every group to `prices_dir/<slug>/<regionKey>[.partN|.spot].json`.

    Consumes `read.main` / `read.spot` (groups are popped to free memory).
    """
    if part_max_bytes < 1024:
        raise PipelineError("--part-max-bytes must be at least 1024")
    keys = set(read.main) | set(read.spot)
    slugs = assign_slugs(service for service, _ in keys)
    region_keys = assign_region_keys(region for _, region in keys)

    services: dict[str, ServiceSummary] = {}
    regions: dict[str, RegionSummary] = {}
    shards: dict[str, dict[str, dict]] = {}
    files: list[ShardFile] = []
    rows_published = duplicates = savings_plan_rows = 0
    vm_skus: set[str] = set()
    prices_root = prices_dir.parent

    for service, region in sorted(keys, key=lambda k: (slugs[k[0]], region_keys[k[1]])):
        slug = slugs[service]
        rkey = region_keys[region]
        main_rows, dup_main = sort_and_dedupe(read.main.pop((service, region), []))
        spot_rows, dup_spot = sort_and_dedupe(read.spot.pop((service, region), []))
        duplicates += dup_main + dup_spot

        shard_dir = prices_dir / slug
        shard_dir.mkdir(parents=True, exist_ok=True)
        entry: dict[str, int | bool] = {"parts": 0, "rows": len(main_rows), "bytes": 0, "spot": bool(spot_rows)}
        written: list[ShardFile] = []
        if main_rows:
            documents = render_parts(service, rkey, main_rows, part_max_bytes)
            if len(documents) == 1:
                names = [f"{rkey}.json"]
            else:
                names = [f"{rkey}.part{i}.json" for i in range(1, len(documents) + 1)]
                log.info("%s/%s: %d rows split into %d parts", slug, rkey, len(main_rows), len(documents))
            for name, (data, n_rows) in zip(names, documents):
                written.append(_write(shard_dir / name, data, n_rows, prices_root))
            entry["parts"] = len(documents)
            entry["bytes"] = sum(f.bytes for f in written)
        if spot_rows:
            written.append(_write(shard_dir / f"{rkey}.spot.json", render_shard(service, rkey, spot_rows),
                                  len(spot_rows), prices_root))
            entry["spotRows"] = len(spot_rows)
        shards.setdefault(slug, {})[rkey] = entry
        files.extend(written)

        summary = services.get(service)
        if summary is None:
            summary = services[service] = ServiceSummary(
                name=service, slug=slug, family=most_common(read.service_family.get(service)) or "Other"
            )
        if main_rows:
            summary.regions.append(rkey)
        summary.rows += len(main_rows) + len(spot_rows)
        summary.spot_rows += len(spot_rows)
        summary.bytes += sum(f.bytes for f in written)
        summary.files += len(written)
        for rows in (main_rows, spot_rows):
            for row in rows:
                summary.products.add(row[PRODUCT])
                if row[TYPE] == SAVINGS_PLAN_TYPE:
                    savings_plan_rows += 1
            if service == VIRTUAL_MACHINES:
                vm_skus.update(row[ARM_SKU] for row in rows if row[ARM_SKU])

        region_summary = regions.get(region)
        if region_summary is None:
            region_summary = regions[region] = RegionSummary(
                arm_region_name=region, key=rkey, location=most_common(read.region_location.get(region))
            )
        region_summary.rows += len(main_rows) + len(spot_rows)
        rows_published += len(main_rows) + len(spot_rows)

        for observe in observers:
            observe(service, region, rkey, main_rows, spot_rows)

    for summary in services.values():
        summary.regions.sort()
    return PublishResult(
        shards=shards,
        services=list(services.values()),
        regions=list(regions.values()),
        files=files,
        rows_published=rows_published,
        duplicates_dropped=duplicates,
        savings_plan_rows=savings_plan_rows,
        vm_skus=vm_skus,
    )


def _write(path: Path, data: bytes, rows: int, root: Path) -> ShardFile:
    path.write_bytes(data)
    return ShardFile(path=path.relative_to(root).as_posix(), bytes=len(data), rows=rows)


def decode_shard(document: dict) -> list[dict]:
    """Decode a columnar shard back into row dicts (used by tests and debugging)."""
    cols = document["cols"]
    return [dict(zip(cols, row)) for row in document["rows"]]
