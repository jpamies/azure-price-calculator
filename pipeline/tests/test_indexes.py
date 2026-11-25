import io
import unittest

import _helpers  # noqa: F401  (sys.path bootstrap)
from azcalc_pipeline import PipelineError
from azcalc_pipeline.build_indexes import (
    fx_index,
    load_region_geo,
    load_vm_skus_base,
    parse_fx_csv,
    regions_index,
    services_index,
    vm_skus_index,
)
from azcalc_pipeline.transform import RegionSummary, ServiceSummary


class FxTests(unittest.TestCase):
    def test_parse_fx_csv(self) -> None:
        text = "currency,fxRate\nEUR,0.8523\ngbp,0.7421\nJPY,154.5\nXX,1\nCHF,abc\nNOK,-1\n\n"
        rates = parse_fx_csv(io.StringIO(text))
        self.assertEqual(rates, {"EUR": 0.8523, "GBP": 0.7421, "JPY": 154.5})
        self.assertEqual(fx_index(rates, "2026-11-24"), {
            "asOf": "2026-11-24", "base": "USD", "rates": {"USD": 1, "EUR": 0.8523, "GBP": 0.7421, "JPY": 154.5},
        })

    def test_parse_fx_csv_alternative_header_and_bom(self) -> None:
        rates = parse_fx_csv(io.StringIO("\ufeffcurrencyCode,rate\nEUR,0.92\n"))
        self.assertEqual(rates, {"EUR": 0.92})

    def test_parse_fx_csv_errors(self) -> None:
        for text in ("", "a,b\nEUR,1\n", "currency,fxRate\nEUR,zero\n"):
            with self.subTest(text=text), self.assertRaises(PipelineError):
                parse_fx_csv(io.StringIO(text))


class VmSkuTests(unittest.TestCase):
    def test_unknown_skus_are_null(self) -> None:
        base = {"source": "seed", "skus": {"Standard_D2s_v5": {"vCPUs": 2, "memoryGB": 8, "family": "Dsv5"},
                                           "Standard_E2s_v5": {"vCPUs": 2, "memoryGB": 16}}}
        index = vm_skus_index(base, {"Standard_D2s_v5", "Standard_X1_v9", "standard_e2s_v5"})
        self.assertEqual(index["source"], "seed")
        self.assertIsNone(index["skus"]["Standard_X1_v9"])
        self.assertEqual(index["skus"]["Standard_D2s_v5"], {"vCPUs": 2, "memoryGB": 8, "family": "Dsv5"})
        self.assertEqual(index["skus"]["standard_e2s_v5"], {"vCPUs": 2, "memoryGB": 16})  # case-insensitive join
        self.assertEqual(list(index["skus"]), sorted(index["skus"]))

    def test_vm_skus_base_file(self) -> None:
        base = load_vm_skus_base()
        self.assertIn(base["source"], ("seed", "az-cli"))
        self.assertEqual(base["skus"]["Standard_D8s_v5"]["vCPUs"], 8)
        self.assertEqual(base["skus"]["Standard_D8s_v5"]["memoryGB"], 32)
        self.assertEqual(base["skus"]["Standard_E96s_v5"]["memoryGB"], 672)
        self.assertEqual(base["skus"]["Standard_E64s_v3"]["memoryGB"], 432)
        self.assertEqual(base["skus"]["Standard_B2ts_v2"], {"vCPUs": 2, "memoryGB": 1, "family": "Bsv2"})


class ServiceAndRegionIndexTests(unittest.TestCase):
    def test_services_sorted_by_family_then_name(self) -> None:
        services = [
            ServiceSummary(name="Storage", slug="storage", family="Storage", regions=["eastus"], rows=3),
            ServiceSummary(name="Virtual Machines", slug="virtual-machines", family="Compute", regions=["eastus"],
                           rows=5, spot_rows=2, products={"a", "b"}),
            ServiceSummary(name="Azure App Service", slug="azure-app-service", family="Compute", regions=["eastus"]),
        ]
        index = services_index(services)
        self.assertEqual([s["serviceName"] for s in index], ["Azure App Service", "Virtual Machines", "Storage"])
        self.assertEqual(index[1], {"serviceFamily": "Compute", "serviceName": "Virtual Machines",
                                    "slug": "virtual-machines", "regions": ["eastus"], "rowCount": 5,
                                    "hasSpot": True, "productCount": 2})

    def test_regions_with_geo_map_and_fallbacks(self) -> None:
        geo = load_region_geo()
        regions = [
            RegionSummary(arm_region_name="westeurope", key="westeurope", location="EU West", rows=4),
            RegionSummary(arm_region_name="", key="_global", location="", rows=1),
            RegionSummary(arm_region_name="marscentral", key="marscentral", location="Mars Central", rows=2),
            RegionSummary(arm_region_name="israelcentral", key="israelcentral", location="IL Central", rows=3),
        ]
        index = regions_index(regions, geo)
        self.assertEqual([r["key"] for r in index], ["_global", "westeurope", "israelcentral", "marscentral"])
        by_key = {r["key"]: r for r in index}
        self.assertEqual(by_key["_global"]["displayName"], "Global (no region)")
        self.assertEqual(by_key["_global"]["geography"], "Global")
        self.assertEqual(by_key["westeurope"], {"key": "westeurope", "armRegionName": "westeurope",
                                                "location": "EU West", "displayName": "West Europe",
                                                "geography": "Europe", "rowCount": 4})
        self.assertEqual((by_key["marscentral"]["displayName"], by_key["marscentral"]["geography"]),
                         ("Mars Central", "Other"))

    def test_region_geo_file(self) -> None:
        geo = load_region_geo()
        expected = {
            "westeurope": ("West Europe", "Europe"),
            "spaincentral": ("Spain Central", "Europe"),
            "israelcentral": ("Israel Central", "Middle East"),
            "southcentralus": ("South Central US", "Americas"),
            "eastus": ("East US", "Americas"),
            "southafricanorth": ("South Africa North", "Africa"),
            "japaneast": ("Japan East", "Asia Pacific"),
            "usgovvirginia": ("US Gov Virginia", "Azure Government"),
        }
        for key, (display, geography) in expected.items():
            with self.subTest(key=key):
                self.assertEqual((geo[key]["displayName"], geo[key]["geography"]), (display, geography))
        allowed = {"Americas", "Europe", "Asia Pacific", "Middle East", "Africa", "Azure Government"}
        self.assertTrue(all(v["geography"] in allowed for v in geo.values()))


if __name__ == "__main__":
    unittest.main()
