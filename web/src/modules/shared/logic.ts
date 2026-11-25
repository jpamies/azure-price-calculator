// Pure helpers behind the module configuration forms (no React, no DOM, relative `.ts` imports) so
// they run under `node --test`: number input parsing, VM picker sorting/price summaries, unit
// semantics of generic meters, disk performance limits and the backup fee band.
import type { BackupConfig, CommitmentId, DisksConfig, DiskType, VmConfig } from "../../domain/model.ts";
import { HOURS_PER_MONTH } from "../../domain/model.ts";
import { protectedInstanceFees } from "../../domain/pricing/backup.ts";
import { compareVmOptions, vmOptionMonthlyUsd } from "../../domain/vmCatalog.ts";
import type { VmSkuOption } from "../../domain/vmCatalog.ts";
import { describeUnit, parseUnit } from "../../domain/units.ts";
import type { MeterOption } from "../../domain/meters.ts";
import { meterCommitment } from "../../domain/pricing/generic.ts";
import { COMMITMENT_LABELS } from "../../domain/pricing/vm.ts";
import { pickTierForSize, standardTiers, tierSizeGB } from "../../domain/tiers.ts";

// ---------------------------------------------------------------- numbers

/**
 * Parses what a user typed in a numeric field. Accepts grouping ("1,000", "1 000", "1_000"),
 * a decimal comma when it cannot be a thousands separator ("1,5", "1.234,5"), exponents and
 * k/M suffixes ("5k" → 5000, "2M" → 2000000). null when it is not a number.
 */
export function parseNumberInput(text: string): number | null {
  let t = (text ?? "").trim().replace(/[\s_\u00a0\u202f]/g, "");
  if (!t) return null;
  const hasDot = t.includes(".");
  const commas = (t.match(/,/g) ?? []).length;
  if (hasDot && commas > 0) {
    // The last separator is the decimal one: "1,234.5" (en) or "1.234,5" (es/de).
    if (t.lastIndexOf(",") > t.lastIndexOf(".")) t = t.replace(/\./g, "").replace(",", ".");
    else t = t.replace(/,/g, "");
  } else if (commas === 1 && !/,\d{3}$/.test(t)) {
    t = t.replace(",", ".");
  } else if (commas > 0) {
    if (!/^[+-]?\d{1,3}(,\d{3})+(?:[km])?$/i.test(t)) return null;
    t = t.replace(/,/g, "");
  }
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)([km])?$/i.exec(t);
  if (!m) return null;
  let n = Number(m[1]);
  if (m[2]) n *= m[2].toLowerCase() === "k" ? 1e3 : 1e6;
  return Number.isFinite(n) ? n : null;
}

export interface NumberBounds {
  min?: number;
  max?: number;
  integer?: boolean;
}

/** Rounds (integer fields) and clamps into [min, max]. */
export function clampNumber(n: number, { min, max, integer }: NumberBounds = {}): number {
  let v = integer ? Math.round(n) : n;
  if (min !== undefined && v < min) v = min;
  if (max !== undefined && v > max) v = max;
  return v === 0 ? 0 : v;
}

/** Validation message for a draft value (null = fine). Out-of-range values are clamped on commit. */
export function numberIssue(parsed: number | null, bounds: NumberBounds): string | null {
  if (parsed === null) return "Enter a number.";
  const { min, max, integer } = bounds;
  const range =
    min !== undefined && max !== undefined
      ? `${formatInputNumber(min)}–${formatInputNumber(max)}`
      : min !== undefined
        ? `at least ${formatInputNumber(min)}`
        : max !== undefined
          ? `at most ${formatInputNumber(max)}`
          : "";
  if ((min !== undefined && parsed < min) || (max !== undefined && parsed > max)) {
    return `Allowed: ${range}. It will be adjusted.`;
  }
  if (integer && !Number.isInteger(parsed)) return "Whole numbers only; it will be rounded.";
  return null;
}

