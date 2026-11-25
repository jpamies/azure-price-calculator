// SQL Server license-included pricing for VMs ("Virtual Machines Licenses", usually global rows).
// Verified naming: productName "SQL Server Standard|Enterprise|Web", skuName "1-4 vCPU VM",
// meterName "1-4 vCPU VM License", unit "1 Hour" = price per VM-hour for up to 4 vCPUs; above 4
// vCPUs the charge is linear per vCPU (8 vCPUs = 2 × the 1-4 vCPU rate). See docs/dev/pricing-api.md.
import { HOURS_PER_MONTH, sqlLicenseConfigSchema } from "../model.ts";
import type { SqlLicenseConfig } from "../model.ts";
import type { Line, PriceRow, PricingContext, PricingModule, ServiceInfo, ShardRef } from "../types.ts";
import { isType, pickEffective, todayIso } from "../effective.ts";
import { SERVICE_MATCHERS, findServices, serviceByName, serviceHasRegion } from "../serviceMatch.ts";
import { monthlyFactor, parseUnit } from "../units.ts";
import { finalize, fmtNum, incomplete, makeLine, nounFor, plural, regionLabel, rowsFor, unavailable } from "./result.ts";

export type SqlEdition = SqlLicenseConfig["edition"];

export const SQL_EDITION_LABELS: Readonly<Record<SqlEdition, string>> = {
  standard: "Standard",
  enterprise: "Enterprise",
  web: "Web",
};

/** SQL Server is billed for at least 4 vCPUs per VM. */
export const SQL_MIN_VCPUS = 4;

const EDITION_RE: Record<SqlEdition, RegExp> = {
  standard: /\bsql server\b.*\bstandard\b/i,
  enterprise: /\bsql server\b.*\benterprise\b/i,
  web: /\bsql server\b.*\bweb\b/i,
};
const EXCLUDED_EDITION = /developer|express|evaluation|free/i;
const LINUX_PRODUCT = /linux|rhel|red hat|suse|sles|ubuntu/i;

export interface SqlLicenseMeter {
  row: PriceRow;
  /** "vm": price per VM-hour for VMs with min..max vCPUs; "core": price per `max` vCPUs (pack). */
  kind: "vm" | "core";
  min: number;
  max: number;
}

export interface SqlLicenseResolution {
  meter: SqlLicenseMeter;
  /** vCPUs billed per VM: max(4, vCPUs). */
  billableVcpus: number;
  /** Multiplier on the meter price: 1 (exact/range), billable / upper bound (linear), billable / pack (per-core). */
  scale: number;
  method: "exact" | "range" | "linear" | "per-core";
}

/**
 * Parse a license meter from skuName + meterName: "1-4 vCPU VM" → vm 1..4; "8 vCPU VM" → vm 8..8;
 * "1 vCPU" / "2 Core Pack" → core pack of 1 / 2; bare "Core"/"vCPU" → core pack of 1. null = other.
 */
export function parseSqlLicenseMeter(row: PriceRow): SqlLicenseMeter | null {
  const text = `${row.skuName} ${row.meterName}`;
  const range = /(\d+)\s*-\s*(\d+)\s*v?(?:cpus?|cores?)\b/i.exec(text);
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    if (!(b > 0)) return null;
    return { row, kind: "vm", min: Math.min(a, b), max: Math.max(a, b) };
  }
  const single = /(\d+)\s*v?(?:cpus?|cores?)\b/i.exec(text);
  if (single) {
    const n = Number(single[1]);
    if (!(n > 0)) return null;
    return { row, kind: /\bvm\b/i.test(text) ? "vm" : "core", min: n, max: n };
  }
  if (/\bv?(?:cpus?|cores?)\b/i.test(text)) return { row, kind: "core", min: 1, max: 1 };
  return null;
}

/** Edition rows grouped by product, preferred first (no Linux/RHEL/SUSE/Ubuntu, then shortest name). */
function editionProducts(rows: readonly PriceRow[], edition: SqlEdition): PriceRow[][] {
  const re = EDITION_RE[edition];
  const groups = new Map<string, PriceRow[]>();
  for (const r of rows) {
    if (!isType(r, "Consumption") || !re.test(r.productName) || EXCLUDED_EDITION.test(r.productName)) continue;
    const g = groups.get(r.productName);
    if (g) g.push(r);
    else groups.set(r.productName, [r]);
  }
  return [...groups.entries()]
    .sort(
      ([a], [b]) =>
        Number(LINUX_PRODUCT.test(a)) - Number(LINUX_PRODUCT.test(b)) || a.length - b.length || a.localeCompare(b),
    )
    .map(([, g]) => g);
}

