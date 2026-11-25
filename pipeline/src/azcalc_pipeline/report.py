"""report.json, the Markdown run summary, size limits and "probes".

Probes sample how real meters are named in a few reference regions, to help adapt the SPA's
matchers (VM / disks / backup / ASR / SQL licenses) after a run against the real export.
"""

from __future__ import annotations

import logging
import os
import re
from collections import Counter
from collections.abc import Iterable, Sequence

from .transform import (
    METER_NAME,
    PRICE,
    PRODUCT,
    SKU,
    TYPE,
    UNIT,
    WINDOWS,
    PublishResult,
    ReadStats,
    Row,
)

log = logging.getLogger(__name__)

REFERENCE_REGIONS: tuple[str, ...] = ("westeurope", "eastus", "southcentralus", "israelcentral")
DEFAULT_MAX_TOTAL_BYTES = 900_000_000
DEFAULT_MAX_FILE_BYTES = 95_000_000
TOP_FILES = 20

_SSD_V2_ULTRA = re.compile(r"Premium SSD v2|Ultra", re.IGNORECASE)
_SITE_RECOVERY = re.compile(r"site recovery", re.IGNORECASE)
_LICENSE = re.compile(r"licen[cs]e", re.IGNORECASE)
_SQL = re.compile(r"SQL", re.IGNORECASE)


