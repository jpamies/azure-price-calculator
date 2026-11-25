# azcalc-pipeline

Turns the daily Azure Retail Prices export published by
[`sbroenne/azureretailprices-exporter`](https://github.com/sbroenne/azureretailprices-exporter)
(~1.1 M rows, USD) into the small static JSON files the SPA downloads on demand from GitHub Pages.
The output format is specified in [`docs/data-contract.md`](../docs/data-contract.md).

Pure Python standard library (≥ 3.10), no runtime dependencies. CI runs it with `uv`; locally you can run
it straight from the source tree.

```
exporter release ──download──▶ validate ──stream──▶ group by (serviceName, armRegionName)
   (cache)                     headers,             sort + dedupe ──▶ prices/<slug>/<region>[.partN|.spot].json
                               rows, savings plans                ──▶ index/services.json, regions.json, vm-skus.json, shards.json
                                                                  ──▶ fx.json, report.json
                                                     publish ──▶ <out>/<DATE>/ + <out>/manifest.json (written last)
```

## Usage

```bash
# CI (from the repository root; uv creates pipeline/.venv)
uv run --project pipeline azcalc-pipeline build --out dist/data
uv run --project pipeline pytest -q pipeline/tests scripts/test_sync_icons.py

# Without installing anything (from the repository root)
PYTHONPATH=pipeline/src python3 -m azcalc_pipeline build --fixture --out web/public/data   # = make data-sample
PYTHONPATH=pipeline/src python3 -m azcalc_pipeline build --out web/public/data --min-rows 0 \
  --regions westeurope,israelcentral,southcentralus,eastus \
  --services "Virtual Machines,Storage,Backup,Azure Site Recovery,Virtual Machines Licenses"  # = make data-real
```

### `azcalc-pipeline build`

| Option | Default | Meaning |
|---|---|---|
| `--out DIR` | required | Output directory. Only previously generated content inside it (`manifest.json`, `YYYY-MM-DD/`) is replaced. |
| `--prices-csv PATH`, `--fx-csv PATH` | – | Use local files instead of downloading (`.csv`, `.csv.gz` or a `.zip` with one CSV; detected by content). Both together. |
| `--fixture` | – | Use `pipeline/tests/fixtures/*.csv` (synthetic), `--min-rows 0`, date `2026-11-24` unless `--date`. |
| `--repo` | `sbroenne/azureretailprices-exporter` | Exporter repository. |
| `--tag` | newest dated release | Release tag, e.g. `prices-2026-11-24` (with local CSVs it only sets `source.tag` and the date). |
| `--cache-dir` | `.cache/exporter` | Download cache (relative to the working directory). |
| `--date YYYY-MM-DD` | release date | Override `pricesDate`. |
| `--source-type exporter\|fixture` | `exporter` (`fixture` with `--fixture`) | `manifest.source.type`; the SPA shows a "sample data" warning for `fixture`. |
| `--min-rows N` | 900000 (0 with `--fixture`) | Fail when the CSV has fewer data rows (truncated export). |
| `--regions a,b` | all | Keep only these `armRegionName`s, plus rows without a region (global meters). |
| `--services "A,B"` | all | Keep only these `serviceName`s. |
| `--part-max-bytes` | 5000000 | Split a main shard above this size into `.part1.json … .partN.json`. |
| `--max-total-bytes` | 900000000 | Fail when all published files together exceed this (GitHub Pages sites are limited to 1 GB). |
| `--max-file-bytes` | 95000000 | Fail when any file exceeds this (Pages/Git limit 100 MiB). |
| `--no-size-limits` | – | Do not enforce the two limits above. |
| `-v` / `-q` | – | Debug logging / warnings only. |

Exit code 0 on success, 1 on any failure (clear message on stderr), 2 on bad arguments. A failing run
publishes nothing: everything is staged in `<out>/.azcalc-tmp-*` and moved into place only at the end; the
old `manifest.json` is removed before the old snapshot and the new one is written last, so a manifest never
points at missing or incomplete data. In CI the job fails before the deploy step and the site keeps serving
the previous snapshot.

`azcalc-pipeline fixture [--out pipeline/tests/fixtures]` regenerates the synthetic sample
(see [`tests/fixtures/README.md`](tests/fixtures/README.md)).

## Download

Release resolution: (a) `--tag`; (b) `GET /repos/{repo}/releases?per_page=20` → newest non-draft release tagged
`prices-YYYY-MM-DD` that has both `azure-retail-prices-usd.csv` and `azure-fxrates-usd.csv` (`.csv.gz`, `.gz`,
`.csv.zip`, `.zip` variants accepted and preferred because they are smaller); `pricesDate` = the tag date;
(c) `GET /releases/latest` (date from the tag, else from the asset `updated_at`); (d) direct
`https://github.com/{repo}/releases/download/latest/…` (then `…/releases/latest/download/…`) with today's UTC date.

Downloads are streamed to disk with SHA-256, 5 retries with exponential backoff (2, 4, 8, 16, 32 s; honours
`Retry-After`) on network errors, 429 and 5xx. An asset already in `--cache-dir` with the same name, size and
`updated_at` (sidecar `<asset>.json`) is not downloaded again. When `GITHUB_TOKEN` is set it is sent **only** to
`api.github.com` and as an unredirected header, so it never reaches the asset storage the downloads redirect to;
it is never logged.

## Validation and transformation

* Columns are mapped by header name (any order). Missing required columns
  (`retailPrice, armRegionName, meterId, meterName, productName, skuName, serviceName, serviceFamily,
  unitOfMeasure, type, armSkuName, reservationTerm, tierMinimumUnits, effectiveStartDate`) fail the run with the
  list of missing names. `location` is optional.
* Rows with an empty `meterId`/`serviceName` or a non-numeric `retailPrice` are dropped with a warning; more than
  1 % of such rows fails the run, as do fewer than `--min-rows` rows.
* Any `type` mentioning "savings" becomes `SavingsPlans`. If a CSV carries a nested `savingsPlan` column (JSON or
  the Python literal pandas writes), each element becomes a `SavingsPlans` row (hourly price, `reservationTerm` =
  term). `manifest.hasSavingsPlan` is true iff any `SavingsPlans` row is published. Virtual Machines SKUs that
  have savings plans but no PAYG row (a bug of older exporter releases) are reported as a warning.
* `DevTestConsumption` rows are dropped. Rows whose `meterName` or `skuName` contains `Spot` or `Low Priority` go
  to `<region>.spot.json`. `isWindows` = `productName` contains "Windows". `effectiveStartDate` keeps the date.
* Exact duplicate output rows are dropped; rows are sorted by `productName, skuName, meterName, type,
  reservationTerm, tierMinimumUnits` (then the remaining columns, for byte-stable output).
* One streaming pass with `csv.reader` and interned strings. Scale test with a synthetic 1.16 M-row CSV
  (322 MB, 60 regions, 150 services): see "Performance" below.

## Indexes

* `manifest.json` stays ~1 KB (it is fetched with `no-store` on every visit): the per-shard map
  (`parts`, `rows`, `bytes`, `spot`, `spotRows` per slug and region) is written to the immutable
  `index/shards.json` (`manifest.paths.shards`; `manifest.stats.shardCount` = number of entries).
* `index/services.json`, `index/regions.json`, `fx.json`: see the data contract. Region display names and
  geographies come from [`data/region-geo.json`](data/region-geo.json) (unknown regions fall back to the CSV
  `location` and geography "Other"; add new regions there).
* `index/vm-skus.json` = [`data/vm-skus.base.json`](data/vm-skus.base.json) + every `armSkuName` of
  Virtual Machines prices (`null` when its specs are unknown). The committed base file is a hand-made seed for
  common families (`python3 scripts/seed_vm_skus.py`). To refresh it from Azure (monthly, needs `az login`):

  ```bash
  bash scripts/export-vm-skus.sh   # az vm list-skus --all | scripts/reduce_vm_skus.py -> pipeline/data/vm-skus.base.json
  ```

## Report and probes

`<DATE>/report.json` holds row counts (read, invalid, filtered, DevTest, duplicates, published), sizes (total,
20 largest files and services), per-service counts, warnings and **probes**: how meters are actually named in
the reference regions `westeurope, eastus, southcentralus, israelcentral` — VM row counts by type, Storage
`*Disk*` products and Premium SSD v2 / Ultra examples, Backup meters, Site Recovery meters, and for every
`/licen[cs]e/i` service its products plus SQL examples. Use them to adapt the SPA matchers after a run on real
data. A Markdown summary is printed and appended to `$GITHUB_STEP_SUMMARY` in Actions.

## Tests

```bash
cd pipeline && python3 -m unittest discover -s tests -v   # stdlib only
uv run --project pipeline pytest -q pipeline/tests scripts/test_sync_icons.py   # CI (repo root)
```

Tests create scratch directories with `tempfile` on local disk (`$TMPDIR` or the system default;
`AZCALC_TEST_TMPDIR` overrides). Keep them — and `--out` — off network/FUSE mounts: publishing renames
directories, which async-write-back mounts (e.g. `rclone mount`) can stall.
They cover slugs, header/row validation, savings-plan expansion, Spot split, DevTest/duplicate dropping, part
splitting, FX parsing, VM specs, release resolution/retries/token handling (fake HTTP) and an end-to-end
`build --fixture`, including failure modes that must not publish anything.

## Performance

Scale test on 1 vCPU with a synthetic 1.16 M-row CSV (322 MB; 60 regions × 150 services → 9 002 shard files,
186 MB of JSON, largest shard 3.1 MB):

| Phase | Wall | CPU |
|---|---|---|
| Read + validate + group (`csv.reader`, one pass) | 16 s | 7.7 s |
| Sort + dedupe + render JSON | 6 s | 3.5 s |
| Indexes + probes | < 0.1 s | < 0.1 s |
| **Peak RSS** | **≈ 335 MB** | |

Writing the files adds disk time only (seconds on a runner SSD; minutes on slow network filesystems, where a
directory walk is avoided by tracking sizes as files are written). Every build logs its wall time and peak RSS.
