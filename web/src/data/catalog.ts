// Catalog loader: manifest (never cached) + immutable per-date index files (services, regions,
// shard map, VM specs, FX). Browser code (fetch, import.meta.env); see docs/data-contract.md.
import type { FxTable, Manifest, RegionInfo, ServiceInfo, ShardEntry, ShardIndex, VmSpec, VmSpecs } from "../domain/types.ts";
import { idbDeleteMany, idbKeys } from "./idb.ts";

/** Newest manifest.schemaVersion this build understands. */
export const SUPPORTED_SCHEMA_VERSION = 1;
export const GLOBAL_REGION = "_global";
export const GLOBAL_REGION_NAME = "Global (no region)";

export interface Catalog {
  manifest: Manifest;
  services: ServiceInfo[];
  regions: RegionInfo[];
  vmSpecs: VmSpecs;
  fx: FxTable;
  /** serviceSlug -> regionKey -> entry, from paths.shards (or the legacy manifest.shards). */
  shards: ShardIndex;
}

/** URL of a published data file: `${BASE_URL}data/${path}` (BASE_URL is "./" in production). */
export function dataUrl(path: string): string {
  const base = import.meta.env?.BASE_URL || "./";
  return `${base.endsWith("/") ? base : `${base}/`}data/${path.replace(/^\/+/, "")}`;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function fetchJson(url: string, what: string, init?: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    throw new Error(`Couldn't download ${what}: network error (${message(e)}).`);
  }
  if (!res.ok) throw new Error(`Couldn't download ${what} (HTTP ${res.status}).`);
  try {
    return await res.json();
  } catch {
    throw new Error(`Couldn't read ${what}: invalid JSON.`);
  }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function strOr(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}

function numOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/**
 * Validates/normalizes the shard map ({ slug: { regionKey: ShardEntry } }). Missing `parts`
 * defaults to 1; `parts: 0` (Spot-only region, no main file) is kept. Also accepts the map wrapped
 * as { shards: {...} }. Throws on a non-object.
 */
export function parseShardIndex(raw: unknown): ShardIndex {
  if (!isObj(raw)) throw new Error("The shard index is invalid (expected an object).");
  const wrapped = isObj(raw.shards) && Object.keys(raw).every((k) => k === "shards" || !isObj(raw[k]));
  const map = wrapped ? (raw.shards as Record<string, unknown>) : raw;
  const shards: ShardIndex = {};
  for (const [slug, regions] of Object.entries(map)) {
    if (!isObj(regions)) continue;
    const bySlug: Record<string, ShardEntry> = {};
    for (const [region, entry] of Object.entries(regions)) {
      if (!isObj(entry)) continue;
      bySlug[region] = {
        parts: Math.max(0, Math.floor(numOr(entry.parts, 1))),
        rows: numOr(entry.rows, 0),
        bytes: numOr(entry.bytes, 0),
        spot: entry.spot === true,
        ...(typeof entry.spotRows === "number" ? { spotRows: entry.spotRows } : {}),
      };
    }
    shards[slug] = bySlug;
  }
  return shards;
}

/**
 * Validates/normalizes manifest.json. Throws an Error with a clear message on an invalid document.
 * Needs `paths.shards` (current snapshots) or an inline `shards` map (legacy snapshots).
 */
export function parseManifest(raw: unknown): Manifest {
  const bad = (why: string) => new Error(`The price manifest is invalid (${why}).`);
  if (!isObj(raw)) throw bad("not an object");
  const schemaVersion = raw.schemaVersion;
  if (typeof schemaVersion !== "number") throw bad("missing schemaVersion");
  if (schemaVersion > SUPPORTED_SCHEMA_VERSION) {
    throw new Error(`The published price data (format v${schemaVersion}) is newer than this app. Reload the page to update.`);
  }
  if (typeof raw.pricesDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw.pricesDate)) throw bad("missing pricesDate");
  if (!isObj(raw.paths)) throw bad("missing paths");
  const paths = raw.paths;
  for (const key of ["root", "services", "regions", "vmSkus", "fx", "prices"]) {
    if (typeof paths[key] !== "string" || paths[key] === "") throw bad(`missing paths.${key}`);
  }
  const shardsPath = typeof paths.shards === "string" && paths.shards !== "" ? paths.shards : undefined;
  const legacyShards = isObj(raw.shards) ? parseShardIndex(raw.shards) : undefined;
  if (!shardsPath && !legacyShards) throw bad("missing paths.shards");
  const source = isObj(raw.source) ? raw.source : {};
  return {
    schemaVersion,
    pricesDate: raw.pricesDate,
    generatedAt: strOr(raw.generatedAt, ""),
    currencyBase: "USD",
    hasSavingsPlan: raw.hasSavingsPlan === true,
    source: { ...(source as Manifest["source"]), type: source.type === "fixture" ? "fixture" : "exporter" },
    paths: {
      root: paths.root as string,
      services: paths.services as string,
      regions: paths.regions as string,
      vmSkus: paths.vmSkus as string,
      fx: paths.fx as string,
      prices: paths.prices as string,
      ...(typeof paths.report === "string" ? { report: paths.report } : {}),
      ...(shardsPath ? { shards: shardsPath } : {}),
    },
    ...(legacyShards ? { shards: legacyShards } : {}),
    ...(isObj(raw.stats) ? { stats: raw.stats as Manifest["stats"] } : {}),
  };
}

