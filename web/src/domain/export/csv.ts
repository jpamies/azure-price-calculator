// RFC 4180 CSV export (one row per priced line + TOTAL row). Pure TypeScript (no DOM).
import type { Estimate } from "../model.ts";
import { convertedTotals, detailHeaders, detailRows, stripControlChars } from "./common.ts";
import type { ExportOptions, Results } from "./common.ts";

export interface CsvOptions extends ExportOptions {
  /** Prepend a UTF-8 BOM so Excel detects the encoding (use it for downloads). Default false. */
  bom?: boolean;
}

/** Quotes a field when it contains a comma, quote, CR or LF (quotes doubled). */
export function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** User text: control chars removed; a leading = + - @ (formula injection) is neutralized with "'". */
export function csvText(value: string): string {
  const clean = stripControlChars(value ?? "");
  return csvField(/^[=+\-@\t\r]/.test(clean) ? `'${clean}` : clean);
}

/** Plain number with "." decimals and no grouping; `fixed` keeps trailing zeros. null → "". */
export function csvNumber(value: number | null | undefined, decimals: number, fixed = false): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  const s = (value === 0 ? 0 : value).toFixed(decimals);
  const out = fixed ? s : s.includes(".") ? s.replace(/\.?0+$/, "") : s;
  return out === "-0" || /^-0\.0*$/.test(out) ? out.slice(1) : out;
}

/**
 * CSV with header row: Item, Service, Region, Line, Detail, Commitment, Quantity, Unit,
 * Unit price (CUR), Monthly (CUR), Upfront (CUR), Amortized monthly (CUR), Notes — one row per
 * line (items without lines get one row with their status in Notes) and a final TOTAL row.
 * CRLF line endings; amounts with 2 decimals, unit prices up to 6, quantities up to 4.
 */
export function estimateToCsv(estimate: Estimate, results: Results, opts: CsvOptions): string {
  const totals = convertedTotals(estimate, results, opts);
  const currency = totals.currency;
  const lines: string[] = [detailHeaders(currency).map(csvField).join(",")];
  for (const r of detailRows(estimate, results, opts)) {
    lines.push(
      [
        csvText(r.item),
        csvText(r.service),
        csvText(r.region),
        csvText(r.line),
        csvText(r.detail),
        csvText(r.commitment),
        csvNumber(r.quantity, 4),
        csvText(r.unit),
        csvNumber(r.unitPrice, 6),
        csvNumber(r.monthly, 2, true),
        csvNumber(r.upfront, 2, true),
        csvNumber(r.amortizedMonthly, 2, true),
        csvText(r.notes),
      ].join(","),
    );
  }
  lines.push(
    [
      "TOTAL",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      csvNumber(totals.monthly, 2, true),
      csvNumber(totals.upfront, 2, true),
      csvNumber(totals.amortizedMonthly, 2, true),
      csvText(`Annual (monthly × 12 + upfront): ${csvNumber(totals.annual, 2, true)} ${currency}`),
    ].join(","),
  );
  return `${opts.bom ? "\uFEFF" : ""}${lines.join("\r\n")}\r\n`;
}
