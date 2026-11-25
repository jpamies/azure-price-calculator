# Pricing domain API (web/src/domain)

Pure TypeScript (no React/DOM), runs under `node --test`. All money is **USD**; convert only for
display. Import from the files below (relative imports with `.ts` inside `domain/`; `@/domain/...`
from the UI). Shapes `PriceRow`, `ShardRef`, `PricingContext`, `Line`, `ItemResult` and
`PricingModule` live in `types.ts`; configs in `model.ts`.

## Rules every module follows

* **Never a silent 0.** No matching price → `status: "unavailable"`, `lines: []`, totals 0 and an
  `error` message such as `"D8as v5 is not available in West Europe."`. Exclude such items from
  totals and show the message.
* `status: "incomplete"` = config not finished (no region, SKU, tier, service or meter); the
  message (level `info`) says what to choose.
* `messages` may also carry `info`/`warning` entries on `ok` results (e.g. Spot ignored, tier mapped).
* **Effective date:** when several rows describe the same meter/type/term/tier, the row with the
  latest `effectiveStartDate <= today` wins (all future → latest). Implemented once in `effective.ts`.
* `assumptions` are short English sentences specific to the item (rounding, storage %, scaling…);
  `assumptions.ts` merges them with the estimate-level sentences.
* Line invariants: `monthlyUsd = quantity × unitPriceUsd` (except reservations, see VM);
  `amortizedMonthlyUsd = monthlyUsd + upfrontUsd / termMonths`.
* `Line.unit` agrees with `quantity`, so `${quantity} ${unit}` reads correctly ("1 disk",
  "2 disks", "1 hour", "730 hours"); invariant units stay as is ("GB", "GiB", "IOPS", "MB/s").
  Summaries pluralize the same way ("1 instance", "2 VMs × 8 vCPUs").

## pricing/index.ts — entry points

| Export | Notes |
|---|---|
| `modules: ModuleMap` | `Record<ModuleId, PricingModule<config>>`. |
| `moduleList` | Catalog order: vm, disks, backup, asr, sqlLicense, generic. |
| `getModule(id)` | Typed lookup. |
| `shardsForItem(item, services): ShardRef[]` | Shards to load for `item.region`. `[]` = nothing to load yet (no region/service/meter) or the service has no shard in the region (`ServiceInfo.regions`). Missing shards must be passed as `[]`. |
| `computeItem(item, ctx): ItemResult` | `ctx.region`/`regionName` must describe `item.region`; `ctx.shards[refKey(ref)]` must hold the rows of every ref from `shardsForItem` (spot shard rows under `refKey({...ref, spot: true})`). Validates the config with the module schema; never throws. |
| `summarizeItem(item): string` | e.g. `"2 × D8as v5 · Windows · RI 3Y"`. |
| `vmModule, disksModule, backupModule, asrModule, sqlLicenseModule, genericModule` | Re-exported modules; `defaultConfig({ hoursPerMonth })` uses the setting for vm, sqlLicense, generic. |
| `ModuleMap`, `AnyPricingModule` | Types. |

| Module | title / category / iconKey | Shards |
|---|---|---|
| vm | Virtual Machines / Compute / virtual-machines | `Virtual Machines` region (+ spot shard when `spot && commitment === "payg"` and the service `hasSpot`) |
| disks | Managed Disks / Storage / managed-disks | `Storage` region |
| backup | Azure Backup / Storage / backup | `Backup` region |
| asr | Azure Site Recovery / Management and Governance / site-recovery | `Azure Site Recovery` (or any `/site recovery/i`) region |
| sqlLicense | SQL Server license (on VMs) / Databases / sql-server | `Virtual Machines Licenses` region **and** `_global` (only those listed in `regions`) |
| generic | Any service (meter) / Other / generic | `config.serviceName` × (`_global` if `useGlobalRegion`, else region) |

## Module behaviour

**VM** (`pricing/vm.ts`; also `VM_OS_LABELS`, `COMMITMENT_LABELS`)
* PAYG: line `compute` = hours × instances × Linux rate. Windows adds line `license` (kind
  `license`) = (Windows rate − Linux rate) × hours × instances. AHB adds line `license-ahb` at 0.
  Windows SKU without a Linux row → one combined line + `warning`.
