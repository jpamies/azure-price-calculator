import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { genericConfigSchema } from "../src/domain/model.ts";
import type { GenericConfig } from "../src/domain/model.ts";
import { refKey } from "../src/domain/types.ts";
import type { PriceRow, PricingContext, ServiceInfo } from "../src/domain/types.ts";
import { genericModule, meterCommitment, meterMonthlyUsd } from "../src/domain/pricing/generic.ts";
import { findMeterOption, listMeters, searchMeters } from "../src/domain/meters.ts";

const near = (actual: number, expected: number, eps = 1e-6) =>
  assert.ok(Math.abs(actual - expected) < eps, `${actual} != ${expected}`);

function r(p: Partial<PriceRow>): PriceRow {
  return {
    meterId: "m",
    meterName: "Meter",
    productName: "Product",
    skuName: "Sku",
    armSkuName: "",
    unitOfMeasure: "1 Hour",
    type: "Consumption",
    reservationTerm: "",
    tierMinimumUnits: 0,
    retailPrice: 1,
    effectiveStartDate: "2024-01-01",
    isWindows: false,
    ...p,
  };
}

const APP: PriceRow[] = [
  r({ meterId: "p1v3", productName: "Azure App Service Premium v3 Plan", skuName: "P1 v3", meterName: "P1 v3 App", retailPrice: 0.2 }),
  r({ meterId: "p1v3", productName: "Azure App Service Premium v3 Plan", skuName: "P1 v3", meterName: "P1 v3 App", type: "Reservation", reservationTerm: "3 Years", unitOfMeasure: "1 Hour", retailPrice: 1000 }),
  r({ meterId: "p1v3", productName: "Azure App Service Premium v3 Plan", skuName: "P1 v3", meterName: "P1 v3 App", type: "SavingsPlans", reservationTerm: "1 Year", retailPrice: 0.15 }),
  r({ meterId: "cert", productName: "App Service Certificate", skuName: "Standard", meterName: "Standard Certificate", unitOfMeasure: "1/Year", retailPrice: 69.99 }),
  r({ meterId: "ip", productName: "App Service IP SSL", skuName: "IP SSL", meterName: "IP SSL Connection", unitOfMeasure: "1/Month", retailPrice: 39 }),
  r({ meterId: "daily", productName: "Daily thing", skuName: "D", meterName: "Daily Fee", unitOfMeasure: "1/Day", retailPrice: 2.4 }),
];

const STORAGE: PriceRow[] = [
  r({ meterId: "wops", productName: "General Block Blob v2", skuName: "Hot LRS", meterName: "Hot LRS Write Operations", unitOfMeasure: "10K", retailPrice: 0.055 }),
  r({ meterId: "hot", productName: "General Block Blob v2", skuName: "Hot LRS", meterName: "Hot LRS Data Stored", unitOfMeasure: "1 GB/Month", retailPrice: 0.0184 }),
];

const BANDWIDTH: PriceRow[] = [
  r({ meterId: "egress", productName: "Bandwidth - Routing Preference: Internet", skuName: "Standard", meterName: "Standard Data Transfer Out", unitOfMeasure: "1 GB", tierMinimumUnits: 0, retailPrice: 0 }),
  r({ meterId: "egress", productName: "Bandwidth - Routing Preference: Internet", skuName: "Standard", meterName: "Standard Data Transfer Out", unitOfMeasure: "1 GB", tierMinimumUnits: 100, retailPrice: 0.09, effectiveStartDate: "2020-01-01" }),
  r({ meterId: "egress", productName: "Bandwidth - Routing Preference: Internet", skuName: "Standard", meterName: "Standard Data Transfer Out", unitOfMeasure: "1 GB", tierMinimumUnits: 100, retailPrice: 0.087 }),
  r({ meterId: "egress", productName: "Bandwidth - Routing Preference: Internet", skuName: "Standard", meterName: "Standard Data Transfer Out", unitOfMeasure: "1 GB", tierMinimumUnits: 10240, retailPrice: 0.083 }),
  r({ meterId: "egress", productName: "Bandwidth - Routing Preference: Internet", skuName: "Standard", meterName: "Standard Data Transfer Out", unitOfMeasure: "1 GB", tierMinimumUnits: 51200, retailPrice: 0.07 }),
];

