// Managed disk price lookup (Storage service shard).
import type { DiskType } from "./model.ts";
import { HOURS_PER_MONTH } from "./model.ts";
import type { PriceRow } from "./types.ts";
import { effectiveBaseRow, isType, todayIso } from "./effective.ts";
import { type DiskTierPrefix, tierSizeGB } from "./tiers.ts";
import { monthlyFactor, parseUnit } from "./units.ts";

export type DiskRedundancy = "LRS" | "ZRS";

export interface DiskTierOption {
  /** e.g. "P30". */
  tier: string;
  sizeGB: number;
  /** USD per disk per month. */
  monthlyUsd: number;
  meterId: string;
  productName: string;
  skuName: string;
  meterName: string;
  effectiveStartDate: string;
}

export const DISK_TYPE_LABELS: Readonly<Record<DiskType, string>> = {
  "standard-hdd": "Standard HDD",
  "standard-ssd": "Standard SSD",
  "premium-ssd": "Premium SSD",
  "premium-ssd-v2": "Premium SSD v2",
  ultra: "Ultra Disk",
};

export function diskTypeLabel(diskType: DiskType): string {
  return DISK_TYPE_LABELS[diskType] ?? diskType;
}

/** Meters that are not the per-disk capacity charge. */
export const DISK_EXCLUDED_METER = /mount|burst|operations|snapshot|transactions/i;

/** Premium SSD v2: performance included per disk at no extra cost. */
export const PREMIUM_V2_FREE_IOPS = 3000;
export const PREMIUM_V2_FREE_MBPS = 125;

interface TieredProduct {
  prefix: DiskTierPrefix;
  exact: string;
  re: RegExp;
}

const TIERED_PRODUCTS: Partial<Record<DiskType, TieredProduct>> = {
  "premium-ssd": { prefix: "P", exact: "premium ssd managed disks", re: /premium ssd managed disk/i },
  "standard-ssd": { prefix: "E", exact: "standard ssd managed disks", re: /standard ssd managed disk/i },
  "standard-hdd": { prefix: "S", exact: "standard hdd managed disks", re: /standard hdd managed disk/i },
};

const PROVISIONED_PRODUCTS: Partial<Record<DiskType, RegExp>> = {
  "premium-ssd-v2": /premium ssd v2/i,
  ultra: /ultra disk/i,
};

/** "P" | "E" | "S" for tiered types; null for Premium SSD v2 / Ultra. */
export function diskTierPrefix(diskType: DiskType): DiskTierPrefix | null {
  return TIERED_PRODUCTS[diskType]?.prefix ?? null;
}

export function isTieredDiskType(diskType: DiskType): boolean {
  return diskTierPrefix(diskType) !== null;
}

function tierOf(row: PriceRow): { tier: string; redundancy: string } | null {
  for (const text of [row.skuName, row.meterName]) {
    const m = /\b([PES])(\d+)\s+(LRS|ZRS)\b/i.exec(text);
    if (m) return { tier: `${m[1].toUpperCase()}${Number(m[2])}`, redundancy: m[3].toUpperCase() };
  }
  return null;
}

function tieredCandidates(rows: readonly PriceRow[], spec: TieredProduct): PriceRow[] {
  const candidates = rows.filter(
    (r) =>
      isType(r, "Consumption") &&
      spec.re.test(r.productName) &&
      !/v2|ultra/i.test(r.productName) &&
      !DISK_EXCLUDED_METER.test(r.meterName) &&
      !DISK_EXCLUDED_METER.test(r.skuName),
  );
  const exact = candidates.filter((r) => r.productName.trim().toLowerCase() === spec.exact);
  return exact.length > 0 ? exact : candidates;
}

const tierMemo = new WeakMap<readonly PriceRow[], Map<string, DiskTierOption[]>>();

/**
 * Per-disk monthly price of every tier of a tiered disk type (P/E/S) for one redundancy, sorted by
 * size. [] for Premium SSD v2 / Ultra, or when the type/redundancy has no price in the shard.
 */
