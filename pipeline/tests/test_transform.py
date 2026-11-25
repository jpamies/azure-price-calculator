import json
import unittest
from pathlib import Path

from _helpers import make_row, read_rows, scratch_dir
from azcalc_pipeline.transform import (
    COLS,
    DATE,
    TERM,
    TIER,
    TYPE,
    WINDOWS,
    decode_shard,
    is_spot,
    render_parts,
    write_shards,
)
from azcalc_pipeline.validate import SavingsPlanOrphanCheck

VM = ("Virtual Machines", "eastus")


class ReadTests(unittest.TestCase):
    def test_spot_and_low_priority_rows_are_split_out(self) -> None:
        rows = [
            make_row(),
            make_row(meterId="s1", meterName="D2s v5 Spot", skuName="D2s v5 Spot", retailPrice="0.01152"),
            make_row(meterId="s2", meterName="D2s v5 Low Priority", skuName="D2s v5 Low Priority"),
            make_row(meterId="s3", meterName="D2s v5", skuName="D2s v5 Spot"),
        ]
        result = read_rows(rows)
        self.assertEqual(len(result.main[VM]), 1)
        self.assertEqual(sorted(r[0] for r in result.spot[VM]), ["s1", "s2", "s3"])
        self.assertTrue(is_spot("D2 Low Priority", ""))
        self.assertFalse(is_spot("D2s v5", "D2s v5"))

    def test_devtest_rows_are_dropped(self) -> None:
        result = read_rows([make_row(), make_row(meterId="dev", type="DevTestConsumption")])
        self.assertEqual([r[0] for r in result.main[VM]], ["11111111-1111-1111-1111-111111111111"])
        self.assertEqual(result.stats.devtest_dropped, 1)

    def test_derived_columns(self) -> None:
        rows = [
            make_row(productName="Virtual Machines Dsv5 Series Windows", reservationTerm="1 Year",
                     effectiveStartDate="2024-05-01T00:00:00Z", tierMinimumUnits="51200.0"),
            make_row(meterId="ri", type="Reservation", reservationTerm="3 Years", retailPrice="958.69"),
        ]
        consumption, reservation = sorted(read_rows(rows).main[VM], key=lambda r: r[TYPE])
        self.assertEqual(consumption[WINDOWS], 1)
        self.assertEqual(consumption[TERM], "")  # terms only for Reservation / SavingsPlans
        self.assertEqual(consumption[DATE], "2024-05-01")
        self.assertEqual(consumption[TIER], 51200)
        self.assertIsInstance(consumption[TIER], int)
        self.assertEqual((reservation[TYPE], reservation[TERM], reservation[WINDOWS]), ("Reservation", "3 Years", 0))

    def test_region_and_service_filters(self) -> None:
        rows = [
            make_row(),
            make_row(meterId="we", armRegionName="westeurope"),
            make_row(meterId="glob", armRegionName="", serviceName="Virtual Machines Licenses"),
            make_row(meterId="st", serviceName="Storage"),
        ]
        result = read_rows(rows, regions=["EastUS"], services=["virtual machines", "Virtual Machines Licenses"])
        self.assertEqual(set(result.main), {VM, ("Virtual Machines Licenses", "")})
        self.assertEqual((result.stats.filtered_region, result.stats.filtered_service), (1, 1))


class WriteTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = scratch_dir()
        self.prices = Path(self._tmp.name) / "2026-11-24" / "prices"

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def load(self, relative: str) -> dict:
        return json.loads((self.prices / relative).read_text(encoding="utf-8"))

    def test_shard_files_sorting_and_exact_duplicates(self) -> None:
        rows = [
            make_row(meterId="b", productName="Virtual Machines Dsv5 Series Windows", retailPrice="0.188"),
            make_row(meterId="a"),
            make_row(meterId="a"),  # exact duplicate
            make_row(meterId="c", type="Reservation", reservationTerm="1 Year", retailPrice="496.17"),
            make_row(meterId="s", meterName="D2s v5 Spot", skuName="D2s v5 Spot", retailPrice="0.01152"),
            make_row(meterId="g", armRegionName="", location="", serviceName="Azure DNS", productName="Azure DNS",
                     skuName="Public", meterName="Public Zone", unitOfMeasure="1/Month", retailPrice="0.5"),
        ]
        published = write_shards(read_rows(rows), self.prices)
        self.assertEqual(published.duplicates_dropped, 1)
        self.assertEqual(published.rows_published, 5)
        self.assertEqual(published.shards["virtual-machines"]["eastus"],
                         {"parts": 1, "rows": 3, "bytes": (self.prices / "virtual-machines/eastus.json").stat().st_size,
                          "spot": True, "spotRows": 1})
        self.assertEqual(published.shards["azure-dns"]["_global"]["rows"], 1)
        main = self.load("virtual-machines/eastus.json")
        self.assertEqual(main["service"], "Virtual Machines")
        self.assertEqual(main["region"], "eastus")
        self.assertEqual(main["cols"], list(COLS))
        decoded = decode_shard(main)
        # productName, skuName, meterName, type, ... => Linux Consumption, Linux Reservation, Windows
        self.assertEqual([r["meterId"] for r in decoded], ["a", "c", "b"])
        self.assertEqual(decoded[0]["isWindows"], 0)
        self.assertEqual(decoded[2]["isWindows"], 1)
        spot = self.load("virtual-machines/eastus.spot.json")
        self.assertEqual([r[0] for r in spot["rows"]], ["s"])
        self.assertTrue((self.prices / "azure-dns/_global.json").is_file())
        self.assertEqual(published.vm_skus, {"Standard_D2s_v5"})
        self.assertEqual(published.savings_plan_rows, 0)

    def test_large_shards_are_split_into_parts(self) -> None:
        rows = [make_row(meterId=f"meter-{i:04d}", meterName=f"Meter {i:04d}", skuName=f"Sku {i:04d}") for i in range(60)]
        published = write_shards(read_rows(rows), self.prices, part_max_bytes=2048)
        entry = published.shards["virtual-machines"]["eastus"]
        self.assertGreater(entry["parts"], 1)
        self.assertFalse((self.prices / "virtual-machines/eastus.json").exists())
        all_rows = []
        for i in range(1, entry["parts"] + 1):
            path = self.prices / f"virtual-machines/eastus.part{i}.json"
            self.assertLessEqual(path.stat().st_size, 2048)
            document = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(document["cols"], list(COLS))
            all_rows.extend(document["rows"])
        self.assertFalse((self.prices / f"virtual-machines/eastus.part{entry['parts'] + 1}.json").exists())
        self.assertEqual(len(all_rows), 60)
        self.assertEqual(entry["rows"], 60)
        self.assertEqual(entry["bytes"], sum(f.bytes for f in published.files))
        unsplit_dir = self.prices.parent / "unsplit"
        write_shards(read_rows(rows), unsplit_dir)
        unsplit = json.loads((unsplit_dir / "virtual-machines/eastus.json").read_text(encoding="utf-8"))
        self.assertEqual(all_rows, unsplit["rows"])  # parts concatenated == the unsplit shard

    def test_savings_plans_without_payg_row_are_reported(self) -> None:
        d4 = {"meterId": "m4", "meterName": "D4s v5", "skuName": "D4s v5", "armSkuName": "Standard_D4s_v5"}
        rows = [
            make_row(type="SavingsPlans", reservationTerm="1 Year", retailPrice="0.0658368"),  # D2s v5: no PAYG
            make_row(**d4, retailPrice="0.192"),
            make_row(**d4, type="SavingsPlans", reservationTerm="1 Year", retailPrice="0.13"),
        ]
        check = SavingsPlanOrphanCheck()
        published = write_shards(read_rows(rows), self.prices, observers=[check])
        self.assertEqual(published.savings_plan_rows, 2)
        self.assertEqual(check.issues.count, 1)
        self.assertEqual(check.issues.examples, ["eastus Standard_D2s_v5 (Virtual Machines Dsv5 Series)"])

    def test_render_parts_keeps_small_shards_whole(self) -> None:
        rows = [("id", "m", "p", "s", "a", "1 Hour", "Consumption", "", 0, 0.5, "2024-01-01", 0)]
        (document, count), = render_parts("Svc", "eastus", rows, part_max_bytes=10_000)
        self.assertEqual(count, 1)
        self.assertEqual(json.loads(document)["rows"], [list(rows[0])])


if __name__ == "__main__":
    unittest.main()
