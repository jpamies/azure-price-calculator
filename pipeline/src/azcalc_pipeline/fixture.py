"""Deterministic SYNTHETIC sample of the exporter CSVs (pipeline/tests/fixtures/).

Prices are made up (ballpark list prices) - see pipeline/tests/fixtures/README.md.
Regenerate with: PYTHONPATH=pipeline/src python3 -m azcalc_pipeline fixture --out pipeline/tests/fixtures
"""

from __future__ import annotations

import csv
import uuid
from pathlib import Path

PRICES_FILE = "prices-sample.csv"
FX_FILE = "fxrates-sample.csv"
FIXTURE_DATE = "2026-11-24"
NAMESPACE = uuid.UUID("5d3f0b8e-2c4a-5e71-9b6d-8a1f4c7e2d90")

#: Column order of the exporter CSV as reproduced here (the pipeline maps columns by name).
COLUMNS: tuple[str, ...] = (
    "currencyCode", "tierMinimumUnits", "retailPrice", "unitPrice", "armRegionName", "location",
    "effectiveStartDate", "meterId", "meterName", "productId", "skuId", "availabilityId", "productName",
    "skuName", "serviceName", "serviceId", "serviceFamily", "unitOfMeasure", "type", "isPrimaryMeterRegion",
    "armSkuName", "reservationTerm",
)

#: (armRegionName, location, price factor)
REGIONS: tuple[tuple[str, str, float], ...] = (
    ("eastus", "US East", 1.00),
    ("southcentralus", "US South Central", 1.00),
    ("westeurope", "EU West", 1.12),
    ("israelcentral", "IL Central", 1.20),
)

#: (family, sku/meter name pattern, armSkuName pattern, vCPU sizes, Linux PAYG USD per vCPU-hour)
VM_FAMILIES = (
    ("Dsv5", "D{n}s v5", "Standard_D{n}s_v5", (2, 4, 8, 16, 32), 0.048),
    ("Dasv5", "D{n}as v5", "Standard_D{n}as_v5", (2, 4, 8, 16, 32), 0.043),
    ("Esv5", "E{n}s v5", "Standard_E{n}s_v5", (2, 4, 8, 16, 32), 0.063),
    ("Fsv2", "F{n}s v2", "Standard_F{n}s_v2", (2, 4, 8, 16, 32), 0.0423),
    ("Bsv2", "B{n}s v2", "Standard_B{n}s_v2", (2, 4, 8, 16), 0.0416),
)
WINDOWS_PER_VCPU_HOUR = 0.046
SPOT_LINUX, LOW_PRIORITY_LINUX, SPOT_WINDOWS = 0.12, 0.20, 0.25
RESERVATION_1Y, RESERVATION_3Y = 0.59, 0.38  # share of PAYG over the term
SAVINGS_PLAN_1Y, SAVINGS_PLAN_3Y = 0.686, 0.46  # share of the PAYG hourly rate
#: Real-looking data point embedded verbatim (instead of the ratios above).
EXACT_SAVINGS_PLANS = {("eastus", "Standard_D2s_v5"): {"1 Year": 0.0658368, "3 Years": 0.0441792}}

PREMIUM_SSD = (("P1", 0.77), ("P2", 1.54), ("P3", 3.01), ("P4", 5.28), ("P6", 10.21), ("P10", 19.71),
               ("P15", 38.02), ("P20", 73.22), ("P30", 135.17), ("P40", 259.05), ("P50", 495.57),
               ("P60", 946.08), ("P70", 1802.13), ("P80", 3604.25))
STANDARD_SSD = (("E1", 0.30), ("E2", 0.60), ("E3", 1.20), ("E4", 2.40), ("E6", 4.80), ("E10", 9.60),
                ("E15", 19.20), ("E20", 38.40), ("E30", 76.80), ("E40", 153.60), ("E50", 307.20),
                ("E60", 614.40), ("E70", 1228.80), ("E80", 2457.60))
STANDARD_HDD = (("S4", 1.54), ("S6", 3.01), ("S10", 5.89), ("S15", 11.33), ("S20", 21.76), ("S30", 40.96),
                ("S40", 77.83), ("S50", 143.36), ("S60", 262.14), ("S70", 524.29), ("S80", 1048.58))

