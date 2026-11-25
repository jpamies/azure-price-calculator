# Data contract: pipeline → SPA

This is the interface between `pipeline/` (Python, runs in GitHub Actions) and `web/` (the SPA).
Every path below is relative to the published `data/` directory (`<site>/data/`). The SPA always
builds URLs as `${import.meta.env.BASE_URL}data/<path>`, so the site works under `/<repo>/` on
GitHub Pages and under `/` with a custom domain.

## Layout

```
data/
  manifest.json                         # fetched with cache: "no-store" + ?t=<now>
  <DATE>/                               # DATE = pricesDate, YYYY-MM-DD; immutable by construction
    fx.json
    report.json                         # pipeline report (sizes, warnings, module probes)
    index/services.json
    index/regions.json
    index/vm-skus.json
    index/shards.json                   # per-shard map (parts/rows/bytes/spot), kept out of the manifest
    prices/<serviceSlug>/<regionKey>.json          # parts == 1
    prices/<serviceSlug>/<regionKey>.part1.json    # parts > 1 (part1..partN)
    prices/<serviceSlug>/<regionKey>.spot.json     # Spot + Low Priority rows (only if any)
```

* `serviceSlug = slugify(serviceName)`; `regionKey = slugify(armRegionName)`, or `_global` when
  `armRegionName` is empty.
* `slugify`: lowercase, `&` → `and`, every run of characters outside `[a-z0-9]` → `-`, trim `-`.
  On a collision (two names → same slug) the later name in sorted order gets `-2`, `-3`, …

## manifest.json

```json
{
  "schemaVersion": 1,
  "pricesDate": "2026-11-24",
  "generatedAt": "2026-11-24T09:41:07Z",
  "currencyBase": "USD",
  "hasSavingsPlan": true,
  "source": {
    "type": "exporter",                 // "exporter" (real data) | "fixture" (synthetic sample)
    "repo": "sbroenne/azureretailprices-exporter",
    "tag": "prices-2026-11-24",
    "pricesUrl": "https://github.com/.../azure-retail-prices-usd.csv",
    "fxUrl": "https://github.com/.../azure-fxrates-usd.csv",
    "pricesSha256": "…", "fxSha256": "…",
    "rowCount": 1102862                  // rows read from the CSV
  },
  "paths": {
    "root": "2026-11-24",
    "services": "2026-11-24/index/services.json",
    "regions": "2026-11-24/index/regions.json",
    "vmSkus": "2026-11-24/index/vm-skus.json",
    "shards": "2026-11-24/index/shards.json",
    "fx": "2026-11-24/fx.json",
    "prices": "2026-11-24/prices",
    "report": "2026-11-24/report.json"
  },
  "stats": { "rowsPublished": 1080000, "shardCount": 9000, "files": 9300, "bytes": 190000000 }
}
```

The manifest is fetched with `no-store` on every visit, so it stays small (~1 KB): the per-shard map
lives in the immutable `paths.shards` file (`index/shards.json`). `stats.shardCount` = number of
(slug, regionKey) entries in that file; `stats.files`/`stats.bytes` cover every file under `<DATE>/`.

## Price shard (`prices/<slug>/<regionKey>[.partN|.spot].json`)

Columnar JSON, one file per (service, region) (+ parts/spot):

```json
{
  "service": "Virtual Machines",
  "region": "westeurope",
  "cols": ["meterId","meterName","productName","skuName","armSkuName","unitOfMeasure",
           "type","reservationTerm","tierMinimumUnits","retailPrice","effectiveStartDate","isWindows"],
  "rows": [["…","D8as v5","Virtual Machines Dasv5 Series","D8as v5","Standard_D8as_v5","1 Hour",
            "Consumption","",0,0.344,"2022-10-01",0]]
}
```

Column semantics (the SPA reads by name from `cols`, never by position):

| column | type | notes |
|---|---|---|
| meterId | string | |
| meterName, productName, skuName, armSkuName, unitOfMeasure | string | `""` when missing |
| type | string | `Consumption`, `Reservation` or `SavingsPlans`. `DevTestConsumption` is dropped (v1). |
| reservationTerm | string | `1 Year` / `3 Years` for `Reservation` and `SavingsPlans`, else `""` |
| tierMinimumUnits | number | `0` when missing |
| retailPrice | number | USD. `Reservation`: **total for the whole term**. `SavingsPlans`: hourly rate. |
| effectiveStartDate | string | `YYYY-MM-DD` (time part dropped) or `""` |
| isWindows | 0/1 | `1` when `productName` contains `Windows` (case-insensitive) |

* Rows whose `meterName` or `skuName` contains `Spot` or `Low Priority` go to `<regionKey>.spot.json`
  and never to the main shard.
* Rows are sorted by `productName, skuName, meterName, type, reservationTerm, tierMinimumUnits`.
* A shard whose serialized main file exceeds 5 MB is split into `.part1.json … .partN.json`
  (each a complete document with the same `cols`); the SPA concatenates `rows`.
* Savings plan: the exporter writes each nested savings plan as its own row with
  `type = SavingsPlans` and `reservationTerm`. If a CSV instead carries a nested `savingsPlan`
  column (JSON or Python-literal list of `{retailPrice, unitPrice, term}`), the pipeline expands it
  into the same `SavingsPlans` rows. `manifest.hasSavingsPlan` is `true` iff any such row exists.

## index/services.json

```json
[{ "serviceFamily": "Compute", "serviceName": "Virtual Machines", "slug": "virtual-machines",
   "regions": ["eastus","westeurope"], "rowCount": 123456, "hasSpot": true, "productCount": 412 }]
```
Sorted by `serviceFamily`, then `serviceName`. `regions` lists region keys with a main shard
(may include `_global`).

## index/regions.json

```json
[{ "key": "westeurope", "armRegionName": "westeurope", "location": "EU West",
   "displayName": "West Europe", "geography": "Europe", "rowCount": 51234 }]
```
`displayName`/`geography` come from `pipeline/data/region-geo.json`; unknown regions fall back to
`displayName = location || armRegionName`, `geography = "Other"`. `_global` is included with
`displayName = "Global (no region)"`, `geography = "Global"`.

## index/vm-skus.json

```json
{ "source": "seed", "skus": { "Standard_D8as_v5": { "vCPUs": 8, "memoryGB": 32, "family": "Dasv5" },
                               "Standard_X1_v9": null } }
```
Every `armSkuName` that appears in `Virtual Machines` prices is a key; `null` = specs unknown.

## index/shards.json

Compact JSON object `serviceSlug -> regionKey -> entry` (keys sorted), one entry per published
(service, region):

```json
{ "virtual-machines": {
    "westeurope": { "parts": 1, "rows": 9120, "bytes": 1234567, "spot": true, "spotRows": 4100 } } }
```

| field | meaning |
|---|---|
| parts | number of main files: `1` → `<regionKey>.json`, `N > 1` → `<regionKey>.part1.json … .partN.json`, `0` → no main file (only Spot rows) |
| rows | rows in the main file(s) |
| bytes | total size of the main file(s) |
| spot | `true` when `<regionKey>.spot.json` exists |
| spotRows | rows in the spot file (present only when `spot` is `true`) |

A (slug, regionKey) without an entry has no prices. Like everything under `<DATE>/`, the file is
immutable, so it can be cached (memory/IndexedDB) under the `pricesDate`.

## fx.json

```json
{ "asOf": "2026-11-24", "base": "USD", "rates": { "USD": 1, "EUR": 0.8523, "GBP": 0.7421 } }
```
`price_in_currency = price_usd × rates[currency]`.
