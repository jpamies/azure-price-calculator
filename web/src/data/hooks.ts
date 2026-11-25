// React hooks over the data layer: catalog, shards, per-item pricing results, media queries.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Estimate, Item } from "../domain/model.ts";
import { refKey } from "../domain/types.ts";
import type { ItemResult, PriceRow, PricingContext, ServiceInfo, ShardRef } from "../domain/types.ts";
import { clearCatalogCache, loadCatalog } from "./catalog.ts";
import type { Catalog } from "./catalog.ts";
import { clearShardErrors, loadShard, peekShard, shardError, shardsVersion, subscribeShards } from "./shards.ts";

export type LoadStatus = "loading" | "ready" | "error";

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ---------------------------------------------------------------- catalog (shared by all hooks)

interface CatalogSnapshot {
  status: LoadStatus;
  catalog?: Catalog;
  error?: string;
}

let catalogSnapshot: CatalogSnapshot = { status: "loading" };
let catalogStarted = false;
let catalogToken = 0;
const catalogListeners = new Set<() => void>();

function setCatalogSnapshot(next: CatalogSnapshot): void {
  catalogSnapshot = next;
  for (const listener of catalogListeners) listener();
}

function subscribeCatalog(listener: () => void): () => void {
  catalogListeners.add(listener);
  return () => {
    catalogListeners.delete(listener);
  };
}

function getCatalogSnapshot(): CatalogSnapshot {
  return catalogSnapshot;
}

function startCatalogLoad(force: boolean): void {
  if (catalogStarted && !force) return;
  catalogStarted = true;
  const token = ++catalogToken;
  if (force) {
    clearCatalogCache();
    if (catalogSnapshot.status !== "loading") setCatalogSnapshot({ status: "loading" });
  }
  loadCatalog().then(
    (catalog) => {
      if (token === catalogToken) setCatalogSnapshot({ status: "ready", catalog });
    },
    (e: unknown) => {
      if (token === catalogToken) setCatalogSnapshot({ status: "error", error: errorMessage(e) });
    },
  );
}

/** Starts loading the catalog before React renders (optional; useCatalog does it too). */
export function preloadCatalog(): void {
  startCatalogLoad(false);
}

/** Reloads the catalog (clears the in-memory cache). */
export function retryCatalog(): void {
  startCatalogLoad(true);
}

export interface CatalogState {
  status: LoadStatus;
  catalog?: Catalog;
  error?: string;
  retry: () => void;
}

/** Shared catalog state: every component sees the same load; `retry` refetches after an error. */
export function useCatalog(): CatalogState {
  const snap = useSyncExternalStore(subscribeCatalog, getCatalogSnapshot, getCatalogSnapshot);
  useEffect(() => {
    startCatalogLoad(false);
  }, []);
  return { status: snap.status, catalog: snap.catalog, error: snap.error, retry: retryCatalog };
}

// ---------------------------------------------------------------- shards

function uniqueRefs(refs: ShardRef[]): { key: string; refs: ShardRef[] } {
  const map = new Map<string, ShardRef>();
  for (const ref of refs) {
    const k = refKey(ref);
    if (!map.has(k)) map.set(k, ref);
  }
  const keys = [...map.keys()].sort();
  return { key: keys.join("\n"), refs: keys.map((k) => map.get(k) as ShardRef) };
}

interface ShardSnapshot {
  data: Record<string, PriceRow[]>;
  errors: Record<string, string>;
  pending: number;
  retry: () => void;
}

