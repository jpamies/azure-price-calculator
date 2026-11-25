// Effective-date selection. Several rows can describe the same meter/type/term/tier with different
// effectiveStartDate values: the price in force is the latest one <= today (fallback: the latest).
import type { PriceRow } from "./types.ts";

/** Today as YYYY-MM-DD (UTC). */
export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * The row in force on `today`: latest effectiveStartDate <= today; when every row is future-dated,
 * the latest one. Empty dates count as the oldest. Ties keep the first row (input order).
 */
export function pickEffective<T extends { effectiveStartDate: string }>(
  rows: readonly T[],
  today: string = todayIso(),
): T | undefined {
  let current: T | undefined;
  let future: T | undefined;
  for (const row of rows) {
    const d = row.effectiveStartDate || "";
    if (d <= today) {
      if (!current || d > (current.effectiveStartDate || "")) current = row;
    } else if (!future || d > future.effectiveStartDate) {
      future = row;
    }
  }
  return current ?? future;
}

/** Group rows by `key` and keep the effective row of each group (first-seen group order). */
export function effectiveByKey<T extends { effectiveStartDate: string }>(
  rows: readonly T[],
  key: (row: T) => string,
  today: string = todayIso(),
): T[] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const g = groups.get(k);
    if (g) g.push(row);
    else groups.set(k, [row]);
  }
  const out: T[] = [];
  for (const g of groups.values()) {
    const picked = pickEffective(g, today);
    if (picked) out.push(picked);
  }
  return out;
}

/** One effective row per tierMinimumUnits, sorted by tierMinimumUnits ascending. */
export function effectiveTiers(rows: readonly PriceRow[], today: string = todayIso()): PriceRow[] {
  return effectiveByKey(rows, (r) => String(r.tierMinimumUnits), today).sort(
    (a, b) => a.tierMinimumUnits - b.tierMinimumUnits,
  );
}

/** The effective row of the lowest tier (flat-priced meters). */
export function effectiveBaseRow(rows: readonly PriceRow[], today: string = todayIso()): PriceRow | undefined {
  return effectiveTiers(rows, today)[0];
}

/** Case-insensitive comparison of a row's `type` ("Consumption" | "Reservation" | "SavingsPlans"). */
export function isType(row: { type: string }, type: string): boolean {
  return row.type.toLowerCase() === type.toLowerCase();
}

/** Rows of the preferred product only: the shortest productName (ties: alphabetical). */
export function preferShortestProduct<T extends { productName: string }>(rows: readonly T[]): T[] {
  if (rows.length === 0) return [];
  let best = rows[0].productName;
  for (const r of rows) {
    const p = r.productName;
    if (p.length < best.length || (p.length === best.length && p < best)) best = p;
  }
  return rows.filter((r) => r.productName === best);
}

/**
 * Flat-price row from candidates that may span several products/dates/tiers: preferred product
 * (shortest name), then the effective row of its lowest tier.
 */
export function pickPreferredRow(rows: readonly PriceRow[], today: string = todayIso()): PriceRow | undefined {
  return effectiveBaseRow(preferShortestProduct(rows), today);
}

/**
 * Prefer rows whose meterName equals one of `exactNames` (case-insensitive); otherwise all rows.
 */
export function preferExactMeterName<T extends { meterName: string }>(rows: readonly T[], exactNames: readonly string[]): T[] {
  const wanted = exactNames.map((n) => n.toLowerCase());
  const exact = rows.filter((r) => wanted.includes(r.meterName.trim().toLowerCase()));
  return exact.length > 0 ? exact : [...rows];
}
