// Managed Disks: tiered Standard HDD (S) / Standard SSD (E) / Premium SSD (P), and provisioned
// Premium SSD v2 / Ultra Disk (capacity + IOPS + throughput).
import { HOURS_PER_MONTH, disksConfigSchema } from "../model.ts";
import type { DisksConfig } from "../model.ts";
import type { ItemMessage, Line, PricingContext, PricingModule, ShardRef } from "../types.ts";
import {
  PREMIUM_V2_FREE_IOPS,
  PREMIUM_V2_FREE_MBPS,
  diskTierOptions,
  diskTierPrefix,
  diskTypeLabel,
  premiumV2BillableSizeGiB,
  provisionedDiskRows,
  ultraBillableSizeGiB,
} from "../diskCatalog.ts";
import { pickPreferredRow } from "../effective.ts";
import { SERVICE_MATCHERS, resolveServiceName, serviceByName, serviceHasRegion } from "../serviceMatch.ts";
import { parseTier, pickTierForSize, tierSizeGB } from "../tiers.ts";
import { monthlyFactor } from "../units.ts";
import { finalize, fmtNum, incomplete, makeLine, nounFor, regionLabel, rowsFor, unavailable } from "./result.ts";

function storageServiceName(ctx: PricingContext): string {
  return resolveServiceName(ctx.services, SERVICE_MATCHERS.storage) ?? "Storage";
}

function computeTiered(config: DisksConfig, ctx: PricingContext) {
  const type = config.diskType;
  const prefix = diskTierPrefix(type) ?? "P";
  const typeLabel = diskTypeLabel(type);
  const where = regionLabel(ctx);
  const rows = rowsFor(ctx, { serviceName: storageServiceName(ctx), regionKey: ctx.region });
  const options = diskTierOptions(rows, type, config.redundancy);
  const messages: ItemMessage[] = [];
  const assumptions: string[] = [];
  if (options.length === 0) {
    if (type === "standard-hdd" && config.redundancy === "ZRS") {
      return unavailable("Standard HDD managed disks support LRS only; choose LRS.");
    }
    return unavailable(`${typeLabel} ${config.redundancy} managed disks are not available in ${where}.`);
  }
  const available = options.map((o) => o.tier);

  let tier: string;
  if (config.sizingMode === "size") {
    const picked = pickTierForSize(prefix, config.sizeGB, available);
    if (!picked) {
      return unavailable(`No ${typeLabel} ${config.redundancy} tier of at least ${fmtNum(config.sizeGB)} GB is available in ${where}.`);
    }
    tier = picked;
    assumptions.push(`Disk size ${fmtNum(config.sizeGB)} GB rounded up to tier ${tier} (${fmtNum(tierSizeGB(tier) ?? 0)} GiB).`);
  } else {
    const requested = config.tier.trim().toUpperCase();
    if (!requested) return incomplete("Choose a disk tier.");
    const parsed = parseTier(requested);
    if (parsed && parsed.prefix !== prefix) {
      // e.g. "P10" kept after switching the type to Standard SSD: map by size.
      const size = tierSizeGB(requested) ?? 0;
      const mapped = pickTierForSize(prefix, size, available);
      if (!mapped) return unavailable(`Tier ${requested} has no ${typeLabel} equivalent in ${where}.`);
      messages.push({ level: "info", text: `Tier ${requested} is not a ${typeLabel} tier; priced as ${mapped}.` });
      tier = mapped;
    } else {
      tier = parsed ? `${parsed.prefix}${parsed.number}` : requested;
    }
  }
  const option = options.find((o) => o.tier === tier);
  if (!option) return unavailable(`${typeLabel} tier ${tier} ${config.redundancy} is not available in ${where}.`);

  const notes: string[] = [];
  if (type !== "premium-ssd") {
    notes.push("Transactions (disk operations) are not included.");
  }
  const line = makeLine({
    id: "disk",
    meterId: option.meterId,
    label: `${typeLabel} ${tier} ${config.redundancy}`,
    detail: `${fmtNum(option.sizeGB)} GiB · ${option.meterName || option.skuName}`,
    unit: nounFor(config.disks, "disk"),
    quantity: config.disks,
    unitPriceUsd: option.monthlyUsd,
    kind: "storage",
    notes,
    effectiveStartDate: option.effectiveStartDate,
  });
  return finalize([line], messages, assumptions);
}

