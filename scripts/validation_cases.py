#!/usr/bin/env python3
"""Compute the three validation cases of docs/validation.md from a published data snapshot.

This is an independent (Python) re-implementation of the SPA formulas, used as a cross-check and
to get the numbers to compare with the official Azure Pricing Calculator after each data build.

Usage:
  python3 scripts/validation_cases.py dist/data            # local snapshot (CI)
  python3 scripts/validation_cases.py web/public/data      # local dev snapshot
  python3 scripts/validation_cases.py https://<user>.github.io/<repo>/data

Prints a Markdown table (and appends it to $GITHUB_STEP_SUMMARY when set). Missing reference
prices or an unreadable snapshot fail the build; comparison with the official calculator is manual.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import sys
import urllib.request
from typing import Any

HOURS = 730
EXCLUDED_PRODUCTS = re.compile(r"dedicated host|cloud services|promo|basic|sql|red hat|rhel|suse|ubuntu|byol", re.I)


def read_json(base: str, path: str) -> Any:
    if re.match(r"^https?://", base):
        req = urllib.request.Request(f"{base.rstrip('/')}/{path}", headers={"User-Agent": "azcalc-validation"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.load(resp)
    with open(os.path.join(base, path), encoding="utf-8") as fh:
        return json.load(fh)


def load_shard_index(base: str, manifest: dict) -> dict:
    """slug -> regionKey -> entry, from paths.shards (index/shards.json); older snapshots embed manifest.shards."""
    path = manifest.get("paths", {}).get("shards")
    if path:
        try:
            return read_json(base, path)
        except Exception as exc:  # noqa: BLE001 - report the read failure before checking legacy data
            print(f"validation_cases: cannot read {path}: {exc}", file=sys.stderr)
    return manifest.get("shards", {})


def load_rows(base: str, manifest: dict, shards: dict, services: list[dict], service_name: str,
              region: str) -> list[dict]:
    slug = next((s["slug"] for s in services if s["serviceName"] == service_name), None)
    if not slug:
        return []
    entry = shards.get(slug, {}).get(region)
    if not entry:
        return []
    root = manifest["paths"]["prices"]
    parts = int(entry.get("parts", 1))
    files = [f"{region}.json"] if parts <= 1 else [f"{region}.part{i}.json" for i in range(1, parts + 1)]
    rows: list[dict] = []
    for name in files:
        doc = read_json(base, f"{root}/{slug}/{name}")
        cols = doc["cols"]
        rows.extend(dict(zip(cols, r)) for r in doc["rows"])
    return rows


def latest(rows: list[dict]) -> dict | None:
    today = dt.date.today().isoformat()
    if not rows:
        return None
    current = [r for r in rows if (r.get("effectiveStartDate") or "") <= today] or rows
    return max(current, key=lambda r: r.get("effectiveStartDate") or "")


def vm_row(rows: list[dict], sku: str, windows: bool, typ: str, term: str = "") -> dict | None:
    cands = [
        r for r in rows
        if r["armSkuName"].lower() == sku.lower()
        and r["type"] == typ
        and (r.get("reservationTerm") or "") == term
        and bool(r["isWindows"]) == windows
        and not EXCLUDED_PRODUCTS.search(r["productName"])
    ]
    if not cands:
        return None
    shortest = min(len(r["productName"]) for r in cands)
    return latest([r for r in cands if len(r["productName"]) == shortest])


def disk_row(rows: list[dict], product: str, tier: str, redundancy: str) -> dict | None:
    sku = f"{tier} {redundancy}"
    cands = [
        r for r in rows
        if r["productName"].lower() == product.lower()
        and r["skuName"].lower() == sku.lower()
        and r["type"] == "Consumption"
        and r["meterName"].lower() == f"{sku} disk".lower()
    ]
    return latest(cands)


def money(v: float | None) -> str:
    return "n/a" if v is None else f"${v:,.2f}"


def main() -> int:
    base = sys.argv[1] if len(sys.argv) > 1 else "dist/data"
    try:
        manifest = read_json(base, "manifest.json")
        services = read_json(base, manifest["paths"]["services"])
        shards = load_shard_index(base, manifest)
    except Exception as exc:  # noqa: BLE001 - report invalid or unreadable snapshot
        print(f"validation_cases: cannot read snapshot at {base}: {exc}", file=sys.stderr)
        return 1

    out = [
        f"### Validation cases (snapshot {manifest.get('pricesDate')}, source: {manifest.get('source', {}).get('type')})",
        "",
        "| # | Case | Formula | This app (USD) |",
        "|---|---|---|---|",
    ]

    we = load_rows(base, manifest, shards, services, "Virtual Machines", "westeurope")
    win = vm_row(we, "Standard_D8as_v5", True, "Consumption")
    lin = vm_row(we, "Standard_D8as_v5", False, "Consumption")
    c1 = win["retailPrice"] * HOURS if win else None
    detail = f"{win['retailPrice']}/h × 730" if win else "price not found"
    if win and lin:
        detail += f" (Linux {lin['retailPrice']}/h + Windows license {win['retailPrice'] - lin['retailPrice']:.4f}/h)"
    out.append(f"| 1 | D8as v5, Windows (license included), West Europe, PAYG, 730 h | {detail} | {money(c1)}/month |")

    il = load_rows(base, manifest, shards, services, "Virtual Machines", "israelcentral")
    ri = vm_row(il, "Standard_D8as_v5", False, "Reservation", "3 Years")
    c2 = ri["retailPrice"] / 36 if ri else None
    out.append(
        f"| 2 | D8as v5, Linux, Reserved 3 years, Israel Central | "
        f"{'term total ' + str(ri['retailPrice']) + ' / 36' if ri else 'price not found'} | "
        f"{money(c2)}/month eq. (upfront {money(ri['retailPrice'] if ri else None)}) |"
    )

    sc = load_rows(base, manifest, shards, services, "Storage", "southcentralus")
    p30 = disk_row(sc, "Premium SSD Managed Disks", "P30", "LRS")
    e15 = disk_row(sc, "Standard SSD Managed Disks", "E15", "ZRS")
    c3 = (p30["retailPrice"] + e15["retailPrice"]) if (p30 and e15) else None
    out.append(
        f"| 3 | P30 LRS + E15 ZRS, South Central US | "
        f"P30 LRS {p30['retailPrice'] if p30 else 'n/a'} + E15 ZRS {e15['retailPrice'] if e15 else 'n/a'} | "
        f"{money(c3)}/month |"
    )
    out += ["", "Compare with https://azure.microsoft.com/pricing/calculator/ (USD, same region/options). Tolerance ±1 %."]

    text = "\n".join(out)
    print(text)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as fh:
            fh.write(text + "\n")
    if c1 is None or c2 is None or c3 is None:
        print("validation_cases: one or more reference prices are missing", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
