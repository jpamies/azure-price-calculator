import unittest

import _helpers  # noqa: F401  (sys.path bootstrap)
from azcalc_pipeline.slug import GLOBAL_REGION_KEY, assign_region_keys, assign_slugs, region_key, slugify


class SlugifyTests(unittest.TestCase):
    def test_contract_examples(self) -> None:
        cases = {
            "Virtual Machines": "virtual-machines",
            "Azure Site Recovery": "azure-site-recovery",
            "Virtual Machines Licenses": "virtual-machines-licenses",
            "Storage": "storage",
            "IoT Hub (Basic)": "iot-hub-basic",
            "  Leading & trailing!! ": "leading-and-trailing",
            "R&D": "randd",
            "Azure Data Lake Storage Gen2": "azure-data-lake-storage-gen2",
            "a--b__c": "a-b-c",
        }
        for name, expected in cases.items():
            with self.subTest(name=name):
                self.assertEqual(slugify(name), expected)

    def test_collisions_get_suffixes_in_sorted_order(self) -> None:
        slugs = assign_slugs(["Foo Bar", "foo-bar", "Foo  Bar", "Other"])
        # Sorted: "Foo  Bar" < "Foo Bar" < "Other" < "foo-bar"
        self.assertEqual(slugs, {"Foo  Bar": "foo-bar", "Foo Bar": "foo-bar-2", "Other": "other", "foo-bar": "foo-bar-3"})

    def test_empty_slug_uses_fallback(self) -> None:
        self.assertEqual(assign_slugs(["!!!", "???"]), {"!!!": "unnamed", "???": "unnamed-2"})


class RegionKeyTests(unittest.TestCase):
    def test_region_keys(self) -> None:
        self.assertEqual(region_key(""), GLOBAL_REGION_KEY)
        self.assertEqual(region_key("   "), GLOBAL_REGION_KEY)
        self.assertEqual(region_key("westeurope"), "westeurope")
        self.assertEqual(region_key("Zone 1"), "zone-1")

    def test_assign_region_keys(self) -> None:
        keys = assign_region_keys(["", "westeurope", "israelcentral", "Zone 1"])
        self.assertEqual(keys, {"": "_global", "westeurope": "westeurope", "israelcentral": "israelcentral",
                                "Zone 1": "zone-1"})


if __name__ == "__main__":
    unittest.main()