#: SQL Server licenses: ONE global meter per edition, priced for a 1-4 vCPU VM (USD/hour).
#: Mirrors the real Retail Prices API naming; the SPA bills N > 4 vCPUs as price x N/4.
SQL_LICENSES = (("SQL Server Standard", 0.40), ("SQL Server Enterprise", 1.50), ("SQL Server Web", 0.0536))
SQL_LICENSE_SKU = "1-4 vCPU VM"
SQL_LICENSE_METER = "1-4 vCPU VM License"

FX_RATES = (("EUR", 0.92), ("GBP", 0.79), ("JPY", 154.5), ("AUD", 1.52), ("CAD", 1.38), ("CHF", 0.88),
            ("DKK", 6.86), ("INR", 84.3), ("KRW", 1380), ("NOK", 10.9), ("NZD", 1.66), ("SEK", 10.6),
            ("TWD", 32.1), ("BRL", 5.7), ("MXN", 18.2), ("SGD", 1.34))

DATE_VM = "2024-05-01T00:00:00Z"
DATE_STORAGE = "2023-10-01T00:00:00Z"
DATE_BACKUP = "2024-02-01T00:00:00Z"
DATE_ASR = "2022-07-01T00:00:00Z"
DATE_LICENSE = "2023-01-01T00:00:00Z"
DATE_OTHER = "2024-01-01T00:00:00Z"


def _uuid(*parts: object) -> str:
    return str(uuid.uuid5(NAMESPACE, "|".join(str(p) for p in parts)))


def _code(*parts: object) -> str:
    """Product/service id lookalike, e.g. DZH3A1B2C3D4."""
    return "DZH3" + uuid.uuid5(NAMESPACE, "code|" + "|".join(str(p) for p in parts)).hex[:8].upper()


def _num(value: float) -> str:
    """pandas.to_csv float formatting (repr), e.g. 0.096, 51200.0, 6.8e-06."""
    return repr(float(value))


def hourly(value: float) -> float:
    """Round an hourly/unit price: 6 decimals, or 10 for sub-0.001 prices so they keep their digits."""
    return round(value, 6) if abs(value) >= 0.001 else round(value, 10)


def regional(base: float, factor: float, unit: str) -> float:
    """Apply a region factor; flat monthly prices ("1/Month") are rounded to cents."""
    value = base * factor
    return round(value, 2) if unit == "1/Month" else hourly(value)


class _Rows:
    def __init__(self) -> None:
        self.rows: list[dict[str, str]] = []

    def add(
        self,
        *,
        service: str,
        family: str,
        product: str,
        sku: str,
        meter: str,
        unit: str,
        price: float,
        region: str = "",
        location: str = "",
        row_type: str = "Consumption",
        term: str = "",
        arm_sku: str = "",
        tier: float = 0.0,
        date: str = DATE_OTHER,
        meter_id: str | None = None,
    ) -> None:
        product_id = _code("product", service, product)
        self.rows.append({
            "currencyCode": "USD",
            "tierMinimumUnits": _num(tier),
            "retailPrice": _num(price),
            "unitPrice": _num(price),
            "armRegionName": region,
            "location": location,
            "effectiveStartDate": date,
            "meterId": meter_id or _uuid("meter", service, region, product, sku, meter, row_type, term),
            "meterName": meter,
            "productId": product_id,
            "skuId": f"{product_id}/{_code('sku', service, product, sku)[-4:]}",
            "availabilityId": "",
            "productName": product,
            "skuName": sku,
            "serviceName": service,
            "serviceId": _code("service", service),
            "serviceFamily": family,
            "unitOfMeasure": unit,
            "type": row_type,
            "isPrimaryMeterRegion": "True",
            "armSkuName": arm_sku,
            "reservationTerm": term,
        })