* RI 1Y/3Y: `compute` line, `unit: "instances"`, `quantity` = instances, `unitPriceUsd` = term
  total per instance, `termMonths` 12/36. `riPayment: "monthly"` → `monthlyUsd = total/term`,
  `upfrontUsd 0`; `"upfront"` → `monthlyUsd 0`, `upfrontUsd = total`. `amortizedMonthlyUsd` is the
  same in both. Hours do not change RI compute. Windows license stays PAYG (hours-based) on top.
* SP 1Y/3Y: hourly SP rate of the **Linux** row × hours × instances; Windows license PAYG on top.
  No SP row → unavailable (message says when the snapshot has no savings plans at all).
* Spot (PAYG only; ignored with an `info` message otherwise): one `compute` line from the
  OS-specific Spot row (AHB → Linux Spot). Low Priority rows are never used.
* OS prices ignore products matching `VM_EXCLUDED_PRODUCT`
  (`dedicated host|cloud services|promo|basic|sql|red hat|rhel|suse|ubuntu|byol`; promo/basic only
  if the SKU has nothing else) and prefer the shortest productName.

**Disks** (`pricing/disks.ts`)
* P/E/S: one `disk` line, `unit: "disks"`, price per disk-month. Tier mode uses `config.tier`
  (a tier of another type, e.g. P10 on Standard SSD, is mapped by size → E10, with an `info`).
  Size mode = smallest tier ≥ `sizeGB` among tiers present in the data (assumption
  `"Disk size 300 GB rounded up to tier P20 (512 GiB)."`). Standard HDD is LRS only.
  Meters containing Mount/Burst/Operations/Snapshot/Transactions are ignored; Standard
  transactions are not priced (line note).
* Premium SSD v2: lines `capacity` (GiB), `iops`, `throughput` (MB/s), each priced per month
  (hourly meter × 730). 3,000 IOPS and 125 MB/s per disk are free; only the excess is billed.
  Capacity billed per GiB: `premiumV2BillableSizeGiB` = whole GiB, 1 GiB minimum.
* Ultra: capacity billed per GiB like v2 (`ultraBillableSizeGiB` = max(4, ceil(size)); no size
  steps — Ultra Disk sizes are 4 GiB–64 TiB in 1-GiB increments). **All** provisioned IOPS and MB/s
  are billed (no free baseline). vCPU reservation meter ignored. An assumption is added whenever
  the billed size differs from the entered size.
* v2/Ultra rows without LRS/ZRS in the name count as LRS; ZRS without ZRS meters → unavailable.

**Backup** (`pricing/backup.ts`)
* Line `instances` (kind `backup`): `quantity` = instances, `unitPriceUsd` = fee × band, band
  `protectedInstanceFees(sizeGB)`: ≤ 50 GB → 0.5; ≤ 500 GB → 1; else `ceil(size/500)`.
  Fee row: meter `"Azure VM Protected Instances"` / `"SQL Server in Azure VM Protected Instances"`,
  else a "Protected Instance" meter naming the workload (SAP HANA, Files, … excluded).
* Line `storage` (kind `storage`, `unit: "GB"`): GB = `instances × avgInstanceSizeGB × storagePercent/100`
  or `storageGB`; meter `"<LRS|ZRS|GRS|RA-GRS> Data Stored"` (GRS never matches RA-GRS;
  Archive/Snapshot ignored), tiered marginally. No storage line when GB = 0.

**Site Recovery** (`pricing/asr.ts`) — line `replication` (kind `dr`), per instance per month:
`"VM Replicated to Azure"` (azure-to-azure, onprem-to-azure) or `"VM Replicated to Customer Owned
Sites"` (onprem-to-onprem). First 31 days free and target compute/storage are not reflected (assumptions).

**SQL Server license** (`pricing/sqlLicense.ts`) — line `sql-license` (kind `license`),
`unit: "hours"`, `quantity` = hours × VMs, `unitPriceUsd` = license per VM-hour.
* Rows: service `Virtual Machines Licenses` (fallback: any `/licen[cs]e/i` service, max 3),
  region rows preferred, else `_global`. `type` Consumption, productName
  `/SQL Server.*(Standard|Enterprise|Web)/` excluding Developer/Express/Evaluation/Free,
  preferring names without Linux/RHEL/SUSE/SLES/Ubuntu, then the shortest.