function computeProvisioned(config: DisksConfig, ctx: PricingContext) {
  const type = config.diskType;
  const ultra = type === "ultra";
  const typeLabel = diskTypeLabel(type);
  const where = regionLabel(ctx);
  const rows = rowsFor(ctx, { serviceName: storageServiceName(ctx), regionKey: ctx.region });
  const pool = provisionedDiskRows(rows, type, config.redundancy);
  const capacityRow = pickPreferredRow(pool.filter((r) => /provisioned capacity/i.test(r.meterName)));
  if (!capacityRow) return unavailable(`${typeLabel} ${config.redundancy} is not available in ${where}.`);
  const iopsRow = pickPreferredRow(pool.filter((r) => /provisioned iops/i.test(r.meterName)));
  const mbpsRow = pickPreferredRow(pool.filter((r) => /provisioned throughput/i.test(r.meterName)));

  const disks = config.disks;
  const sizeGiB = ultra ? ultraBillableSizeGiB(config.sizeGB) : premiumV2BillableSizeGiB(config.sizeGB);
  const iops = ultra ? config.iops : Math.max(0, config.iops - PREMIUM_V2_FREE_IOPS);
  const mbps = ultra ? config.throughputMBps : Math.max(0, config.throughputMBps - PREMIUM_V2_FREE_MBPS);
  if (iops > 0 && !iopsRow) return unavailable(`The ${typeLabel} provisioned IOPS price is not available in ${where}.`);
  if (mbps > 0 && !mbpsRow) return unavailable(`The ${typeLabel} provisioned throughput price is not available in ${where}.`);

  const assumptions: string[] = ["Hourly disk meters are converted to monthly prices with 730 hours."];
  if (ultra) {
    assumptions.push("Ultra Disk bills all provisioned IOPS and throughput (no free baseline).");
  } else {
    assumptions.push(
      "Premium SSD v2 includes 3,000 IOPS and 125 MB/s per disk at no cost; only provisioned performance above that is billed.",
    );
  }
  if (sizeGiB !== config.sizeGB) {
    assumptions.push(
      ultra
        ? `Ultra Disk size ${fmtNum(config.sizeGB)} GiB billed as ${fmtNum(sizeGiB)} GiB (per GiB, 4 GiB minimum).`
        : `Premium SSD v2 size ${fmtNum(config.sizeGB)} GiB billed as ${fmtNum(sizeGiB)} GiB (per GiB).`,
    );
  }

  const perMonth = (row: { unitOfMeasure: string; retailPrice: number }) =>
    row.retailPrice * monthlyFactor(row.unitOfMeasure, HOURS_PER_MONTH);
  const lines: Line[] = [
    makeLine({
      id: "capacity",
      meterId: capacityRow.meterId,
      label: `${typeLabel} capacity`,
      detail: `${fmtNum(sizeGiB)} GiB per disk · ${capacityRow.meterName}`,
      unit: "GiB",
      quantity: sizeGiB * disks,
      unitPriceUsd: perMonth(capacityRow),
      kind: "storage",
      notes: ["Price per GiB per month."],
      effectiveStartDate: capacityRow.effectiveStartDate,
    }),
  ];
  if (iopsRow) {
    lines.push(
      makeLine({
        id: "iops",
        meterId: iopsRow.meterId,
        label: `${typeLabel} provisioned IOPS`,
        detail: ultra
          ? `${fmtNum(config.iops)} IOPS per disk`
          : `${fmtNum(config.iops)} IOPS per disk, first ${fmtNum(PREMIUM_V2_FREE_IOPS)} free`,
        unit: "IOPS",
        quantity: iops * disks,
        unitPriceUsd: perMonth(iopsRow),
        kind: "storage",
        notes: ultra
          ? ["All provisioned IOPS are billed (no free baseline)."]
          : [`First ${fmtNum(PREMIUM_V2_FREE_IOPS)} IOPS per disk are free.`],
        effectiveStartDate: iopsRow.effectiveStartDate,
      }),
    );
  }
  if (mbpsRow) {
    lines.push(
      makeLine({
        id: "throughput",
        meterId: mbpsRow.meterId,
        label: `${typeLabel} provisioned throughput`,
        detail: ultra
          ? `${fmtNum(config.throughputMBps)} MB/s per disk`
          : `${fmtNum(config.throughputMBps)} MB/s per disk, first ${fmtNum(PREMIUM_V2_FREE_MBPS)} free`,
        unit: "MB/s",
        quantity: mbps * disks,
        unitPriceUsd: perMonth(mbpsRow),
        kind: "storage",
        notes: ultra
          ? ["All provisioned throughput is billed (no free baseline)."]
          : [`First ${fmtNum(PREMIUM_V2_FREE_MBPS)} MB/s per disk are free.`],
        effectiveStartDate: mbpsRow.effectiveStartDate,
      }),
    );
  }
  return finalize(lines, [], assumptions);
}

export const disksModule: PricingModule<DisksConfig> = {
  id: "disks",
  title: "Managed Disks",
  description: "Block storage for VMs: Standard HDD, Standard SSD, Premium SSD, Premium SSD v2 and Ultra Disk.",
  category: "Storage",
  iconKey: "managed-disks",
  configSchema: disksConfigSchema,
  defaultConfig() {
    return disksConfigSchema.parse({});
  },
  shards(_config, region, services): ShardRef[] {
    if (!region) return [];
    const serviceName = resolveServiceName(services, SERVICE_MATCHERS.storage);
    if (!serviceName || !serviceHasRegion(serviceByName(services, serviceName), region)) return [];
    return [{ serviceName, regionKey: region }];
  },
  compute(config, ctx) {
    if (!ctx.region) return incomplete("Choose a region.");
    return diskTierPrefix(config.diskType) ? computeTiered(config, ctx) : computeProvisioned(config, ctx);
  },
  summarize(config) {
    const label = diskTypeLabel(config.diskType);
    const count = `${fmtNum(config.disks)} ×`;
    if (!diskTierPrefix(config.diskType)) {
      return [
        `${count} ${fmtNum(config.sizeGB)} GiB`,
        `${fmtNum(config.iops)} IOPS`,
        `${fmtNum(config.throughputMBps)} MB/s`,
        `${label} ${config.redundancy}`,
      ].join(" · ");
    }
    const what = config.sizingMode === "size" ? `${fmtNum(config.sizeGB)} GB` : config.tier.trim().toUpperCase() || "?";
    return `${count} ${what} ${config.redundancy} · ${label}`;
  },
};