/** Display form of a committed value: en-US grouping, up to 6 decimals ("5,000", "0.25"). */
export function formatInputNumber(n: number): string {
  if (!Number.isFinite(n)) return "";
  return n.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

/** Integer grouping helper for labels ("1,024"). */
export function fmtInt(n: number): string {
  return Number.isFinite(n) ? Math.round(n).toLocaleString("en-US") : "—";
}

/** Disk/RAM sizes: "512 GiB", "1 TiB", "32,767 GiB" (exact TiB only). */
export function formatGiB(gib: number): string {
  if (!Number.isFinite(gib)) return "—";
  if (gib >= 1024 && gib % 1024 === 0) return `${(gib / 1024).toLocaleString("en-US")} TiB`;
  return `${gib.toLocaleString("en-US", { maximumFractionDigits: 2 })} GiB`;
}

// ---------------------------------------------------------------- savings

/** Fraction saved vs a reference (0.62 = 62 % cheaper; negative = more expensive). null if unknown. */
export function savingsFraction(reference: number | null | undefined, value: number | null | undefined): number | null {
  if (reference === null || reference === undefined || value === null || value === undefined) return null;
  if (!(reference > 0) || !Number.isFinite(value)) return null;
  return 1 - value / reference;
}

/** "−62%" / "+5%" / "±0%" (minus sign U+2212). */
export function formatSavings(fraction: number | null): string {
  if (fraction === null || !Number.isFinite(fraction)) return "";
  const pct = Math.round(fraction * 100);
  if (pct === 0) return "±0%";
  return pct > 0 ? `\u2212${pct}%` : `+${-pct}%`;
}

// ---------------------------------------------------------------- VM picker

export type VmColumnKey = "sku" | "vcpu" | "ram" | "linux" | "windows" | "ri1y" | "ri3y" | "sp1y" | "sp3y" | "spot";
export type SortDir = "asc" | "desc";
export interface VmSort {
  key: VmColumnKey;
  dir: SortDir;
}

/** Value shown/sorted in a picker column; RI columns are the monthly equivalent (term total / months). */
export function vmColumnValue(o: VmSkuOption, key: VmColumnKey, os: VmConfig["os"]): number | string | undefined {
  switch (key) {
    case "sku":
      return o.label;
    case "vcpu":
      return o.specs ? o.vCPUs : undefined;
    case "ram":
      return o.specs ? o.memoryGB : undefined;
    case "linux":
      return o.linuxHourUsd;
    case "windows":
      return o.windowsHourUsd;
    case "ri1y":
      return o.ri1yTotalUsd === undefined ? undefined : o.ri1yTotalUsd / 12;
    case "ri3y":
      return o.ri3yTotalUsd === undefined ? undefined : o.ri3yTotalUsd / 36;
    case "sp1y":
      return o.sp1yHourUsd;
    case "sp3y":
      return o.sp3yHourUsd;
    case "spot":
      return os === "windows" ? o.spotWindowsHourUsd : o.spotLinuxHourUsd;
  }
}

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/** Stable sort by a column; missing values always last; ties keep the catalog order. */
export function sortVmOptions(options: readonly VmSkuOption[], sort: VmSort, os: VmConfig["os"]): VmSkuOption[] {
  const sign = sort.dir === "asc" ? 1 : -1;
  return options
    .map((o, i) => ({ o, i, v: vmColumnValue(o, sort.key, os) }))
    .sort((a, b) => {
      const am = a.v === undefined || (typeof a.v === "number" && !Number.isFinite(a.v));
      const bm = b.v === undefined || (typeof b.v === "number" && !Number.isFinite(b.v));
      if (am !== bm) return am ? 1 : -1;
      let c = 0;
      if (!am && !bm) {
        c = typeof a.v === "string" || typeof b.v === "string" ? collator.compare(String(a.v), String(b.v)) : (a.v as number) - (b.v as number);
      }
      if (c === 0 && sort.key === "sku") c = compareVmOptions(a.o, b.o);
      return c * sign || a.i - b.i;
    })
    .map((x) => x.o);
}

/** The price column matching the item's OS/commitment (highlighted in the picker). */
export function activeVmColumn(config: Pick<VmConfig, "os" | "commitment" | "spot">): VmColumnKey {
  if (config.spot && config.commitment === "payg") return "spot";
  switch (config.commitment) {
    case "payg":
      return config.os === "windows" ? "windows" : "linux";
    default:
      return config.commitment;
  }
}

export interface VmPriceSummary {
  /** Effective USD per hour per VM (RI: amortized monthly / 730). */
  hourlyUsd: number;
  /** USD per month per VM (RI amortized; Windows license on top). */
  monthlyUsd: number;
  /** Reservation term total per VM (compute only). */
  termTotalUsd?: number;
  termMonths?: number;
  /** Windows license per month per VM when it is billed on top of a reservation/savings plan. */
  licenseMonthlyUsd?: number;
}

/** Per-VM price of an option for the item's settings; null when a needed price is missing. */
export function vmPriceSummary(
  option: VmSkuOption,
  config: Pick<VmConfig, "os" | "commitment" | "spot" | "hoursPerMonth">,
): VmPriceSummary | null {
  const hours = config.hoursPerMonth;
  const spot = config.spot && config.commitment === "payg";
  const monthly = vmOptionMonthlyUsd(option, { os: config.os, commitment: config.commitment, spot, hoursPerMonth: hours });
  if (monthly === null) return null;
  const isRi = config.commitment === "ri1y" || config.commitment === "ri3y";
  const summary: VmPriceSummary = {
    hourlyUsd: isRi ? monthly / HOURS_PER_MONTH : hours > 0 ? monthly / hours : 0,
    monthlyUsd: monthly,
  };
  if (isRi) {
    summary.termMonths = config.commitment === "ri1y" ? 12 : 36;
    summary.termTotalUsd = config.commitment === "ri1y" ? option.ri1yTotalUsd : option.ri3yTotalUsd;
  }
  if (config.os === "windows" && config.commitment !== "payg" && option.windowsHourUsd !== undefined && option.linuxHourUsd !== undefined) {
    summary.licenseMonthlyUsd = Math.max(0, option.windowsHourUsd - option.linuxHourUsd) * hours;
  }
  return summary;
}

/** Monthly USD per VM for every commitment plus the savings vs pay-as-you-go (same OS and hours). */
export function vmCommitmentSavings(
  option: VmSkuOption | undefined,
  config: Pick<VmConfig, "os" | "hoursPerMonth">,
  commitments: readonly CommitmentId[],
): Record<CommitmentId, { monthlyUsd: number | null; savings: number | null }> {
  const sel = { os: config.os, hoursPerMonth: config.hoursPerMonth };
  const payg = option ? vmOptionMonthlyUsd(option, { ...sel, commitment: "payg" }) : null;
  const out = {} as Record<CommitmentId, { monthlyUsd: number | null; savings: number | null }>;
  for (const c of commitments) {
    const m = option ? vmOptionMonthlyUsd(option, { ...sel, commitment: c }) : null;
    out[c] = { monthlyUsd: m, savings: c === "payg" ? null : savingsFraction(payg, m) };
  }
  return out;
}

// ---------------------------------------------------------------- generic meters

export interface QuantitySemantics {
  /** Field label, e.g. "GB per month", "Instances", "Transactions per month". */
  label: string;
  /** Short unit for the input adornment, e.g. "GB", "×", "10K"… ("" = none). */
  suffix: string;
  /** Show the hours/month input (hourly/daily meters). */
  timeBased: boolean;
  /** What one unit of the quantity means. */
  explain: string;
}

/** How the generic `quantity` of a meter reads to the user (see GenericConfig.quantity). */
export function quantitySemantics(unitOfMeasure: string, type: string): QuantitySemantics {
  if (type.toLowerCase() === "reservation") {
    return { label: "Reserved units", suffix: "", timeBased: false, explain: "Number of reservations; the term total is spread monthly." };
  }
  const p = parseUnit(unitOfMeasure);
  const measure = p.measure;
  if (p.timeBased) {
    return measure
      ? { label: `${measure} provisioned`, suffix: measure, timeBased: true, explain: `${measure} kept provisioned during the hours below.` }
      : { label: "Instances", suffix: "", timeBased: true, explain: "Instances running during the hours below." };
  }
  if (p.per === "month") {
    if (measure) return { label: `${measure} per month`, suffix: measure, timeBased: false, explain: `${measure} billed per month.` };
    if (p.packSize > 1) return { label: "Transactions per month", suffix: "", timeBased: false, explain: "Individual transactions (not packs) per month." };
    return { label: "Units per month", suffix: "", timeBased: false, explain: "Units billed monthly." };
  }
  if (p.per === "year") {
    return { label: measure ? `${measure} (billed yearly)` : "Units (billed yearly)", suffix: measure, timeBased: false, explain: "Yearly price spread over 12 months." };
  }
  if (measure) return { label: `${measure} per month`, suffix: measure, timeBased: false, explain: `${measure} used per month.` };
  if (p.packSize > 1) return { label: "Transactions per month", suffix: "", timeBased: false, explain: "Individual transactions (not packs) per month." };
  return { label: "Units per month", suffix: "", timeBased: false, explain: "Units used per month." };
}

/** Headline/unit helpers of the meter picker. */
/** "PAYG", "RI 1Y", "SP 3Y" or the raw type. */
export function meterTypeBadge(type: string, term: string): string {
  const c = meterCommitment(type, term);
  if (c) return COMMITMENT_LABELS[c];
  return [type, term].filter(Boolean).join(" ") || "—";
}

/** Headline price of a meter: first paid tier (0 when every tier is free); reservations = term total. */
export function meterHeadlinePrice(o: Pick<MeterOption, "tiers">): number | undefined {
  if (o.tiers.length === 0) return undefined;
  return (o.tiers.find((t) => t.retailPrice > 0) ?? o.tiers[0]).retailPrice;
}

export function meterUnitText(o: Pick<MeterOption, "unitOfMeasure" | "type" | "reservationTerm">): string {
  return o.type.toLowerCase() === "reservation" ? `per ${o.reservationTerm || "term"}` : describeUnit(o.unitOfMeasure);
}

// ---------------------------------------------------------------- disks

/** Max size of the tiered (P/E/S) disks: P80/E80/S80 = 32,767 GiB. */
export const TIERED_DISK_MAX_GIB = 32_767;

/** Premium SSD v2 limits (learn.microsoft.com/azure/virtual-machines/disks-types). */
export const PREMIUM_V2_LIMITS = { minGiB: 1, maxGiB: 65_536, maxIops: 80_000, maxMbps: 2_000, iopsPerGiB: 500, mbpsPerIops: 0.25 };
/** Ultra Disk limits (learn.microsoft.com/azure/virtual-machines/disks-types). */
export const ULTRA_LIMITS = { minGiB: 4, maxGiB: 65_536, minIops: 100, maxIops: 400_000, iopsPerGiB: 1_000, minMbps: 1, maxMbps: 10_000, mbpsPerIops: 0.25 };

export function premiumV2MaxIops(sizeGiB: number): number {
  const L = PREMIUM_V2_LIMITS;
  if (sizeGiB <= 6) return 3000;
  return Math.min(L.maxIops, Math.max(3000, L.iopsPerGiB * Math.ceil(sizeGiB)));
}

/** Max MB/s of a Premium SSD v2 disk: 0.25 MB/s per IOPS (min 125, max 2,000); 125 up to 6 GiB. */
export function premiumV2MaxMbps(iops: number, sizeGiB?: number): number {
  if (sizeGiB !== undefined && sizeGiB <= 6) return 125;
  return Math.min(PREMIUM_V2_LIMITS.maxMbps, Math.max(125, PREMIUM_V2_LIMITS.mbpsPerIops * Math.max(iops, 3000)));
}

export function ultraMaxIops(sizeGiB: number): number {
  return Math.min(ULTRA_LIMITS.maxIops, ULTRA_LIMITS.iopsPerGiB * Math.max(ULTRA_LIMITS.minGiB, Math.ceil(sizeGiB)));
}

export function ultraMaxMbps(iops: number): number {
  return Math.min(ULTRA_LIMITS.maxMbps, Math.max(ULTRA_LIMITS.minMbps, ULTRA_LIMITS.mbpsPerIops * iops));
}

export interface DiskWarning {
  field: "size" | "iops" | "mbps";
  text: string;
}

/** Non-blocking warnings for Premium SSD v2 / Ultra performance settings (empty when within limits). */
export function provisionedDiskWarnings(config: Pick<DisksConfig, "diskType" | "sizeGB" | "iops" | "throughputMBps">): DiskWarning[] {
  const out: DiskWarning[] = [];
  const n = (v: number) => fmtInt(v);
  if (config.diskType === "premium-ssd-v2") {
    const maxIops = premiumV2MaxIops(config.sizeGB);
    if (config.iops < 3000) out.push({ field: "iops", text: "Below the 3,000 IOPS baseline, which every disk gets for free." });
    else if (config.iops > maxIops) {
      out.push({ field: "iops", text: `${n(config.iops)} IOPS exceeds the ${n(maxIops)} IOPS limit for ${n(config.sizeGB)} GiB (500 IOPS per GiB above 6 GiB, max 80,000).` });
    }
    const maxMbps = premiumV2MaxMbps(config.iops, config.sizeGB);
    if (config.throughputMBps < 125) out.push({ field: "mbps", text: "Below the 125 MB/s baseline, which every disk gets for free." });
    else if (config.throughputMBps > maxMbps) {
      out.push({ field: "mbps", text: `${n(config.throughputMBps)} MB/s exceeds the ${n(maxMbps)} MB/s limit for ${n(config.iops)} IOPS (0.25 MB/s per IOPS, max 2,000).` });
    }
  } else if (config.diskType === "ultra") {
    if (config.sizeGB < ULTRA_LIMITS.minGiB) out.push({ field: "size", text: "Ultra Disk sizes start at 4 GiB." });
    const maxIops = ultraMaxIops(config.sizeGB);
    if (config.iops < ULTRA_LIMITS.minIops) out.push({ field: "iops", text: "Ultra Disk needs at least 100 IOPS." });
    else if (config.iops > maxIops) {
      out.push({ field: "iops", text: `${n(config.iops)} IOPS exceeds the ${n(maxIops)} IOPS limit for ${n(config.sizeGB)} GiB (1,000 IOPS per GiB, max 400,000).` });
    }
    const maxMbps = ultraMaxMbps(config.iops);
    if (config.throughputMBps < ULTRA_LIMITS.minMbps) out.push({ field: "mbps", text: "Ultra Disk needs at least 1 MB/s." });
    else if (config.throughputMBps > maxMbps) {
      out.push({ field: "mbps", text: `${n(config.throughputMBps)} MB/s exceeds the ${n(maxMbps)} MB/s limit for ${n(config.iops)} IOPS (0.25 MB/s per IOPS, max 10,000).` });
    }
  }
  return out;
}

/** Base performance per tier (Premium SSD guaranteed; Standard "up to"). Source: disks-types. */
const TIER_PERF: Record<"P" | "E" | "S", Record<number, [number, number]>> = {
  P: { 1: [120, 25], 2: [120, 25], 3: [120, 25], 4: [120, 25], 6: [240, 50], 10: [500, 100], 15: [1100, 125], 20: [2300, 150], 30: [5000, 200], 40: [7500, 250], 50: [7500, 250], 60: [16000, 500], 70: [18000, 750], 80: [20000, 900] },
  E: { 1: [500, 100], 2: [500, 100], 3: [500, 100], 4: [500, 100], 6: [500, 100], 10: [500, 100], 15: [500, 100], 20: [500, 100], 30: [500, 100], 40: [500, 100], 50: [500, 100], 60: [2000, 400], 70: [4000, 600], 80: [6000, 750] },
  S: { 4: [500, 60], 6: [500, 60], 10: [500, 60], 15: [500, 60], 20: [500, 60], 30: [500, 60], 40: [500, 60], 50: [500, 60], 60: [1300, 300], 70: [2000, 500], 80: [2000, 500] },
};

/** "5,000 IOPS · 200 MB/s" (Premium) / "≤ 500 IOPS · ≤ 100 MB/s" (Standard); "" for unknown tiers. */
export function tierPerformance(tier: string): string {
  const m = /^([PES])(\d+)$/i.exec(tier.trim());
  if (!m) return "";
  const prefix = m[1].toUpperCase() as "P" | "E" | "S";
  const perf = TIER_PERF[prefix][Number(m[2])];
  if (!perf) return "";
  const upTo = prefix === "P" ? "" : "≤ ";
  return `${upTo}${fmtInt(perf[0])} IOPS · ${upTo}${fmtInt(perf[1])} MB/s`;
}

/** Capacity in GiB currently configured for a disk item (tier size in tier mode). */
export function configuredDiskSize(config: Pick<DisksConfig, "diskType" | "sizingMode" | "tier" | "sizeGB">, tieredType: boolean): number {
  if (tieredType && config.sizingMode === "tier") return tierSizeGB(config.tier) ?? config.sizeGB;
  return config.sizeGB;
}

/** Tier of `prefix` with the same (or the next larger) size; falls back to the largest tier. */
export function equivalentTier(prefix: string, sizeGiB: number, available?: readonly string[]): string {
  const pool = available && available.length > 0 ? available : standardTiers(prefix);
  return pickTierForSize(prefix, sizeGiB, pool) ?? pool[pool.length - 1] ?? `${prefix}10`;
}

/** Config patch when the disk type changes: keeps the capacity and a valid redundancy. */
export function diskTypeChangePatch(
  config: DisksConfig,
  next: DiskType,
  prefixOf: (t: DiskType) => string | null,
  availableTiers?: readonly string[],
): Partial<DisksConfig> {
  const patch: Partial<DisksConfig> = { diskType: next };
  const curPrefix = prefixOf(config.diskType);
  const nextPrefix = prefixOf(next);
  const size = configuredDiskSize(config, curPrefix !== null);
  if (nextPrefix) {
    patch.tier = equivalentTier(nextPrefix, Math.min(size, TIERED_DISK_MAX_GIB), availableTiers);
    if (!curPrefix || config.sizingMode === "tier") patch.sizeGB = Math.max(1, Math.min(size, TIERED_DISK_MAX_GIB));
  } else {
    patch.sizeGB = Math.max(next === "ultra" ? ULTRA_LIMITS.minGiB : 1, Math.min(size, PREMIUM_V2_LIMITS.maxGiB));
  }
  if ((next === "standard-hdd" || next === "ultra") && config.redundancy === "ZRS") patch.redundancy = "LRS";
  return patch;
}

// ---------------------------------------------------------------- backup

export interface BackupBand {
  /** 0: ≤ 50 GB (half fee), 1: 50–500 GB (one fee), 2: > 500 GB (one fee per started 500 GB). */
  index: 0 | 1 | 2;
  /** Protected-instance fees billed per instance. */
  fees: number;
}

export function backupBand(sizeGB: number): BackupBand {
  const fees = protectedInstanceFees(sizeGB);
  return { index: sizeGB <= 50 ? 0 : sizeGB <= 500 ? 1 : 2, fees };
}

/** Backup storage in GB as priced by pricing/backup.ts. */
export function backupStorageGB(config: Pick<BackupConfig, "instances" | "avgInstanceSizeGB" | "storageMode" | "storagePercent" | "storageGB">): number {
  return config.storageMode === "percent"
    ? (config.instances * config.avgInstanceSizeGB * config.storagePercent) / 100
    : config.storageGB;
}
