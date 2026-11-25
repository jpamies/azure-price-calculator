// Managed disk tier table (Premium SSD "P", Standard SSD "E", Standard HDD "S").

/** Tier number → size in GiB (same numbers for P/E/S; Standard HDD starts at S4). */
export const DISK_TIER_SIZES: Readonly<Record<number, number>> = Object.freeze({
  1: 4,
  2: 8,
  3: 16,
  4: 32,
  6: 64,
  10: 128,
  15: 256,
  20: 512,
  30: 1024,
  40: 2048,
  50: 4096,
  60: 8192,
  70: 16384,
  80: 32767,
});

export type DiskTierPrefix = "P" | "E" | "S";

const TIER_NUMBERS = Object.keys(DISK_TIER_SIZES)
  .map(Number)
  .sort((a, b) => a - b);

/** Parse "P30" / "e15" / "S4" → { prefix, number }; null if malformed. */
export function parseTier(tier: string): { prefix: DiskTierPrefix; number: number } | null {
  const m = /^\s*([PES])(\d+)\s*$/i.exec(tier ?? "");
  if (!m) return null;
  return { prefix: m[1].toUpperCase() as DiskTierPrefix, number: Number(m[2]) };
}

/** Size in GiB of a tier name ("P30" → 1024); null for unknown tiers. */
export function tierSizeGB(tier: string): number | null {
  const t = parseTier(tier);
  if (!t) return null;
  if (t.prefix === "S" && t.number < 4) return null;
  return DISK_TIER_SIZES[t.number] ?? null;
}

/** All standard tier names for a prefix in size order (S starts at S4). */
export function standardTiers(prefix: string): string[] {
  const p = prefix.toUpperCase();
  return TIER_NUMBERS.filter((n) => !(p === "S" && n < 4)).map((n) => `${p}${n}`);
}

/**
 * Smallest tier with size >= sizeGB among `availableTiers` (default: every standard tier of the
 * prefix). Only tiers with the given prefix and a known size are considered. null = none fits.
 */
export function pickTierForSize(prefix: string, sizeGB: number, availableTiers?: readonly string[]): string | null {
  const p = prefix.toUpperCase();
  const pool = availableTiers ?? standardTiers(p);
  let best: { tier: string; size: number } | null = null;
  for (const tier of pool) {
    const parsed = parseTier(tier);
    if (!parsed || parsed.prefix !== p) continue;
    const size = tierSizeGB(tier);
    if (size === null || size < sizeGB) continue;
    if (!best || size < best.size) best = { tier: `${parsed.prefix}${parsed.number}`, size };
  }
  return best ? best.tier : null;
}
