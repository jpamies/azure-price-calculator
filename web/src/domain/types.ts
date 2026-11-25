// Shared domain types: the contract between domain/, data/, store/ and the UI.
// Pure TypeScript (no React, no DOM, no import.meta.env) so it runs under `node --test`.
// Imports between domain files MUST use relative paths with the `.ts` extension.
import type { ZodType } from "zod";
import type { CommitmentId, Item, ModuleId } from "./model.ts";

export type { CommitmentId, ModuleId } from "./model.ts";

/** One decoded price row from a shard. Prices in USD. See docs/data-contract.md. */
export interface PriceRow {
  meterId: string;
  meterName: string;
  productName: string;
  skuName: string;
  armSkuName: string;
  unitOfMeasure: string;
  /** "Consumption" | "Reservation" | "SavingsPlans" (DevTestConsumption is dropped by the pipeline). */
  type: string;
  /** "1 Year" | "3 Years" for Reservation/SavingsPlans, else "". */
  reservationTerm: string;
  tierMinimumUnits: number;
  /** USD. Reservation rows: TOTAL price for the whole term. SavingsPlans rows: hourly rate. */
  retailPrice: number;
  /** YYYY-MM-DD or "". */
  effectiveStartDate: string;
  isWindows: boolean;
}

/** Reference to one logical shard (all of its parts). Resolved to a file by the data layer. */
export interface ShardRef {
  /** Exact serviceName as listed in services.json. */
  serviceName: string;
  /** armRegionName, or "_global" for meters without a region. */
  regionKey: string;
  /** true = the Spot/Low Priority companion shard (<region>.spot.json). */
  spot?: boolean;
}

/** Stable key for a ShardRef; PricingContext.shards is keyed by this. */
export function refKey(ref: ShardRef): string {
  return `${ref.serviceName}|${ref.regionKey}|${ref.spot ? "spot" : "main"}`;
}

export interface ServiceInfo {
  serviceFamily: string;
  serviceName: string;
  slug: string;
  /** Region keys that have a main shard (may include "_global"). */
  regions: string[];
  rowCount: number;
  hasSpot: boolean;
  productCount?: number;
}

export interface RegionInfo {
  key: string;
  armRegionName: string;
  location: string;
  displayName: string;
  geography: string;
  rowCount: number;
}

export interface VmSpec {
  vCPUs: number;
  memoryGB: number;
  family?: string;
}
/** armSkuName -> specs (null = unknown). */
export type VmSpecs = Record<string, VmSpec | null>;

export interface FxTable {
  asOf: string;
  base: "USD";
  /** currency code -> units of that currency per 1 USD (USD = 1). */
  rates: Record<string, number>;
}

export interface ShardEntry {
  /** Main files: 0 = no main shard (Spot-only), 1 = <region>.json, N > 1 = <region>.part1..N.json. */
  parts: number;
  rows: number;
  bytes: number;
  spot: boolean;
  spotRows?: number;
}

/** serviceSlug -> regionKey -> entry. Published as index/shards.json (paths.shards). */
export type ShardIndex = Record<string, Record<string, ShardEntry>>;

export interface Manifest {
  schemaVersion: number;
  pricesDate: string;
  generatedAt: string;
  currencyBase: "USD";
  hasSavingsPlan: boolean;
  source: {
    type: "exporter" | "fixture";
    repo?: string;
    tag?: string;
    pricesUrl?: string;
    fxUrl?: string;
    pricesSha256?: string;
    fxSha256?: string;
    rowCount?: number;
  };
  paths: {
    root: string;
    services: string;
    regions: string;
    vmSkus: string;
    fx: string;
    prices: string;
    report?: string;
    /** "<DATE>/index/shards.json": the ShardIndex (current snapshots). */
    shards?: string;
  };
  /** Legacy snapshots only (before paths.shards): the ShardIndex inline. Use Catalog.shards. */
  shards?: ShardIndex;
  stats?: { rowsPublished: number; files: number; bytes: number; shardCount?: number };
}

/** Everything a pricing module needs to compute one item. Provided by the data layer/UI. */
export interface PricingContext {
  /** Item region (armRegionName). */
  region: string;
  /** Human name of the region for messages, e.g. "West Europe". */
  regionName: string;
  /** Rows for every ShardRef the module asked for, keyed by refKey(ref). Missing shard => []. */
  shards: Record<string, PriceRow[]>;
  services: ServiceInfo[];
  vmSpecs: VmSpecs;
  hasSavingsPlan: boolean;
}

export type LineKind = "compute" | "license" | "storage" | "backup" | "dr" | "network" | "other";

/** One priced line of an item. All money in USD; convert only for display. */
export interface Line {
  /** Stable within the item, e.g. "compute", "license", or a meterId. */
  id: string;
  meterId?: string;
  /** e.g. "D8as v5 compute (Linux)". */
  label: string;
  /** Secondary text, e.g. product / meter name. */
  detail?: string;
  /** Display unit of `quantity`, e.g. "hours", "GB/month", "disks", "instances". */
  unit: string;
  /** Billable quantity per month in `unit` (for reservations: number of reserved instances). */
  quantity: number;
  /** USD per `unit` (for reservations: total term price per instance). */
  unitPriceUsd: number;
  /** Recurring charge per month (USD). */
  monthlyUsd: number;
  /** One-time charge (USD), e.g. a reservation paid upfront. */
  upfrontUsd: number;
  /** monthlyUsd + upfront spread over its term. Equals monthlyUsd when there is no upfront. */
  amortizedMonthlyUsd: number;
  kind: LineKind;
  commitment?: CommitmentId;
  termMonths?: number;
  notes: string[];
  effectiveStartDate?: string;
}

export type ItemStatus = "ok" | "incomplete" | "unavailable";

export interface ItemMessage {
  level: "info" | "warning" | "error";
  text: string;
}

export interface ItemResult {
  /** ok = priced; incomplete = config not finished (e.g. no SKU chosen); unavailable = no matching price. */
  status: ItemStatus;
  lines: Line[];
  messages: ItemMessage[];
  monthlyUsd: number;
  upfrontUsd: number;
  amortizedMonthlyUsd: number;
  /** Item-specific assumption sentences (English), merged into the estimate Assumptions. */
  assumptions: string[];
}

/** A service module ("rich" calculator for one Azure service). Implemented in domain/pricing/. */
export interface PricingModule<C> {
  id: ModuleId;
  /** e.g. "Virtual Machines". */
  title: string;
  /** One sentence for the catalog. */
  description: string;
  /** Catalog category, e.g. "Compute", "Storage", "Management and Governance", "Other". */
  category: string;
  /** Key into web/src/catalog/icon-map.ts. */
  iconKey: string;
  configSchema: ZodType<C>;
  defaultConfig(settings: { hoursPerMonth: number }): C;
  /** Shards needed to configure and price this item in `region`. */
  shards(config: C, region: string, services: ServiceInfo[]): ShardRef[];
  compute(config: C, ctx: PricingContext): ItemResult;
  /** One-line summary for collapsed cards and exports, e.g. "2 × D8as v5 · Windows · RI 3Y". */
  summarize(config: C): string;
}

/** Narrow helper used by the UI: the config type of an item. */
export type ItemConfig<I extends Item> = I["config"];
