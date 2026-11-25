// Application store: zustand v5 + persist (localStorage "azcalc.v1", debounced writes).
import type { ZodType } from "zod";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { StateStorage } from "zustand/middleware";
import {
  configShape,
  duplicateEstimate as cloneEstimate,
  duplicateItem as cloneItem,
  newEstimate,
  newItem,
  nowIso,
  sanitizeEstimate,
} from "../domain/factory.ts";
import { SCHEMA_VERSION, settingsSchema } from "../domain/model.ts";
import type { CachedTotals, Estimate, Item, ItemOf, ModuleId, PersistedState, Settings } from "../domain/model.ts";
import { migratePersistedState } from "./migrations.ts";

export const STORAGE_KEY = "azcalc.v1";
export const SAVE_DEBOUNCE_MS = 500;

// ---------------------------------------------------------------- save status

export type SaveStatus = "saved" | "saving" | "error";

export interface SaveStatusState {
  status: SaveStatus;
  /** User-facing message when status is "error". */
  error?: string;
  /** Date.now() of the last successful write. */
  savedAt?: number;
}

/** Tiny separate store for the "Saved" indicator: `const { status, error } = useSaveStatus();`. */
export const useSaveStatus = create<SaveStatusState>(() => ({ status: "saved" }));

// ---------------------------------------------------------------- debounced localStorage

function local(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

function storageErrorMessage(e: unknown): string {
  const name = e instanceof DOMException || e instanceof Error ? e.name : "";
  if (name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED") {
    return "Couldn't save: browser storage is full. Export your estimates as JSON and delete some to free space.";
  }
  return "Couldn't save: browser storage is unavailable (private mode or blocked). Export your estimates as JSON to keep them.";
}

interface DebouncedStorage extends StateStorage<void> {
  flush(): void;
  hasPending(): boolean;
}

function createDebouncedStorage(delayMs: number): DebouncedStorage {
  const pending = new Map<string, string>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (pending.size === 0) return;
    const entries = [...pending];
    pending.clear();
    try {
      const ls = local();
      if (!ls) throw new Error("localStorage unavailable");
      for (const [key, value] of entries) ls.setItem(key, value);
      useSaveStatus.setState({ status: "saved", error: undefined, savedAt: Date.now() });
    } catch (e) {
      useSaveStatus.setState({ status: "error", error: storageErrorMessage(e) });
    }
  };

  return {
    getItem(name) {
      if (pending.has(name)) return pending.get(name) ?? null;
      let raw: string | null = null;
      try {
        raw = local()?.getItem(name) ?? null;
      } catch {
        return null;
      }
      if (raw === null) return null;
      try {
        JSON.parse(raw);
        return raw;
      } catch {
        // Keep a copy of corrupted data instead of silently overwriting it.
        try {
          local()?.setItem(`${name}.corrupt-${Date.now()}`, raw);
        } catch {
          // Ignore: nothing else we can do.
        }
        console.warn(`[azcalc] Stored data under "${name}" is not valid JSON; starting fresh (a copy was kept).`);
        return null;
      }
    },
    setItem(name, value) {
      pending.set(name, value);
      if (useSaveStatus.getState().status !== "saving") useSaveStatus.setState({ status: "saving" });
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(flush, delayMs);
    },
    removeItem(name) {
      pending.delete(name);
      try {
        local()?.removeItem(name);
      } catch {
        // Ignore.
      }
    },
    flush,
    hasPending: () => pending.size > 0,
  };
}

const debouncedStorage = createDebouncedStorage(SAVE_DEBOUNCE_MS);

/** Writes any pending change to localStorage now (also done on pagehide / tab hidden). */
export function flushSave(): void {
  debouncedStorage.flush();
}

// ---------------------------------------------------------------- store

export interface EstimatePatch {
  name?: string;
  currency?: string;
  /** "" removes the notes. */
  notes?: string;
}

