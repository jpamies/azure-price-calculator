// Factories, duplication and lenient sanitizing for estimates/items/settings.
// Pure TypeScript (no DOM, no React, no import.meta.env) so it runs under `node --test`.
import type { ZodType } from "zod";
import {
  asrConfigSchema,
  backupConfigSchema,
  disksConfigSchema,
  estimateSchema,
  genericConfigSchema,
  itemSchema,
  moduleIdSchema,
  settingsSchema,
  sqlLicenseConfigSchema,
  vmConfigSchema,
} from "./model.ts";
import type { Estimate, Item, ItemOf, ModuleId, Settings } from "./model.ts";

/** Config schema of every module (from model.ts). */
export const CONFIG_SCHEMAS = {
  vm: vmConfigSchema,
  disks: disksConfigSchema,
  backup: backupConfigSchema,
  asr: asrConfigSchema,
  sqlLicense: sqlLicenseConfigSchema,
  generic: genericConfigSchema,
} as const;

/** Default item names (used when an item has no name of its own). */
export const DEFAULT_ITEM_NAMES: Record<ModuleId, string> = {
  vm: "Virtual machine",
  disks: "Managed disks",
  backup: "Backup",
  asr: "Site Recovery",
  sqlLicense: "SQL Server license",
  generic: "Custom meter",
};

export const DEFAULT_ESTIMATE_NAME = "Untitled estimate";
export const COPY_SUFFIX = " (copy)";

type Shape = Record<string, ZodType>;
type Warn = (message: string) => void;

/** Options shared by the sanitizers. */
export interface SanitizeOptions {
  /** Replace every id (estimate and items) with a fresh one (imports, share links). */
  freshIds?: boolean;
  /** Timestamp used for missing createdAt/updatedAt (default: now). */
  now?: string;
  /** Receives a human-readable message for every repaired field or dropped item. */
  onWarning?: Warn;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** RFC 4122 v4 id. crypto.randomUUID needs a secure context, so fall back to getRandomValues/Math.random. */
export function newId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === "function") {
    try {
      return c.randomUUID();
    } catch {
      // Fall through to the manual generator.
    }
  }
  const b = new Uint8Array(16);
  let filled = false;
  if (c && typeof c.getRandomValues === "function") {
    try {
      c.getRandomValues(b);
      filled = true;
    } catch {
      filled = false;
    }
  }
  if (!filled) for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Upper-cased ISO 4217-looking code; anything else becomes "USD". */
export function normalizeCurrencyCode(code: unknown): string {
  const c = typeof code === "string" ? code.trim().toUpperCase() : "";
  return /^[A-Z]{3}$/.test(c) ? c : "USD";
}

export function configShape(moduleId: ModuleId): Shape {
  return CONFIG_SCHEMAS[moduleId].shape as unknown as Shape;
}

/** The module config with every field at its schema default (hoursPerMonth = 730). */
export function configDefaults<M extends ModuleId>(moduleId: M): ItemOf<M>["config"] {
  return CONFIG_SCHEMAS[moduleId].parse({}) as ItemOf<M>["config"];
}

/** Display name of an item: its own name, or the module default name. */
export function itemDisplayName(item: Pick<Item, "name" | "moduleId">): string {
  return item.name.trim() || DEFAULT_ITEM_NAMES[item.moduleId];
}

/**
 * Parses `raw` field by field against `shape`: valid values are kept, invalid ones fall back to the
 * field default (optional fields without default are omitted), unknown keys are dropped.
 */
export function salvageObject(shape: Shape, raw: unknown, warn?: Warn, skip: readonly string[] = []): Record<string, unknown> {
  const src = isRecord(raw) ? raw : {};
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(shape)) {
    if (skip.includes(key)) continue;
    const field = shape[key];
    const value = src[key] === null ? undefined : src[key];
    let parsed = field.safeParse(value);
    if (!parsed.success && value !== undefined) {
      warn?.(`invalid value for "${key}" replaced by the default`);
      parsed = field.safeParse(undefined);
    }
    if (parsed.success && parsed.data !== undefined) out[key] = parsed.data;
  }
  return out;
}

const ITEM_VARIANTS = (itemSchema as unknown as { options: Array<{ shape: Shape }> }).options;

function itemShape(moduleId: ModuleId): Shape | undefined {
  return ITEM_VARIANTS.find((o) => o.shape.moduleId.safeParse(moduleId).success)?.shape;
}

function keepId(raw: unknown, fresh: boolean | undefined): string {
  return !fresh && typeof raw === "string" && raw.trim() !== "" ? raw : newId();
}

function validDate(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" && !Number.isNaN(Date.parse(value)) ? value : undefined;
}

/**
 * Lenient item parser. Returns undefined (drop) when the value is not an object or its moduleId is
 * unknown; invalid fields are repaired with their defaults.
 */
export function sanitizeItem(raw: unknown, opts: SanitizeOptions = {}): Item | undefined {
  if (!isRecord(raw)) return undefined;
  const mod = moduleIdSchema.safeParse(raw.moduleId);
  if (!mod.success) return undefined;
  const moduleId = mod.data;
  const shape = itemShape(moduleId);
  if (!shape) return undefined;
  const warn = opts.onWarning;
  const out = salvageObject(shape, raw, warn, ["id", "moduleId", "config"]);
  out.id = keepId(raw.id, opts.freshIds);
  out.moduleId = moduleId;
  out.config = salvageObject(configShape(moduleId), raw.config, warn ? (m) => warn(`config: ${m}`) : undefined);
  const parsed = itemSchema.safeParse(out);
  return parsed.success ? parsed.data : undefined;
}

