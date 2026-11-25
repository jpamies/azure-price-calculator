# Validation against the official Azure Pricing Calculator

Goal (plan §7.3): three reference cases must match the
[official calculator](https://azure.microsoft.com/pricing/calculator/) within **±1 %** (USD, same
region and options). A larger difference is a bug in the matching rules or the data.

## How to run

Every data build prints this app's numbers for the three cases in the GitHub Actions job summary
(step *Validation cases*). Locally:

```bash
python3 scripts/validation_cases.py dist/data                       # after a full data build
python3 scripts/validation_cases.py https://<user>.github.io/<repo>/data   # deployed site
```

`scripts/validation_cases.py` independently implements the pricing formulas and fails if a reference
price is missing. Compare its output with the app and the official calculator (USD, *Savings options*
as listed); the official comparison is manual, not an automated CI check.

## Cases

| # | Configuration | Formula in this app | Official calculator setting |
|---|---|---|---|
| 1 | `Standard_D8as_v5`, **Windows** (license included), **West Europe**, PAYG, 730 h, 1 VM | Windows hourly price × 730 (shown as Linux compute + Windows license lines) | Virtual Machines → West Europe → Windows → OS only → D8as v5 → Pay as you go |
| 2 | `Standard_D8as_v5`, **Linux**, **Israel Central**, Reserved **3 years**, 1 VM | Reservation term total ÷ 36 (upfront option: the total once) | Virtual Machines → Israel Central → Linux → D8as v5 → 3 year reserved |
| 3 | **P30 LRS** + **E15 ZRS**, **South Central US**, 1 disk each | P30 LRS monthly + E15 ZRS monthly | Managed Disks → Premium SSD P30 LRS; Standard SSD E15 ZRS |

## Results

On 2026-11-25 the official calculator was checked using snapshot `prices-2026-11-24`.
The disk case excludes storage transactions, snapshots and other extras.

| # | This app (USD/month) | Official (USD/month) | Δ % | OK? |
|---|---|---|---|---|
| 1 | $572.32 | $572.32 | 0% | Yes |
| 2 | $117.61 | $117.61 | 0% | Yes |
| 3 | $151.68 | $122.88 + $28.80 = $151.68 | 0% | Yes |

For reference, the synthetic sample snapshot (`make data-sample`, fake prices) yields
1 = $582.13, 2 = $114.51 eq. (upfront $4,122.39), 3 = $159.17 — these only prove the formulas run
end to end; they are **not** real prices.

## If a case is off

1. Check `data/<DATE>/report.json` → `probes` (meter/product names found in the real data).
2. Adjust the matchers in `web/src/domain/pricing/*` (and the mirror in `scripts/validation_cases.py`).
3. Typical causes: a new product name variant (e.g. a "Promo" or "Basic" product), several rows with
   different `effectiveStartDate` (the app uses the latest one not in the future), or Windows prices
   published only as Savings Plan rows (historical exporter bug — check the job warnings).
