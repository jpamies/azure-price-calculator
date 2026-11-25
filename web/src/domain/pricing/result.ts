// Shared builders for Line / ItemResult used by every pricing module.
import type { CommitmentId } from "../model.ts";
import { refKey } from "../types.ts";
import type { ItemMessage, ItemResult, Line, LineKind, PriceRow, PricingContext, ShardRef } from "../types.ts";

export interface LineInput {
  id: string;
  label: string;
  unit: string;
  quantity: number;
  unitPriceUsd: number;
  kind: LineKind;
  meterId?: string;
  detail?: string;
  /** Default: quantity × unitPriceUsd. */
  monthlyUsd?: number;
  /** Default: 0. */
  upfrontUsd?: number;
  /** Default: monthlyUsd + upfrontUsd / termMonths (monthlyUsd when there is no upfront). */
  amortizedMonthlyUsd?: number;
  commitment?: CommitmentId;
  termMonths?: number;
  notes?: string[];
  effectiveStartDate?: string;
}

export function makeLine(input: LineInput): Line {
  const monthlyUsd = input.monthlyUsd ?? input.quantity * input.unitPriceUsd;
  const upfrontUsd = input.upfrontUsd ?? 0;
  const amortizedMonthlyUsd =
    input.amortizedMonthlyUsd ??
    (upfrontUsd > 0 && input.termMonths ? monthlyUsd + upfrontUsd / input.termMonths : monthlyUsd);
  const line: Line = {
    id: input.id,
    label: input.label,
    unit: input.unit,
    quantity: input.quantity,
    unitPriceUsd: input.unitPriceUsd,
    monthlyUsd,
    upfrontUsd,
    amortizedMonthlyUsd,
    kind: input.kind,
    notes: input.notes ?? [],
  };
  if (input.meterId) line.meterId = input.meterId;
  if (input.detail) line.detail = input.detail;
  if (input.commitment) line.commitment = input.commitment;
  if (input.termMonths) line.termMonths = input.termMonths;
  if (input.effectiveStartDate) line.effectiveStartDate = input.effectiveStartDate;
  return line;
}

function uniq(texts: readonly string[]): string[] {
  return [...new Set(texts.filter((t) => t.trim() !== ""))];
}

/** status "ok" with totals summed from the lines. */
export function finalize(lines: Line[], messages: ItemMessage[] = [], assumptions: string[] = []): ItemResult {
  let monthlyUsd = 0;
  let upfrontUsd = 0;
  let amortizedMonthlyUsd = 0;
  for (const l of lines) {
    monthlyUsd += l.monthlyUsd;
    upfrontUsd += l.upfrontUsd;
    amortizedMonthlyUsd += l.amortizedMonthlyUsd;
  }
  return { status: "ok", lines, messages, monthlyUsd, upfrontUsd, amortizedMonthlyUsd, assumptions: uniq(assumptions) };
}

/** Config not finished (e.g. no SKU / meter / region chosen). */
export function incomplete(text: string, messages: ItemMessage[] = []): ItemResult {
  return {
    status: "incomplete",
    lines: [],
    messages: [...messages, { level: "info", text }],
    monthlyUsd: 0,
    upfrontUsd: 0,
    amortizedMonthlyUsd: 0,
    assumptions: [],
  };
}

/** No matching price: no lines, zero totals and error message(s) — never a silent 0. */
export function unavailable(text: string | string[], messages: ItemMessage[] = []): ItemResult {
  const errors = (Array.isArray(text) ? text : [text]).map((t): ItemMessage => ({ level: "error", text: t }));
  return {
    status: "unavailable",
    lines: [],
    messages: [...messages, ...errors],
    monthlyUsd: 0,
    upfrontUsd: 0,
    amortizedMonthlyUsd: 0,
    assumptions: [],
  };
}

export function rowsFor(ctx: PricingContext, ref: ShardRef): PriceRow[] {
  return ctx.shards[refKey(ref)] ?? [];
}

/** "West Europe" (falls back to the region key). */
export function regionLabel(ctx: PricingContext): string {
  return ctx.regionName || ctx.region;
}

/** 1234.5 → "1,234.5" (en-US, up to `digits` decimals). */
export function fmtNum(n: number, digits = 2): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

/** Noun agreeing with a count: nounFor(1, "disk") → "disk", nounFor(2, "disk") → "disks". */
export function nounFor(n: number, singular: string, pluralForm = `${singular}s`): string {
  return n === 1 ? singular : pluralForm;
}

/** "1 instance" / "3 instances". */
export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${fmtNum(n)} ${nounFor(n, singular, pluralForm)}`;
}
