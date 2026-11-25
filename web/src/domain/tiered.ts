// Marginal (graduated) tier pricing over tierMinimumUnits.

export interface PriceTier {
  tierMinimumUnits: number;
  retailPrice: number;
}

export interface TierBand {
  /** Inclusive lower bound (billing units). */
  from: number;
  /** Exclusive upper bound; null = unbounded. */
  to: number | null;
  /** Units of `qty` that fall in this band. */
  units: number;
  price: number;
  cost: number;
}

function sortTiers(tiers: readonly PriceTier[]): PriceTier[] {
  return [...tiers].sort((a, b) => a.tierMinimumUnits - b.tierMinimumUnits);
}

/**
 * Per-band breakdown of `qty` billing units. Band i covers [min_i, min_{i+1}). Units below the
 * lowest tierMinimumUnits are free (the API omits a row for a free allowance, e.g. "first 5 GB").
 */
export function tieredBreakdown(tiers: readonly PriceTier[], qty: number): TierBand[] {
  const sorted = sortTiers(tiers);
  const bands: TierBand[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const from = Math.max(0, sorted[i].tierMinimumUnits);
    const next = i + 1 < sorted.length ? sorted[i + 1].tierMinimumUnits : null;
    const upper = next === null ? Infinity : next;
    const units = qty > from ? Math.max(0, Math.min(qty, upper) - from) : 0;
    bands.push({ from, to: next, units, price: sorted[i].retailPrice, cost: units * sorted[i].retailPrice });
  }
  return bands;
}

/** Marginal cost of `qty` billing units over the tiers (0 for qty <= 0 or no tiers). */
export function tieredCost(tiers: readonly PriceTier[], qty: number): number {
  if (!(qty > 0) || tiers.length === 0) return 0;
  let cost = 0;
  for (const band of tieredBreakdown(tiers, qty)) cost += band.cost;
  return cost;
}

/** Units below the lowest tier minimum (billed at 0). */
export function freeAllowance(tiers: readonly PriceTier[]): number {
  if (tiers.length === 0) return 0;
  return Math.max(0, sortTiers(tiers)[0].tierMinimumUnits);
}