* Verified naming: skuName `"1-4 vCPU VM"` (meter `"1-4 vCPU VM License"`, `"1 Hour"`) = price per
  VM-hour for up to 4 vCPUs; above 4 vCPUs the price is linear per vCPU.
* Resolver (`chooseSqlLicenseMeter`), billable = max(4, vCPUs):
  1. exact single-count VM meter (`"8 vCPU VM"`);
  2. narrowest VM range covering billable (`"5-8 vCPU VM"`);
  3. linear from the VM meter with the largest upper bound U ≤ billable (else the smallest U):
     price × billable / U — e.g. 8 vCPU Enterprise at 1.50/h → 3.00/h → 2,190/month;
  4. per-core meters (`"1 vCPU"`, `"Core"`, `"2 Core Pack"`): price × billable / pack size.
* AHB → line at 0 with a note (no price row needed).

**Generic meter** (`pricing/generic.ts`) — one line, `id = meterId`.
* `quantity` is in the meter's base units per month: instances for hourly/daily meters, GB,
  transactions (not packs), units… Billing units = quantity × `monthlyFactor(unit, hoursPerMonth)`;
  monthly = `tieredCost(tiers, billing units)`. Line `quantity` = billing units, `unit` =
  `billingUnitLabel`, `unitPriceUsd` = price per pack (average when tiered).
* Reservation meters: monthly = term total × quantity / term months (`termMonths` set, no upfront).
  SavingsPlans meters are hourly. Line kind from serviceFamily (Compute/Storage/Networking → compute/storage/network, else other).
* `genericRegionKey(config, region)`, `meterCommitment(type, term)`, `meterMonthlyUsd(option, qty, hours)` (price preview).

## Catalog helpers for pickers

**vmCatalog.ts**
* `buildVmCatalog(mainRows, specs, spotRows?) → VmSkuOption[]` — one option per armSkuName with any
  usable price; memoized by array identity (keep shard arrays stable). Fields: `armSkuName`, `label`
  ("D8as v5"), `family` ("Dasv5"), `specs` (null = unknown), `vCPUs` (specs, else parsed from the
  name), `memoryGB`, `linuxHourUsd`, `windowsHourUsd`, `ri1yTotalUsd`/`ri3yTotalUsd` (term totals),
  `sp1yHourUsd`/`sp3yHourUsd`, `spotLinuxHourUsd`/`spotWindowsHourUsd`; missing price = `undefined`.
* `filterVmSkus(options, { query, minVcpu, maxVcpu, minMemGB, maxMemGB, family, priceFor })` —
  bounds ≤ 0 ignored; unknown specs are dropped when a bound is set; `family` = exact
  (case-insensitive) or RegExp; `priceFor: { os, commitment, spot? }` keeps priced SKUs; a query
  ranks results ("D8as_v5", "Standard_D8as_v5", "d8as v5" → Standard_D8as_v5 first).
* `vmOptionMonthlyUsd(option, { os, commitment, spot?, hoursPerMonth? })` → per-instance monthly
  (RI amortized, Windows license on top) or null. `vmFamilies(options)`, `findVmOption(options, name)`,
  `compareVmOptions`.
* Lower level: `resolveVmSku(mainRows, armSkuName, spotRows?) → VmSkuPrices` (chosen rows,
  `rowCount` 0 = SKU not in region), `indexVmRows`, `lookupVmSpec`, `hourlyUsd(row)`, `isSpotRow`,
  `vmSkuLabel`, `vmFamilyFromProduct`, `vmFamilyFromSku`, `parseVcpuFromSku`
  (`Standard_E32-16s_v5` → 16), `VM_EXCLUDED_PRODUCT`.

