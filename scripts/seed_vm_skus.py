#!/usr/bin/env python3
"""Write pipeline/data/vm-skus.base.json from hand-maintained tables of common VM families.

The authoritative source is the Azure CLI (scripts/export-vm-skus.sh, needs `az login`); this seed
only covers common families so the SPA can filter by vCPU/RAM before the first az export.

Usage: python3 scripts/seed_vm_skus.py [--out pipeline/data/vm-skus.base.json]
"""

from __future__ import annotations

import argparse
import json
from collections.abc import Callable
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = ROOT / "pipeline" / "data" / "vm-skus.base.json"
NOTE = "Hand-seeded for common families; regenerate with scripts/export-vm-skus.sh (az CLI)"

D_V5 = (2, 4, 8, 16, 32, 48, 64, 96)
D_V6 = (2, 4, 8, 16, 32, 48, 64, 96, 128)
E_V5 = (2, 4, 8, 16, 20, 32, 48, 64, 96)
D_V3_V4 = (2, 4, 8, 16, 32, 48, 64)
E_V3_V4 = (2, 4, 8, 16, 20, 32, 48, 64)
F_V2 = (2, 4, 8, 16, 32, 48, 64, 72)
B_V2 = (2, 4, 8, 16, 32)


def gb_per_vcpu(gb: int) -> Callable[[int], int]:
    return lambda n: gb * n


def e_v5_memory(n: int) -> int:
    return 672 if n == 96 else 8 * n


def e_v4_memory(n: int) -> int:
    return 504 if n == 64 else 8 * n


def e_v3_memory(n: int) -> int:
    return 432 if n == 64 else 8 * n


#: (family, armSkuName pattern, vCPU sizes, memoryGB(vCPUs))
FAMILIES: list[tuple[str, str, tuple[int, ...], Callable[[int], int]]] = [
    ("Dv5", "Standard_D{n}_v5", D_V5, gb_per_vcpu(4)),
    ("Dsv5", "Standard_D{n}s_v5", D_V5, gb_per_vcpu(4)),
    ("Ddv5", "Standard_D{n}d_v5", D_V5, gb_per_vcpu(4)),
    ("Ddsv5", "Standard_D{n}ds_v5", D_V5, gb_per_vcpu(4)),
    ("Dasv5", "Standard_D{n}as_v5", D_V5, gb_per_vcpu(4)),
    ("Dadsv5", "Standard_D{n}ads_v5", D_V5, gb_per_vcpu(4)),
    ("Dlsv5", "Standard_D{n}ls_v5", D_V5, gb_per_vcpu(2)),
    ("Dldsv5", "Standard_D{n}lds_v5", D_V5, gb_per_vcpu(2)),
    ("Dsv6", "Standard_D{n}s_v6", D_V6, gb_per_vcpu(4)),
    ("Ddsv6", "Standard_D{n}ds_v6", D_V6, gb_per_vcpu(4)),
    ("Dlsv6", "Standard_D{n}ls_v6", D_V6, gb_per_vcpu(2)),
    ("Dldsv6", "Standard_D{n}lds_v6", D_V6, gb_per_vcpu(2)),
    ("Dasv6", "Standard_D{n}as_v6", D_V5, gb_per_vcpu(4)),
    ("Dadsv6", "Standard_D{n}ads_v6", D_V5, gb_per_vcpu(4)),
    ("Ev5", "Standard_E{n}_v5", E_V5, e_v5_memory),
    ("Esv5", "Standard_E{n}s_v5", E_V5, e_v5_memory),
    ("Edv5", "Standard_E{n}d_v5", E_V5, e_v5_memory),
    ("Edsv5", "Standard_E{n}ds_v5", E_V5, e_v5_memory),
    ("Easv5", "Standard_E{n}as_v5", E_V5, e_v5_memory),
    ("Eadsv5", "Standard_E{n}ads_v5", E_V5, e_v5_memory),
    ("Dsv4", "Standard_D{n}s_v4", D_V3_V4, gb_per_vcpu(4)),
    ("Ddsv4", "Standard_D{n}ds_v4", D_V3_V4, gb_per_vcpu(4)),
    ("Dsv3", "Standard_D{n}s_v3", D_V3_V4, gb_per_vcpu(4)),
    ("Esv4", "Standard_E{n}s_v4", E_V3_V4, e_v4_memory),
    ("Edsv4", "Standard_E{n}ds_v4", E_V3_V4, e_v4_memory),
    ("Esv3", "Standard_E{n}s_v3", E_V3_V4, e_v3_memory),
    ("Fsv2", "Standard_F{n}s_v2", F_V2, gb_per_vcpu(2)),
    ("Bsv2", "Standard_B{n}s_v2", B_V2, gb_per_vcpu(4)),
    ("Basv2", "Standard_B{n}as_v2", B_V2, gb_per_vcpu(4)),
    ("Blsv2", "Standard_B{n}ls_v2", B_V2, gb_per_vcpu(2)),
    ("Balsv2", "Standard_B{n}als_v2", B_V2, gb_per_vcpu(2)),
]

#: (armSkuName, family, vCPUs, memoryGB) for sizes outside the regular patterns.
EXTRA: list[tuple[str, str, int, int]] = [
    ("Standard_E104i_v5", "Ev5", 104, 672),
    ("Standard_E104is_v5", "Esv5", 104, 672),
    ("Standard_E104id_v5", "Edv5", 104, 672),
    ("Standard_E104ids_v5", "Edsv5", 104, 672),
    ("Standard_E112ias_v5", "Easv5", 112, 672),
    ("Standard_E112iads_v5", "Eadsv5", 112, 672),
    ("Standard_B2ts_v2", "Bsv2", 2, 1),
    ("Standard_B2ats_v2", "Basv2", 2, 1),
]


def seed_skus() -> dict[str, dict]:
    skus: dict[str, dict] = {}
    for family, pattern, sizes, memory in FAMILIES:
        for n in sizes:
            skus[pattern.format(n=n)] = {"vCPUs": n, "memoryGB": memory(n), "family": family}
    for name, family, vcpus, memory_gb in EXTRA:
        skus[name] = {"vCPUs": vcpus, "memoryGB": memory_gb, "family": family}
    return dict(sorted(skus.items()))


def render(source: str, note: str, skus: dict[str, dict]) -> str:
    """Same layout as scripts/reduce_vm_skus.py: one SKU per line, keys sorted."""
    lines = [f'  {json.dumps(name)}: {json.dumps(spec)}' for name, spec in skus.items()]
    return (
        "{\n"
        f'  "source": {json.dumps(source)},\n'
        f'  "note": {json.dumps(note)},\n'
        '  "skus": {\n  ' + ",\n  ".join(lines) + "\n  }\n}\n"
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args(argv)
    skus = seed_skus()
    text = render("seed", NOTE, skus)
    json.loads(text)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(text, encoding="utf-8")
    print(f"wrote {args.out} ({len(skus)} SKUs)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
