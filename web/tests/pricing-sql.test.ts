import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { sqlLicenseConfigSchema } from "../src/domain/model.ts";
import type { SqlLicenseConfig } from "../src/domain/model.ts";
import { refKey } from "../src/domain/types.ts";
import type { PriceRow, PricingContext, ServiceInfo } from "../src/domain/types.ts";
import {
  chooseSqlLicenseMeter,
  parseSqlLicenseMeter,
  resolveSqlLicense,
  sqlLicenseModule,
} from "../src/domain/pricing/sqlLicense.ts";

const near = (actual: number, expected: number, eps = 1e-6) =>
  assert.ok(Math.abs(actual - expected) < eps, `${actual} != ${expected}`);

const SERVICE = "Virtual Machines Licenses";

function lic(productName: string, skuName: string, retailPrice: number, p: Partial<PriceRow> = {}): PriceRow {
  return {
    meterId: `id-${productName}-${skuName}`,
    meterName: `${skuName} License`,
    productName,
    skuName,
    armSkuName: "",
    unitOfMeasure: "1 Hour",
    type: "Consumption",
    reservationTerm: "",
    tierMinimumUnits: 0,
    retailPrice,
    effectiveStartDate: "2024-01-01",
    isWindows: false,
    ...p,
  };
}

// Real naming: only "1-4 vCPU VM" rows, global (no region).
const GLOBAL: PriceRow[] = [
  lic("SQL Server Developer", "1-4 vCPU VM", 0),
  lic("SQL Server Enterprise Linux", "1-4 vCPU VM", 1.2),
  lic("SQL Server Enterprise", "1-4 vCPU VM", 1.4, { effectiveStartDate: "2020-01-01" }),
  lic("SQL Server Enterprise", "1-4 vCPU VM", 1.5),
  lic("SQL Server Standard", "1-4 vCPU VM", 0.4),
  lic("SQL Server Web", "1-4 vCPU VM", 0.04),
];

const SERVICES: ServiceInfo[] = [
  { serviceFamily: "Compute", serviceName: SERVICE, slug: "virtual-machines-licenses", regions: ["_global"], rowCount: 6, hasSpot: false },
];

function ctx(shards: Record<string, PriceRow[]>, services: ServiceInfo[] = SERVICES): PricingContext {
  return { region: "westeurope", regionName: "West Europe", shards, services, vmSpecs: {}, hasSavingsPlan: true };
}
const globalCtx = (rows: PriceRow[] = GLOBAL) => ctx({ [refKey({ serviceName: SERVICE, regionKey: "_global" })]: rows });

const cfg = (p: Partial<SqlLicenseConfig>) => sqlLicenseConfigSchema.parse(p);
const price = (p: Partial<SqlLicenseConfig>, c = globalCtx()) => sqlLicenseModule.compute(cfg(p), c);

describe('"1-4 vCPU VM" (primary path)', () => {
  test("8 vCPU Enterprise at 1.50/h → 3.00/h → 2190/month", () => {
    const res = price({ edition: "enterprise", vCPUs: 8, vms: 1, hoursPerMonth: 730 });
    assert.equal(res.status, "ok");
    assert.equal(res.lines.length, 1);
    const [l] = res.lines;
    assert.equal(l.kind, "license");
    assert.equal(l.unit, "hours");
    assert.equal(l.quantity, 730);
    assert.ok(l.notes.some((n) => /2 × the "1-4 vCPU VM" rate/.test(n)));
    near(l.unitPriceUsd, 3);
    near(res.monthlyUsd, 2190);
    assert.equal(l.meterId, "id-SQL Server Enterprise-1-4 vCPU VM");
    assert.ok(res.assumptions.some((a) => /2 × the "1-4 vCPU VM" rate/.test(a)));
  });

  test("4 vCPU Standard = the range rate", () => {
    near(price({ edition: "standard", vCPUs: 4 }).monthlyUsd, 0.4 * 730);
  });

  test("below 4 vCPUs is billed as 4", () => {
    const res = price({ edition: "standard", vCPUs: 2, vms: 3 });
    near(res.monthlyUsd, 0.4 * 730 * 3);
    assert.ok(res.assumptions.some((a) => /2 vCPUs billed as 4/.test(a)));
    assert.ok(price({ vCPUs: 1 }).assumptions.some((a) => /: 1 vCPU billed as 4/.test(a)));
  });

  test("6 vCPUs = 1.5 × the rate (linear per vCPU)", () => {
    near(price({ edition: "enterprise", vCPUs: 6 }).lines[0].unitPriceUsd, 2.25);
  });

  test("Web edition; Linux and Developer products are avoided", () => {
    near(price({ edition: "web", vCPUs: 4 }).lines[0].unitPriceUsd, 0.04);
    near(price({ edition: "enterprise", vCPUs: 4 }).lines[0].unitPriceUsd, 1.5);
  });
});

