// Auto-generated estimate assumptions: ready-to-paste English sentences.
// Pure TypeScript so it runs under `node --test`.
import { itemDisplayName } from "./factory.ts";
import { HOURS_PER_MONTH } from "./model.ts";
import type { Estimate, Item, ItemOf } from "./model.ts";
import { FX_DISCLAIMER, normalizeCurrency } from "./money.ts";
import type { ItemResult } from "./types.ts";

export interface AssumptionsInput {
  estimate: Estimate;
  results: Record<string, ItemResult | undefined>;
  /** Snapshot date (manifest.pricesDate). */
  pricesDate?: string;
  /** Display currency actually used (resolved). */
  currency: string;
  /** fx.json asOf. */
  fxAsOf?: string;
  /** Optional: units of `currency` per USD, quoted in the FX sentence. */
  fxRate?: number;
  hasSavingsPlan: boolean;
  /** manifest.source.type; "fixture" adds a sample-data warning. */
  sourceType?: "exporter" | "fixture" | string;
}

export const ALWAYS_ASSUMPTIONS = [
  "List prices; no negotiated (EA/MCA/CSP) discounts.",
  "Marketplace and third-party software not included.",
  "Taxes not included.",
] as const;

const MAX_NAMES = 5;

function quoted(item: Item): string {
  return `"${itemDisplayName(item)}"`;
}

