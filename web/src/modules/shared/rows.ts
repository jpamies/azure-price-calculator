// Shard rows as seen by a form: the card loads the item's shards; forms read them by ref.
import type { ShardsState } from "@/data/hooks";
import { refKey, type PriceRow, type ShardRef } from "@/domain/types";

/** Stable empty rows (keeps memoized catalogs stable). */
export const NO_ROWS: PriceRow[] = [];

/**
 * Rows of `ref` from the card's shard state: [] when there is nothing to load (no region, service
 * not offered there), undefined while the shard is loading or failed.
 */
export function rowsOf(shards: ShardsState, ref: ShardRef | undefined): PriceRow[] | undefined {
  if (!ref) return NO_ROWS;
  return shards.data[refKey(ref)];
}

/** true when data-driven selectors should show a skeleton. */
export function isLoading(shards: ShardsState, rows: PriceRow[] | undefined): boolean {
  return rows === undefined && shards.status !== "error";
}
