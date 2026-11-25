# Published data sizes

The pipeline prints a size report on every run (GitHub Actions job summary and
`data/<DATE>/report.json`) and fails the build — without deploying — if the snapshot exceeds
**900 MB** in total or any file exceeds **95 MB** (GitHub Pages limits: 1 GB site, 100 MiB per file).

## Measurements

| Snapshot | Input rows | Published rows | Files | Size on disk | Build time | Peak RSS |
|---|---|---|---|---|---|---|
| Synthetic sample (`--fixture`) | 1,349 | 1,253 | 44 | 0.25 MB | 0.1 s | 26 MB |
| Synthetic scale test (fixture rows × ~60 regions × ~150 services) | 1,160,000 | ≈ 1.1 M | 9,002 | 186 MB | ≈ 22 s (read 16 s + render 6 s) | ≈ 335 MB |
| **Real exporter release** | ≈ 1.1 M | _fill in after the first workflow run_ | | | | |

The scale test ran in the development sandbox (1 vCPU); a GitHub-hosted runner is faster. The
real catalog has a different service/region distribution, so use the job summary numbers.

## What keeps it small

- Columnar JSON (`cols` + `rows`), only the 12 columns the app needs.
- Spot / Low Priority rows in separate `<region>.spot.json` files, loaded only when Spot is chosen.
- `DevTestConsumption` rows dropped.
- Shards over 5 MB split into `.partN.json`.
- The shard index lives in `index/shards.json` (immutable per date), so `manifest.json`, which is
  fetched without cache on every visit, stays below 1 KB.
- GitHub Pages serves JSON gzip-compressed (typically 5–10× smaller on the wire).

## If the limits are hit

1. Check the largest files in the report (`report.json` → `sizes.largestFiles` / `sizes.largestServices`).
2. Lower `--part-max-bytes` for very large shards (more, smaller parts).
3. As a last resort, publish an allow-list of services (filter with `--services`) — the generic
   "Any service" module only lists services present in `services.json`.