function rawItemLabel(raw: unknown, index: number): string {
  const name = isRecord(raw) && typeof raw.name === "string" && raw.name.trim() ? ` "${raw.name.trim()}"` : "";
  return `item ${index + 1}${name}`;
}

/**
 * Validates any estimate-like value with estimateSchema defaults. Missing id/timestamps are
 * filled, invalid fields are repaired with defaults, invalid items are dropped (reported through
 * `onWarning`), duplicate item ids are replaced. Throws an Error when `raw` is not an object.
 */
export function sanitizeEstimate(raw: unknown, opts: SanitizeOptions = {}): Estimate {
  if (!isRecord(raw)) throw new Error("Invalid estimate: expected a JSON object.");
  const warn = opts.onWarning;
  const now = opts.now ?? nowIso();
  const shape = estimateSchema.shape as unknown as Shape;
  const base = salvageObject(shape, raw, warn, ["id", "items", "createdAt", "updatedAt"]);
  base.currency = normalizeCurrencyCode(base.currency);
  const createdAt = validDate(raw.createdAt) ?? now;
  const updatedAt = validDate(raw.updatedAt) ?? createdAt;
  if (raw.items !== undefined && !Array.isArray(raw.items)) warn?.("items is not a list and was ignored");
  const rawItems: unknown[] = Array.isArray(raw.items) ? raw.items : [];
  const items: Item[] = [];
  const seen = new Set<string>();
  rawItems.forEach((rawItem, index) => {
    const label = rawItemLabel(rawItem, index);
    const item = sanitizeItem(rawItem, { freshIds: opts.freshIds, onWarning: warn ? (m) => warn(`${label}: ${m}`) : undefined });
    if (!item) {
      warn?.(`${label} was dropped (unknown service or invalid data)`);
      return;
    }
    if (seen.has(item.id)) item.id = newId();
    seen.add(item.id);
    items.push(item);
  });
  const parsed = estimateSchema.safeParse({ ...base, id: keepId(raw.id, opts.freshIds), createdAt, updatedAt, items });
  if (!parsed.success) throw new Error(`Invalid estimate: ${parsed.error.issues[0]?.message ?? "unknown error"}.`);
  return parsed.data;
}

/** Lenient settings parser: invalid fields fall back to their defaults. */
export function sanitizeSettings(raw: unknown, warn?: Warn): Settings {
  const out = salvageObject(settingsSchema.shape as unknown as Shape, raw, warn ? (m) => warn(`settings: ${m}`) : undefined);
  out.defaultCurrency = normalizeCurrencyCode(out.defaultCurrency);
  return settingsSchema.parse(out);
}

export function newEstimate(settings: Pick<Settings, "defaultCurrency">, name?: string): Estimate {
  const now = nowIso();
  return {
    id: newId(),
    name: name?.trim() || DEFAULT_ESTIMATE_NAME,
    currency: normalizeCurrencyCode(settings.defaultCurrency),
    items: [],
    createdAt: now,
    updatedAt: now,
  };
}

export interface NewItemInit<M extends ModuleId> {
  region: string;
  settings: Pick<Settings, "hoursPerMonth">;
  name?: string;
  /** Overrides merged over the defaults; invalid values fall back to the defaults. */
  config?: Partial<ItemOf<M>["config"]>;
}

/**
 * New item with the module's default config. Schemas with an `hoursPerMonth` field start from
 * `settings.hoursPerMonth`; `config` overrides are merged on top.
 */
export function newItem<M extends ModuleId>(moduleId: M, init: NewItemInit<M>): ItemOf<M> {
  const shape = configShape(moduleId);
  const seed: Record<string, unknown> = {};
  if ("hoursPerMonth" in shape) seed.hoursPerMonth = init.settings.hoursPerMonth;
  const config = salvageObject(shape, { ...seed, ...(init.config ?? {}) });
  return itemSchema.parse({
    id: newId(),
    moduleId,
    name: init.name?.trim() || DEFAULT_ITEM_NAMES[moduleId],
    region: init.region,
    collapsed: false,
    config,
  }) as ItemOf<M>;
}

function withCopySuffix(name: string): string {
  return `${name}${COPY_SUFFIX}`;
}

/** Deep copy with fresh estimate/item ids, " (copy)" name suffix and new timestamps. */
export function duplicateEstimate(estimate: Estimate): Estimate {
  const now = nowIso();
  const copy = structuredClone(estimate);
  return {
    ...copy,
    id: newId(),
    name: withCopySuffix(estimate.name.trim() || DEFAULT_ESTIMATE_NAME),
    createdAt: now,
    updatedAt: now,
    items: copy.items.map((item) => ({ ...item, id: newId() })),
  };
}

/** Deep copy with a fresh id and " (copy)" name suffix. */
export function duplicateItem<I extends Item>(item: I): I {
  const copy = structuredClone(item);
  return { ...copy, id: newId(), name: withCopySuffix(itemDisplayName(item)) };
}
