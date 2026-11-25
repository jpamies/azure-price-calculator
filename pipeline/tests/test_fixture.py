import csv
import unittest
from pathlib import Path

from _helpers import scratch_dir
from azcalc_pipeline import fixtures_dir
from azcalc_pipeline.fixture import COLUMNS, FX_FILE, PRICES_FILE, generate_rows, write_fixture


class FixtureTests(unittest.TestCase):
    def test_committed_fixture_matches_the_generator(self) -> None:
        with scratch_dir() as tmp:
            prices, fx = write_fixture(Path(tmp))
            for generated, committed in ((prices, fixtures_dir() / PRICES_FILE), (fx, fixtures_dir() / FX_FILE)):
                with self.subTest(file=committed.name):
                    self.assertEqual(generated.read_bytes(), committed.read_bytes(),
                                     "fixture is stale: run `azcalc-pipeline fixture --out pipeline/tests/fixtures`")

    def test_header_and_row_count(self) -> None:
        with open(fixtures_dir() / PRICES_FILE, encoding="utf-8", newline="") as fh:
            rows = list(csv.reader(fh))
        self.assertEqual(tuple(rows[0]), COLUMNS)
        self.assertEqual(len(rows) - 1, len(generate_rows()))
        self.assertEqual(len({len(r) for r in rows}), 1)

    def test_sql_server_licenses_one_global_meter_per_edition(self) -> None:
        licenses = [r for r in generate_rows() if r["serviceName"] == "Virtual Machines Licenses"]
        self.assertEqual(
            sorted((r["productName"], r["retailPrice"]) for r in licenses),
            [("SQL Server Enterprise", "1.5"), ("SQL Server Standard", "0.4"), ("SQL Server Web", "0.0536")],
        )
        for row in licenses:
            self.assertEqual(
                (row["armRegionName"], row["location"], row["skuName"], row["meterName"], row["unitOfMeasure"],
                 row["type"], row["serviceFamily"]),
                ("", "", "1-4 vCPU VM", "1-4 vCPU VM License", "1 Hour", "Consumption", "Compute"),
            )
        self.assertEqual(len({r["meterId"] for r in licenses}), 3)

    def test_embedded_exact_data_point(self) -> None:
        rows = [r for r in generate_rows() if r["armRegionName"] == "eastus" and r["armSkuName"] == "Standard_D2s_v5"
                and r["productName"] == "Virtual Machines Dsv5 Series" and r["meterName"] == "D2s v5"]
        consumption = [r for r in rows if r["type"] == "Consumption"]
        self.assertEqual([r["retailPrice"] for r in consumption], ["0.096"])
        plans = {r["reservationTerm"]: (r["retailPrice"], r["meterId"]) for r in rows if r["type"] == "SavingsPlans"}
        self.assertEqual(plans, {"1 Year": ("0.0658368", consumption[0]["meterId"]),
                                 "3 Years": ("0.0441792", consumption[0]["meterId"])})

    def test_regions_and_factors(self) -> None:
        def price(region: str, meter: str) -> float:
            (row,) = [r for r in generate_rows() if r["armRegionName"] == region and r["meterName"] == meter]
            return float(row["retailPrice"])

        self.assertEqual(price("eastus", "P30 LRS Disk"), 135.17)
        self.assertEqual(price("westeurope", "P30 LRS Disk"), 151.39)
        self.assertEqual(price("israelcentral", "P30 LRS Disk"), 162.2)
        self.assertEqual(price("eastus", "Premium LRS Provisioned IOPS"), 0.0000068)
        locations = {(r["armRegionName"], r["location"]) for r in generate_rows()}
        self.assertEqual(locations, {("eastus", "US East"), ("southcentralus", "US South Central"),
                                     ("westeurope", "EU West"), ("israelcentral", "IL Central"), ("", "")})


if __name__ == "__main__":
    unittest.main()