describe("resolver variants", () => {
  test("exact single-count meter wins over linear scaling", () => {
    const rows = [...GLOBAL, lic("SQL Server Standard", "8 vCPU VM", 0.79)];
    near(price({ edition: "standard", vCPUs: 8 }, globalCtx(rows)).lines[0].unitPriceUsd, 0.79);
    near(price({ edition: "standard", vCPUs: 16 }, globalCtx(rows)).lines[0].unitPriceUsd, 0.79 * 2);
  });

  test("between single counts → linear from the largest count below", () => {
    const rows = [lic("SQL Server Standard", "4 vCPU VM", 0.4), lic("SQL Server Standard", "8 vCPU VM", 0.8)];
    const res = resolveSqlLicense(rows, "standard", 6);
    assert.equal(res?.method, "linear");
    assert.equal(res?.meter.max, 4);
    near(res?.scale ?? 0, 1.5);
  });

  test("covering range", () => {
    const rows = [lic("SQL Server Standard", "1-4 vCPU VM", 0.4), lic("SQL Server Standard", "5-8 vCPU VM", 0.8)];
    const res = resolveSqlLicense(rows, "standard", 6);
    assert.equal(res?.method, "range");
    assert.equal(res?.scale, 1);
    assert.equal(res?.meter.row.retailPrice, 0.8);
  });

  test("per-core meters × billable vCPUs (1 vCPU and 2-core packs)", () => {
    const perCore = [lic("SQL Server Enterprise", "1 vCPU", 0.375)];
    near(price({ edition: "enterprise", vCPUs: 6 }, globalCtx(perCore)).lines[0].unitPriceUsd, 2.25);
    near(price({ edition: "enterprise", vCPUs: 2 }, globalCtx(perCore)).lines[0].unitPriceUsd, 1.5);
    const packs = [lic("SQL Server Enterprise", "2 Core Pack", 0.75)];
    const res = resolveSqlLicense(packs, "enterprise", 8);
    assert.equal(res?.method, "per-core");
    near((res?.meter.row.retailPrice ?? 0) * (res?.scale ?? 0), 3);
  });

  test("parseSqlLicenseMeter", () => {
    const p = (sku: string, meter = `${sku} License`) => {
      const m = parseSqlLicenseMeter(lic("SQL Server Standard", sku, 1, { meterName: meter }));
      return m && [m.kind, m.min, m.max];
    };
    assert.deepEqual(p("1-4 vCPU VM"), ["vm", 1, 4]);
    assert.deepEqual(p("8 vCPU VM"), ["vm", 8, 8]);
    assert.deepEqual(p("1 vCPU"), ["core", 1, 1]);
    assert.deepEqual(p("2 Core Pack"), ["core", 2, 2]);
    assert.deepEqual(p("Standard", "Core License"), ["core", 1, 1]);
    assert.equal(p("Standard", "License"), null);
  });

  test("chooseSqlLicenseMeter with no meters", () => {
    assert.equal(chooseSqlLicenseMeter([], 8), null);
  });
});

