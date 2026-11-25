// Versioned persisted data model (zod 4). Source of truth for Estimate / Item / Settings shapes.
// Every field has a default so that parsing partial/older JSON (imports, share links, migrations)
// yields a complete object.
import { z } from "zod";

export const SCHEMA_VERSION = 1;
export const HOURS_PER_MONTH = 730;
export const MAX_HOURS_PER_MONTH = 744;

export const moduleIdSchema = z.enum(["vm", "disks", "backup", "asr", "sqlLicense", "generic"]);
export type ModuleId = z.infer<typeof moduleIdSchema>;

export const commitmentSchema = z.enum(["payg", "ri1y", "ri3y", "sp1y", "sp3y"]);
export type CommitmentId = z.infer<typeof commitmentSchema>;

const count = (def: number) => z.number().int().min(0).max(1_000_000).default(def);
const hours = () => z.number().min(0).max(MAX_HOURS_PER_MONTH).default(HOURS_PER_MONTH);

export const vmConfigSchema = z.object({
  /** windows-ahb = Windows with Azure Hybrid Benefit (priced as Linux + informational line). */
  os: z.enum(["linux", "windows", "windows-ahb"]).default("windows"),
  /** e.g. "Standard_D8as_v5"; "" = not chosen yet. */
  armSkuName: z.string().default("Standard_D2s_v5"),
  instances: count(1),
  hoursPerMonth: hours(),
  commitment: commitmentSchema.default("payg"),
  /** Reservations only: pay the term upfront (one-time) or monthly. */
  riPayment: z.enum(["monthly", "upfront"]).default("monthly"),
  /** Price with Spot instead of regular PAYG (only with commitment = payg). */
  spot: z.boolean().default(false),
});
export type VmConfig = z.infer<typeof vmConfigSchema>;

export const diskTypeSchema = z.enum(["standard-hdd", "standard-ssd", "premium-ssd", "premium-ssd-v2", "ultra"]);
export type DiskType = z.infer<typeof diskTypeSchema>;

export const disksConfigSchema = z.object({
  diskType: diskTypeSchema.default("premium-ssd"),
  /** size = pick the smallest tier >= sizeGB; tier = use `tier` directly. (v2/Ultra always use sizeGB.) */
  sizingMode: z.enum(["size", "tier"]).default("tier"),
  sizeGB: z.number().min(1).max(65536).default(128),
  /** e.g. "P30", "E15", "S10". */
  tier: z.string().default("P10"),
  redundancy: z.enum(["LRS", "ZRS"]).default("LRS"),
  disks: count(1),
  /** Premium SSD v2 / Ultra only. */
  iops: z.number().min(0).max(400_000).default(3000),
  /** Premium SSD v2 / Ultra only (MB/s). */
  throughputMBps: z.number().min(0).max(10_000).default(125),
});
export type DisksConfig = z.infer<typeof disksConfigSchema>;

export const backupConfigSchema = z.object({
  workload: z.enum(["azure-vm", "sql-in-azure-vm"]).default("azure-vm"),
  instances: count(1),
  /** Average protected size per instance (GB); drives the protected-instance fee band. */
  avgInstanceSizeGB: z.number().min(0).max(1_000_000).default(200),
  /** percent = backup storage is storagePercent % of protected data; gb = storageGB total. */
  storageMode: z.enum(["percent", "gb"]).default("percent"),
  storagePercent: z.number().min(0).max(10_000).default(100),
  storageGB: z.number().min(0).max(100_000_000).default(200),
  redundancy: z.enum(["LRS", "ZRS", "GRS", "RA-GRS"]).default("GRS"),
});
export type BackupConfig = z.infer<typeof backupConfigSchema>;

export const asrConfigSchema = z.object({
  scenario: z.enum(["azure-to-azure", "onprem-to-azure", "onprem-to-onprem"]).default("azure-to-azure"),
  instances: count(1),
});
export type AsrConfig = z.infer<typeof asrConfigSchema>;

export const sqlLicenseConfigSchema = z.object({
  edition: z.enum(["standard", "enterprise", "web"]).default("standard"),
  /** vCPUs per VM; Azure charges SQL Server per vCPU with a 4-vCPU minimum per VM. */
  vCPUs: z.number().int().min(1).max(1024).default(4),
  vms: count(1),
  hoursPerMonth: hours(),
  /** Azure Hybrid Benefit: license covered by existing Software Assurance (priced at 0). */
  ahb: z.boolean().default(false),
});
export type SqlLicenseConfig = z.infer<typeof sqlLicenseConfigSchema>;

