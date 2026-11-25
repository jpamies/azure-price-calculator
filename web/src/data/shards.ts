// Price shard loading: shard-index lookup (catalog.shards), parts/spot files, memory + IndexedDB caches.
// Browser code (fetch, IndexedDB); see docs/data-contract.md.
import { refKey } from "../domain/types.ts";
import type { PriceRow, ShardRef } from "../domain/types.ts";
import { dataUrl, regionKeyFor, slugFor } from "./catalog.ts";
import type { Catalog } from "./catalog.ts";
import { decodeShard } from "./columnar.ts";
import { idbDelete, idbGet, idbSet } from "./idb.ts";

const EMPTY_ROWS: PriceRow[] = [];

const resolved = new Map<string, PriceRow[]>();
const inflight = new Map<string, Promise<PriceRow[]>>();
const failures = new Map<string, string>();
const listeners = new Set<() => void>();
let version = 0;
let cacheDate: string | null = null;

function notify(): void {
  version++;
  for (const listener of listeners) listener();
}

/** Subscribe to shard cache changes (a shard loaded or failed). Used by the React hooks. */
export function subscribeShards(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Monotonic counter bumped on every cache change (useSyncExternalStore snapshot). */
export function shardsVersion(): number {
  return version;
}

function cacheKey(catalog: Catalog, ref: ShardRef): string {
  const date = catalog.manifest.pricesDate;
  if (cacheDate !== date) {
    // A new snapshot: rows of the previous date are never needed again.
    cacheDate = date;
    resolved.clear();
    failures.clear();
  }
  return `${date}|${refKey(ref)}`;
}

export interface ShardPlan {
  slug: string;
  regionKey: string;
  /** File names inside prices/<slug>/ (main file, part1..N, or the .spot file). */
  files: string[];
}

/**
 * Files backing `ref` (looked up in catalog.shards), or null when the shard does not exist:
 * unknown service/region, a Spot ref without Spot rows, or a main ref of a Spot-only region (parts 0).
 */
export function shardPlan(catalog: Catalog, ref: ShardRef): ShardPlan | null {
  const slug = slugFor(catalog, ref.serviceName);
  if (!slug) return null;
  const regionKey = regionKeyFor(ref.regionKey);
  const entry = catalog.shards[slug]?.[regionKey];
  if (!entry) return null;
  if (ref.spot) return entry.spot ? { slug, regionKey, files: [`${regionKey}.spot.json`] } : null;
  const parts = Number.isFinite(entry.parts) ? Math.floor(entry.parts) : 1;
  if (parts < 1) return null;
  const files = parts === 1 ? [`${regionKey}.json`] : Array.from({ length: parts }, (_, i) => `${regionKey}.part${i + 1}.json`);
  return { slug, regionKey, files };
}

/** Rows already in memory: the cached rows, [] for a shard that does not exist, else undefined. */
export function peekShard(catalog: Catalog, ref: ShardRef): PriceRow[] | undefined {
  const hit = resolved.get(cacheKey(catalog, ref));
  if (hit) return hit;
  return shardPlan(catalog, ref) ? undefined : EMPTY_ROWS;
}

/** Last load error of `ref` (cleared by a successful load or clearShardErrors). */
export function shardError(catalog: Catalog, ref: ShardRef): string | undefined {
  return failures.get(cacheKey(catalog, ref));
}

/** Forget recorded failures (all, or only `refs`) so the next load retries. */
export function clearShardErrors(catalog?: Catalog, refs?: ShardRef[]): void {
  if (!catalog || !refs) failures.clear();
  else for (const ref of refs) failures.delete(cacheKey(catalog, ref));
  notify();
}

/** Drops every in-memory shard (IndexedDB entries stay). */
export function clearShardCache(): void {
  resolved.clear();
  failures.clear();
  notify();
}

async function loadPart(catalog: Catalog, plan: ShardPlan, file: string, ref: ShardRef): Promise<PriceRow[]> {
  const date = catalog.manifest.pricesDate;
  const idbKey = `${date}/${plan.slug}/${file}`;
  const cached = await idbGet<{ cols: unknown; rows: unknown }>(idbKey);
  if (cached) {
    try {
      return decodeShard(cached);
    } catch {
      void idbDelete(idbKey);
    }
  }
  const what = `prices for ${ref.serviceName} (${ref.regionKey}${ref.spot ? ", Spot" : ""})`;
  const url = dataUrl(`${catalog.manifest.paths.prices}/${encodeURIComponent(plan.slug)}/${encodeURIComponent(file)}`);
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new Error(`Couldn't download ${what}: network error (${e instanceof Error ? e.message : String(e)}).`);
  }
  if (!res.ok) throw new Error(`Couldn't download ${what} (HTTP ${res.status}).`);
  let doc: { cols: unknown; rows: unknown };
  try {
    doc = (await res.json()) as { cols: unknown; rows: unknown };
  } catch {
    throw new Error(`Couldn't read ${what}: invalid JSON.`);
  }
  const rows = decodeShard(doc);
  void idbSet(idbKey, doc);
  return rows;
}

/**
 * Rows of one logical shard (all parts concatenated). Missing service/region/spot → [].
 * Concurrent loads are deduplicated; results are cached in memory, raw documents in IndexedDB
 * under `${pricesDate}/${slug}/${file}`. Errors propagate (HTTP status in the message) and are
 * recorded for shardError(); a failed load is retried by the next call.
 */
export function loadShard(catalog: Catalog, ref: ShardRef): Promise<PriceRow[]> {
  const key = cacheKey(catalog, ref);
  const hit = resolved.get(key);
  if (hit) return Promise.resolve(hit);
  const pending = inflight.get(key);
  if (pending) return pending;
  const plan = shardPlan(catalog, ref);
  if (!plan) return Promise.resolve(EMPTY_ROWS);

  const promise = Promise.all(plan.files.map((file) => loadPart(catalog, plan, file, ref))).then(
    (parts) => {
      const rows = parts.length === 1 ? parts[0] : parts.flat();
      inflight.delete(key);
      if (cacheDate === catalog.manifest.pricesDate) {
        resolved.set(key, rows);
        failures.delete(key);
      }
      notify();
      return rows;
    },
    (err: unknown) => {
      inflight.delete(key);
      if (cacheDate === catalog.manifest.pricesDate) failures.set(key, err instanceof Error ? err.message : String(err));
      notify();
      throw err;
    },
  );
  inflight.set(key, promise);
  return promise;
}
