// Undo helpers for destructive actions (remove item / delete estimate), built on zustand's
// setState so the restored objects keep their ids (cached prices stay valid).
import { nowIso } from "@/domain/factory";
import type { Estimate, Item } from "@/domain/model";
import { useStore } from "@/store/useStore";

function clampIndex(index: number, length: number): number {
  return Math.min(Math.max(Math.round(index), 0), length);
}

/** Re-inserts a removed item at `index`. False when the estimate is gone or the item is back. */
export function restoreItem(estimateId: string, item: Item, index: number): boolean {
  let restored = false;
  useStore.setState((s) => {
    const target = s.estimates.find((e) => e.id === estimateId);
    if (!target || target.items.some((i) => i.id === item.id)) return s;
    restored = true;
    return {
      estimates: s.estimates.map((e) => {
        if (e !== target) return e;
        const items = e.items.slice();
        items.splice(clampIndex(index, items.length), 0, item);
        return { ...e, items, updatedAt: nowIso() };
      }),
    };
  });
  return restored;
}

/** Re-inserts a deleted estimate at `index`. False when an estimate with that id exists. */
export function restoreEstimate(estimate: Estimate, index: number): boolean {
  let restored = false;
  useStore.setState((s) => {
    if (s.estimates.some((e) => e.id === estimate.id)) return s;
    restored = true;
    const estimates = s.estimates.slice();
    estimates.splice(clampIndex(index, estimates.length), 0, estimate);
    return { estimates };
  });
  return restored;
}