export function diskTierOptions(
  rows: readonly PriceRow[],
  diskType: DiskType,
  redundancy: DiskRedundancy | string,
): DiskTierOption[] {
  const spec = TIERED_PRODUCTS[diskType];
  if (!spec) return [];
  const today = todayIso();
  const red = redundancy.toUpperCase();
  const memoKey = `${diskType}|${red}|${today}`;
  let memo = tierMemo.get(rows);
  const hit = memo?.get(memoKey);
  if (hit) return hit;

  const byTier = new Map<string, PriceRow[]>();
  for (const r of tieredCandidates(rows, spec)) {
    const t = tierOf(r);
    if (!t || t.redundancy !== red || !t.tier.startsWith(spec.prefix)) continue;
    const per = parseUnit(r.unitOfMeasure).per;
    if (per !== "month" && per !== "hour" && per !== "day") continue;
    const list = byTier.get(t.tier);
    if (list) list.push(r);
    else byTier.set(t.tier, [r]);
  }
  const out: DiskTierOption[] = [];
  for (const [tier, list] of byTier) {
    const sizeGB = tierSizeGB(tier);
    const row = effectiveBaseRow(list, today);
    if (sizeGB === null || !row) continue;
    out.push({
      tier,
      sizeGB,
      monthlyUsd: row.retailPrice * monthlyFactor(row.unitOfMeasure, HOURS_PER_MONTH),
      meterId: row.meterId,
      productName: row.productName,
      skuName: row.skuName,
      meterName: row.meterName,
      effectiveStartDate: row.effectiveStartDate,
    });
  }
  out.sort((a, b) => a.sizeGB - b.sizeGB);
  if (!memo) {
    memo = new Map();
    tierMemo.set(rows, memo);
  }
  memo.set(memoKey, out);
  return out;
}

function redundancyMention(row: PriceRow): string | null {
  const m = /\b(LRS|ZRS)\b/i.exec(`${row.skuName} ${row.meterName}`);
  return m ? m[1].toUpperCase() : null;
}

/**
 * Consumption rows of Premium SSD v2 / Ultra for a redundancy. Rows that mention no redundancy
 * are treated as LRS (both products were LRS-only for a long time).
 */
export function provisionedDiskRows(
  rows: readonly PriceRow[],
  diskType: DiskType,
  redundancy: DiskRedundancy | string,
): PriceRow[] {
  const re = PROVISIONED_PRODUCTS[diskType];
  if (!re) return [];
  const red = redundancy.toUpperCase();
  const candidates = rows.filter(
    (r) => isType(r, "Consumption") && re.test(r.productName) && !DISK_EXCLUDED_METER.test(r.meterName),
  );
  return candidates.filter((r) => (redundancyMention(r) ?? "LRS") === red);
}

/** Redundancies with prices in the shard for a disk type (for disabling ZRS in the UI). */
export function diskRedundancies(rows: readonly PriceRow[], diskType: DiskType): DiskRedundancy[] {
  const out: DiskRedundancy[] = [];
  for (const red of ["LRS", "ZRS"] as const) {
    const has = isTieredDiskType(diskType)
      ? diskTierOptions(rows, diskType, red).length > 0
      : provisionedDiskRows(rows, diskType, red).some((r) => /provisioned capacity/i.test(r.meterName));
    if (has) out.push(red);
  }
  return out;
}

/** Smallest Ultra Disk size (GiB). */
export const ULTRA_MIN_SIZE_GIB = 4;

/** Billed Ultra Disk capacity: per GiB in 1-GiB increments, 4 GiB minimum (4 GiB – 64 TiB). */
export function ultraBillableSizeGiB(sizeGB: number): number {
  return Math.max(ULTRA_MIN_SIZE_GIB, Math.ceil(sizeGB > 0 ? sizeGB : 0));
}

/** Billed Premium SSD v2 capacity: per GiB in 1-GiB increments, 1 GiB minimum. */
export function premiumV2BillableSizeGiB(sizeGB: number): number {
  return Math.max(1, Math.ceil(sizeGB > 0 ? sizeGB : 0));
}
