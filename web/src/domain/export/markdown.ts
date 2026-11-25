// Markdown summary (for the clipboard): per-item table, totals and assumptions. Pure TypeScript.
import type { Estimate } from "../model.ts";
import { formatMoney } from "../money.ts";
import { convertedTotals, stripControlChars, summaryRows } from "./common.ts";
import type { ExportOptions, Results } from "./common.ts";

/** Table-cell safe text: single line, pipes and backslashes escaped. */
export function mdCell(text: string): string {
  return stripControlChars(text ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .trim();
}

/**
 * Markdown with a heading, a `Service | Region | Configuration | Monthly | Upfront` table (one row
 * per item, bold total row), a totals line and the assumptions as a bullet list.
 */
export function estimateToMarkdown(estimate: Estimate, results: Results, opts: ExportOptions): string {
  const totals = convertedTotals(estimate, results, opts);
  const currency = totals.currency;
  const fmt = (v: number | null) => (v === null ? "—" : formatMoney(v, currency));
  const out: string[] = [];

  out.push(`## ${mdCell(estimate.name) || "Estimate"}`, "");
  const meta = [
    opts.pricesDate ? `Prices as of ${opts.pricesDate} (Azure Retail Prices API, list prices)` : "Azure Retail Prices API list prices",
    `Currency: ${currency}${currency === "USD" ? "" : " (indicative, converted from USD)"}`,
  ];
  out.push(meta.join(" · "), "");

  out.push("| Service | Region | Configuration | Monthly | Upfront |", "|---|---|---|---:|---:|");
  for (const row of summaryRows(estimate, results, opts)) {
    const priced = row.status === "OK";
    const monthly = row.monthly === null ? "Pending" : priced || row.monthly !== 0 ? fmt(row.monthly) : mdCell(row.status) || "—";
    out.push(
      `| ${mdCell(row.service)} | ${mdCell(row.region) || "—"} | ${mdCell(row.configuration)} | ${monthly} | ${row.upfront ? fmt(row.upfront) : "—"} |`,
    );
  }
  out.push(`| **Total** | | | **${fmt(totals.monthly)}** | **${fmt(totals.upfront)}** |`, "");

  const summary = [`**Monthly:** ${fmt(totals.monthly)}`];
  if (totals.upfront > 0) {
    summary.push(`**Upfront:** ${fmt(totals.upfront)}`, `**Amortized monthly:** ${fmt(totals.amortizedMonthly)}`);
  }
  summary.push(`**Annual (monthly × 12 + upfront):** ${fmt(totals.annual)}`);
  out.push(summary.join(" · "));

  const pending = totals.usd.pendingItems.length + totals.usd.incompleteItems.length + totals.usd.unavailableItems.length;
  if (pending > 0) out.push("", `_${pending} item${pending === 1 ? " is" : "s are"} not fully priced (pending, incomplete or unavailable)._`);

  if (opts.assumptions && opts.assumptions.length > 0) {
    out.push("", "### Assumptions", "");
    for (const a of opts.assumptions) out.push(`- ${mdCell(a)}`);
  }
  return `${out.join("\n")}\n`;
}
