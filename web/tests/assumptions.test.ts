import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ALWAYS_ASSUMPTIONS, buildAssumptions } from "../src/domain/assumptions.ts";
import { newEstimate, newItem } from "../src/domain/factory.ts";
import { FX_DISCLAIMER } from "../src/domain/money.ts";
import { SETTINGS, sampleEstimate } from "./_platform-fixtures.ts";

const base = { pricesDate: "2026-11-24", currency: "USD", fxAsOf: "2026-11-24", hasSavingsPlan: true, sourceType: "exporter" as const };

describe("buildAssumptions", () => {
  it("always states the snapshot, source and the fixed disclaimers", () => {
    const list = buildAssumptions({ ...base, estimate: newEstimate(SETTINGS), results: {} });
    assert.equal(list[0], "Prices are Microsoft list prices in USD from the Azure Retail Prices API snapshot of 2026-11-24.");
    for (const a of ALWAYS_ASSUMPTIONS) assert.ok(list.includes(a), a);
    assert.ok(list.includes("List prices; no negotiated (EA/MCA/CSP) discounts."));
    assert.ok(list.includes("Marketplace and third-party software not included."));
    assert.ok(list.includes("Taxes not included."));
    assert.ok(!list.some((a) => a.includes(FX_DISCLAIMER)));
  });

  it("adds the FX disclaimer for non-USD currencies", () => {
    const list = buildAssumptions({ ...base, currency: "EUR", fxRate: 0.8523, estimate: newEstimate(SETTINGS), results: {} });
    const fx = list.find((a) => a.startsWith("Amounts in EUR"));
    assert.ok(fx);
    assert.match(fx, /FX snapshot of 2026-11-24 \(1 USD = 0\.8523 EUR\)/);
    assert.ok(fx.endsWith(FX_DISCLAIMER));
  });

  it("warns about sample data", () => {
    const list = buildAssumptions({ ...base, sourceType: "fixture", estimate: newEstimate(SETTINGS), results: {} });
    assert.match(list[0], /^Sample data/);
  });

  it("covers hours, reservations, Windows, Spot, disks, backup, ASR and dedupes item assumptions", () => {
    const { estimate, results } = sampleEstimate();
    const list = buildAssumptions({ ...base, estimate, results });
    const has = (re: RegExp) => assert.ok(list.some((a) => re.test(a)), `missing ${re}`);
    has(/^Hourly resources assume 730 hours per month, except "Batch" \(500 h\)\.$/);
    has(/total term price.*÷ 12 or ÷ 36 months/);
    has(/^Reservations paid upfront \("Batch"\)/);
    has(/^Windows VM prices include the Windows Server license/);
    has(/^Reservations and savings plans cover compute only/);
    has(/^Spot pricing is used only where selected \("Virtual machine"\)/);
    has(/rounded up to the next tier/);
    has(/^Disk transactions, snapshots and on-demand bursting are not included\.$/);
    has(/^Backup storage is assumed to be 100% of the protected data \(1 × 200 GB = 200 GB\), GRS\.$/);
    has(/^Azure Site Recovery covers the per-instance replication fee only/);
    assert.equal(list.filter((a) => a === "D8as v5 prices effective since 2022-10-01.").length, 1);
    assert.equal(new Set(list).size, list.length);
    assert.deepEqual(list.slice(-3), [...ALWAYS_ASSUMPTIONS]);
  });

  it("mentions AHB, SQL licensing, savings plans and Spot exclusion when relevant", () => {
    const e = newEstimate(SETTINGS);
    e.items = [
      newItem("vm", { region: "westeurope", settings: SETTINGS, config: { os: "windows-ahb", commitment: "sp3y" } }),
      newItem("sqlLicense", { region: "westeurope", settings: SETTINGS, config: { ahb: true } }),
      newItem("sqlLicense", { region: "westeurope", settings: SETTINGS, name: "SQL EE", config: { edition: "enterprise" } }),
      newItem("backup", { region: "westeurope", settings: SETTINGS, name: "Vault", config: { storageMode: "gb", storageGB: 1500, redundancy: "LRS" } }),
    ];
    const list = buildAssumptions({ ...base, hasSavingsPlan: false, estimate: e, results: {} });
    const has = (re: RegExp) => assert.ok(list.some((a) => re.test(a)), `missing ${re}`);
    has(/Azure Hybrid Benefit are priced at the Linux rate/);
    has(/^SQL Server licenses with Azure Hybrid Benefit are priced at zero/);
    has(/^SQL Server licenses are billed per vCPU-hour/);
    has(/^Savings plan rates are not available in this price snapshot; "Virtual machine" cannot be priced/);
    has(/^Spot and Low Priority prices are excluded/);
    has(/^Backup storage is assumed to be 1500 GB in total, LRS\.$/);
    assert.ok(!list.some((a) => /^Windows VM prices include/.test(a)));
    assert.ok(!list.some((a) => /Site Recovery/.test(a)));
  });

  it("names each backup item when there are several", () => {
    const e = newEstimate(SETTINGS);
    e.items = [
      newItem("backup", { region: "westeurope", settings: SETTINGS, name: "Prod" }),
      newItem("backup", { region: "westeurope", settings: SETTINGS, name: "Dev", config: { storageMode: "gb", storageGB: 50 } }),
    ];
    const list = buildAssumptions({ ...base, estimate: e, results: {} });
    assert.ok(list.includes('Backup "Prod": backup storage is assumed to be 100% of the protected data (1 × 200 GB = 200 GB), GRS.'));
    assert.ok(list.includes('Backup "Dev": backup storage is assumed to be 50 GB in total, GRS.'));
  });
});