export interface ItemPatch {
  name?: string;
  region?: string;
  collapsed?: boolean;
  /** "" removes the notes. */
  notes?: string;
  /** Shallow-merged into the config; keys with invalid values are ignored (console.warn). */
  config?: Partial<Item["config"]>;
}

export interface AddItemInit<M extends ModuleId = ModuleId> {
  /** Default: settings.lastRegion ?? settings.defaultRegion. */
  region?: string;
  name?: string;
  config?: Partial<ItemOf<M>["config"]>;
}

export interface StoreActions {
  /** New empty estimate (currency = settings.defaultCurrency), inserted first. Returns its id. */
  createEstimate(name?: string): string;
  /** Adds estimates with fresh ids (names kept), inserted first. Returns the new ids. */
  importEstimates(list: Estimate[]): string[];
  updateEstimate(id: string, patch: EstimatePatch): void;
  /** Copy inserted first, named "<name> (copy)". Returns its id (undefined if `id` is unknown). */
  duplicateEstimate(id: string): string | undefined;
  deleteEstimate(id: string): void;
  /** Appends a new item; returns its id (undefined if the estimate is unknown). */
  addItem<M extends ModuleId>(estimateId: string, moduleId: M, init?: AddItemInit<M>): string | undefined;
  /** Also sets settings.lastRegion when the region changes. */
  updateItem(estimateId: string, itemId: string, patch: ItemPatch): void;
  removeItem(estimateId: string, itemId: string): void;
  /** Copy inserted right after the original. Returns its id. */
  duplicateItem(estimateId: string, itemId: string): string | undefined;
  /** Moves an item to `toIndex` (clamped). */
  moveItem(estimateId: string, itemId: string, toIndex: number): void;
  setAllCollapsed(estimateId: string, collapsed: boolean): void;
  /**
   * Stores the editor's last complete totals (display cache for the estimates list). Does NOT bump
   * updatedAt. No-op when the amounts/snapshot are unchanged and the cache is already newer than
   * the last edit; `undefined` removes the cache. Non-finite amounts are ignored.
   */
  setCachedTotals(estimateId: string, totals: CachedTotals | undefined): void;
  /** Invalid values are ignored (console.warn). */
  updateSettings(patch: Partial<Settings>): void;
  /** Replaces everything (backup restore); the data is validated/repaired first. */
  replaceAll(state: PersistedState): void;
  /** Deletes every estimate and resets the settings. */
  clearAll(): void;
}

export type StoreState = PersistedState & StoreActions;

function touch(estimate: Estimate): Estimate {
  return { ...estimate, updatedAt: nowIso() };
}

/** Applies valid keys of `patch` to `config`; invalid keys are ignored with a warning. */
function mergeConfig(item: Item, patch: Record<string, unknown>): Item["config"] {
  const shape = configShape(item.moduleId);
  const next: Record<string, unknown> = { ...item.config };
  for (const [key, value] of Object.entries(patch)) {
    const field: ZodType | undefined = shape[key];
    const parsed = field?.safeParse(value);
    if (parsed?.success) next[key] = parsed.data;
    else console.warn(`[azcalc] Ignored invalid ${item.moduleId} config value for "${key}":`, value);
  }
  return next as Item["config"];
}

/** Upper-cased 3-letter code, or undefined when `value` is not a currency code. */
function currencyCode(value: unknown): string | undefined {
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";
  return /^[A-Z]{3}$/.test(code) ? code : undefined;
}

function mergeSettings(settings: Settings, patch: Partial<Settings>): Settings {
  const shape = settingsSchema.shape as unknown as Record<string, ZodType>;
  const next: Record<string, unknown> = { ...settings };
  for (const [key, value] of Object.entries(patch)) {
    const candidate = key === "defaultCurrency" ? currencyCode(value) : value;
    const parsed = key === "defaultCurrency" && candidate === undefined ? undefined : shape[key]?.safeParse(candidate);
    if (parsed?.success) next[key] = parsed.data;
    else console.warn(`[azcalc] Ignored invalid setting "${key}":`, value);
  }
  return next as Settings;
}

