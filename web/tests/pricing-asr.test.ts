import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { asrConfigSchema } from "../src/domain/model.ts";
import type { AsrConfig } from "../src/domain/model.ts";
import { refKey } from "../src/domain/types.ts";
import type { PriceRow, PricingContext, ServiceInfo } from "../src/domain/types.ts";
import { asrModule, findAsrRows } from "../src/domain/pricing/asr.ts";

function r(meterName: string, retailPrice: number, p: Partial<PriceRow> = {}): PriceRow {
  return {
    meterId: `id-${meterName}`,
    meterName,
    productName: "Azure Site Recovery",
    skuName: "Standard",
    armSkuName: "",
    unitOfMeasure: "1/Month",
    type: "Consumption",
    reservationTerm: "",
    tierMinimumUnits: 0,
    retailPrice,
    effectiveStartDate: "2024-01-01",
    isWindows: false,
    ...p,
  };
}

const ROWS: PriceRow[] = [
  r("VM Replicated to Customer Owned Sites", 16),
  r("VM Replicated to Azure", 24, { effectiveStartDate: "2019-01-01" }),
  r("VM Replicated to Azure", 25),
];

function ctx(serviceName: string, rows: PriceRow[] = ROWS): PricingContext {
  const services: ServiceInfo[] = [
    { serviceFamily: "Management and Governance", serviceName, slug: "x", regions: ["westeurope"], rowCount: 1, hasSpot: false },
  ];
  return {
    region: "westeurope",
    regionName: "West Europe",
    shards: { [refKey({ serviceName, regionKey: "westeurope" })]: rows },
    services,
    vmSpecs: {},
    hasSavingsPlan: true,
  };
}

const cfg = (p: Partial<AsrConfig>) => asrConfigSchema.parse(p);

describe("Azure Site Recovery", () => {
  for (const scenario of ["azure-to-azure", "onprem-to-azure"] as const) {
    test(`${scenario} uses "VM Replicated to Azure"`, () => {
      const res = asrModule.compute(cfg({ scenario, instances: 3 }), ctx("Azure Site Recovery"));
      assert.equal(res.status, "ok");
      assert.equal(res.lines.length, 1);
      const [l] = res.lines;
      assert.equal(l.kind, "dr");
      assert.equal(l.unit, "instances");
      assert.equal(l.quantity, 3);
      assert.equal(l.unitPriceUsd, 25);
      assert.equal(res.monthlyUsd, 75);
      assert.ok(!res.assumptions.some((a) => /excludes compute/.test(a)), "generic sentence lives in the estimate-level assumptions");
      assert.ok(res.assumptions.some((a) => /31 days/.test(a)));
    });
  }

  test('onprem-to-onprem uses "VM Replicated to Customer Owned Sites"', () => {
    const res = asrModule.compute(cfg({ scenario: "onprem-to-onprem", instances: 2 }), ctx("Azure Site Recovery"));
    assert.equal(res.monthlyUsd, 32);
    assert.equal(res.lines[0].meterId, "id-VM Replicated to Customer Owned Sites");
  });

  test("service name fallback (/site recovery/i)", () => {
    const c = ctx("Site Recovery");
    assert.deepEqual(asrModule.shards(cfg({}), "westeurope", c.services), [{ serviceName: "Site Recovery", regionKey: "westeurope" }]);
    assert.equal(asrModule.compute(cfg({}), c).monthlyUsd, 25);
  });

  test("loose meter names", () => {
    const rows = [r("Replicated to Azure VM", 21), r("Customer-Owned Site Replication", 12)];
    assert.equal(findAsrRows(rows, "azure-to-azure")[0].retailPrice, 21);
    assert.equal(findAsrRows(rows, "onprem-to-onprem")[0].retailPrice, 12);
  });

  test("missing meter → unavailable; no region → incomplete", () => {
    const res = asrModule.compute(cfg({ scenario: "onprem-to-onprem" }), ctx("Azure Site Recovery", [ROWS[2]]));
    assert.equal(res.status, "unavailable");
    assert.match(res.messages[0].text, /Site Recovery \(On-premises → customer-owned site\) is not available in West Europe/);
    assert.equal(asrModule.compute(cfg({}), { ...ctx("Azure Site Recovery"), region: "" }).status, "incomplete");
  });

  test("summary", () => {
    assert.equal(asrModule.summarize(cfg({ instances: 5 })), "5 instances · Azure → Azure");
    assert.equal(asrModule.summarize(cfg({ instances: 1, scenario: "onprem-to-azure" })), "1 instance · On-premises → Azure");
  });
});
