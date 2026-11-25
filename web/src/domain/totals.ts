// Estimate totals and breakdowns (USD). Pure TypeScript so it runs under `node --test`.
import type { Estimate, Item } from "./model.ts";
import type { CommitmentId, ItemResult, Line, LineKind } from "./types.ts";

/** Commitment bucket of a line: a CommitmentId, or "spot". */
export type CommitmentKey = CommitmentId | "spot";

export const CATEGORY_LABELS: Record<LineKind, string> = {
  compute: "Compute",
  license: "Licenses",
  storage: "Storage",
  backup: "Backup",
  dr: "Disaster recovery",
  network: "Networking",
  other: "Other",
};

export const COMMITMENT_LABELS: Record<CommitmentKey, string> = {
  payg: "PAYG",
  ri1y: "Reserved 1Y",
  ri3y: "Reserved 3Y",
  sp1y: "Savings plan 1Y",
  sp3y: "Savings plan 3Y",
  spot: "Spot",
};

export interface BreakdownEntry {
  key: string;
  label: string;
  monthlyUsd: number;
  upfrontUsd: number;
  amortizedMonthlyUsd: number;
}

export interface ItemRef {
  id: string;
  /** item.name, or titleOf(item) when the item has no name. */
  title: string;
}

export interface EstimateTotals {
  monthlyUsd: number;
  upfrontUsd: number;
  amortizedMonthlyUsd: number;
  /** monthly × 12 + upfront. */
  annualUsd: number;
  /** Items without a result yet (prices loading). */
  pendingItems: ItemRef[];
  /** status "incomplete" (configuration not finished). */
  incompleteItems: ItemRef[];
  /** status "unavailable" (no matching price). */
  unavailableItems: ItemRef[];
  byService: BreakdownEntry[];
  byCategory: BreakdownEntry[];
  byCommitment: BreakdownEntry[];
}

const SPOT_NAME = /\b(spot|low priority)\b/i;

/**
 * Spot detection (Line has no "spot" commitment): a PAYG/uncommitted line is Spot when
 * (a) one of its notes starts with "Spot", or (b) it is a compute/license line of a VM item with
 * config.spot and commitment "payg", or (c) it belongs to a generic item whose meter/SKU name
 * contains "Spot" or "Low Priority".
 */
export function isSpotLine(line: Line, item?: Item): boolean {
  if (line.commitment && line.commitment !== "payg") return false;
  if (line.notes?.some((n) => /^\s*spot\b/i.test(n))) return true;
  if (!item) return false;
  if (item.moduleId === "vm") {
    return item.config.spot && item.config.commitment === "payg" && (line.kind === "compute" || line.kind === "license");
  }
  if (item.moduleId === "generic") return SPOT_NAME.test(`${item.config.meterName} ${item.config.skuName}`);
  return false;
}

/** Commitment bucket of a line; lines without commitment count as PAYG (or Spot, see isSpotLine). */
export function lineCommitment(line: Line, item?: Item): CommitmentKey {
  if (line.commitment && line.commitment !== "payg" && line.commitment in COMMITMENT_LABELS) return line.commitment;
  return isSpotLine(line, item) ? "spot" : "payg";
}

export function categoryKey(kind: string): LineKind {
  return kind in CATEGORY_LABELS ? (kind as LineKind) : "other";
}

function finite(n: number | undefined): number {
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

class Breakdown {
  private readonly map = new Map<string, BreakdownEntry>();

  add(key: string, label: string, monthly: number, upfront: number, amortized: number): void {
    let e = this.map.get(key);
    if (!e) {
      e = { key, label, monthlyUsd: 0, upfrontUsd: 0, amortizedMonthlyUsd: 0 };
      this.map.set(key, e);
    }
    e.monthlyUsd += monthly;
    e.upfrontUsd += upfront;
    e.amortizedMonthlyUsd += amortized;
  }

  /** Sorted by amortized monthly desc, then monthly desc, upfront desc, label asc. */
  sorted(): BreakdownEntry[] {
    return [...this.map.values()].sort(
      (a, b) =>
        b.amortizedMonthlyUsd - a.amortizedMonthlyUsd ||
        b.monthlyUsd - a.monthlyUsd ||
        b.upfrontUsd - a.upfrontUsd ||
        a.label.localeCompare(b.label),
    );
  }
}

/**
 * Totals of an estimate from the per-item results (USD). `titleOf(item)` is the service title used
 * for byService (e.g. "Virtual Machines"; for generic items the chosen serviceName).
 * Totals and byService use the item-level amounts; byCategory/byCommitment use the lines.
 * Entries exist for every group with at least one priced item/line (zero groups sort last).
 */
export function estimateTotals(
  estimate: Estimate,
  results: Record<string, ItemResult | undefined>,
  titleOf: (item: Item) => string,
): EstimateTotals {
  let monthly = 0;
  let upfront = 0;
  let amortized = 0;
  const pendingItems: ItemRef[] = [];
  const incompleteItems: ItemRef[] = [];
  const unavailableItems: ItemRef[] = [];
  const byService = new Breakdown();
  const byCategory = new Breakdown();
  const byCommitment = new Breakdown();

  for (const item of estimate.items) {
    const service = titleOf(item);
    const ref: ItemRef = { id: item.id, title: item.name.trim() || service };
    const result = results[item.id];
    if (!result) {
      pendingItems.push(ref);
      continue;
    }
    if (result.status === "incomplete") incompleteItems.push(ref);
    else if (result.status === "unavailable") unavailableItems.push(ref);
    const m = finite(result.monthlyUsd);
    const u = finite(result.upfrontUsd);
    const a = finite(result.amortizedMonthlyUsd);
    monthly += m;
    upfront += u;
    amortized += a;
    if (result.status === "ok" || result.lines.length > 0) byService.add(service, service, m, u, a);
    for (const line of result.lines) {
      const lm = finite(line.monthlyUsd);
      const lu = finite(line.upfrontUsd);
      const la = finite(line.amortizedMonthlyUsd);
      const kind = categoryKey(line.kind);
      byCategory.add(kind, CATEGORY_LABELS[kind], lm, lu, la);
      const commitment = lineCommitment(line, item);
      byCommitment.add(commitment, COMMITMENT_LABELS[commitment], lm, lu, la);
    }
  }

  return {
    monthlyUsd: monthly,
    upfrontUsd: upfront,
    amortizedMonthlyUsd: amortized,
    annualUsd: monthly * 12 + upfront,
    pendingItems,
    incompleteItems,
    unavailableItems,
    byService: byService.sorted(),
    byCategory: byCategory.sorted(),
    byCommitment: byCommitment.sorted(),
  };
}