function effectiveMeters(rows: readonly PriceRow[], today: string): SqlLicenseMeter[] {
  const groups = new Map<string, SqlLicenseMeter[]>();
  for (const r of rows) {
    const m = parseSqlLicenseMeter(r);
    if (!m) continue;
    const key = `${m.kind}:${m.min}-${m.max}`;
    const g = groups.get(key);
    if (g) g.push(m);
    else groups.set(key, [m]);
  }
  const out: SqlLicenseMeter[] = [];
  for (const g of groups.values()) {
    const minTier = Math.min(...g.map((m) => m.row.tierMinimumUnits));
    const base = g.filter((m) => m.row.tierMinimumUnits === minTier);
    const row = pickEffective(
      base.map((m) => m.row),
      today,
    );
    const picked = base.find((m) => m.row === row);
    if (picked) out.push(picked);
  }
  return out;
}

/**
 * Resolver: billable = max(4, vCPUs); then (1) exact single-count VM meter; (2) narrowest VM range
 * covering billable; (3) linear from the VM meter with the largest upper bound U <= billable
 * (else the smallest U): price × billable / U; (4) per-core meter: price × billable / pack size.
 */
export function chooseSqlLicenseMeter(meters: readonly SqlLicenseMeter[], vCPUs: number): SqlLicenseResolution | null {
  const billable = Math.max(SQL_MIN_VCPUS, Math.ceil(vCPUs));
  const vms = meters.filter((m) => m.kind === "vm");
  const exact = vms.find((m) => m.min === m.max && m.max === billable);
  if (exact) return { meter: exact, billableVcpus: billable, scale: 1, method: "exact" };
  const covering = vms
    .filter((m) => m.min <= billable && billable <= m.max)
    .sort((a, b) => a.max - a.min - (b.max - b.min))[0];
  if (covering) return { meter: covering, billableVcpus: billable, scale: 1, method: "range" };
  if (vms.length > 0) {
    const below = vms.filter((m) => m.max <= billable).sort((a, b) => b.max - a.max)[0];
    const basis = below ?? [...vms].sort((a, b) => a.max - b.max)[0];
    return { meter: basis, billableVcpus: billable, scale: billable / basis.max, method: "linear" };
  }
  const core = meters.filter((m) => m.kind === "core").sort((a, b) => a.max - b.max)[0];
  if (core) return { meter: core, billableVcpus: billable, scale: billable / core.max, method: "per-core" };
  return null;
}

/** Resolve the license meter of an edition from one shard's rows (null = no usable meter). */
export function resolveSqlLicense(
  rows: readonly PriceRow[],
  edition: SqlEdition,
  vCPUs: number,
  today: string = todayIso(),
): SqlLicenseResolution | null {
  for (const product of editionProducts(rows, edition)) {
    const meters = effectiveMeters(product, today);
    if (meters.length > 0) return chooseSqlLicenseMeter(meters, vCPUs);
  }
  return null;
}

/** License services to read, best first (exact "Virtual Machines Licenses", else /licen[cs]e/i, max 3). */
export function sqlLicenseServiceNames(services: readonly ServiceInfo[]): string[] {
  const m = SERVICE_MATCHERS.sqlLicense;
  if (services.length === 0) return [m.names[0]];
  return findServices(services, m.names, m.fallback, m.prefer)
    .slice(0, 3)
    .map((s) => s.serviceName);
}

function methodNote(res: SqlLicenseResolution): string {
  const sku = res.meter.row.skuName || res.meter.row.meterName;
  switch (res.method) {
    case "exact":
      return `"${sku}" rate (exact match for ${res.billableVcpus} vCPUs).`;
    case "range":
      return `Rate for VMs with ${res.meter.min}-${res.meter.max} vCPUs.`;
    case "linear":
      return `${res.billableVcpus} vCPUs = ${fmtNum(res.scale, 4)} × the "${sku}" rate (linear per vCPU).`;
    case "per-core":
      return `${res.billableVcpus} vCPUs × the per-${res.meter.max === 1 ? "vCPU" : `${res.meter.max}-vCPU`} rate ("${sku}").`;
  }
}