export const genericConfigSchema = z.object({
  /** Exact serviceName from services.json; "" = not chosen. */
  serviceName: z.string().default(""),
  /** true = use the "_global" shard (meters without a region) instead of the item region. */
  useGlobalRegion: z.boolean().default(false),
  /** "" = not chosen. Together with type/reservationTerm identifies the meter. */
  meterId: z.string().default(""),
  type: z.string().default("Consumption"),
  reservationTerm: z.string().default(""),
  /** Display copies so the item can be shown before prices load. */
  productName: z.string().default(""),
  skuName: z.string().default(""),
  meterName: z.string().default(""),
  unitOfMeasure: z.string().default(""),
  /** Usage per month in the meter's unit; for hourly meters = number of instances. */
  quantity: z.number().min(0).max(1e12).default(1),
  /** Hourly meters only. */
  hoursPerMonth: hours(),
});
export type GenericConfig = z.infer<typeof genericConfigSchema>;

const itemBase = {
  id: z.string().min(1),
  name: z.string().default(""),
  /** armRegionName (e.g. "westeurope"); "" = not chosen. */
  region: z.string().default(""),
  collapsed: z.boolean().default(false),
  notes: z.string().optional(),
  /** Phase 2 (inventory import) hooks. */
  source: z.object({ type: z.enum(["manual", "import"]), ref: z.string().optional() }).optional(),
  tags: z.array(z.string()).optional(),
};

export const itemSchema = z.discriminatedUnion("moduleId", [
  z.object({ ...itemBase, moduleId: z.literal("vm"), config: vmConfigSchema }),
  z.object({ ...itemBase, moduleId: z.literal("disks"), config: disksConfigSchema }),
  z.object({ ...itemBase, moduleId: z.literal("backup"), config: backupConfigSchema }),
  z.object({ ...itemBase, moduleId: z.literal("asr"), config: asrConfigSchema }),
  z.object({ ...itemBase, moduleId: z.literal("sqlLicense"), config: sqlLicenseConfigSchema }),
  z.object({ ...itemBase, moduleId: z.literal("generic"), config: genericConfigSchema }),
]);
export type Item = z.infer<typeof itemSchema>;
export type ItemOf<M extends ModuleId> = Extract<Item, { moduleId: M }>;

/**
 * Last complete totals computed by the estimate editor (USD), shown on the estimates list.
 * A display cache only: never a price source, never shared, refreshed whenever the editor prices
 * every item. Stale when computedAt < estimate.updatedAt or pricesDate != the current snapshot.
 */
export const cachedTotalsSchema = z.object({
  monthlyUsd: z.number(),
  upfrontUsd: z.number(),
  amortizedMonthlyUsd: z.number(),
  /** Snapshot date the totals were computed with. */
  pricesDate: z.string(),
  /** ISO timestamp of the computation. */
  computedAt: z.string(),
});
export type CachedTotals = z.infer<typeof cachedTotalsSchema>;

export const estimateSchema = z.object({
  id: z.string().min(1),
  name: z.string().default("Untitled estimate"),
  /** Display currency code (USD, EUR, ...). */
  currency: z.string().default("USD"),
  items: z.array(itemSchema).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
  notes: z.string().optional(),
  /** Snapshot date the estimate was imported from (share link / JSON), informational. */
  pricesDate: z.string().optional(),
  /** Display cache written by the editor (see cachedTotalsSchema). */
  cachedTotals: cachedTotalsSchema.optional(),
});
export type Estimate = z.infer<typeof estimateSchema>;

export const settingsSchema = z.object({
  defaultCurrency: z.string().default("USD"),
  defaultRegion: z.string().default("westeurope"),
  hoursPerMonth: z.number().min(1).max(MAX_HOURS_PER_MONTH).default(HOURS_PER_MONTH),
  theme: z.enum(["light", "dark", "system"]).default("system"),
  /** Region of the last item the user configured (default for new items). */
  lastRegion: z.string().optional(),
});
export type Settings = z.infer<typeof settingsSchema>;

/** Persisted store state (localStorage key "azcalc.v1", zustand persist version = SCHEMA_VERSION). */
export const persistedStateSchema = z.object({
  estimates: z.array(estimateSchema).default([]),
  settings: settingsSchema.default(settingsSchema.parse({})),
});
export type PersistedState = z.infer<typeof persistedStateSchema>;
