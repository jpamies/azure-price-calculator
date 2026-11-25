// Azure Backup: protected-instance fee (banded by instance size) + backup storage (GB/month, tiered).
import { HOURS_PER_MONTH, backupConfigSchema } from "../model.ts";
import type { BackupConfig } from "../model.ts";
import type { Line, PriceRow, PricingContext, PricingModule, ShardRef } from "../types.ts";
import { effectiveTiers, isType, pickPreferredRow, preferExactMeterName, preferShortestProduct, todayIso } from "../effective.ts";
import { SERVICE_MATCHERS, resolveServiceName, serviceByName, serviceHasRegion } from "../serviceMatch.ts";
import { tieredCost } from "../tiered.ts";
import { monthlyFactor } from "../units.ts";
import { finalize, fmtNum, incomplete, makeLine, nounFor, plural, regionLabel, rowsFor, unavailable } from "./result.ts";

export const BACKUP_WORKLOAD_LABELS: Readonly<Record<BackupConfig["workload"], string>> = {
  "azure-vm": "Azure VM",
  "sql-in-azure-vm": "SQL Server in Azure VM",
};

const WORKLOADS: Record<BackupConfig["workload"], { exact: string; match: RegExp; exclude: RegExp }> = {
  "azure-vm": {
    exact: "Azure VM Protected Instances",
    match: /\bazure vms?\b/i,
    exclude: /sql|sap|hana|postgre|mysql|oracle|file|blob|disk|on-?prem|dpm|mabs|exchange|sharepoint/i,
  },
  "sql-in-azure-vm": {
    exact: "SQL Server in Azure VM Protected Instances",
    match: /\bsql\b/i,
    exclude: /sap|hana|postgre|mysql|oracle|on-?prem|dpm|mabs/i,
  },
};

/**
 * Protected-instance fees per instance (official model, the price row is the 50–500 GB fee):
 * <= 50 GB → 0.5; 50–500 GB → 1; > 500 GB → 1 per started 500 GB.
 */
export function protectedInstanceFees(sizeGB: number): number {
  if (sizeGB <= 50) return 0.5;
  if (sizeGB <= 500) return 1;
  return Math.ceil(sizeGB / 500);
}

/**
 * The protected-instance fee row for a workload: exact meterName ("Azure VM Protected Instances",
 * "SQL Server in Azure VM Protected Instances"), else a "Protected Instance" meter whose
 * product/SKU/meter text names the workload and no other workload (SAP HANA, Files, …).
 */
export function findProtectedInstanceRow(
  rows: readonly PriceRow[],
  workload: BackupConfig["workload"],
  today: string = todayIso(),
): PriceRow | undefined {
  const spec = WORKLOADS[workload];
  const pis = rows.filter((r) => isType(r, "Consumption") && /protected instance/i.test(`${r.skuName} ${r.meterName}`));
  const exact = pis.filter((r) => r.meterName.trim().toLowerCase() === spec.exact.toLowerCase());
  if (exact.length > 0) return pickPreferredRow(exact, today);
  // Loose fallback: the workload may sit in the SKU or product name instead of the meter name.
  const loose = pis.filter((r) => {
    const text = `${r.productName} ${r.skuName} ${r.meterName}`;
    return spec.match.test(text) && !spec.exclude.test(text);
  });
  return pickPreferredRow(loose, today);
}

/** "GRS" must not match "RA-GRS": the code may not be preceded by a letter, digit or "-". */
function storageMeterRe(redundancy: string): RegExp {
  const code = redundancy.replace(/[-]/g, "\\-");
  return new RegExp(`(?:^|[^a-z0-9-])${code}\\s+data stored`, "i");
}

/** Effective tier rows of the backup storage meter "<redundancy> Data Stored" (Archive/Snapshot excluded). */
export function findBackupStorageTiers(
  rows: readonly PriceRow[],
  redundancy: BackupConfig["redundancy"],
  today: string = todayIso(),
): PriceRow[] {
  const re = storageMeterRe(redundancy);
  const candidates = rows.filter(
    (r) => isType(r, "Consumption") && re.test(r.meterName) && !/archive|snapshot/i.test(r.meterName),
  );
  if (candidates.length === 0) return [];
  const pool = preferShortestProduct(preferExactMeterName(candidates, [`${redundancy} Data Stored`]));
  const meterName = pool[0].meterName;
  return effectiveTiers(
    pool.filter((r) => r.meterName === meterName),
    today,
  );
}