def human_bytes(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if abs(n) < 1000 or unit == "GB":
            return f"{n:,.0f} {unit}" if unit == "B" else f"{n:,.1f} {unit}"
        n /= 1000
    return f"{n:,.1f} GB"  # pragma: no cover


def _meter_list(counter: Counter, limit: int) -> list[dict]:
    items = sorted(counter.items(), key=lambda kv: (kv[0][0].casefold(), kv[0][1]))
    return [{"meterName": m, "unitOfMeasure": u, "rows": n} for (m, u), n in items[:limit]]


def _example(row: Row, region_key: str) -> dict:
    return {
        "productName": row[PRODUCT],
        "skuName": row[SKU],
        "meterName": row[METER_NAME],
        "unitOfMeasure": row[UNIT],
        "type": row[TYPE],
        "retailPrice": row[PRICE],
        "regionKey": region_key,
    }


class ProbeCollector:
    """Group observer (see transform.write_shards) that samples meter naming for report.json."""

    def __init__(self, reference_regions: Sequence[str] = REFERENCE_REGIONS) -> None:
        self.reference = tuple(r.lower() for r in reference_regions)
        self.present: set[str] = set()
        self.vm: dict[str, dict[str, int]] = {}
        self.disk_products: Counter[str] = Counter()
        self.ssd_v2_ultra: list[dict] = []
        self.backup: Counter[tuple[str, str]] = Counter()
        self.site_recovery: dict[str, Counter[tuple[str, str]]] = {}
        self.license_products: dict[str, Counter[str]] = {}
        self.sql_preferred: dict[str, list[dict]] = {}
        self.sql_other: dict[str, list[dict]] = {}

    def __call__(self, service: str, region: str, region_key: str, main_rows: list, spot_rows: list) -> None:
        in_reference = region.lower() in self.reference
        if in_reference:
            self.present.add(region.lower())
        if service == "Virtual Machines" and in_reference:
            counts = self.vm.setdefault(region.lower(), {
                "consumptionLinux": 0, "consumptionWindows": 0, "reservation": 0,
                "savingsPlans": 0, "otherTypes": 0, "spotRows": 0,
            })
            for row in main_rows:
                row_type = row[TYPE]
                if row_type == "Consumption":
                    counts["consumptionWindows" if row[WINDOWS] else "consumptionLinux"] += 1
                elif row_type == "Reservation":
                    counts["reservation"] += 1
                elif row_type == "SavingsPlans":
                    counts["savingsPlans"] += 1
                else:
                    counts["otherTypes"] += 1
            counts["spotRows"] += len(spot_rows)
        elif service == "Storage" and in_reference:
            for row in main_rows:
                product = row[PRODUCT]
                if "disk" in product.lower():
                    self.disk_products[product] += 1
                if _SSD_V2_ULTRA.search(product) and len(self.ssd_v2_ultra) < 20:
                    self.ssd_v2_ultra.append(_example(row, region_key))
        elif service == "Backup" and in_reference:
            for row in main_rows:
                self.backup[(row[METER_NAME], row[UNIT])] += 1
        if _SITE_RECOVERY.search(service) and (in_reference or not region):
            counter = self.site_recovery.setdefault(service, Counter())
            for row in main_rows:
                counter[(row[METER_NAME], row[UNIT])] += 1
        if _LICENSE.search(service):
            products = self.license_products.setdefault(service, Counter())
            preferred = self.sql_preferred.setdefault(service, [])
            other = self.sql_other.setdefault(service, [])
            target = preferred if (in_reference or not region) else other
            for row in main_rows:
                products[row[PRODUCT]] += 1
                if _SQL.search(row[PRODUCT]) and len(target) < 40:
                    target.append(_example(row, region_key))

    def result(self) -> dict:
        present = [r for r in self.reference if r in self.present]
        disk_products = sorted(self.disk_products.items(), key=lambda kv: (-kv[1], kv[0]))[:40]
        licenses = {}
        for service, products in sorted(self.license_products.items()):
            ranked = sorted(products.items(), key=lambda kv: (not _SQL.search(kv[0]), -kv[1], kv[0]))
            licenses[service] = {
                "productCount": len(products),
                "products": [{"productName": p, "rows": n} for p, n in ranked[:60]],
                "sqlExamples": (self.sql_preferred.get(service, []) + self.sql_other.get(service, []))[:40],
            }
        return {
            "referenceRegions": present,
            "virtualMachines": {r: self.vm[r] for r in present if r in self.vm},
            "storage": {
                "diskProducts": [{"productName": p, "rows": n} for p, n in disk_products],
                "ssdV2UltraExamples": self.ssd_v2_ultra,
            },
            "backup": {"meters": _meter_list(self.backup, 60)},
            "siteRecovery": {s: {"meters": _meter_list(c, 40)} for s, c in sorted(self.site_recovery.items())},
            "licenses": licenses,
        }


def size_violations(files: Iterable[tuple[str, int]], max_total: int, max_file: int) -> list[str]:
    files = list(files)
    problems = []
    total = sum(size for _, size in files)
    if total > max_total:
        problems.append(f"total size {human_bytes(total)} exceeds the limit of {human_bytes(max_total)}")
    for path, size in files:
        if size > max_file:
            problems.append(f"{path} is {human_bytes(size)} (limit {human_bytes(max_file)})")
    return problems


def build_report(
    *,
    prices_date: str,
    generated_at: str,
    source: dict,
    stats: ReadStats,
    published: PublishResult,
    files: Sequence[tuple[str, int]],
    warnings: Sequence[str],
    probes: dict,
    limits: dict,
) -> dict:
    total = sum(size for _, size in files)
    largest = sorted(files, key=lambda f: (-f[1], f[0]))[:TOP_FILES]
    services = sorted(published.services, key=lambda s: (-s.rows, s.name))
    by_bytes = sorted(published.services, key=lambda s: (-s.bytes, s.name))[:TOP_FILES]
    return {
        "pricesDate": prices_date,
        "generatedAt": generated_at,
        "source": source,
        "rows": {
            "read": stats.rows_read,
            "invalidDropped": stats.invalid.count,
            "filteredByRegion": stats.filtered_region,
            "filteredByService": stats.filtered_service,
            "devTestDropped": stats.devtest_dropped,
            "savingsPlanExpanded": stats.savings_plan_expanded,
            "duplicatesDropped": published.duplicates_dropped,
            "published": published.rows_published,
            "savingsPlanRows": published.savings_plan_rows,
        },
        "sizes": {
            "totalBytes": total,
            "files": len(files),
            "largestFiles": [{"path": p, "bytes": b} for p, b in largest],
            "largestServices": [{"serviceName": s.name, "slug": s.slug, "bytes": s.bytes, "files": s.files}
                                for s in by_bytes],
        },
        "services": [
            {"serviceName": s.name, "slug": s.slug, "serviceFamily": s.family, "rows": s.rows,
             "spotRows": s.spot_rows, "regions": len(s.regions), "products": len(s.products), "bytes": s.bytes}
            for s in services
        ],
        "limits": limits,
        "warnings": list(warnings),
        "probes": probes,
    }


def render_markdown(report: dict, *, failed: Sequence[str] = ()) -> str:
    rows, sizes, source = report["rows"], report["sizes"], report["source"]
    origin = source.get("type", "?")
    if source.get("tag"):
        origin += f" `{source['tag']}`"
    lines = [
        f"### Azure price data snapshot {report['pricesDate']}",
        "",
        "| | |",
        "|---|---|",
        f"| Source | {origin} |",
        f"| Rows read / published | {rows['read']:,} / {rows['published']:,} |",
        f"| Dropped | invalid {rows['invalidDropped']:,} · DevTest {rows['devTestDropped']:,} · "
        f"duplicates {rows['duplicatesDropped']:,} · filtered {rows['filteredByRegion'] + rows['filteredByService']:,} |",
        f"| Savings plan rows | {rows['savingsPlanRows']:,} |",
        f"| Services | {len(report['services']):,} |",
        f"| Files / size | {sizes['files']:,} / {human_bytes(sizes['totalBytes'])} |",
        "",
        "| Largest files | Size |",
        "|---|---:|",
    ]
    lines += [f"| `{f['path']}` | {human_bytes(f['bytes'])} |" for f in sizes["largestFiles"][:10]]
    if report["warnings"]:
        lines += ["", "**Warnings**", ""] + [f"- {w}" for w in report["warnings"]]
    if failed:
        lines += ["", "**FAILED: size limits exceeded, nothing was published**", ""] + [f"- {p}" for p in failed]
    return "\n".join(lines) + "\n"


def emit_summary(markdown: str) -> None:
    """Print the summary and append it to the GitHub Actions job summary when available."""
    print(markdown)
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        try:
            with open(summary_path, "a", encoding="utf-8") as fh:
                fh.write(markdown + "\n")
        except OSError as exc:
            log.warning("could not write GITHUB_STEP_SUMMARY: %s", exc)
