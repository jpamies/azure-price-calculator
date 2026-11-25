// Meter catalog for the generic module: any row of any shard grouped into selectable meters.
import type { PriceRow } from "./types.ts";
import { effectiveTiers, todayIso } from "./effective.ts";
import { rankBy } from "./search.ts";

export interface MeterTier {
  tierMinimumUnits: number;
  retailPrice: number;
}

export interface MeterOption {
  /** Unique within a shard: meterId|type|reservationTerm|productName|skuName. */
  key: string;
  meterId: string;
  productName: string;
  skuName: string;
  meterName: string;
  armSkuName: string;
  unitOfMeasure: string;
  type: string;
  reservationTerm: string;
  /** Effective price per tier, ascending tierMinimumUnits (one entry for flat meters). */
  tiers: MeterTier[];
  /** Latest effectiveStartDate among the tiers in force. */
  effectiveStartDate: string;
}

export interface MeterSelector {
  meterId: string;
  type?: string;
  reservationTerm?: string;
  /** Optional display copies; used to disambiguate a meterId shared by several products. */
  productName?: string;
  skuName?: string;
}

const lc = (s: string | undefined) => (s ?? "").trim().toLowerCase();

export function meterOptionKey(r: Pick<PriceRow, "meterId" | "type" | "reservationTerm" | "productName" | "skuName">): string {
  return `${r.meterId}|${r.type}|${r.reservationTerm}|${r.productName}|${r.skuName}`;
}

const TYPE_ORDER: Record<string, number> = { consumption: 0, reservation: 1, savingsplans: 2 };
const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

function compareOptions(a: MeterOption, b: MeterOption): number {
  return (
    collator.compare(a.productName, b.productName) ||
    collator.compare(a.skuName, b.skuName) ||
    collator.compare(a.meterName, b.meterName) ||
    (TYPE_ORDER[lc(a.type)] ?? 9) - (TYPE_ORDER[lc(b.type)] ?? 9) ||
    collator.compare(a.reservationTerm, b.reservationTerm)
  );
}

function buildOptions(rows: readonly PriceRow[], today: string): MeterOption[] {
  const groups = new Map<string, PriceRow[]>();
  for (const r of rows) {
    if (!r.meterId) continue;
    const k = meterOptionKey(r);
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }
  const out: MeterOption[] = [];
  for (const [key, group] of groups) {
    const tiers = effectiveTiers(group, today);
    if (tiers.length === 0) continue;
    const rep = tiers[0];
    let effectiveStartDate = "";
    for (const t of tiers) if (t.effectiveStartDate > effectiveStartDate) effectiveStartDate = t.effectiveStartDate;
    out.push({
      key,
      meterId: rep.meterId,
      productName: rep.productName,
      skuName: rep.skuName,
      meterName: rep.meterName,
      armSkuName: rep.armSkuName,
      unitOfMeasure: rep.unitOfMeasure,
      type: rep.type,
      reservationTerm: rep.reservationTerm,
      tiers: tiers.map((t) => ({ tierMinimumUnits: t.tierMinimumUnits, retailPrice: t.retailPrice })),
      effectiveStartDate,
    });
  }
  return out.sort(compareOptions);
}

const memo = new WeakMap<readonly PriceRow[], { today: string; options: MeterOption[] }>();

/** Every meter of a shard (effective prices, tiers grouped). Memoized by the rows array identity. */
export function listMeters(rows: readonly PriceRow[]): MeterOption[] {
  const today = todayIso();
  const hit = memo.get(rows);
  if (hit && hit.today === today) return hit.options;
  const options = buildOptions(rows, today);
  memo.set(rows, { today, options });
  return options;
}

/** Ranked search over product / SKU / meter names, armSkuName and meterId. Empty query → all. */
export function searchMeters(options: readonly MeterOption[], query: string, limit?: number): MeterOption[] {
  return rankBy(
    options,
    query,
    (o) => [
      o.meterName,
      o.skuName,
      o.productName,
      o.armSkuName,
      `${o.productName} ${o.skuName} ${o.meterName}`,
      o.meterId,
    ],
    limit,
  );
}

/**
 * The meter identified by meterId + type + reservationTerm (type defaults to "Consumption",
 * term to ""). When several products share the meterId, productName/skuName break the tie.
 */
export function findMeterOption(rows: readonly PriceRow[], sel: MeterSelector): MeterOption | undefined {
  const id = lc(sel.meterId);
  if (!id) return undefined;
  const type = lc(sel.type || "Consumption");
  const term = lc(sel.reservationTerm);
  const matches = listMeters(rows).filter(
    (o) => lc(o.meterId) === id && lc(o.type) === type && lc(o.reservationTerm) === term,
  );
  if (matches.length <= 1) return matches[0];
  const product = lc(sel.productName);
  const sku = lc(sel.skuName);
  return (
    matches.find((o) => lc(o.productName) === product && lc(o.skuName) === sku) ??
    matches.find((o) => lc(o.productName) === product) ??
    matches[0]
  );
}
