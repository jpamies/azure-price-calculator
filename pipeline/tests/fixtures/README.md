# Test fixtures (synthetic)

`prices-sample.csv` and `fxrates-sample.csv` imitate the two assets of the
[`sbroenne/azureretailprices-exporter`](https://github.com/sbroenne/azureretailprices-exporter)
daily release (same header names, pandas-style values: `True`/`False`, empty for missing, floats such
as `0.0`). **All prices are synthetic**: they are ballpark list prices chosen to look realistic and to
exercise the calculator, not real Azure prices. Never use them for a quote.

They are generated deterministically (uuid5 meter ids, no randomness) by `azcalc_pipeline/fixture.py`:

```bash
PYTHONPATH=pipeline/src python3 -m azcalc_pipeline fixture --out pipeline/tests/fixtures
```

A test fails when the committed files differ from the generator output, so edit the generator, not the CSVs.

## Content

Regions and price factors: `eastus` ("US East", ×1.00), `southcentralus` ("US South Central", ×1.00),
`westeurope` ("EU West", ×1.12), `israelcentral` ("IL Central", ×1.20). Hourly/unit prices are rounded
to 6 decimals (10 for prices below 0.001), flat monthly prices (`1/Month`) to cents.

| Service | What is in it |
|---|---|
| Virtual Machines | Dsv5, Dasv5, Esv5, Fsv2 (2–32 vCPU) and Bsv2 (2–16 vCPU). Per SKU: Linux and Windows PAYG, Linux Spot / Low Priority, Windows Spot, Reservation 1Y/3Y (term totals), SavingsPlans 1Y/3Y (hourly, same meterId as Linux PAYG) and one DevTestConsumption row (dropped by the pipeline). Exact data point: eastus `Standard_D2s_v5` Linux PAYG 0.096, savings plan 1Y 0.0658368, 3Y 0.0441792. |
| Storage | Premium SSD P1–P80 and Standard SSD E1–E80 (LRS + ZRS), Standard HDD S4–S80 (LRS); distractors `P30 LRS Disk Mount` and `Disk Operations` (10K); Premium SSD v2 and Ultra Disks capacity/IOPS/throughput meters; tiered `Hot LRS Data Stored` blob meter. |
| Backup | Azure VM and SQL Server in Azure VM protected instances, LRS/GRS/ZRS/RA-GRS data stored. |
| Azure Site Recovery | VM replicated to Azure / to customer-owned sites. |
| Virtual Machines Licenses (global) | SQL Server licenses: **one meter per edition**, as named in the real Retail Prices API — productName `SQL Server Standard` (0.40), `SQL Server Enterprise` (1.50), `SQL Server Web` (0.0536), skuName `1-4 vCPU VM`, meterName `1-4 vCPU VM License`, unit `1 Hour`, empty `armRegionName`. The SPA bills N > 4 vCPUs linearly as price × N/4. |
| Generic | Azure App Service (P1 v3/P2 v3), Bandwidth (tiered egress), Log Analytics, Key Vault and global Azure DNS. |

`fxrates-sample.csv` has 16 currencies (`currency,fxRate`, units per 1 USD).