/** Loads `refs` (deduplicated, stable for equal sets) and exposes rows/errors keyed by refKey. */
function useShardLoader(catalog: Catalog | undefined, refs: ShardRef[]): ShardSnapshot {
  const { key } = uniqueRefs(refs);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` identifies the ref set.
  const unique = useMemo(() => uniqueRefs(refs).refs, [key]);
  const version = useSyncExternalStore(subscribeShards, shardsVersion, shardsVersion);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!catalog) return;
    for (const ref of unique) {
      if (peekShard(catalog, ref) || shardError(catalog, ref)) continue;
      loadShard(catalog, ref).catch(() => undefined); // failures are recorded by shards.ts
    }
  }, [catalog, unique, attempt]);

  const retry = useCallback(() => {
    if (catalog) clearShardErrors(catalog, unique);
    setAttempt((a) => a + 1);
  }, [catalog, unique]);

  return useMemo(() => {
    const data: Record<string, PriceRow[]> = {};
    const errors: Record<string, string> = {};
    let pending = 0;
    for (const ref of unique) {
      const k = refKey(ref);
      const rows = catalog ? peekShard(catalog, ref) : undefined;
      if (rows) data[k] = rows;
      else {
        const err = catalog ? shardError(catalog, ref) : undefined;
        if (err) errors[k] = err;
        else pending++;
      }
    }
    return { data, errors, pending, retry };
    // `version` invalidates the snapshot whenever any shard loads or fails.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, unique, version, retry]);
}

export interface ShardsState {
  status: LoadStatus;
  /** Rows keyed by refKey(ref); a shard that does not exist is []. */
  data: Record<string, PriceRow[]>;
  error?: string;
  retry: () => void;
}

/** Rows of `refs` (uses the shared catalog). Stable for equal ref sets, whatever the array identity. */
export function useShards(refs: ShardRef[]): ShardsState {
  const cat = useCatalog();
  const shards = useShardLoader(cat.catalog, refs);
  if (cat.status !== "ready") {
    return { status: cat.status, data: shards.data, error: cat.error, retry: cat.retry };
  }
  const firstError = Object.values(shards.errors)[0];
  return {
    status: firstError ? "error" : shards.pending > 0 ? "loading" : "ready",
    data: shards.data,
    error: firstError,
    retry: shards.retry,
  };
}

// ---------------------------------------------------------------- estimate results

export interface EstimateResultsOptions {
  /** Shards an item needs, e.g. `(item, services) => moduleOf(item).shards(item.config, item.region, services)`. */
  shardsFor(item: Item, services: ServiceInfo[]): ShardRef[];
  /** Prices one item, e.g. `(item, ctx) => moduleOf(item).compute(item.config, ctx)`. */
  compute(item: Item, ctx: PricingContext): ItemResult;
  /** Region display name for messages. */
  regionName(key: string): string;
}

export interface EstimateResults {
  /** itemId → result; undefined while the item's prices load (or when it failed, see errors). */
  results: Record<string, ItemResult | undefined>;
  /** True while any needed shard (or the catalog) is still loading. */
  loading: boolean;
  /** itemId → user-facing error (shard download failed, shardsFor/compute threw). */
  errors: Record<string, string>;
  /** Retries failed shard downloads. */
  retry: () => void;
}

interface CachedResult {
  item: Item;
  catalog: Catalog;
  shards: Record<string, PriceRow[]>;
  result?: ItemResult;
  error?: string;
}

const NO_ITEMS: Item[] = [];

function sameShards(a: Record<string, PriceRow[]>, b: Record<string, PriceRow[]>): boolean {
  const ak = Object.keys(a);
  if (ak.length !== Object.keys(b).length) return false;
  return ak.every((k) => a[k] === b[k]);
}

/**
 * Prices every item of `estimate`: loads all needed shards (deduplicated across items), then calls
 * `compute` per item. Results are memoized per item object, so editing one item recomputes only
 * that item. `options` may be an inline object: it is read from a ref, and changing it alone does
 * not trigger a recompute.
 */
export function useEstimateResults(
  estimate: Estimate | undefined,
  catalog: Catalog | undefined,
  options: EstimateResultsOptions,
): EstimateResults {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const items = estimate?.items ?? NO_ITEMS;

  const plan = useMemo(() => {
    const perItem = new Map<string, { refs: ShardRef[]; error?: string }>();
    if (!catalog) return perItem;
    for (const item of items) {
      try {
        perItem.set(item.id, { refs: optionsRef.current.shardsFor(item, catalog.services) ?? [] });
      } catch (e) {
        perItem.set(item.id, { refs: [], error: `Couldn't prepare this item: ${errorMessage(e)}` });
      }
    }
    return perItem;
  }, [items, catalog]);

  const allRefs = useMemo(() => [...plan.values()].flatMap((p) => p.refs), [plan]);
  const shards = useShardLoader(catalog, allRefs);
  const cacheRef = useRef(new Map<string, CachedResult>());

  const computed = useMemo(() => {
    const results: Record<string, ItemResult | undefined> = {};
    const errors: Record<string, string> = {};
    let loading = !catalog && items.length > 0;
    const nextCache = new Map<string, CachedResult>();
    if (catalog) {
      for (const item of items) {
        const p = plan.get(item.id);
        if (!p) continue;
        if (p.error) {
          errors[item.id] = p.error;
          continue;
        }
        const keys = p.refs.map(refKey);
        if (keys.some((k) => !shards.data[k])) {
          const failed = keys.find((k) => !shards.data[k] && shards.errors[k]);
          if (failed) errors[item.id] = shards.errors[failed];
          else loading = true;
          continue;
        }
        const shardMap: Record<string, PriceRow[]> = {};
        for (const k of keys) shardMap[k] = shards.data[k];
        let entry = cacheRef.current.get(item.id);
        if (!entry || entry.item !== item || entry.catalog !== catalog || !sameShards(entry.shards, shardMap)) {
          const ctx: PricingContext = {
            region: item.region,
            regionName: optionsRef.current.regionName(item.region),
            shards: shardMap,
            services: catalog.services,
            vmSpecs: catalog.vmSpecs,
            hasSavingsPlan: catalog.manifest.hasSavingsPlan,
          };
          try {
            entry = { item, catalog, shards: shardMap, result: optionsRef.current.compute(item, ctx) };
          } catch (e) {
            entry = { item, catalog, shards: shardMap, error: `Couldn't price this item: ${errorMessage(e)}` };
          }
        }
        nextCache.set(item.id, entry);
        if (entry.result) results[item.id] = entry.result;
        if (entry.error) errors[item.id] = entry.error;
      }
    }
    cacheRef.current = nextCache;
    return { results, errors, loading };
  }, [items, catalog, plan, shards.data, shards.errors]);

  return { ...computed, retry: shards.retry };
}

// ---------------------------------------------------------------- misc

/** `window.matchMedia(query).matches`, kept in sync (false when matchMedia is unavailable). */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => undefined;
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );
  const getSnapshot = () => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(query).matches : false);
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