def _virtual_machines(out: _Rows, region: str, location: str, factor: float) -> None:
    common = {"service": "Virtual Machines", "family": "Compute", "unit": "1 Hour", "region": region,
              "location": location, "date": DATE_VM}
    for family, sku_pattern, arm_pattern, sizes, rate in VM_FAMILIES:
        linux_product = f"Virtual Machines {family} Series"
        windows_product = f"{linux_product} Windows"
        for n in sizes:
            sku = sku_pattern.format(n=n)
            arm = arm_pattern.format(n=n)
            linux = hourly(n * rate * factor)
            windows = hourly(n * (rate + WINDOWS_PER_VCPU_HOUR) * factor)
            linux_meter = _uuid("vm", region, arm, "linux")
            vm = dict(common, arm_sku=arm)
            out.add(**vm, product=linux_product, sku=sku, meter=sku, price=linux, meter_id=linux_meter)
            out.add(**vm, product=windows_product, sku=sku, meter=sku, price=windows)
            out.add(**vm, product=linux_product, sku=f"{sku} Spot", meter=f"{sku} Spot",
                    price=hourly(linux * SPOT_LINUX))
            out.add(**vm, product=linux_product, sku=f"{sku} Low Priority", meter=f"{sku} Low Priority",
                    price=hourly(linux * LOW_PRIORITY_LINUX))
            out.add(**vm, product=windows_product, sku=f"{sku} Spot", meter=f"{sku} Spot",
                    price=hourly(windows * SPOT_WINDOWS))
            out.add(**vm, product=linux_product, sku=sku, meter=sku, row_type="Reservation", term="1 Year",
                    price=round(linux * 8760 * RESERVATION_1Y, 2))
            out.add(**vm, product=linux_product, sku=sku, meter=sku, row_type="Reservation", term="3 Years",
                    price=round(linux * 26280 * RESERVATION_3Y, 2))
            exact = EXACT_SAVINGS_PLANS.get((region, arm), {})
            out.add(**vm, product=linux_product, sku=sku, meter=sku, row_type="SavingsPlans", term="1 Year",
                    price=exact.get("1 Year", hourly(linux * SAVINGS_PLAN_1Y)), meter_id=linux_meter)
            out.add(**vm, product=linux_product, sku=sku, meter=sku, row_type="SavingsPlans", term="3 Years",
                    price=exact.get("3 Years", hourly(linux * SAVINGS_PLAN_3Y)), meter_id=linux_meter)
            out.add(**vm, product=windows_product, sku=sku, meter=sku, row_type="DevTestConsumption", price=linux)


def _storage(out: _Rows, region: str, location: str, factor: float) -> None:
    common = {"service": "Storage", "family": "Storage", "region": region, "location": location,
              "date": DATE_STORAGE}

    def disk(product: str, tier: str, redundancy: str, base: float) -> None:
        out.add(**common, product=product, sku=f"{tier} {redundancy}", meter=f"{tier} {redundancy} Disk",
                unit="1/Month", price=regional(base, factor, "1/Month"))

    for tier, price in PREMIUM_SSD:
        disk("Premium SSD Managed Disks", tier, "LRS", price)
        disk("Premium SSD Managed Disks", tier, "ZRS", price * 1.5)
    for tier, price in STANDARD_SSD:
        disk("Standard SSD Managed Disks", tier, "LRS", price)
        disk("Standard SSD Managed Disks", tier, "ZRS", price * 1.25)
    for tier, price in STANDARD_HDD:
        disk("Standard HDD Managed Disks", tier, "LRS", price)
    # Distractors: must never be picked as a disk-size meter.
    out.add(**common, product="Premium SSD Managed Disks", sku="P30 LRS", meter="P30 LRS Disk Mount",
            unit="1/Month", price=regional(13.52, factor, "1/Month"))
    out.add(**common, product="Standard SSD Managed Disks", sku="E10 LRS", meter="Disk Operations",
            unit="10K", price=regional(0.002, factor, "10K"))
    for product, sku, meters in (
        ("Azure Premium SSD v2", "Premium LRS", (
            ("Premium LRS Provisioned Capacity", "1 GiB/Hour", 0.000110),
            ("Premium LRS Provisioned IOPS", "1/Hour", 0.0000068),
            ("Premium LRS Provisioned Throughput (MBps)", "1/Hour", 0.0000548))),
        ("Ultra Disks", "Ultra LRS", (
            ("Ultra LRS Provisioned Capacity", "1 GiB/Hour", 0.000164),
            ("Ultra LRS Provisioned IOPS", "1/Hour", 0.0000681),
            ("Ultra LRS Provisioned Throughput (MBps)", "1/Hour", 0.000479))),
    ):
        for meter, unit, price in meters:
            out.add(**common, product=product, sku=sku, meter=meter, unit=unit, price=regional(price, factor, unit))
    blob = dict(common, product="General Block Blob v2", sku="Hot LRS")
    stored = _uuid("blob", region, "Hot LRS Data Stored")
    for tier, price in ((0, 0.0184), (51200, 0.0177), (512000, 0.0170)):
        out.add(**blob, meter="Hot LRS Data Stored", unit="1 GB/Month", tier=tier,
                price=regional(price, factor, "1 GB/Month"), meter_id=stored)
    out.add(**blob, meter="Hot LRS Write Operations", unit="10K", price=regional(0.065, factor, "10K"))


