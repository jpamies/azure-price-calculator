// Export actions of the estimate editor (downloads / clipboard) built on domain/export/*.
// Loaded on demand (dynamic import from the Export menu / Share dialog): keep it out of static imports.
import { regionName } from "@/data/catalog";
import type { ExportOptions } from "@/domain/export/common";
import { estimateToCsv } from "@/domain/export/csv";
import { MIME, copyText, downloadBlob, safeFileName } from "@/domain/export/download";
import { exportEstimateJson } from "@/domain/export/json";
import { estimateToMarkdown } from "@/domain/export/markdown";
import { XLSX_MIME, estimateToXlsx } from "@/domain/export/xlsx";
import type { Estimate } from "@/domain/model";
import { summarizeItem } from "@/domain/pricing";
import { estimateAssumptions } from "@/lib/assumptions";
import type { ExportContext } from "@/lib/assumptions";
import { serviceTitleOf } from "@/lib/serviceTitle";

export type { ExportContext, Results } from "@/lib/assumptions";

export function exportOptions(ctx: ExportContext): ExportOptions {
  const { catalog, currency } = ctx;
  return {
    currency,
    fx: catalog?.fx,
    titleOf: serviceTitleOf,
    regionName: (key) => regionName(catalog, key),
    summarize: summarizeItem,
    pricesDate: catalog?.manifest.pricesDate,
    assumptions: estimateAssumptions(ctx),
  };
}

function baseName(estimate: Estimate): string {
  return safeFileName(estimate.name, "estimate");
}

/** Full model (+ priced lines for reference) as `<name>.json`. */
export function downloadEstimateJson(ctx: ExportContext): string {
  const filename = `${baseName(ctx.estimate)}.json`;
  const text = exportEstimateJson(ctx.estimate, {
    pricesDate: ctx.catalog?.manifest.pricesDate,
    results: ctx.results,
    titleOf: serviceTitleOf,
  });
  downloadBlob(text, filename, MIME.json);
  return filename;
}

/** One row per priced line, UTF-8 with BOM (Excel friendly). */
export function downloadEstimateCsv(ctx: ExportContext): string {
  const filename = `${baseName(ctx.estimate)}.csv`;
  downloadBlob(estimateToCsv(ctx.estimate, ctx.results, { ...exportOptions(ctx), bom: true }), filename, MIME.csv);
  return filename;
}

/** Workbook with Summary / Detail / Assumptions sheets. */
export async function downloadEstimateXlsx(ctx: ExportContext): Promise<string> {
  const filename = `${baseName(ctx.estimate)}.xlsx`;
  const bytes = await estimateToXlsx(ctx.estimate, ctx.results, exportOptions(ctx));
  downloadBlob(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: XLSX_MIME }), filename, XLSX_MIME);
  return filename;
}

/** Markdown table to the clipboard; resolves false when the clipboard is unavailable. */
export function copyEstimateMarkdown(ctx: ExportContext): Promise<boolean> {
  return copyText(estimateToMarkdown(ctx.estimate, ctx.results, exportOptions(ctx)));
}
