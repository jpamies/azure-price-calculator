// Module registry + item-level entry points used by the store/UI.
import type { Item, ItemOf, ModuleId } from "../model.ts";
import type { ItemResult, PricingContext, PricingModule, ServiceInfo, ShardRef } from "../types.ts";
import { asrModule } from "./asr.ts";
import { backupModule } from "./backup.ts";
import { disksModule } from "./disks.ts";
import { genericModule } from "./generic.ts";
import { incomplete, unavailable } from "./result.ts";
import { sqlLicenseModule } from "./sqlLicense.ts";
import { vmModule } from "./vm.ts";

export type ModuleMap = { [K in ModuleId]: PricingModule<ItemOf<K>["config"]> };
export type AnyPricingModule = ModuleMap[ModuleId];

export const modules: ModuleMap = {
  vm: vmModule,
  disks: disksModule,
  backup: backupModule,
  asr: asrModule,
  sqlLicense: sqlLicenseModule,
  generic: genericModule,
};

/** Catalog order. */
export const moduleList: readonly AnyPricingModule[] = [
  vmModule,
  disksModule,
  backupModule,
  asrModule,
  sqlLicenseModule,
  genericModule,
];

export function getModule<K extends ModuleId>(id: K): ModuleMap[K] {
  return modules[id];
}

function moduleOf(item: Item): PricingModule<Item["config"]> {
  const mod = (modules as Partial<Record<string, AnyPricingModule>>)[item?.moduleId];
  if (!mod) throw new Error(`Unknown module "${String(item?.moduleId)}"`);
  return mod as unknown as PricingModule<Item["config"]>;
}

function parseConfig(item: Item): { ok: true; config: Item["config"] } | { ok: false; error: string } {
  if (!(modules as Partial<Record<string, AnyPricingModule>>)[item?.moduleId]) {
    return { ok: false, error: `unknown module "${String(item?.moduleId)}"` };
  }
  const parsed = moduleOf(item).configSchema.safeParse(item.config);
  if (parsed.success) return { ok: true, config: parsed.data };
  const issue = parsed.error.issues[0];
  const where = issue?.path?.length ? `${issue.path.join(".")}: ` : "";
  return { ok: false, error: `${where}${issue?.message ?? "invalid value"}` };
}

/** Shards the item needs in its own region (item.region). [] when nothing can be loaded yet. */
export function shardsForItem(item: Item, services: ServiceInfo[]): ShardRef[] {
  const parsed = parseConfig(item);
  if (!parsed.ok) return [];
  try {
    return moduleOf(item).shards(parsed.config, item.region, services);
  } catch {
    return [];
  }
}

/**
 * Price one item. `ctx.region`/`ctx.regionName` must describe item.region and `ctx.shards` must hold
 * the rows of shardsForItem(item). Never throws: invalid config → "incomplete", errors → "unavailable".
 */
export function computeItem(item: Item, ctx: PricingContext): ItemResult {
  const parsed = parseConfig(item);
  if (!parsed.ok) return incomplete(`Invalid configuration (${parsed.error}).`);
  try {
    return moduleOf(item).compute(parsed.config, ctx);
  } catch (err) {
    return unavailable(`Pricing failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** One-line summary for collapsed cards and exports, e.g. "2 × D8as v5 · Windows · RI 3Y". */
export function summarizeItem(item: Item): string {
  const title = (modules as Partial<Record<string, AnyPricingModule>>)[item?.moduleId]?.title ?? "Unknown item";
  const parsed = parseConfig(item);
  if (!parsed.ok) return title;
  try {
    return moduleOf(item).summarize(parsed.config);
  } catch {
    return title;
  }
}

export { asrModule, backupModule, disksModule, genericModule, sqlLicenseModule, vmModule };
