// Estimate assumptions for the summary panel and the exports. Kept separate from
// lib/estimateExports.ts so the export builders (xlsx/zip/csv/markdown/json) can be lazy-loaded.
import type { Catalog } from "@/data/catalog";
import { buildAssumptions } from "@/domain/assumptions";
import type { Estimate } from "@/domain/model";
import { currencyRate } from "@/domain/money";
import type { ItemResult } from "@/domain/types";

export type Results = Record<string, ItemResult | undefined>;

/** One estimate with its prices, as needed by the assumptions and the exports. */
export interface ExportContext {
  estimate: Estimate;
  results: Results;
  catalog: Catalog | undefined;
  /** Resolved display currency. */
  currency: string;
}

/** Assumption sentences of an estimate (see domain/assumptions.ts). */
export function estimateAssumptions({ estimate, results, catalog, currency }: ExportContext): string[] {
  return buildAssumptions({
    estimate,
    results,
    pricesDate: catalog?.manifest.pricesDate,
    currency,
    fxAsOf: catalog?.fx.asOf,
    fxRate: currencyRate(catalog?.fx, currency) ?? undefined,
    hasSavingsPlan: catalog?.manifest.hasSavingsPlan ?? false,
    sourceType: catalog?.manifest.source.type,
  });
}
