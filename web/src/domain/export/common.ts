// Shared row building for the CSV / Markdown / XLSX exports. Pure TypeScript (no DOM).
import { DEFAULT_ITEM_NAMES, itemDisplayName } from "../factory.ts";
import type { Estimate, Item } from "../model.ts";
import { convertUsd, resolveCurrency } from "../money.ts";
import { COMMITMENT_LABELS, estimateTotals, lineCommitment } from "../totals.ts";
import type { EstimateTotals } from "../totals.ts";
import type { FxTable, ItemResult } from "../types.ts";

/** Options shared by estimateToCsv / estimateToMarkdown / estimateToXlsx. */
export interface ExportOptions {
  /** Display currency; unknown currencies fall back to USD. */
  currency: string;
  fx: Pick<FxTable, "rates"> | null | undefined;
  /** Service title of an item, e.g. "Virtual Machines" (module title, or serviceName for generic items). */
  titleOf: (item: Item) => string;
  /** Region display name (default: the armRegionName). */
  regionName?: (key: string) => string;
  /** One-line configuration summary (PricingModule.summarize). */
  summarize?: (item: Item) => string;
  /** Snapshot date shown in headers. */
  pricesDate?: string;
  /** Sentences from buildAssumptions(). */
  assumptions?: string[];
}

export type Results = Record<string, ItemResult | undefined>;

/** One export row per Line (or one per item without lines). Money already converted to the currency. */
export interface DetailRow {
  itemId: string;
  item: string;
  service: string;
  region: string;
  line: string;
  detail: string;
  commitment: string;
  quantity: number | null;
  unit: string;
  unitPrice: number | null;
  monthly: number | null;
  upfront: number | null;
  amortizedMonthly: number | null;
  notes: string;
}

export interface SummaryRow {
  itemId: string;
  item: string;
  service: string;
  region: string;
  configuration: string;
  status: string;
  monthly: number | null;
  upfront: number | null;
  amortizedMonthly: number | null;
}

export function detailHeaders(currency: string): string[] {
  return [
    "Item",
    "Service",
    "Region",
    "Line",
    "Detail",
    "Commitment",
    "Quantity",
    "Unit",
    `Unit price (${currency})`,
    `Monthly (${currency})`,
    `Upfront (${currency})`,
    `Amortized monthly (${currency})`,
    "Notes",
  ];
}

export function exportCurrency(opts: Pick<ExportOptions, "currency" | "fx">): string {
  return resolveCurrency(opts.currency, opts.fx);
}

function money(usd: number, currency: string, opts: Pick<ExportOptions, "fx">): number {
  const v = convertUsd(Number.isFinite(usd) ? usd : 0, currency, opts.fx);
  return Number.isFinite(v) ? v : 0;
}

export function regionLabel(item: Item, opts: Pick<ExportOptions, "regionName">): string {
  if (!item.region) return "";
  return opts.regionName?.(item.region) || item.region;
}

/** Text for an item that has no priced lines. */
export function statusText(result: ItemResult | undefined): string {
  if (!result) return "Not priced yet (prices loading)";
  const messages = result.messages.map((m) => m.text.trim()).filter(Boolean);
  const head =
    result.status === "incomplete" ? "Incomplete configuration" : result.status === "unavailable" ? "Not available" : "";
  return [head, ...messages].filter(Boolean).join("; ");
}

/** "Web tier — 2 × D8as v5 · Windows" (custom name + summary), or whichever exists. */
export function configurationText(item: Item, opts: Pick<ExportOptions, "summarize">): string {
  const summary = opts.summarize?.(item)?.trim() ?? "";
  const name = item.name.trim();
  const custom = name !== "" && name !== DEFAULT_ITEM_NAMES[item.moduleId] && name !== summary ? name : "";
  return [custom, summary].filter(Boolean).join(" — ") || itemDisplayName(item);
}

export function detailRows(estimate: Estimate, results: Results, opts: ExportOptions): DetailRow[] {
  const currency = exportCurrency(opts);
  const rows: DetailRow[] = [];
  for (const item of estimate.items) {
    const result = results[item.id];
    const base = { itemId: item.id, item: itemDisplayName(item), service: opts.titleOf(item), region: regionLabel(item, opts) };
    if (!result || result.lines.length === 0) {
      rows.push({
        ...base,
        line: "",
        detail: "",
        commitment: "",
        quantity: null,
        unit: "",
        unitPrice: null,
        monthly: result ? money(result.monthlyUsd, currency, opts) : null,
        upfront: result ? money(result.upfrontUsd, currency, opts) : null,
        amortizedMonthly: result ? money(result.amortizedMonthlyUsd, currency, opts) : null,
        notes: statusText(result),
      });
      continue;
    }
    for (const line of result.lines) {
      rows.push({
        ...base,
        line: line.label,
        detail: line.detail ?? "",
        commitment: COMMITMENT_LABELS[lineCommitment(line, item)],
        quantity: Number.isFinite(line.quantity) ? line.quantity : null,
        unit: line.unit,
        unitPrice: money(line.unitPriceUsd, currency, opts),
        monthly: money(line.monthlyUsd, currency, opts),
        upfront: money(line.upfrontUsd, currency, opts),
        amortizedMonthly: money(line.amortizedMonthlyUsd, currency, opts),
        notes: (line.notes ?? []).join("; "),
      });
    }
  }
  return rows;
}

export function summaryRows(estimate: Estimate, results: Results, opts: ExportOptions): SummaryRow[] {
  const currency = exportCurrency(opts);
  return estimate.items.map((item) => {
    const result = results[item.id];
    return {
      itemId: item.id,
      item: itemDisplayName(item),
      service: opts.titleOf(item),
      region: regionLabel(item, opts),
      configuration: configurationText(item, opts),
      status: result?.status === "ok" ? "OK" : statusText(result),
      monthly: result ? money(result.monthlyUsd, currency, opts) : null,
      upfront: result ? money(result.upfrontUsd, currency, opts) : null,
      amortizedMonthly: result ? money(result.amortizedMonthlyUsd, currency, opts) : null,
    };
  });
}

export interface ConvertedTotals {
  currency: string;
  usd: EstimateTotals;
  monthly: number;
  upfront: number;
  amortizedMonthly: number;
  annual: number;
}

export function convertedTotals(estimate: Estimate, results: Results, opts: ExportOptions): ConvertedTotals {
  const currency = exportCurrency(opts);
  const usd = estimateTotals(estimate, results, opts.titleOf);
  return {
    currency,
    usd,
    monthly: money(usd.monthlyUsd, currency, opts),
    upfront: money(usd.upfrontUsd, currency, opts),
    amortizedMonthly: money(usd.amortizedMonthlyUsd, currency, opts),
    annual: money(usd.annualUsd, currency, opts),
  };
}

/** Removes characters that are invalid in XML 1.0 / spreadsheets (C0 controls except tab/LF/CR, lone surrogates). */
export function stripControlChars(text: string): string {
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
}