describe("regions, AHB and availability", () => {
  test("global rows are used when the region shard has none; region rows are preferred", () => {
    const regionRows = [lic("SQL Server Enterprise", "1-4 vCPU VM", 1.6)];
    const both = ctx({
      [refKey({ serviceName: SERVICE, regionKey: "westeurope" })]: regionRows,
      [refKey({ serviceName: SERVICE, regionKey: "_global" })]: GLOBAL,
    });
    near(price({ edition: "enterprise", vCPUs: 4 }, both).lines[0].unitPriceUsd, 1.6);
    near(price({ edition: "standard", vCPUs: 4 }, both).lines[0].unitPriceUsd, 0.4); // not in region → global
  });

  test("shards request the region and _global", () => {
    assert.deepEqual(sqlLicenseModule.shards(cfg({}), "westeurope", SERVICES), [{ serviceName: SERVICE, regionKey: "_global" }]);
    const withRegion: ServiceInfo[] = [{ ...SERVICES[0], regions: ["westeurope", "_global"] }];
    assert.deepEqual(sqlLicenseModule.shards(cfg({}), "westeurope", withRegion), [
      { serviceName: SERVICE, regionKey: "westeurope" },
      { serviceName: SERVICE, regionKey: "_global" },
    ]);
    assert.deepEqual(sqlLicenseModule.shards(cfg({}), "westeurope", []), [
      { serviceName: SERVICE, regionKey: "westeurope" },
      { serviceName: SERVICE, regionKey: "_global" },
    ]);
    assert.deepEqual(sqlLicenseModule.shards(cfg({}), "", SERVICES), []);
  });

  test("fallback service name (/licen[cs]e/i)", () => {
    const services: ServiceInfo[] = [{ ...SERVICES[0], serviceName: "SQL Server Licenses" }];
    const c = ctx({ [refKey({ serviceName: "SQL Server Licenses", regionKey: "_global" })]: GLOBAL }, services);
    assert.deepEqual(sqlLicenseModule.shards(cfg({}), "westeurope", services), [
      { serviceName: "SQL Server Licenses", regionKey: "_global" },
    ]);
    near(sqlLicenseModule.compute(cfg({ edition: "enterprise", vCPUs: 8 }), c).monthlyUsd, 2190);
  });

  test("AHB → license line at 0 with a note", () => {
    const res = price({ edition: "enterprise", vCPUs: 8, ahb: true });
    assert.equal(res.status, "ok");
    assert.equal(res.monthlyUsd, 0);
    assert.equal(res.lines.length, 1);
    assert.equal(res.lines[0].monthlyUsd, 0);
    assert.match(res.lines[0].label, /Azure Hybrid Benefit/);
    assert.ok(res.lines[0].notes.length > 0);
    assert.equal(price({ ahb: true }, globalCtx([])).status, "ok");
  });

  test("no license rows → unavailable; no region → incomplete", () => {
    const res = price({ edition: "enterprise" }, globalCtx([]));
    assert.equal(res.status, "unavailable");
    assert.match(res.messages[0].text, /SQL Server Enterprise license price is not available in West Europe or in the global price list/);
    assert.equal(sqlLicenseModule.compute(cfg({}), { ...globalCtx(), region: "" }).status, "incomplete");
  });

  test("summary and defaults", () => {
    assert.equal(sqlLicenseModule.summarize(cfg({ vms: 2, vCPUs: 8, edition: "enterprise" })), "2 VMs × 8 vCPUs · SQL Server Enterprise");
    assert.equal(sqlLicenseModule.summarize(cfg({ ahb: true })), "1 VM × 4 vCPUs · SQL Server Standard · AHB");
    assert.equal(sqlLicenseModule.summarize(cfg({ vCPUs: 1 })), "1 VM × 1 vCPU · SQL Server Standard");
    assert.equal(sqlLicenseModule.defaultConfig({ hoursPerMonth: 700 }).hoursPerMonth, 700);
  });
});
