"""Shared test helpers: import-path bootstrap, scratch directories and CSV builders.

Works under `python3 -m unittest discover -s tests` (package not installed) and under pytest.
"""

from __future__ import annotations

import contextlib
import csv
import io
import logging
import os
import sys
import tempfile
from collections.abc import Iterable
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = PIPELINE_DIR.parent
_SRC = PIPELINE_DIR / "src"
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))

from azcalc_pipeline import cli  # noqa: E402
from azcalc_pipeline.fixture import COLUMNS  # noqa: E402
from azcalc_pipeline.transform import ReadResult, read_prices  # noqa: E402

# Keep test output readable: expected warnings are not printed (errors are asserted with assertLogs).
logging.getLogger("azcalc_pipeline").setLevel(logging.ERROR)


def scratch_dir() -> tempfile.TemporaryDirectory:
    """A local-disk scratch directory: $TMPDIR / system default, or AZCALC_TEST_TMPDIR if set.

    Do not point it at a network mount: builds stage and publish with directory renames.
    """
    base = os.environ.get("AZCALC_TEST_TMPDIR") or None
    if base:
        Path(base).mkdir(parents=True, exist_ok=True)
    return tempfile.TemporaryDirectory(dir=base, prefix="azcalc-test-", ignore_cleanup_errors=True)


def make_row(**overrides: object) -> dict[str, str]:
    """One exporter CSV row (a Linux D2s v5 PAYG meter in eastus unless overridden)."""
    row = {column: "" for column in COLUMNS}
    row.update({
        "currencyCode": "USD",
        "tierMinimumUnits": "0.0",
        "retailPrice": "0.096",
        "unitPrice": "0.096",
        "armRegionName": "eastus",
        "location": "US East",
        "effectiveStartDate": "2024-05-01T00:00:00Z",
        "meterId": "11111111-1111-1111-1111-111111111111",
        "meterName": "D2s v5",
        "productName": "Virtual Machines Dsv5 Series",
        "skuName": "D2s v5",
        "serviceName": "Virtual Machines",
        "serviceFamily": "Compute",
        "unitOfMeasure": "1 Hour",
        "type": "Consumption",
        "isPrimaryMeterRegion": "True",
        "armSkuName": "Standard_D2s_v5",
    })
    row.update({key: str(value) for key, value in overrides.items()})
    return row


def csv_text(rows: Iterable[dict[str, str]], columns: Iterable[str] = COLUMNS) -> str:
    columns = list(columns)
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(columns)
    for row in rows:
        writer.writerow([row.get(column, "") for column in columns])
    return buffer.getvalue()


def read_rows(rows: Iterable[dict[str, str]], columns: Iterable[str] = COLUMNS, **kwargs: object) -> ReadResult:
    return read_prices(io.StringIO(csv_text(rows, columns)), **kwargs)  # type: ignore[arg-type]


def write_csv(path: Path, rows: Iterable[dict[str, str]], columns: Iterable[str] = COLUMNS) -> Path:
    path.write_text(csv_text(rows, columns), encoding="utf-8")
    return path


def run_cli(*args: object) -> tuple[int, str]:
    """Run `azcalc-pipeline <args> -q` in-process; returns (exit code, stdout)."""
    stdout = io.StringIO()
    with contextlib.redirect_stdout(stdout):
        code = cli.main([str(a) for a in args] + ["-q"])
    return code, stdout.getvalue()