const defaultState = (): PersistedState => ({ estimates: [], settings: settingsSchema.parse({}) });

export const useStore = create<StoreState>()(
  persist(
    (set, get) => {
      /** Applies `fn` to one estimate; no state change (and no save) when fn returns the same object. */
      const updateEstimateById = (id: string, fn: (e: Estimate) => Estimate): void => {
        let changed = false;
        const estimates = get().estimates.map((e) => {
          if (e.id !== id) return e;
          const next = fn(e);
          if (next !== e) changed = true;
          return next;
        });
        if (changed) set({ estimates });
      };

      return {
        ...defaultState(),

        createEstimate(name) {
          const estimate = newEstimate(get().settings, name);
          set((s) => ({ estimates: [estimate, ...s.estimates] }));
          return estimate.id;
        },

        importEstimates(list) {
          const now = nowIso();
          const fresh = list.map((e) => ({ ...sanitizeEstimate(e, { freshIds: true }), updatedAt: now }));
          set((s) => ({ estimates: [...fresh, ...s.estimates] }));
          return fresh.map((e) => e.id);
        },

        updateEstimate(id, patch) {
          updateEstimateById(id, (e) => {
            const next: Estimate = { ...e };
            if (patch.name !== undefined) next.name = patch.name;
            if (patch.currency !== undefined) {
              const code = currencyCode(patch.currency);
              if (code) next.currency = code;
              else console.warn("[azcalc] Ignored invalid currency:", patch.currency);
            }
            if (patch.notes !== undefined) {
              if (patch.notes === "") delete next.notes;
              else next.notes = patch.notes;
            }
            return touch(next);
          });
        },

        duplicateEstimate(id) {
          const source = get().estimates.find((e) => e.id === id);
          if (!source) return undefined;
          const copy = cloneEstimate(source);
          set((s) => ({ estimates: [copy, ...s.estimates] }));
          return copy.id;
        },

        deleteEstimate(id) {
          set((s) => ({ estimates: s.estimates.filter((e) => e.id !== id) }));
        },

        addItem(estimateId, moduleId, init = {}) {
          const { estimates, settings } = get();
          if (!estimates.some((e) => e.id === estimateId)) return undefined;
          const region = init.region ?? settings.lastRegion ?? settings.defaultRegion;
          const item = newItem(moduleId, { region, settings, name: init.name, config: init.config });
          updateEstimateById(estimateId, (e) => touch({ ...e, items: [...e.items, item] }));
          return item.id;
        },

        updateItem(estimateId, itemId, patch) {
          let newRegion: string | undefined;
          updateEstimateById(estimateId, (e) => {
            const index = e.items.findIndex((i) => i.id === itemId);
            if (index < 0) return e;
            const item = e.items[index];
            const next = { ...item } as Item;
            if (patch.name !== undefined) next.name = patch.name;
            if (patch.region !== undefined && patch.region !== item.region) {
              next.region = patch.region;
              newRegion = patch.region;
            }
            if (patch.collapsed !== undefined) next.collapsed = patch.collapsed;
            if (patch.notes !== undefined) {
              if (patch.notes === "") delete next.notes;
              else next.notes = patch.notes;
            }
            if (patch.config) next.config = mergeConfig(item, patch.config as Record<string, unknown>);
            const items = e.items.slice();
            items[index] = next;
            // Collapsing/expanding a card is view state: it does not count as an edit.
            const viewOnly = Object.keys(patch).every((k) => k === "collapsed");
            return viewOnly ? { ...e, items } : touch({ ...e, items });
          });
          const settings = get().settings;
          if (newRegion && settings.lastRegion !== newRegion) set({ settings: { ...settings, lastRegion: newRegion } });
        },

        removeItem(estimateId, itemId) {
          updateEstimateById(estimateId, (e) =>
            e.items.some((i) => i.id === itemId) ? touch({ ...e, items: e.items.filter((i) => i.id !== itemId) }) : e,
          );
        },

        duplicateItem(estimateId, itemId) {
          let newId: string | undefined;
          updateEstimateById(estimateId, (e) => {
            const index = e.items.findIndex((i) => i.id === itemId);
            if (index < 0) return e;
            const copy = cloneItem(e.items[index]);
            newId = copy.id;
            const items = e.items.slice();
            items.splice(index + 1, 0, copy);
            return touch({ ...e, items });
          });
          return newId;
        },

        moveItem(estimateId, itemId, toIndex) {
          updateEstimateById(estimateId, (e) => {
            const from = e.items.findIndex((i) => i.id === itemId);
            if (from < 0 || !Number.isFinite(toIndex)) return e;
            const to = Math.min(Math.max(Math.round(toIndex), 0), e.items.length - 1);
            if (to === from) return e;
            const items = e.items.slice();
            const [moved] = items.splice(from, 1);
            items.splice(to, 0, moved);
            return touch({ ...e, items });
          });
        },

        setAllCollapsed(estimateId, collapsed) {
          updateEstimateById(estimateId, (e) =>
            e.items.every((i) => i.collapsed === collapsed) ? e : { ...e, items: e.items.map((i) => (i.collapsed === collapsed ? i : { ...i, collapsed })) },
          );
        },

        setCachedTotals(estimateId, totals) {
          if (totals && ![totals.monthlyUsd, totals.upfrontUsd, totals.amortizedMonthlyUsd].every(Number.isFinite)) {
            console.warn("[azcalc] Ignored non-finite cached totals:", totals);
            return;
          }
          // View cache, not an edit: never touch() the estimate.
          updateEstimateById(estimateId, (e) => {
            const prev = e.cachedTotals;
            if (!totals) {
              if (!prev) return e;
              const next = { ...e };
              delete next.cachedTotals;
              return next;
            }
            const unchanged =
              prev !== undefined &&
              prev.monthlyUsd === totals.monthlyUsd &&
              prev.upfrontUsd === totals.upfrontUsd &&
              prev.amortizedMonthlyUsd === totals.amortizedMonthlyUsd &&
              prev.pricesDate === totals.pricesDate &&
              prev.computedAt >= e.updatedAt;
            if (unchanged) return e;
            const { monthlyUsd, upfrontUsd, amortizedMonthlyUsd, pricesDate, computedAt } = totals;
            return { ...e, cachedTotals: { monthlyUsd, upfrontUsd, amortizedMonthlyUsd, pricesDate, computedAt } };
          });
        },

        updateSettings(patch) {
          const current = get().settings;
          const next = mergeSettings(current, patch);
          if (Object.keys(next).some((k) => !Object.is(next[k as keyof Settings], current[k as keyof Settings]))) set({ settings: next });
        },

        replaceAll(state) {
          set(migratePersistedState(state, SCHEMA_VERSION));
        },

        clearAll() {
          set(defaultState());
        },
      };
    },
    {
      name: STORAGE_KEY,
      version: SCHEMA_VERSION,
      storage: createJSONStorage<PersistedState>(() => debouncedStorage),
      partialize: (s) => ({ estimates: s.estimates, settings: s.settings }),
      migrate: (persisted, version) => migratePersistedState(persisted, version),
      // Validate on every hydration, not only on version changes (hand-edited/corrupted data).
      merge: (persisted, current) => (persisted === undefined ? current : { ...current, ...migratePersistedState(persisted, SCHEMA_VERSION) }),
    },
  ),
);

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushSave);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushSave();
  });
  // Another tab saved: reload our copy (unless we have unsaved changes, which win on next flush).
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY && event.newValue !== null && !debouncedStorage.hasPending()) {
      void useStore.persist.rehydrate();
    }
  });
}

// ---------------------------------------------------------------- selectors

export function useEstimates(): Estimate[] {
  return useStore((s) => s.estimates);
}

export function useEstimate(id: string | undefined): Estimate | undefined {
  return useStore((s) => (id ? s.estimates.find((e) => e.id === id) : undefined));
}

export function useSettings(): Settings {
  return useStore((s) => s.settings);
}