/** `"A", "B" and "C"`; long lists end with "and N more". */
function nameList(items: Item[]): string {
  const names = items.slice(0, MAX_NAMES).map(quoted);
  const extra = items.length - names.length;
  if (extra > 0) return `${names.join(", ")} and ${extra} more`;
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function ofModule<M extends Item["moduleId"]>(items: Item[], moduleId: M): ItemOf<M>[] {
  return items.filter((i): i is ItemOf<M> => i.moduleId === moduleId);
}

function hoursOf(item: Item): number | undefined {
  switch (item.moduleId) {
    case "vm":
    case "sqlLicense":
      return item.config.hoursPerMonth;
    case "generic":
      return /hour/i.test(item.config.unitOfMeasure) ? item.config.hoursPerMonth : undefined;
    default:
      return undefined;
  }
}

function gb(n: number): string {
  return `${Number.isInteger(n) ? n : Number(n.toFixed(2))} GB`;
}

function normalizeSentence(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Builds the estimate assumptions. Order: sample-data warning, snapshot/source, currency, hours,
 * module-specific sentences (only for modules present), deduplicated item assumptions
 * (ItemResult.assumptions), then the fixed disclaimers. Exact duplicates are removed.
 */
export function buildAssumptions(input: AssumptionsInput): string[] {
  const { estimate, results, pricesDate, fxAsOf, fxRate, hasSavingsPlan, sourceType } = input;
  const currency = normalizeCurrency(input.currency) || "USD";
  const items = estimate.items;
  const out: string[] = [];

  if (sourceType === "fixture") {
    out.push("Sample data: these prices come from a synthetic test fixture, not from Azure. Do not use this estimate for decisions.");
  }
  out.push(
    pricesDate
      ? `Prices are Microsoft list prices in USD from the Azure Retail Prices API snapshot of ${pricesDate}.`
      : "Prices are Microsoft list prices in USD from the latest Azure Retail Prices API snapshot.",
  );
  if (currency !== "USD") {
    const rate = fxRate && Number.isFinite(fxRate) && fxRate > 0 ? ` (1 USD = ${Number(fxRate.toPrecision(6))} ${currency})` : "";
    const asOf = fxAsOf ? ` of ${fxAsOf}` : "";
    out.push(`Amounts in ${currency} are converted from USD with the FX snapshot${asOf}${rate}. ${FX_DISCLAIMER}`);
  }

  if (items.length > 0) {
    out.push("Annual cost = monthly cost × 12 plus one-time upfront payments.");
    const deviating = items.filter((i) => {
      const h = hoursOf(i);
      return h !== undefined && h !== HOURS_PER_MONTH;
    });
    const deviations = deviating
      .slice(0, MAX_NAMES)
      .map((i) => `${quoted(i)} (${hoursOf(i)} h)`)
      .join(", ");
    const more = deviating.length > MAX_NAMES ? ` and ${deviating.length - MAX_NAMES} more` : "";
    out.push(
      deviating.length > 0
        ? `Hourly resources assume ${HOURS_PER_MONTH} hours per month, except ${deviations}${more}.`
        : `Hourly resources assume ${HOURS_PER_MONTH} hours per month.`,
    );
  }

  const vms = ofModule(items, "vm");
  const reserved = vms.filter((v) => v.config.commitment === "ri1y" || v.config.commitment === "ri3y");
  if (reserved.length > 0) {
    out.push(
      "Reserved instances are priced from the reservation's total term price (1 or 3 years); the monthly equivalent is that total ÷ 12 or ÷ 36 months.",
    );
    const upfront = reserved.filter((v) => v.config.riPayment === "upfront");
    if (upfront.length > 0) {
      out.push(
        `Reservations paid upfront (${nameList(upfront)}) appear as a one-time upfront charge and add nothing to the monthly total; the amortized view spreads the upfront over the term.`,
      );
    }
  }
  const savingsPlan = vms.filter((v) => v.config.commitment === "sp1y" || v.config.commitment === "sp3y");
  if (savingsPlan.length > 0) {
    out.push(
      hasSavingsPlan
        ? "Savings plan prices use the hourly savings plan rate of the chosen term (1 or 3 years) for every hour, billed monthly."
        : `Savings plan rates are not available in this price snapshot; ${nameList(savingsPlan)} cannot be priced with a savings plan.`,
    );
  }
  if (vms.some((v) => v.config.os === "windows")) {
    out.push("Windows VM prices include the Windows Server license at pay-as-you-go rates.");
  }
  if (vms.some((v) => v.config.os === "windows" && v.config.commitment !== "payg")) {
    out.push("Reservations and savings plans cover compute only; Windows Server licenses are billed separately at pay-as-you-go rates.");
  }
  if (vms.some((v) => v.config.os === "windows-ahb")) {
    out.push(
      "Windows VMs with Azure Hybrid Benefit are priced at the Linux rate; the Windows Server license is assumed to be covered by existing licenses with Software Assurance.",
    );
  }

  const sql = ofModule(items, "sqlLicense");
  if (sql.some((s) => !s.config.ahb)) {
    out.push("SQL Server licenses are billed per vCPU-hour at pay-as-you-go rates, with a minimum of 4 vCPUs per VM.");
  }
  if (sql.some((s) => s.config.ahb)) {
    out.push("SQL Server licenses with Azure Hybrid Benefit are priced at zero (covered by existing licenses with Software Assurance).");
  }

  if (vms.length > 0) {
    const spot = vms.filter((v) => v.config.spot && v.config.commitment === "payg");
    out.push(
      spot.length > 0
        ? `Spot pricing is used only where selected (${nameList(spot)}); Spot VMs can be evicted at any time and Spot prices change frequently.`
        : "Spot and Low Priority prices are excluded; regular VM prices are used.",
    );
  }

  const disks = ofModule(items, "disks");
  if (disks.some((d) => d.config.diskType !== "premium-ssd-v2" && d.config.diskType !== "ultra")) {
    out.push("Managed disks are billed per provisioned size tier; sizes are rounded up to the next tier (for example, 200 GiB is billed as a 256 GiB tier).");
  }
  if (disks.some((d) => d.config.diskType === "premium-ssd-v2" || d.config.diskType === "ultra")) {
    out.push("Premium SSD v2 and Ultra Disk prices are based on provisioned capacity, IOPS and throughput, billed hourly.");
  }
  if (disks.length > 0) {
    out.push("Disk transactions, snapshots and on-demand bursting are not included.");
  }

  const backups = ofModule(items, "backup");
  for (const b of backups) {
    const c = b.config;
    const protectedGb = c.instances * c.avgInstanceSizeGB;
    const who = backups.length > 1 ? `Backup ${quoted(b)}: backup` : "Backup";
    out.push(
      c.storageMode === "percent"
        ? `${who} storage is assumed to be ${c.storagePercent}% of the protected data (${c.instances} × ${gb(c.avgInstanceSizeGB)} = ${gb(protectedGb)}), ${c.redundancy}.`
        : `${who} storage is assumed to be ${gb(c.storageGB)} in total, ${c.redundancy}.`,
    );
  }
  if (backups.length > 0) {
    out.push("Actual backup storage depends on retention, daily change rate and compression; the protected-instance fee depends on the average instance size.");
  }

  if (items.some((i) => i.moduleId === "asr")) {
    out.push("Azure Site Recovery covers the per-instance replication fee only; target compute, replicated disks/storage and network are not included.");
  }

  for (const item of items) {
    for (const a of results[item.id]?.assumptions ?? []) out.push(a);
  }
  out.push(...ALWAYS_ASSUMPTIONS);

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const sentence of out) {
    const s = normalizeSentence(sentence);
    if (s === "" || seen.has(s)) continue;
    seen.add(s);
    unique.push(s);
  }
  return unique;
}
