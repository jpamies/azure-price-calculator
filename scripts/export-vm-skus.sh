#!/usr/bin/env bash
# Refresh pipeline/data/vm-skus.base.json (vCPUs / memory per VM size) from the Azure CLI.
# The price export has no VM specs; the pipeline joins this file into <DATE>/index/vm-skus.json.
#
# Requirements: Azure CLI logged in (`az login`; any subscription works) and python3.
# Run monthly or when new VM families appear (sizes missing here show up with specs = null).
set -euo pipefail

cd "$(dirname "$0")/.."
out="pipeline/data/vm-skus.base.json"
trap 'rm -f "$out.tmp"' EXIT

echo "Listing VM sizes with az vm list-skus (all locations, takes a minute)..." >&2
az vm list-skus --resource-type virtualMachines --all -o json \
  | python3 scripts/reduce_vm_skus.py --out "$out.tmp"
mv "$out.tmp" "$out"
echo "Updated $out" >&2