function computeBackup(config: BackupConfig, ctx: PricingContext) {
  if (!ctx.region) return incomplete("Choose a region.");
  const serviceName = resolveServiceName(ctx.services, SERVICE_MATCHERS.backup) ?? "Backup";
  const rows = rowsFor(ctx, { serviceName, regionKey: ctx.region });
  const where = regionLabel(ctx);
  const workload = BACKUP_WORKLOAD_LABELS[config.workload];

  const instanceRow = findProtectedInstanceRow(rows, config.workload);
  if (!instanceRow) return unavailable(`The Azure Backup protected-instance price (${workload}) is not available in ${where}.`);
  const fee = instanceRow.retailPrice * monthlyFactor(instanceRow.unitOfMeasure, HOURS_PER_MONTH);
  const size = config.avgInstanceSizeGB;
  const fees = protectedInstanceFees(size);
  const feesText = fees === 0.5 ? "half" : `${fmtNum(fees)} ×`;

  const lines: Line[] = [
    makeLine({
      id: "instances",
      meterId: instanceRow.meterId,
      label: `Protected instances (${workload})`,
      detail: `${fmtNum(size)} GB per instance · ${instanceRow.meterName}`,
      unit: nounFor(config.instances, "instance"),
      quantity: config.instances,
      unitPriceUsd: fee * fees,
      kind: "backup",
      notes: [`Each ${fmtNum(size)} GB instance is billed ${feesText} the protected-instance fee.`],
      effectiveStartDate: instanceRow.effectiveStartDate,
    }),
  ];
  const assumptions = [
    `Each protected instance (${fmtNum(size)} GB) is billed ${feesText} the instance fee (≤ 50 GB: half; 50–500 GB: 1; > 500 GB: 1 per started 500 GB).`,
    "Instant-restore snapshots, archive tier and restore egress are not included.",
  ];

  const protectedGB = config.instances * size;
  const storageGB = config.storageMode === "percent" ? (protectedGB * config.storagePercent) / 100 : config.storageGB;
  // Storage sizing (percent of protected data or explicit GB) is stated in the estimate-level assumptions.

  if (storageGB > 0) {
    const tiers = findBackupStorageTiers(rows, config.redundancy);
    if (tiers.length === 0) return unavailable(`${config.redundancy} backup storage is not available in ${where}.`);
    const factor = monthlyFactor(tiers[0].unitOfMeasure, HOURS_PER_MONTH);
    const monthly = tieredCost(tiers, storageGB * factor);
    const tiered = tiers.length > 1 || tiers[0].tierMinimumUnits > 0;
    lines.push(
      makeLine({
        id: "storage",
        meterId: tiers[0].meterId,
        label: `Backup storage (${config.redundancy})`,
        detail: tiers[0].meterName,
        unit: "GB",
        quantity: storageGB,
        unitPriceUsd: tiered ? monthly / storageGB : tiers[0].retailPrice * factor,
        monthlyUsd: monthly,
        kind: "storage",
        notes: tiered ? ["Tiered price per GB; unit price shown is the average."] : [],
        effectiveStartDate: tiers[0].effectiveStartDate,
      }),
    );
  }
  return finalize(lines, [], assumptions);
}

export const backupModule: PricingModule<BackupConfig> = {
  id: "backup",
  title: "Azure Backup",
  description: "Backup of Azure VMs and SQL Server in Azure VMs: protected-instance fee plus backup storage.",
  category: "Storage",
  iconKey: "backup",
  configSchema: backupConfigSchema,
  defaultConfig() {
    return backupConfigSchema.parse({});
  },
  shards(_config, region, services): ShardRef[] {
    if (!region) return [];
    const serviceName = resolveServiceName(services, SERVICE_MATCHERS.backup);
    if (!serviceName || !serviceHasRegion(serviceByName(services, serviceName), region)) return [];
    return [{ serviceName, regionKey: region }];
  },
  compute: computeBackup,
  summarize(config) {
    return [
      `${plural(config.instances, "instance")} · ${BACKUP_WORKLOAD_LABELS[config.workload]}`,
      `${fmtNum(config.avgInstanceSizeGB)} GB avg`,
      config.redundancy,
    ].join(" · ");
  },
};