**diskCatalog.ts** — `diskTierOptions(rows, diskType, redundancy) → { tier, sizeGB, monthlyUsd,
meterId, productName, skuName, meterName, effectiveStartDate }[]` (P/E/S only, sorted by size,
memoized); `diskRedundancies(rows, diskType)` (which of LRS/ZRS have prices); `diskTypeLabel`,
`DISK_TYPE_LABELS`, `diskTierPrefix` (P/E/S or null), `isTieredDiskType`, `provisionedDiskRows`,
`ultraBillableSizeGiB` (max(4, ceil(size))), `ULTRA_MIN_SIZE_GIB` (4), `premiumV2BillableSizeGiB`
(max(1, ceil(size))), `PREMIUM_V2_FREE_IOPS` (3000), `PREMIUM_V2_FREE_MBPS` (125), `DISK_EXCLUDED_METER`.

**tiers.ts** — `DISK_TIER_SIZES` (tier number → GiB), `parseTier("P30")`, `tierSizeGB("P30")` →
1024 (null if unknown; S starts at S4), `standardTiers("E")`, `pickTierForSize(prefix, sizeGB, availableTiers?)`.

**meters.ts** — `listMeters(rows) → MeterOption[]` (memoized; one option per
meterId+type+reservationTerm+product+SKU with effective `tiers[]`, sorted by product/SKU/meter);
`searchMeters(options, query, limit?)`; `findMeterOption(rows, { meterId, type?, reservationTerm?,
productName?, skuName? })` (type defaults to Consumption); `meterOptionKey`. Store `meterId`,
`type`, `reservationTerm` + display copies in `GenericConfig`.

**pricing/backup.ts / asr.ts / sqlLicense.ts extras** — `BACKUP_WORKLOAD_LABELS`,
`protectedInstanceFees`, `findProtectedInstanceRow`, `findBackupStorageTiers`;
`ASR_SCENARIO_LABELS`, `findAsrRows`; `SQL_EDITION_LABELS`, `SQL_MIN_VCPUS`,
`parseSqlLicenseMeter`, `chooseSqlLicenseMeter`, `resolveSqlLicense`, `sqlLicenseServiceNames`.

## Low-level helpers

**units.ts** — `parseUnit(uom) → { raw, packSize, measure, per, timeBased, recognized }` (cached,
frozen). `per`: `"hour" | "day" | "month" | "year" | null` (null = usage-based: GB, 10K…).
`timeBased` = per hour/day → show an hours/month input. Examples: `"1 Hour"` → pack 1, per hour;
`"1 GB/Month"` → measure GB, per month; `"10K"` → pack 10000; `"100 Hours"` → pack 100, per hour.
`describeUnit(uom)` → `"per hour"`, `"per GB/month"`, `"per 10K"`, `"per 100 hours"`, `"per unit"`.
`monthlyFactor(unit, hoursPerMonth)` = periods per month / packSize (hour → hours, day → hours/24,
month → 1, year → 1/12). `billingUnitLabel(uom, count?)` (Line.unit: "hours", "GB/month", "10K",
"GiB-hours"), `quantityLabel(uom, count?)` (input label: "instances", "GB", "GB per month"); both
are plural unless `count === 1` ("hour", "instance", "unit per month"). `periodsPerMonth`,
`formatPackSize`, `termMonths("3 Years")` → 36.

**tiered.ts** — `tieredCost(tiers, qty)` marginal over `tierMinimumUnits` (units below the lowest
minimum are free), `tieredBreakdown`, `freeAllowance`.

**effective.ts** — `todayIso`, `pickEffective`, `effectiveByKey`, `effectiveTiers`,
`effectiveBaseRow`, `isType`, `preferShortestProduct`, `pickPreferredRow`, `preferExactMeterName`.

**search.ts** — `normalize` (lowercase, strip `Standard_`, `_`/`-` → space), `queryTokens`,
`tokenMatch`, `score` (exact 1000 > prefix ~800 > contains ~450 > tokens ~300 > spread 100 > 0),
`rankBy(items, query, fields, limit?)`.

**serviceMatch.ts** — `SERVICE_MATCHERS` (vm, storage, backup, asr, sqlLicense),
`findService(services, names, fallback?)`, `findServices`, `matchService`,
`resolveServiceName(services, matcher)` (empty services → first preferred name),
`serviceByName`, `serviceHasRegion`.

**pricing/result.ts** — shared builders: `makeLine`, `finalize`, `incomplete`, `unavailable`,
`rowsFor`, `regionLabel`, `fmtNum`, `nounFor(n, "disk")` ("disk"/"disks"), `plural(n, "VM")` ("1 VM").