const LOGS: PriceRow[] = [
  r({ meterId: "ingest", productName: "Log Analytics", skuName: "Pay-as-you-go", meterName: "Pay-as-you-go Data Ingestion", unitOfMeasure: "1 GB", tierMinimumUnits: 5, retailPrice: 2.3 }),
];

const SERVICES: ServiceInfo[] = [
  { serviceFamily: "Web", serviceName: "Azure App Service", slug: "azure-app-service", regions: ["westeurope"], rowCount: 1, hasSpot: false },
  { serviceFamily: "Storage", serviceName: "Storage", slug: "storage", regions: ["westeurope"], rowCount: 1, hasSpot: false },
  { serviceFamily: "Networking", serviceName: "Bandwidth", slug: "bandwidth", regions: ["westeurope"], rowCount: 1, hasSpot: false },
  { serviceFamily: "Management and Governance", serviceName: "Log Analytics", slug: "log-analytics", regions: ["_global"], rowCount: 1, hasSpot: false },
];

const CTX: PricingContext = {
  region: "westeurope",
  regionName: "West Europe",
  shards: {
    [refKey({ serviceName: "Azure App Service", regionKey: "westeurope" })]: APP,
    [refKey({ serviceName: "Storage", regionKey: "westeurope" })]: STORAGE,
    [refKey({ serviceName: "Bandwidth", regionKey: "westeurope" })]: BANDWIDTH,
    [refKey({ serviceName: "Log Analytics", regionKey: "_global" })]: LOGS,
  },
  services: SERVICES,
  vmSpecs: {},
  hasSavingsPlan: true,
};

const cfg = (p: Partial<GenericConfig>) => genericConfigSchema.parse(p);
const price = (p: Partial<GenericConfig>, c = CTX) => genericModule.compute(cfg(p), c);

