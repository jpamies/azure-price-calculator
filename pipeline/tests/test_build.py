"""End-to-end: `azcalc-pipeline build` on the synthetic fixture (and failure modes)."""

import gzip
import json
import shutil
import stat
import unittest
import zipfile
from pathlib import Path

from _helpers import make_row, run_cli, scratch_dir, write_csv
from azcalc_pipeline import fixtures_dir
from azcalc_pipeline.fixture import COLUMNS
from azcalc_pipeline.transform import COLS, decode_shard

FIXTURES = fixtures_dir()
PRICES = FIXTURES / "prices-sample.csv"
FX = FIXTURES / "fxrates-sample.csv"


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def generated_entries(out: Path) -> list[str]:
    return sorted(p.name for p in out.iterdir()) if out.exists() else []


class FixtureBuildTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls._tmp = scratch_dir()
        cls.out = Path(cls._tmp.name) / "data"
        code, cls.stdout = run_cli("build", "--fixture", "--out", cls.out)
        assert code == 0, f"fixture build failed with exit code {code}"
        cls.manifest = load(cls.out / "manifest.json")
        cls.root = cls.out / cls.manifest["paths"]["root"]
        cls.shards = load(cls.out / cls.manifest["paths"]["shards"])

    @classmethod
    def tearDownClass(cls) -> None:
        cls._tmp.cleanup()

    def shard(self, slug: str, region: str, suffix: str = "") -> list[dict]:
        return decode_shard(load(self.root / "prices" / slug / f"{region}{suffix}.json"))

    def test_manifest_shape(self) -> None:
        m = self.manifest
        self.assertEqual(list(m), ["schemaVersion", "pricesDate", "generatedAt", "currencyBase", "hasSavingsPlan",
                                   "source", "paths", "stats"])
        self.assertEqual((m["schemaVersion"], m["pricesDate"], m["currencyBase"]), (1, "2026-11-24", "USD"))
        self.assertRegex(m["generatedAt"], r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
        self.assertTrue(m["hasSavingsPlan"])
        self.assertEqual(m["source"]["type"], "fixture")
        self.assertEqual(m["source"]["rowCount"], 1349)
        self.assertRegex(m["source"]["pricesSha256"], r"^[0-9a-f]{64}$")
        self.assertEqual(m["paths"], {
            "root": "2026-11-24", "services": "2026-11-24/index/services.json",
            "regions": "2026-11-24/index/regions.json", "vmSkus": "2026-11-24/index/vm-skus.json",
            "shards": "2026-11-24/index/shards.json", "fx": "2026-11-24/fx.json", "prices": "2026-11-24/prices",
            "report": "2026-11-24/report.json",
        })
        for key, path in m["paths"].items():
            self.assertTrue((self.out / path).exists(), key)
        files = [p for p in self.root.rglob("*") if p.is_file()]
        self.assertEqual(list(m["stats"]), ["rowsPublished", "shardCount", "files", "bytes"])
        self.assertEqual(m["stats"]["files"], len(files))
        self.assertEqual(m["stats"]["bytes"], sum(p.stat().st_size for p in files))
        self.assertEqual(generated_entries(self.out), ["2026-11-24", "manifest.json"])
        self.assertEqual(stat.S_IMODE(self.root.stat().st_mode) & 0o005, 0o005)  # Pages needs o+rx
        self.assertIn("Azure price data snapshot 2026-11-24", self.stdout)

    def test_shard_index_file(self) -> None:
        raw = (self.out / self.manifest["paths"]["shards"]).read_bytes()
        self.assertNotIn(b"\n", raw)  # compact JSON
        self.assertNotIn(b'": ', raw)
        self.assertEqual(list(self.shards), sorted(self.shards))
        self.assertEqual(self.manifest["stats"]["shardCount"], sum(len(r) for r in self.shards.values()))
        self.assertEqual(self.manifest["stats"]["shardCount"], 34)  # 8 regional services x 4 regions + 2 global
        self.assertEqual(self.shards["virtual-machines"]["eastus"],
                         {"parts": 1, "rows": 144, "bytes": self.shards["virtual-machines"]["eastus"]["bytes"],
                          "spot": True, "spotRows": 72})
        self.assertEqual(self.shards["storage"]["westeurope"]["spot"], False)
        self.assertNotIn("spotRows", self.shards["storage"]["westeurope"])
        manifest_size = (self.out / "manifest.json").stat().st_size
        self.assertLess(manifest_size, 1500)  # no per-shard data in the no-store manifest

    def test_every_shard_in_the_index_decodes(self) -> None:
        published = 0
        for slug, regions in self.shards.items():
            for region, entry in regions.items():
                with self.subTest(slug=slug, region=region):
                    self.assertEqual(entry["parts"], 1)
                    document = load(self.root / "prices" / slug / f"{region}.json")
                    self.assertEqual(document["cols"], list(COLS))
                    self.assertEqual(document["region"], region)
                    self.assertEqual(len(document["rows"]), entry["rows"])
                    self.assertEqual(entry["bytes"], (self.root / "prices" / slug / f"{region}.json").stat().st_size)
                    spot_path = self.root / "prices" / slug / f"{region}.spot.json"
                    self.assertEqual(spot_path.exists(), entry["spot"])
                    published += entry["rows"] + entry.get("spotRows", 0)
                    if entry["spot"]:
                        self.assertEqual(len(load(spot_path)["rows"]), entry["spotRows"])
        self.assertEqual(published, self.manifest["stats"]["rowsPublished"])

    def test_eastus_virtual_machines_exact_rows(self) -> None:
        rows = [r for r in self.shard("virtual-machines", "eastus") if r["armSkuName"] == "Standard_D2s_v5"]
        linux = [r for r in rows if r["productName"] == "Virtual Machines Dsv5 Series"]
        payg = [r for r in linux if r["type"] == "Consumption"]
        self.assertEqual([r["retailPrice"] for r in payg], [0.096])
        plans = {r["reservationTerm"]: r for r in linux if r["type"] == "SavingsPlans"}
        self.assertEqual({t: r["retailPrice"] for t, r in plans.items()}, {"1 Year": 0.0658368, "3 Years": 0.0441792})
        self.assertEqual({r["meterId"] for r in plans.values()}, {payg[0]["meterId"]})
        reservations = {r["reservationTerm"]: r["retailPrice"] for r in linux if r["type"] == "Reservation"}
        self.assertEqual(reservations, {"1 Year": 496.17, "3 Years": 958.69})
        windows = [r for r in rows if r["isWindows"] == 1]
        self.assertEqual([(r["type"], r["retailPrice"]) for r in windows], [("Consumption", 0.188)])
        self.assertFalse([r for r in rows if "Spot" in r["meterName"] or "Low Priority" in r["meterName"]])
        spot = [(r["productName"], r["meterName"], r["retailPrice"])
                for r in self.shard("virtual-machines", "eastus", ".spot") if r["armSkuName"] == "Standard_D2s_v5"]
        self.assertEqual(spot, [
            ("Virtual Machines Dsv5 Series", "D2s v5 Low Priority", 0.0192),
            ("Virtual Machines Dsv5 Series", "D2s v5 Spot", 0.01152),
            ("Virtual Machines Dsv5 Series Windows", "D2s v5 Spot", 0.047),
        ])
        all_types = {r["type"] for r in self.shard("virtual-machines", "eastus")}
        self.assertEqual(all_types, {"Consumption", "Reservation", "SavingsPlans"})

    def test_global_shards_for_licenses_and_dns(self) -> None:
        self.assertEqual(set(self.shards["virtual-machines-licenses"]), {"_global"})
        self.assertEqual(set(self.shards["azure-dns"]), {"_global"})
        licenses = self.shard("virtual-machines-licenses", "_global")
        self.assertEqual(
            sorted((r["productName"], r["retailPrice"]) for r in licenses),
            [("SQL Server Enterprise", 1.5), ("SQL Server Standard", 0.4), ("SQL Server Web", 0.0536)],
        )
        for row in licenses:
            self.assertEqual((row["skuName"], row["meterName"], row["unitOfMeasure"], row["type"]),
                             ("1-4 vCPU VM", "1-4 vCPU VM License", "1 Hour", "Consumption"))
        dns = {r["meterName"]: (r["unitOfMeasure"], r["retailPrice"]) for r in self.shard("azure-dns", "_global")}
        self.assertEqual(dns, {"Public Zone": ("1/Month", 0.5), "Public Queries": ("1M", 0.4)})

    def test_storage_tiers_and_distractors(self) -> None:
        rows = self.shard("storage", "westeurope")
        p30 = [r for r in rows if r["skuName"] == "P30 LRS"]
        self.assertEqual(sorted(r["meterName"] for r in p30), ["P30 LRS Disk", "P30 LRS Disk Mount"])
        price = {r["meterName"]: r["retailPrice"] for r in p30}
        self.assertEqual(price["P30 LRS Disk"], round(135.17 * 1.12, 2))
        blob = [(r["tierMinimumUnits"], r["retailPrice"]) for r in rows if r["meterName"] == "Hot LRS Data Stored"]
        self.assertEqual([t for t, _ in blob], [0, 51200, 512000])
        self.assertEqual(len({r["meterId"] for r in rows if r["meterName"] == "Hot LRS Data Stored"}), 1)

    def test_indexes(self) -> None:
        services = load(self.out / self.manifest["paths"]["services"])
        names = [s["serviceName"] for s in services]
        self.assertEqual(names, ["Azure App Service", "Virtual Machines", "Virtual Machines Licenses",
                                 "Azure Site Recovery", "Log Analytics", "Azure DNS", "Bandwidth", "Key Vault",
                                 "Backup", "Storage"])
        vm = services[1]
        self.assertEqual((vm["slug"], vm["hasSpot"], vm["regions"]),
                         ("virtual-machines", True, ["eastus", "israelcentral", "southcentralus", "westeurope"]))
        licenses = services[2]
        self.assertEqual((licenses["regions"], licenses["rowCount"], licenses["productCount"]), (["_global"], 3, 3))
        regions = {r["key"]: r for r in load(self.out / self.manifest["paths"]["regions"])}
        self.assertEqual(set(regions), {"_global", "eastus", "southcentralus", "westeurope", "israelcentral"})
        self.assertEqual((regions["westeurope"]["displayName"], regions["westeurope"]["location"]),
                         ("West Europe", "EU West"))
        self.assertEqual(regions["israelcentral"]["geography"], "Middle East")
        self.assertEqual(regions["_global"]["rowCount"], 5)
        vm_skus = load(self.out / self.manifest["paths"]["vmSkus"])
        priced = {r["armSkuName"] for r in self.shard("virtual-machines", "eastus")}
        self.assertTrue(priced <= set(vm_skus["skus"]))
        self.assertEqual(vm_skus["skus"]["Standard_D8s_v5"], {"vCPUs": 8, "memoryGB": 32, "family": "Dsv5"})
        fx = load(self.out / self.manifest["paths"]["fx"])
        self.assertEqual((fx["asOf"], fx["base"], fx["rates"]["USD"], fx["rates"]["EUR"]), ("2026-11-24", "USD", 1, 0.92))
        self.assertEqual(len(fx["rates"]), 17)

    def test_report(self) -> None:
        report = load(self.out / self.manifest["paths"]["report"])
        self.assertEqual(report["rows"]["read"], 1349)
        self.assertEqual(report["rows"]["devTestDropped"], 96)
        self.assertEqual(report["rows"]["published"], self.manifest["stats"]["rowsPublished"])
        probes = report["probes"]
        self.assertEqual(probes["referenceRegions"], ["westeurope", "eastus", "southcentralus", "israelcentral"])
        self.assertEqual(probes["virtualMachines"]["eastus"]["consumptionLinux"], 24)
        self.assertEqual(len(probes["licenses"]["Virtual Machines Licenses"]["sqlExamples"]), 3)
        self.assertIn("Azure Site Recovery", probes["siteRecovery"])
        self.assertTrue(probes["storage"]["ssdV2UltraExamples"])
        self.assertLessEqual(len(report["sizes"]["largestFiles"]), 20)


class RebuildAndFailureTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = scratch_dir()
        self.tmp = Path(self._tmp.name)
        self.out = self.tmp / "data"

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def build(self, *args: object) -> int:
        code, _ = run_cli("build", "--out", self.out, *args)
        return code

    def assert_failed_cleanly(self, *args: object) -> None:
        with self.assertLogs("azcalc_pipeline", level="ERROR"):
            self.assertEqual(self.build(*args), 1)
        self.assertFalse([name for name in generated_entries(self.out) if name.startswith(".azcalc-tmp-")])

    def test_rebuild_replaces_only_generated_content(self) -> None:
        self.assertEqual(self.build("--fixture"), 0)
        (self.out / "keep.txt").write_text("not generated")
        (self.out / "notes").mkdir()
        self.assertEqual(self.build("--fixture", "--date", "2026-11-25"), 0)
        self.assertEqual(generated_entries(self.out), ["2026-11-25", "keep.txt", "manifest.json", "notes"])
        manifest = load(self.out / "manifest.json")
        self.assertEqual(manifest["pricesDate"], "2026-11-25")
        self.assertTrue((self.out / "2026-11-25/prices/virtual-machines/eastus.json").is_file())

    def test_missing_header_publishes_nothing(self) -> None:
        columns = [c for c in COLUMNS if c != "meterId"]
        prices = write_csv(self.tmp / "bad.csv", [make_row()], columns)
        self.assert_failed_cleanly("--prices-csv", prices, "--fx-csv", FX, "--min-rows", "0")
        self.assertEqual(generated_entries(self.out), [])

    def test_failure_keeps_the_previous_snapshot(self) -> None:
        self.assertEqual(self.build("--fixture"), 0)
        before = (self.out / "manifest.json").read_bytes()
        self.assert_failed_cleanly("--prices-csv", PRICES, "--fx-csv", FX, "--min-rows", "999999")
        self.assertEqual((self.out / "manifest.json").read_bytes(), before)
        self.assertEqual(generated_entries(self.out), ["2026-11-24", "manifest.json"])

    def test_size_limits(self) -> None:
        self.assert_failed_cleanly("--fixture", "--max-file-bytes", "10000")
        self.assertFalse((self.out / "manifest.json").exists())
        self.assert_failed_cleanly("--fixture", "--max-total-bytes", "100000")
        self.assertEqual(self.build("--fixture", "--max-file-bytes", "10000", "--no-size-limits"), 0)

    def test_compressed_inputs_and_filters(self) -> None:
        gz = self.tmp / "prices.csv.gz"
        with open(PRICES, "rb") as src, gzip.open(gz, "wb") as dst:
            shutil.copyfileobj(src, dst)
        zipped = self.tmp / "fx.zip"
        with zipfile.ZipFile(zipped, "w") as archive:
            archive.write(FX, "azure-fxrates-usd.csv")
        code = self.build("--prices-csv", gz, "--fx-csv", zipped, "--min-rows", "0", "--tag", "prices-2026-11-20",
                          "--regions", "westeurope", "--services", "Virtual Machines,Virtual Machines Licenses")
        self.assertEqual(code, 0)
        manifest = load(self.out / "manifest.json")
        self.assertEqual(manifest["pricesDate"], "2026-11-20")
        self.assertEqual(manifest["source"]["type"], "exporter")
        self.assertEqual(manifest["source"]["tag"], "prices-2026-11-20")
        self.assertNotIn("shards", manifest)
        self.assertEqual(manifest["stats"]["shardCount"], 2)
        shards = load(self.out / manifest["paths"]["shards"])
        self.assertEqual({s: set(r) for s, r in shards.items()},
                         {"virtual-machines": {"westeurope"}, "virtual-machines-licenses": {"_global"}})

    def test_argument_errors(self) -> None:
        self.assert_failed_cleanly("--prices-csv", PRICES)
        self.assert_failed_cleanly("--fixture", "--prices-csv", PRICES, "--fx-csv", FX)
        self.assert_failed_cleanly("--prices-csv", self.tmp / "missing.csv", "--fx-csv", FX)


if __name__ == "__main__":
    unittest.main()