export function parseServices(raw: unknown): ServiceInfo[] {
  if (!Array.isArray(raw)) throw new Error("The service index is invalid (expected a list).");
  return raw
    .filter((s): s is Record<string, unknown> => isObj(s) && typeof s.serviceName === "string" && typeof s.slug === "string")
    .map((s) => ({
      serviceFamily: strOr(s.serviceFamily, "Other") || "Other",
      serviceName: s.serviceName as string,
      slug: s.slug as string,
      regions: Array.isArray(s.regions) ? s.regions.filter((r): r is string => typeof r === "string") : [],
      rowCount: numOr(s.rowCount, 0),
      hasSpot: s.hasSpot === true,
      ...(typeof s.productCount === "number" ? { productCount: s.productCount } : {}),
    }));
}

export function parseRegions(raw: unknown): RegionInfo[] {
  if (!Array.isArray(raw)) throw new Error("The region index is invalid (expected a list).");
  return raw
    .filter((r): r is Record<string, unknown> => isObj(r) && typeof r.key === "string")
    .map((r) => {
      const key = r.key as string;
      const armRegionName = strOr(r.armRegionName, key);
      const location = strOr(r.location, "");
      return {
        key,
        armRegionName,
        location,
        displayName: strOr(r.displayName, "") || (key === GLOBAL_REGION ? GLOBAL_REGION_NAME : location || armRegionName),
        geography: strOr(r.geography, "") || "Other",
        rowCount: numOr(r.rowCount, 0),
      };
    });
}

export function parseVmSpecs(raw: unknown): VmSpecs {
  const skus = isObj(raw) && isObj(raw.skus) ? raw.skus : {};
  const out: VmSpecs = {};
  for (const [sku, spec] of Object.entries(skus)) {
    if (isObj(spec) && typeof spec.vCPUs === "number" && typeof spec.memoryGB === "number") {
      const v: VmSpec = { vCPUs: spec.vCPUs, memoryGB: spec.memoryGB };
      if (typeof spec.family === "string") v.family = spec.family;
      out[sku] = v;
    } else {
      out[sku] = null;
    }
  }
  return out;
}

/** FX table with upper-case codes, valid positive rates only, USD always 1. */
export function parseFx(raw: unknown, fallbackAsOf: string): FxTable {
  const rates: Record<string, number> = { USD: 1 };
  const src = isObj(raw) && isObj(raw.rates) ? raw.rates : {};
  for (const [code, rate] of Object.entries(src)) {
    const c = code.trim().toUpperCase();
    if (/^[A-Z]{3}$/.test(c) && c !== "USD" && typeof rate === "number" && Number.isFinite(rate) && rate > 0) rates[c] = rate;
  }
  return { asOf: isObj(raw) && typeof raw.asOf === "string" ? raw.asOf : fallbackAsOf, base: "USD", rates };
}

/** Fetches data/manifest.json bypassing every cache (no-store + ?t=now) and validates it. */
export async function loadManifest(): Promise<Manifest> {
  const raw = await fetchJson(`${dataUrl("manifest.json")}?t=${Date.now()}`, "the price manifest", { cache: "no-store" });
  return parseManifest(raw);
}

let catalogPromise: Promise<Catalog> | null = null;
let purgedFor: string | null = null;

/** Removes IndexedDB entries (`${date}/…`) of every other snapshot date. Best effort. */
async function purgeOtherDates(pricesDate: string): Promise<void> {
  if (purgedFor === pricesDate) return;
  purgedFor = pricesDate;
  try {
    const stale = (await idbKeys()).filter((k) => !k.startsWith(`${pricesDate}/`));
    await idbDeleteMany(stale);
  } catch {
    // Cache cleanup must never break the app.
  }
}