function computeSql(config: SqlLicenseConfig, ctx: PricingContext) {
  if (!ctx.region) return incomplete("Choose a region.");
  const edition = SQL_EDITION_LABELS[config.edition];
  const hours = config.hoursPerMonth;
  const vms = config.vms;
  const billable = Math.max(SQL_MIN_VCPUS, Math.ceil(config.vCPUs));

  let res: SqlLicenseResolution | null = null;
  for (const serviceName of sqlLicenseServiceNames(ctx.services)) {
    const regional = ctx.region === "_global" ? [] : rowsFor(ctx, { serviceName, regionKey: ctx.region });
    res = resolveSqlLicense(regional, config.edition, config.vCPUs) ??
      resolveSqlLicense(rowsFor(ctx, { serviceName, regionKey: "_global" }), config.edition, config.vCPUs);
    if (res) break;
  }

  const assumptions = ["The SQL Server license excludes the VM itself; add a Virtual Machines item for compute."];
  if (config.vCPUs < SQL_MIN_VCPUS) {
    assumptions.push(`SQL Server ${edition}: ${plural(config.vCPUs, "vCPU")} billed as ${SQL_MIN_VCPUS} (minimum per VM).`);
  }

  if (config.ahb) {
    const notes = ["Covered by Azure Hybrid Benefit (SQL Server licenses with Software Assurance or subscriptions)."];
    if (res) notes.push(`License-included price not charged. ${methodNote(res)}`);
    const line = makeLine({
      id: "sql-license",
      meterId: res?.meter.row.meterId,
      label: `SQL Server ${edition} license (Azure Hybrid Benefit)`,
      detail: `${billable} vCPUs per VM`,
      unit: nounFor(hours * vms, "hour"),
      quantity: hours * vms,
      unitPriceUsd: 0,
      kind: "license",
      commitment: "payg",
      notes,
    });
    return finalize([line], [], assumptions);
  }

  if (!res) {
    return unavailable(`The SQL Server ${edition} license price is not available in ${regionLabel(ctx)} or in the global price list.`);
  }
  const row = res.meter.row;
  const unit = parseUnit(row.unitOfMeasure);
  if (res.method === "linear" || res.method === "per-core") assumptions.push(`SQL Server ${edition}: ${methodNote(res)}`);
  const common = {
    id: "sql-license",
    meterId: row.meterId,
    label: `SQL Server ${edition} license`,
    detail: `${billable} vCPUs per VM · ${row.productName} · ${row.skuName || row.meterName}`,
    kind: "license" as const,
    commitment: "payg" as const,
    notes: [methodNote(res)],
    effectiveStartDate: row.effectiveStartDate,
  };
  let line: Line;
  if (unit.per === "hour" || row.unitOfMeasure.trim() === "") {
    line = makeLine({
      ...common,
      unit: nounFor(hours * vms, "hour"),
      quantity: hours * vms,
      unitPriceUsd: (row.retailPrice / unit.packSize) * res.scale,
    });
  } else {
    line = makeLine({
      ...common,
      unit: nounFor(vms, "VM"),
      quantity: vms,
      unitPriceUsd: row.retailPrice * res.scale * monthlyFactor(unit, hours),
    });
  }
  return finalize([line], [], assumptions);
}

export const sqlLicenseModule: PricingModule<SqlLicenseConfig> = {
  id: "sqlLicense",
  title: "SQL Server license (on VMs)",
  description: "License-included SQL Server Standard, Enterprise or Web for virtual machines, billed per vCPU-hour.",
  category: "Databases",
  iconKey: "sql-server",
  configSchema: sqlLicenseConfigSchema,
  defaultConfig(settings) {
    return sqlLicenseConfigSchema.parse({ hoursPerMonth: settings.hoursPerMonth });
  },
  shards(_config, region, services): ShardRef[] {
    if (!region) return [];
    const refs: ShardRef[] = [];
    for (const serviceName of sqlLicenseServiceNames(services)) {
      const svc = serviceByName(services, serviceName);
      if (region !== "_global" && serviceHasRegion(svc, region)) refs.push({ serviceName, regionKey: region });
      if (serviceHasRegion(svc, "_global")) refs.push({ serviceName, regionKey: "_global" });
    }
    return refs;
  },
  compute: computeSql,
  summarize(config) {
    const parts = [
      `${plural(config.vms, "VM")} × ${plural(config.vCPUs, "vCPU")}`,
      `SQL Server ${SQL_EDITION_LABELS[config.edition]}`,
    ];
    if (config.ahb) parts.push("AHB");
    if (config.hoursPerMonth !== HOURS_PER_MONTH) parts.push(`${fmtNum(config.hoursPerMonth)} h/month`);
    return parts.join(" · ");
  },
};