describe("generic meter pricing", () => {
  test("hourly meter: instances × hours × price", () => {
    const res = price({ serviceName: "Azure App Service", meterId: "p1v3", quantity: 2, hoursPerMonth: 730 });
    assert.equal(res.status, "ok");
    const [l] = res.lines;
    assert.equal(l.unit, "hours");
    assert.equal(l.quantity, 1460);
    assert.equal(l.unitPriceUsd, 0.2);
    near(res.monthlyUsd, 292);
    assert.equal(l.commitment, "payg");
    assert.equal(l.kind, "other");
    assert.ok(res.assumptions[0].includes("2 instances × 730 hours per month"));
    const one = price({ serviceName: "Azure App Service", meterId: "p1v3", quantity: 1, hoursPerMonth: 1 });
    assert.equal(one.lines[0].unit, "hour");
    assert.ok(one.assumptions[0].includes("1 instance × 1 hour per month"));
    near(price({ serviceName: "Azure App Service", meterId: "p1v3", quantity: 1, hoursPerMonth: 100 }).monthlyUsd, 20);
  });

  test("monthly, daily and yearly meters", () => {
    near(price({ serviceName: "Azure App Service", meterId: "ip", quantity: 3 }).monthlyUsd, 117);
    assert.equal(price({ serviceName: "Azure App Service", meterId: "ip", quantity: 1 }).lines[0].unit, "unit");
    assert.equal(price({ serviceName: "Azure App Service", meterId: "ip", quantity: 3 }).lines[0].unit, "units");
    near(price({ serviceName: "Azure App Service", meterId: "daily", quantity: 1, hoursPerMonth: 720 }).monthlyUsd, 2.4 * 30);
    near(price({ serviceName: "Azure App Service", meterId: "cert", quantity: 1 }).monthlyUsd, 69.99 / 12);
  });

  test("10K pack: quantity in transactions", () => {
    const res = price({ serviceName: "Storage", meterId: "wops", quantity: 1_000_000 });
    const [l] = res.lines;
    assert.equal(l.unit, "10K");
    near(l.quantity, 100);
    assert.equal(l.unitPriceUsd, 0.055);
    near(res.monthlyUsd, 5.5);
    assert.equal(l.kind, "storage");
    near(price({ serviceName: "Storage", meterId: "hot", quantity: 1000 }).monthlyUsd, 18.4);
  });

  test("tiered bandwidth (marginal, effective rows)", () => {
    near(price({ serviceName: "Bandwidth", meterId: "egress", quantity: 50 }).monthlyUsd, 0);
    near(price({ serviceName: "Bandwidth", meterId: "egress", quantity: 500 }).monthlyUsd, 400 * 0.087);
    const big = price({ serviceName: "Bandwidth", meterId: "egress", quantity: 20000 });
    near(big.monthlyUsd, (10240 - 100) * 0.087 + (20000 - 10240) * 0.083);
    near(big.lines[0].unitPriceUsd * big.lines[0].quantity, big.monthlyUsd);
    assert.equal(big.lines[0].kind, "network");
    assert.ok(big.lines[0].notes.some((n) => /Tiered/.test(n)));
  });

  test("free allowance below the first tier (global shard)", () => {
    const res = price({ serviceName: "Log Analytics", useGlobalRegion: true, meterId: "ingest", quantity: 105 });
    assert.equal(res.status, "ok");
    near(res.monthlyUsd, 100 * 2.3);
    assert.ok(res.lines[0].notes.some((n) => /First 5 GB per month are free/.test(n)));
    const noRegion = genericModule.compute(cfg({ serviceName: "Log Analytics", useGlobalRegion: true, meterId: "ingest" }), { ...CTX, region: "" });
    assert.equal(noRegion.status, "ok");
  });

  test("reservation term: total / term months × quantity", () => {
    const res = price({ serviceName: "Azure App Service", meterId: "p1v3", type: "Reservation", reservationTerm: "3 Years", quantity: 2 });
    assert.equal(res.status, "ok");
    const [l] = res.lines;
    near(l.monthlyUsd, 2000 / 36);
    near(l.amortizedMonthlyUsd, 2000 / 36);
    assert.equal(l.upfrontUsd, 0);
    assert.equal(l.termMonths, 36);
    assert.equal(l.commitment, "ri3y");
    assert.equal(l.unitPriceUsd, 1000);
    assert.equal(l.quantity, 2);
    assert.equal(l.unit, "reservations");
  });

  test("savings plan meter is hourly", () => {
    const res = price({ serviceName: "Azure App Service", meterId: "p1v3", type: "SavingsPlans", reservationTerm: "1 Year", quantity: 1 });
    near(res.monthlyUsd, 0.15 * 730);
    assert.equal(res.lines[0].commitment, "sp1y");
  });

  test("incomplete and unavailable", () => {
    assert.equal(price({}).status, "incomplete");
    assert.equal(price({ serviceName: "Storage" }).status, "incomplete");
    assert.equal(genericModule.compute(cfg({ serviceName: "Storage", meterId: "hot" }), { ...CTX, region: "" }).status, "incomplete");
    const missing = price({ serviceName: "Storage", meterId: "nope", meterName: "Cool LRS Data Stored" });
    assert.equal(missing.status, "unavailable");
    assert.equal(missing.monthlyUsd, 0);
    assert.match(missing.messages[0].text, /"Cool LRS Data Stored" \(Storage\) is not available in West Europe/);
    assert.equal(price({ serviceName: "Storage", meterId: "hot", type: "Reservation", reservationTerm: "1 Year" }).status, "unavailable");
    assert.match(price({ serviceName: "Gone Service", meterId: "x" }).messages[0].text, /not in the current price snapshot/);
  });

  test("helpers", () => {
    assert.equal(meterCommitment("Consumption", ""), "payg");
    assert.equal(meterCommitment("Reservation", "1 Year"), "ri1y");
    assert.equal(meterCommitment("Reservation", "5 Years"), undefined);
    assert.equal(meterCommitment("SavingsPlans", "3 Years"), "sp3y");
    const egress = findMeterOption(BANDWIDTH, { meterId: "egress" });
    assert.ok(egress);
    near(meterMonthlyUsd(egress, 500, 730) ?? NaN, 34.8);
  });
});