async function fetchCatalog(): Promise<Catalog> {
  const manifest = await loadManifest();
  const p = manifest.paths;
  const optional = (what: string) => (e: unknown) => {
    console.warn(`[azcalc] ${what} unavailable: ${message(e)}`);
    return null;
  };
  const [services, regions, shardIndex, vmSkus, fx] = await Promise.all([
    fetchJson(dataUrl(p.services), "the service index"),
    fetchJson(dataUrl(p.regions), "the region index"),
    p.shards ? fetchJson(dataUrl(p.shards), "the shard index") : Promise.resolve(manifest.shards ?? {}),
    fetchJson(dataUrl(p.vmSkus), "VM specs").catch(optional("VM specs")),
    fetchJson(dataUrl(p.fx), "exchange rates").catch(optional("Exchange rates")),
  ]);
  void purgeOtherDates(manifest.pricesDate);
  return {
    manifest,
    services: parseServices(services),
    regions: parseRegions(regions),
    vmSpecs: parseVmSpecs(vmSkus),
    fx: parseFx(fx, manifest.pricesDate),
    shards: parseShardIndex(shardIndex),
  };
}

/**
 * The catalog (manifest + indexes), loaded once per page and cached in memory. A failed load is
 * not cached (the next call retries). The shard map comes from paths.shards (falls back to the
 * legacy manifest.shards). VM specs and FX are optional (empty / USD-only on failure).
 */
export function loadCatalog(): Promise<Catalog> {
  if (!catalogPromise) {
    const p = fetchCatalog();
    catalogPromise = p;
    p.catch(() => {
      if (catalogPromise === p) catalogPromise = null;
    });
  }
  return catalogPromise;
}

/** Forgets the in-memory catalog so the next loadCatalog() refetches (retry / refresh). */
export function clearCatalogCache(): void {
  catalogPromise = null;
}

/** True when the published manifest has a different pricesDate than `catalog` (new snapshot). */
export async function hasNewerSnapshot(catalog: Catalog): Promise<boolean> {
  try {
    return (await loadManifest()).pricesDate !== catalog.manifest.pricesDate;
  } catch {
    return false;
  }
}

interface CatalogIndex {
  services: Map<string, ServiceInfo>;
  regions: Map<string, RegionInfo>;
}
const indexes = new WeakMap<Catalog, CatalogIndex>();

function indexOf(catalog: Catalog): CatalogIndex {
  let idx = indexes.get(catalog);
  if (!idx) {
    idx = { services: new Map(), regions: new Map() };
    for (const s of catalog.services) if (!idx.services.has(s.serviceName)) idx.services.set(s.serviceName, s);
    for (const r of catalog.regions) {
      if (!idx.regions.has(r.key)) idx.regions.set(r.key, r);
      if (!idx.regions.has(r.armRegionName)) idx.regions.set(r.armRegionName, r);
    }
    indexes.set(catalog, idx);
  }
  return idx;
}

/** Exact serviceName lookup in services.json. */
export function serviceByName(catalog: Catalog, serviceName: string): ServiceInfo | undefined {
  return indexOf(catalog).services.get(serviceName);
}

/** Region by key or armRegionName. */
export function regionByKey(catalog: Catalog, key: string): RegionInfo | undefined {
  return indexOf(catalog).regions.get(key);
}

/** Display name of a region ("West Europe"); falls back to the key. Works without a catalog. */
export function regionName(catalog: Catalog | undefined, key: string): string {
  if (!key) return "";
  const found = catalog ? regionByKey(catalog, key) : undefined;
  if (found?.displayName) return found.displayName;
  return key === GLOBAL_REGION ? GLOBAL_REGION_NAME : key;
}

/** Slug (shard folder) of an exact serviceName, or undefined when the service is not published. */
export function slugFor(catalog: Catalog, serviceName: string): string | undefined {
  return serviceByName(catalog, serviceName)?.slug;
}

/** slugify() of docs/data-contract.md: lowercase, & → and, non [a-z0-9] runs → "-", trimmed. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Shard region key of an armRegionName ("" or "_global" → "_global"). */
export function regionKeyFor(armRegionName: string): string {
  if (!armRegionName || armRegionName === GLOBAL_REGION) return GLOBAL_REGION;
  return slugify(armRegionName) || GLOBAL_REGION;
}

/** Whole days between the snapshot date and `now` (UTC). NaN for an invalid date. */
export function snapshotAgeDays(pricesDate: string, now: Date = new Date()): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(pricesDate ?? "");
  if (!m) return Number.NaN;
  const snap = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((today - snap) / 86_400_000);
}

/** True when the snapshot is more than `days` days old (banner). Invalid dates are not stale. */
export function isStale(pricesDate: string, now: Date = new Date(), days = 3): boolean {
  const age = snapshotAgeDays(pricesDate, now);
  return Number.isFinite(age) && age > days;
}
