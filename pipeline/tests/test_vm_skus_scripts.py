"""scripts/seed_vm_skus.py and scripts/reduce_vm_skus.py (VM specs for index/vm-skus.json)."""

import importlib.util
import json
import unittest
from types import ModuleType

from _helpers import REPO_ROOT
from azcalc_pipeline.build_indexes import load_vm_skus_base


def load_script(name: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, REPO_ROOT / "scripts" / f"{name}.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class VmSkuScriptTests(unittest.TestCase):
    def test_seed_and_committed_base_have_common_vm_specs(self) -> None:
        seed = load_script("seed_vm_skus")
        for skus in (seed.seed_skus(), load_vm_skus_base()["skus"]):
            self.assertEqual(skus["Standard_D8s_v5"]["vCPUs"], 8)
            self.assertEqual(skus["Standard_D8s_v5"]["memoryGB"], 32)

    def test_reduce_az_output(self) -> None:
        reduce = load_script("reduce_vm_skus")
        az = [
            {"resourceType": "virtualMachines", "name": "Standard_D8s_v5", "family": "standardDSv5Family",
             "locations": ["westeurope"], "capabilities": [{"name": "vCPUs", "value": "8"},
                                                           {"name": "MemoryGB", "value": "32"}]},
            {"resourceType": "virtualMachines", "name": "Standard_D8s_v5", "family": "standardDSv5Family",
             "locations": ["eastus"], "capabilities": [{"name": "vCPUs", "value": "8"},
                                                       {"name": "MemoryGB", "value": "32"}]},
            {"resourceType": "virtualMachines", "name": "Standard_B1ls", "family": "standardBSFamily",
             "capabilities": [{"name": "vCPUs", "value": "1"}, {"name": "MemoryGB", "value": "0.5"}]},
            {"resourceType": "virtualMachines", "name": "Standard_Broken", "capabilities": []},
            {"resourceType": "disks", "name": "Premium_LRS"},
        ]
        skus = reduce.reduce_skus(az)
        self.assertEqual(skus, {
            "Standard_B1ls": {"vCPUs": 1, "memoryGB": 0.5, "family": "BS"},
            "Standard_D8s_v5": {"vCPUs": 8, "memoryGB": 32, "family": "DSv5"},
        })
        document = json.loads(reduce.render("az-cli", "note", skus))
        self.assertEqual(document["source"], "az-cli")
        self.assertEqual(document["skus"], skus)


if __name__ == "__main__":
    unittest.main()
