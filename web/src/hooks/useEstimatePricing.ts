import { useEffect, useMemo } from "react";
import { regionName } from "@/data/catalog";
import { useCatalog, useEstimateResults } from "@/data/hooks";
import type { CatalogState, EstimateResults } from "@/data/hooks";
import { nowIso } from "@/domain/factory";
import type { Estimate } from "@/domain/model";
import { resolveCurrency } from "@/domain/money";
import { computeItem, shardsForItem } from "@/domain/pricing";
import { estimateTotals } from "@/domain/totals";
import type { EstimateTotals } from "@/domain/totals";
import { moneyFormatter } from "@/lib/format";
import type { MoneyFormatter } from "@/lib/format";
import { serviceTitleOf } from "@/lib/serviceTitle";
import { useStore } from "@/store/useStore";

export interface EstimatePricing extends EstimateResults {
  catalogState: CatalogState;
  /** Resolved display currency (unknown codes and "FX not loaded yet" → USD). */
  currency: string;
  money: MoneyFormatter;
  totals?: EstimateTotals;
  /** Every item has a result (no pending shard, no load error) and the catalog is ready. */
  complete: boolean;
}

/** Prices every item of `estimate` (shared shard loads, per-item memoization) and derives totals. */
export function useEstimatePricing(estimate: Estimate | undefined): EstimatePricing {
  const catalogState = useCatalog();
  const { catalog } = catalogState;
  const pricing = useEstimateResults(estimate, catalog, {
    shardsFor: shardsForItem,
    compute: computeItem,
    regionName: (key) => regionName(catalog, key),
  });
  const currency = resolveCurrency(estimate?.currency, catalog?.fx);
  const fx = catalog?.fx;
  const money = useMemo(() => moneyFormatter(currency, fx), [currency, fx]);
  const items = estimate?.items;
  const { results } = pricing;
  const totals = useMemo(
    () => (estimate ? estimateTotals(estimate, results, serviceTitleOf) : undefined),
    // estimateTotals only reads estimate.items.
    [items, results],
  );
  const complete =
    catalogState.status === "ready" &&
    !pricing.loading &&
    totals !== undefined &&
    totals.pendingItems.length === 0 &&
    Object.keys(pricing.errors).length === 0;
  return { ...pricing, catalogState, currency, money, totals, complete };
}

/** Writes the totals to the estimate's display cache (shown on the estimates list) once complete. */
export function useCacheTotals(estimate: Estimate | undefined, pricing: EstimatePricing): void {
  const id = estimate?.id;
  const updatedAt = estimate?.updatedAt;
  const pricesDate = pricing.catalogState.catalog?.manifest.pricesDate;
  const { totals, complete } = pricing;
  useEffect(() => {
    if (!id || !complete || !totals || !pricesDate) return;
    useStore.getState().setCachedTotals(id, {
      monthlyUsd: totals.monthlyUsd,
      upfrontUsd: totals.upfrontUsd,
      amortizedMonthlyUsd: totals.amortizedMonthlyUsd,
      pricesDate,
      computedAt: nowIso(),
    });
  }, [id, updatedAt, complete, totals, pricesDate]);
}