def _backup_and_asr(out: _Rows, region: str, location: str, factor: float) -> None:
    backup = {"service": "Backup", "family": "Storage", "product": "Backup", "region": region,
              "location": location, "date": DATE_BACKUP}
    for meter, sku, unit, price in (
        ("Azure VM Protected Instances", "Azure VM", "1/Month", 10.00),
        ("SQL Server in Azure VM Protected Instances", "SQL Server in Azure VM", "1/Month", 15.00),
        ("LRS Data Stored", "Standard LRS", "1 GB/Month", 0.0224),
        ("GRS Data Stored", "Standard GRS", "1 GB/Month", 0.0448),
        ("ZRS Data Stored", "Standard ZRS", "1 GB/Month", 0.028),
        ("RA-GRS Data Stored", "Standard RA-GRS", "1 GB/Month", 0.056),
    ):
        out.add(**backup, sku=sku, meter=meter, unit=unit, price=regional(price, factor, unit))
    asr = {"service": "Azure Site Recovery", "family": "Management and Governance",
           "product": "Azure Site Recovery", "sku": "Standard", "unit": "1/Month", "region": region,
           "location": location, "date": DATE_ASR}
    for meter, price in (("VM Replicated to Azure", 25.00), ("VM Replicated to Customer Owned Sites", 16.00)):
        out.add(**asr, meter=meter, price=regional(price, factor, "1/Month"))


def _generic(out: _Rows, region: str, location: str, factor: float) -> None:
    where = {"region": region, "location": location, "date": DATE_OTHER}
    for sku, price in (("P1 v3", 0.169), ("P2 v3", 0.338)):
        out.add(**where, service="Azure App Service", family="Compute", product="Azure App Service Premium v3 Plan",
                sku=sku, meter=f"{sku} App", unit="1 Hour", price=regional(price, factor, "1 Hour"))
    egress = _uuid("bandwidth", region, "Standard Data Transfer Out")
    for tier, price in ((0, 0.0), (100, 0.087), (10340, 0.083), (51540, 0.07), (153940, 0.05)):
        out.add(**where, service="Bandwidth", family="Networking", product="Bandwidth", sku="Standard",
                meter="Standard Data Transfer Out", unit="1 GB", tier=tier, price=regional(price, factor, "1 GB"),
                meter_id=egress)
    out.add(**where, service="Log Analytics", family="Management and Governance", product="Log Analytics",
            sku="Analytics Logs", meter="Analytics Logs Data Ingestion", unit="1 GB",
            price=regional(2.30, factor, "1 GB"))
    out.add(**where, service="Key Vault", family="Security", product="Key Vault", sku="Standard",
            meter="Standard Operations", unit="10K", price=regional(0.03, factor, "10K"))


def _global(out: _Rows) -> None:
    for product, price in SQL_LICENSES:
        out.add(service="Virtual Machines Licenses", family="Compute", product=product, sku=SQL_LICENSE_SKU,
                meter=SQL_LICENSE_METER, unit="1 Hour", price=price, date=DATE_LICENSE)
    for meter, unit, price in (("Public Zone", "1/Month", 0.50), ("Public Queries", "1M", 0.40)):
        out.add(service="Azure DNS", family="Networking", product="Azure DNS", sku="Public", meter=meter,
                unit=unit, price=price)


def generate_rows() -> list[dict[str, str]]:
    """All fixture rows (as CSV string values), in file order."""
    out = _Rows()
    for region, location, factor in REGIONS:
        _virtual_machines(out, region, location, factor)
        _storage(out, region, location, factor)
        _backup_and_asr(out, region, location, factor)
        _generic(out, region, location, factor)
    _global(out)
    return out.rows


def write_fixture(out_dir: Path) -> tuple[Path, Path]:
    """Write prices-sample.csv and fxrates-sample.csv into out_dir."""
    out_dir.mkdir(parents=True, exist_ok=True)
    prices_path = out_dir / PRICES_FILE
    with open(prices_path, "w", encoding="utf-8", newline="") as fh:
        writer = csv.writer(fh, lineterminator="\n")
        writer.writerow(COLUMNS)
        for row in generate_rows():
            writer.writerow([row[c] for c in COLUMNS])
    fx_path = out_dir / FX_FILE
    with open(fx_path, "w", encoding="utf-8", newline="") as fh:
        writer = csv.writer(fh, lineterminator="\n")
        writer.writerow(("currency", "fxRate"))
        for code, rate in FX_RATES:
            writer.writerow((code, _num(rate)))
    return prices_path, fx_path
