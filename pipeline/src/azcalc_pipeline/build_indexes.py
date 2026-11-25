"""Index files: services.json, regions.json, vm-skus.json and fx.json (docs/data-contract.md)."""

from __future__ import annotations

import csv
import json
import logging
import re
from collections.abc import Iterable
from pathlib import Path
from typing import Any, TextIO

from . import PipelineError, data_dir
from .slug import GLOBAL_REGION_KEY
from .transform import RegionSummary, ServiceSummary
from .validate import compact_number, parse_price

log = logging.getLogger(__name__)

GLOBAL_DISPLAY_NAME = "Global (no region)"
GEOGRAPHY_ORDER = ("Global", "Americas", "Europe", "Asia Pacific", "Middle East", "Africa", "Azure Government", "Other")
_CURRENCY_CODE = re.compile(r"^[A-Z]{3}$")

_encode = json.JSONEncoder(ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode


def write_json(path: Path, obj: Any) -> int:
    """Write compact UTF-8 JSON; returns the byte size."""
    data = _encode(obj).encode("utf-8")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return len(data)


def load_json(path: Path, what: str) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise PipelineError(f"{what} not found: {path}") from None
    except ValueError as exc:
        raise PipelineError(f"{what} is not valid JSON ({path}): {exc}") from None


# --------------------------------------------------------------------------------------------
# services.json
# --------------------------------------------------------------------------------------------

def services_index(services: Iterable[ServiceSummary]) -> list[dict]:
    items = [
        {
            "serviceFamily": s.family,
            "serviceName": s.name,
            "slug": s.slug,
            "regions": list(s.regions),
            "rowCount": s.rows,
            "hasSpot": s.has_spot,
            "productCount": len(s.products),
        }
        for s in services
    ]
    items.sort(key=lambda d: (d["serviceFamily"].casefold(), d["serviceName"].casefold(), d["serviceName"]))
    return items


# --------------------------------------------------------------------------------------------
# regions.json
# --------------------------------------------------------------------------------------------

def load_region_geo(path: Path | None = None) -> dict[str, dict[str, str]]:
    path = path or data_dir() / "region-geo.json"
    geo = load_json(path, "region geography map")
    if not isinstance(geo, dict):
        raise PipelineError(f"{path}: expected an object keyed by armRegionName")
    return {k.lower(): v for k, v in geo.items() if isinstance(v, dict) and not k.startswith("$")}


def regions_index(regions: Iterable[RegionSummary], geo: dict[str, dict[str, str]]) -> list[dict]:
    items = []
    for region in regions:
        if region.key == GLOBAL_REGION_KEY:
            display, geography = GLOBAL_DISPLAY_NAME, "Global"
        else:
            known = geo.get(region.arm_region_name.lower())
            if known:
                display = known.get("displayName") or region.location or region.arm_region_name
                geography = known.get("geography") or "Other"
            else:
                display = region.location or region.arm_region_name
                geography = "Other"
        items.append(
            {
                "key": region.key,
                "armRegionName": region.arm_region_name,
                "location": region.location,
                "displayName": display,
                "geography": geography,
                "rowCount": region.rows,
            }
        )

    def order(item: dict) -> tuple:
        geography = item["geography"]
        rank = GEOGRAPHY_ORDER.index(geography) if geography in GEOGRAPHY_ORDER else len(GEOGRAPHY_ORDER)
        return (rank, geography, item["displayName"].casefold(), item["key"])

    items.sort(key=order)
    return items


# --------------------------------------------------------------------------------------------
# vm-skus.json
# --------------------------------------------------------------------------------------------

def load_vm_skus_base(path: Path | None = None) -> dict:
    path = path or data_dir() / "vm-skus.base.json"
    base = load_json(path, "VM specs base file")
    if not isinstance(base, dict) or not isinstance(base.get("skus"), dict):
        raise PipelineError(f"{path}: expected {{\"source\": ..., \"skus\": {{...}}}}")
    return base


def _clean_spec(spec: Any) -> dict | None:
    if not isinstance(spec, dict):
        return None
    vcpus, memory = parse_price(spec.get("vCPUs")), parse_price(spec.get("memoryGB"))
    if vcpus is None or memory is None:
        return None
    out: dict[str, Any] = {"vCPUs": compact_number(vcpus), "memoryGB": compact_number(memory)}
    if spec.get("family"):
        out["family"] = str(spec["family"])
    return out


def vm_skus_index(base: dict, price_skus: Iterable[str]) -> dict:
    """Base specs plus every armSkuName seen in Virtual Machines prices (null when unknown)."""
    skus: dict[str, dict | None] = {name: _clean_spec(spec) for name, spec in base["skus"].items()}
    folded = {name.lower(): spec for name, spec in skus.items()}
    unknown = 0
    for name in price_skus:
        if name in skus:
            continue
        skus[name] = folded.get(name.lower())
        if skus[name] is None:
            unknown += 1
    if unknown:
        log.info("vm-skus: %d priced SKU(s) without specs (null); refresh with scripts/export-vm-skus.sh", unknown)
    return {"source": str(base.get("source") or "seed"), "skus": dict(sorted(skus.items()))}


# --------------------------------------------------------------------------------------------
# fx.json
# --------------------------------------------------------------------------------------------

def parse_fx_csv(stream: TextIO) -> dict[str, float]:
    """Parse the exporter's FX CSV (`currency,fxRate`: units of currency per 1 USD)."""
    reader = csv.reader(stream)
    header = next(reader, None)
    if header is None:
        raise PipelineError("FX CSV is empty")
    names = [h.strip().lstrip("\ufeff").strip().lower() for h in header]
    currency_col = next((i for i, n in enumerate(names) if n in ("currency", "currencycode", "code")), None)
    if currency_col is None:
        currency_col = next((i for i, n in enumerate(names) if "currency" in n), None)
    rate_col = next((i for i, n in enumerate(names) if "rate" in n and i != currency_col), None)
    if currency_col is None or rate_col is None:
        raise PipelineError(f"FX CSV header must contain a currency and a rate column, got {header}")
    rates: dict[str, float] = {}
    bad: list[str] = []
    for rec in reader:
        if not rec or not any(cell.strip() for cell in rec):
            continue
        code = rec[currency_col].strip().upper() if len(rec) > currency_col else ""
        rate = parse_price(rec[rate_col]) if len(rec) > rate_col else None
        if not _CURRENCY_CODE.match(code) or rate is None or rate <= 0:
            bad.append(",".join(rec))
            continue
        rates[code] = rate
    if bad:
        log.warning("FX CSV: ignored %d invalid row(s), e.g. %s", len(bad), bad[:3])
    if not rates:
        raise PipelineError("FX CSV has no valid currency rows")
    return rates


def fx_index(rates: dict[str, float], as_of: str) -> dict:
    table: dict[str, int | float] = {"USD": 1}
    for code in sorted(rates):
        if code != "USD":
            table[code] = compact_number(rates[code])
    return {"asOf": as_of, "base": "USD", "rates": table}