describe("meters catalog", () => {
  test("listMeters groups tiers per meterId+type+term and keeps effective prices", () => {
    const options = listMeters(BANDWIDTH);
    assert.equal(options.length, 1);
    assert.deepEqual(options[0].tiers, [
      { tierMinimumUnits: 0, retailPrice: 0 },
      { tierMinimumUnits: 100, retailPrice: 0.087 },
      { tierMinimumUnits: 10240, retailPrice: 0.083 },
      { tierMinimumUnits: 51200, retailPrice: 0.07 },
    ]);
    assert.equal(listMeters(BANDWIDTH), options); // memoized
    const app = listMeters(APP);
    assert.equal(app.length, 6);
    assert.deepEqual(
      app.filter((o) => o.meterId === "p1v3").map((o) => o.type),
      ["Consumption", "Reservation", "SavingsPlans"],
    );
  });

  test("findMeterOption by meterId + type + term", () => {
    assert.equal(findMeterOption(APP, { meterId: "p1v3" })?.type, "Consumption");
    assert.equal(findMeterOption(APP, { meterId: "p1v3", type: "Reservation", reservationTerm: "3 Years" })?.tiers[0].retailPrice, 1000);
    assert.equal(findMeterOption(APP, { meterId: "p1v3", type: "Reservation", reservationTerm: "1 Year" }), undefined);
    assert.equal(findMeterOption(APP, { meterId: "" }), undefined);
    const shared = [
      r({ meterId: "s", productName: "Virtual Machines Dv3 Series", skuName: "D2 v3", retailPrice: 0.1 }),
      r({ meterId: "s", productName: "Virtual Machines DSv3 Series", skuName: "D2s v3", retailPrice: 0.1 }),
    ];
    assert.equal(findMeterOption(shared, { meterId: "s", skuName: "D2s v3", productName: "Virtual Machines DSv3 Series" })?.skuName, "D2s v3");
  });

  test("searchMeters ranks by names", () => {
    const options = listMeters([...STORAGE, ...APP]);
    assert.equal(searchMeters(options, "hot lrs data stored")[0].meterId, "hot");
    assert.equal(searchMeters(options, "p1 v3").length, 3);
    assert.equal(searchMeters(options, "").length, options.length);
    assert.equal(searchMeters(options, "certificate", 1)[0].meterId, "cert");
  });

  test("summary and shards", () => {
    assert.equal(genericModule.summarize(cfg({})), "No service selected");
    const hourly = { serviceName: "Azure App Service", meterId: "p1v3", meterName: "P1 v3 App", unitOfMeasure: "1 Hour" };
    assert.equal(genericModule.summarize(cfg({ ...hourly, quantity: 1 })), "P1 v3 App · 1 instance");
    assert.equal(genericModule.summarize(cfg({ ...hourly, quantity: 2 })), "P1 v3 App · 2 instances");
    assert.equal(
      genericModule.summarize(cfg({ serviceName: "Storage", meterId: "wops", meterName: "Hot LRS Write Operations", unitOfMeasure: "10K", quantity: 1 })),
      "Hot LRS Write Operations · 1 unit per month",
    );
    assert.equal(
      genericModule.summarize(cfg({ serviceName: "Storage", meterId: "hot", meterName: "Hot LRS Data Stored", unitOfMeasure: "1 GB/Month", quantity: 1000 })),
      "Hot LRS Data Stored · 1,000 GB",
    );
    assert.deepEqual(genericModule.shards(cfg({ serviceName: "Storage", meterId: "hot" }), "westeurope", SERVICES), [
      { serviceName: "Storage", regionKey: "westeurope" },
    ]);
    assert.deepEqual(genericModule.shards(cfg({ serviceName: "Log Analytics", useGlobalRegion: true }), "", SERVICES), [
      { serviceName: "Log Analytics", regionKey: "_global" },
    ]);
    assert.deepEqual(genericModule.shards(cfg({ serviceName: "Log Analytics" }), "westeurope", SERVICES), []);
    assert.deepEqual(genericModule.shards(cfg({ serviceName: "Unknown" }), "westeurope", SERVICES), []);
    assert.deepEqual(genericModule.shards(cfg({}), "westeurope", SERVICES), []);
  });
});
