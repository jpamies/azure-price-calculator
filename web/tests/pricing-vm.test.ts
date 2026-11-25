import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { vmConfigSchema } from "../src/domain/model.ts";
import type { VmConfig } from "../src/domain/model.ts";
import { refKey } from "../src/domain/types.ts";
import type { PriceRow, PricingContext, ServiceInfo, VmSpecs } from "../src/domain/types.ts";
import { vmModule } from "../src/domain/pricing/vm.ts";
import {
  buildVmCatalog,
  filterVmSkus,
  findVmOption,
  parseVcpuFromSku,
  resolveVmSku,
  vmFamilies,
  vmFamilyFromProduct,
  vmFamilyFromSku,
  vmOptionMonthlyUsd,
  vmSkuLabel,
} from "../src/domain/vmCatalog.ts";

const near = (actual: number, expected: number, eps = 1e-6) =>
  assert.ok(Math.abs(actual - expected) < eps, `${actual} != ${expected}`);

const LINUX = "Virtual Machines Dsv5 Series";
const WINDOWS = "Virtual Machines Dsv5 Series Windows";

function vmRow(p: Partial<PriceRow>): PriceRow {
  return {
    meterId: "meter-linux",
    meterName: "D2s v5",
    productName: LINUX,
    skuName: "D2s v5",
    armSkuName: "Standard_D2s_v5",
    unitOfMeasure: "1 Hour",
    type: "Consumption",
    reservationTerm: "",
    tierMinimumUnits: 0,
    retailPrice: 0,
    effectiveStartDate: "2024-01-01",
    isWindows: false,
    ...p,
  };
}

// East US data points: Linux PAYG 0.096, SP 1Y 0.0658368, SP 3Y 0.0441792 (Standard_D2s_v5).
const MAIN: PriceRow[] = [
  vmRow({ retailPrice: 0.096 }),
  vmRow({ retailPrice: 0.09, effectiveStartDate: "2021-01-01" }), // superseded
  vmRow({ retailPrice: 0.5, effectiveStartDate: "2099-01-01" }), // not yet effective
  vmRow({ meterId: "meter-promo", productName: "Virtual Machines Dsv5 Series Promo", retailPrice: 0.01 }),
  vmRow({ meterId: "meter-rhel", productName: "Virtual Machines RHEL Dsv5 Series", retailPrice: 0.2 }),
  vmRow({ meterId: "meter-win", productName: WINDOWS, isWindows: true, retailPrice: 0.188 }),
  vmRow({ meterId: "meter-win-byol", productName: "Virtual Machines Dsv5 Series Windows BYOL", isWindows: true, retailPrice: 0.05 }),
  vmRow({ meterId: "meter-ri1", type: "Reservation", reservationTerm: "1 Year", retailPrice: 504 }),
  vmRow({ meterId: "meter-ri3", type: "Reservation", reservationTerm: "3 Years", retailPrice: 972 }),
  vmRow({ meterId: "meter-sp1", type: "SavingsPlans", reservationTerm: "1 Year", retailPrice: 0.0658368 }),
  vmRow({ meterId: "meter-sp3", type: "SavingsPlans", reservationTerm: "3 Years", retailPrice: 0.0441792 }),
  vmRow({ meterId: "meter-sp1-win", productName: WINDOWS, isWindows: true, type: "SavingsPlans", reservationTerm: "1 Year", retailPrice: 0.15 }),
  // A SKU with reservations but no PAYG rows (historical exporter bug).
  vmRow({ armSkuName: "Standard_D4s_v5", skuName: "D4s v5", meterName: "D4s v5", meterId: "d4-ri1", type: "Reservation", reservationTerm: "1 Year", retailPrice: 1000 }),
  // A SKU with only the Windows PAYG row.
  vmRow({ armSkuName: "Standard_D16s_v5", skuName: "D16s v5", meterName: "D16s v5", meterId: "d16-win", productName: WINDOWS, isWindows: true, retailPrice: 1.5 }),
  // Another family for the catalog.
  vmRow({ armSkuName: "Standard_E32-16s_v5", skuName: "E32-16s v5", meterName: "E32-16s v5", meterId: "e32", productName: "Virtual Machines Esv5 Series", retailPrice: 2.016 }),
  // Rows without armSkuName are ignored by the catalog.
  vmRow({ armSkuName: "", meterId: "noarm", retailPrice: 9 }),
];

const SPOT: PriceRow[] = [
  vmRow({ meterId: "spot-linux", skuName: "D2s v5 Spot", meterName: "D2s v5 Spot", retailPrice: 0.0192 }),
  vmRow({ meterId: "lp-linux", skuName: "D2s v5 Low Priority", meterName: "D2s v5 Low Priority", retailPrice: 0.0383 }),
  vmRow({ meterId: "spot-win", productName: WINDOWS, isWindows: true, skuName: "D2s v5 Spot", meterName: "D2s v5 Spot", retailPrice: 0.1112 }),
];

const SERVICES: ServiceInfo[] = [
  { serviceFamily: "Compute", serviceName: "Virtual Machines", slug: "virtual-machines", regions: ["eastus"], rowCount: 100, hasSpot: true },
];

function ctx(over: Partial<PricingContext> = {}): PricingContext {
  return {
    region: "eastus",
    regionName: "East US",
    shards: {
      [refKey({ serviceName: "Virtual Machines", regionKey: "eastus" })]: MAIN,
      [refKey({ serviceName: "Virtual Machines", regionKey: "eastus", spot: true })]: SPOT,
    },
    services: SERVICES,
    vmSpecs: {},
    hasSavingsPlan: true,
    ...over,
  };
}

function cfg(p: Partial<VmConfig> = {}): VmConfig {
  return vmConfigSchema.parse({ armSkuName: "Standard_D2s_v5", os: "linux", ...p });
}

const price = (p: Partial<VmConfig>, c: PricingContext = ctx()) => vmModule.compute(cfg(p), c);

describe("VM pay-as-you-go", () => {
  test("Linux: hours × instances × Linux rate (effective row)", () => {
    const r = price({ instances: 1 });
    assert.equal(r.status, "ok");
    assert.equal(r.lines.length, 1);
    const [l] = r.lines;
    assert.equal(l.id, "compute");
    assert.equal(l.kind, "compute");
    assert.equal(l.commitment, "payg");
    assert.equal(l.meterId, "meter-linux");
    assert.equal(l.unit, "hours");
    assert.equal(l.quantity, 730);
    near(l.unitPriceUsd, 0.096);
    near(r.monthlyUsd, 70.08);
    near(r.amortizedMonthlyUsd, 70.08);
    assert.equal(r.upfrontUsd, 0);
    assert.match(l.label, /D2s v5 compute \(Linux\)/);
  });

  test("Windows: compute line + Windows Server license line = Windows rate", () => {
    const r = price({ os: "windows", instances: 2, hoursPerMonth: 730 });
    assert.equal(r.status, "ok");
    assert.deepEqual(
      r.lines.map((l) => [l.id, l.kind]),
      [
        ["compute", "compute"],
        ["license", "license"],
      ],
    );
    near(r.lines[0].monthlyUsd, 0.096 * 730 * 2);
    near(r.lines[1].unitPriceUsd, 0.188 - 0.096);
    near(r.lines[1].monthlyUsd, (0.188 - 0.096) * 730 * 2);
    near(r.monthlyUsd, 0.188 * 730 * 2);
    assert.equal(r.lines[1].label, "Windows Server license");
  });

  test("Windows + AHB: Linux rate plus an informational license line at 0", () => {
    const r = price({ os: "windows-ahb" });
    assert.equal(r.status, "ok");
    assert.equal(r.lines.length, 2);
    near(r.monthlyUsd, 70.08);
    const ahb = r.lines[1];
    assert.equal(ahb.label, "Windows Server license covered by Azure Hybrid Benefit");
    assert.equal(ahb.monthlyUsd, 0);
    assert.equal(ahb.kind, "license");
  });

  test("custom hours per month", () => {
    const r = price({ hoursPerMonth: 200, instances: 3 });
    near(r.monthlyUsd, 0.096 * 200 * 3);
  });
});

describe("VM reservations", () => {
  test("RI 1Y monthly vs upfront: same amortized cost", () => {
    const monthly = price({ commitment: "ri1y", riPayment: "monthly", instances: 2 });
    const upfront = price({ commitment: "ri1y", riPayment: "upfront", instances: 2 });
    assert.equal(monthly.status, "ok");
    assert.equal(upfront.status, "ok");
    const m = monthly.lines[0];
    const u = upfront.lines[0];
    assert.equal(m.unit, "instances");
    assert.equal(price({ commitment: "ri1y", instances: 1 }).lines[0].unit, "instance");
    assert.equal(m.quantity, 2);
    assert.equal(m.unitPriceUsd, 504);
    assert.equal(m.termMonths, 12);
    assert.equal(m.commitment, "ri1y");
    near(m.monthlyUsd, (504 * 2) / 12);
    assert.equal(m.upfrontUsd, 0);
    near(m.amortizedMonthlyUsd, 84);
    assert.equal(u.monthlyUsd, 0);
    assert.equal(u.upfrontUsd, 1008);
    near(u.amortizedMonthlyUsd, 84);
    near(monthly.amortizedMonthlyUsd, upfront.amortizedMonthlyUsd);
    assert.equal(upfront.upfrontUsd, 1008);
    assert.ok(!monthly.assumptions.some((a) => /total term cost/.test(a)), "generic RI sentence lives in the estimate-level assumptions");
  });

  test("RI 3Y Windows: reserved compute + PAYG license on top", () => {
    const r = price({ os: "windows", commitment: "ri3y" });
    assert.equal(r.status, "ok");
    assert.equal(r.lines.length, 2);
    near(r.lines[0].monthlyUsd, 972 / 36);
    assert.equal(r.lines[0].termMonths, 36);
    assert.equal(r.lines[1].id, "license");
    assert.equal(r.lines[1].commitment, "payg");
    near(r.lines[1].monthlyUsd, (0.188 - 0.096) * 730);
    near(r.monthlyUsd, 27 + (0.188 - 0.096) * 730);
  });

  test("hours per month does not change the reserved compute", () => {
    const r = price({ commitment: "ri3y", hoursPerMonth: 100 });
    near(r.monthlyUsd, 27);
    assert.ok(r.lines[0].notes.some((n) => /every hour of the term/.test(n)));
  });

  test("missing reservation → unavailable", () => {
    const rows = MAIN.filter((r) => r.type !== "Reservation");
    const r = price({ commitment: "ri3y" }, ctx({ shards: { [refKey({ serviceName: "Virtual Machines", regionKey: "eastus" })]: rows } }));
    assert.equal(r.status, "unavailable");
    assert.equal(r.monthlyUsd, 0);
    assert.match(r.messages[0].text, /3-year reservation for D2s v5 is not available in East US/);
  });
});

describe("VM savings plans", () => {
  test("East US D2s v5: PAYG 0.096 / SP 1Y 0.0658368 / SP 3Y 0.0441792", () => {
    near(price({ commitment: "payg" }).monthlyUsd, 0.096 * 730);
    const sp1 = price({ commitment: "sp1y" });
    const sp3 = price({ commitment: "sp3y" });
    assert.equal(sp1.status, "ok");
    near(sp1.monthlyUsd, 48.060864);
    near(sp3.monthlyUsd, 32.250816);
    assert.equal(sp1.lines[0].meterId, "meter-sp1"); // Linux SP row, not the Windows one
    assert.equal(sp1.lines[0].commitment, "sp1y");
    assert.equal(sp1.lines[0].termMonths, 12);
    assert.equal(sp1.upfrontUsd, 0);
  });

  test("SP Windows: SP compute + PAYG Windows license", () => {
    const r = price({ os: "windows", commitment: "sp3y" });
    near(r.monthlyUsd, 0.0441792 * 730 + (0.188 - 0.096) * 730);
  });

  test("no SP rows → unavailable", () => {
    const rows = MAIN.filter((r) => r.type !== "SavingsPlans");
    const shards = { [refKey({ serviceName: "Virtual Machines", regionKey: "eastus" })]: rows };
    const r = price({ commitment: "sp1y" }, ctx({ shards }));
    assert.equal(r.status, "unavailable");
    assert.match(r.messages[0].text, /1-year savings plan price for D2s v5 is not available in East US/);
    const r2 = price({ commitment: "sp1y" }, ctx({ shards, hasSavingsPlan: false }));
    assert.match(r2.messages[0].text, /not included in this price snapshot/);
  });
});

describe("VM Spot", () => {
  test("Linux / Windows / AHB Spot use the OS-specific Spot row; Low Priority is ignored", () => {
    const linux = price({ spot: true });
    assert.equal(linux.status, "ok");
    assert.equal(linux.lines.length, 1);
    near(linux.monthlyUsd, 0.0192 * 730);
    const windows = price({ spot: true, os: "windows" });
    assert.equal(windows.lines.length, 1);
    near(windows.monthlyUsd, 0.1112 * 730);
    const ahb = price({ spot: true, os: "windows-ahb" });
    assert.equal(ahb.lines.length, 1);
    near(ahb.monthlyUsd, 0.0192 * 730);
  });

  test("Spot is ignored with a commitment", () => {
    const r = price({ spot: true, commitment: "ri1y" });
    assert.equal(r.status, "ok");
    near(r.monthlyUsd, 42);
    assert.ok(r.messages.some((m) => m.level === "info" && /Spot/.test(m.text)));
  });

  test("missing Spot shard → unavailable", () => {
    const shards = { [refKey({ serviceName: "Virtual Machines", regionKey: "eastus" })]: MAIN };
    const r = price({ spot: true }, ctx({ shards }));
    assert.equal(r.status, "unavailable");
    assert.match(r.messages[0].text, /Spot price of D2s v5 \(Linux\) is not available in East US/);
  });
});

describe("VM missing prices", () => {
  test("SKU without PAYG rows: PAYG unavailable, RI Linux ok, RI Windows unavailable", () => {
    const payg = price({ armSkuName: "Standard_D4s_v5" });
    assert.equal(payg.status, "unavailable");
    assert.match(payg.messages[0].text, /pay-as-you-go Linux price of D4s v5 is not available in East US/);
    const ri = price({ armSkuName: "Standard_D4s_v5", commitment: "ri1y" });
    assert.equal(ri.status, "ok");
    near(ri.monthlyUsd, 1000 / 12);
    const riWin = price({ armSkuName: "Standard_D4s_v5", commitment: "ri1y", os: "windows" });
    assert.equal(riWin.status, "unavailable");
    assert.match(riWin.messages.at(-1)?.text ?? "", /Windows/);
  });

  test("Windows PAYG with only the Windows row: one combined line + warning", () => {
    const r = price({ armSkuName: "Standard_D16s_v5", os: "windows" });
    assert.equal(r.status, "ok");
    assert.equal(r.lines.length, 1);
    near(r.monthlyUsd, 1.5 * 730);
    assert.ok(r.messages.some((m) => m.level === "warning"));
    assert.equal(price({ armSkuName: "Standard_D16s_v5", os: "linux" }).status, "unavailable");
  });

  test("SKU not in region", () => {
    const r = price({ armSkuName: "Standard_D8as_v5" }, ctx({ regionName: "West Europe" }));
    assert.equal(r.status, "unavailable");
    assert.equal(r.lines.length, 0);
    assert.equal(r.monthlyUsd, 0);
    assert.equal(r.messages[0].text, "D8as v5 is not available in West Europe.");
  });

  test("incomplete config", () => {
    assert.equal(price({ armSkuName: "" }).status, "incomplete");
    assert.equal(price({}, ctx({ region: "" })).status, "incomplete");
  });

  test("SKU lookup is case-insensitive and accepts normalized names", () => {
    near(price({ armSkuName: "standard_d2s_v5" }).monthlyUsd, 70.08);
    near(price({ armSkuName: "D2s v5" }).monthlyUsd, 70.08);
  });
});

describe("VM module metadata", () => {
  test("shards: main + spot only when Spot is on with PAYG", () => {
    assert.deepEqual(vmModule.shards(cfg(), "eastus", SERVICES), [{ serviceName: "Virtual Machines", regionKey: "eastus" }]);
    assert.deepEqual(vmModule.shards(cfg({ spot: true }), "eastus", SERVICES), [
      { serviceName: "Virtual Machines", regionKey: "eastus" },
      { serviceName: "Virtual Machines", regionKey: "eastus", spot: true },
    ]);
    assert.equal(vmModule.shards(cfg({ spot: true, commitment: "ri1y" }), "eastus", SERVICES).length, 1);
    assert.deepEqual(vmModule.shards(cfg(), "westeurope", SERVICES), []);
    assert.deepEqual(vmModule.shards(cfg(), "", SERVICES), []);
    assert.equal(vmModule.shards(cfg(), "westeurope", []).length, 1);
  });

  test("summary", () => {
    assert.equal(
      vmModule.summarize(cfg({ instances: 2, armSkuName: "Standard_D8as_v5", os: "windows", commitment: "ri3y" })),
      "2 × D8as v5 · Windows · RI 3Y",
    );
    assert.equal(vmModule.summarize(cfg({ spot: true, hoursPerMonth: 200 })), "1 × D2s v5 · Linux · Spot · 200 h/month");
  });

  test("defaultConfig uses the settings hours", () => {
    assert.equal(vmModule.defaultConfig({ hoursPerMonth: 700 }).hoursPerMonth, 700);
    assert.equal(vmModule.defaultConfig({ hoursPerMonth: 730 }).armSkuName, "Standard_D2s_v5");
  });
});

describe("VM catalog", () => {
  const specs: VmSpecs = {
    Standard_D2s_v5: { vCPUs: 2, memoryGB: 8, family: "Dsv5" },
    Standard_D16s_v5: { vCPUs: 16, memoryGB: 64, family: "Dsv5" },
    "Standard_E32-16s_v5": null,
  };

  test("one option per SKU with every price", () => {
    const options = buildVmCatalog(MAIN, specs, SPOT);
    assert.deepEqual(
      options.map((o) => o.armSkuName),
      ["Standard_D2s_v5", "Standard_D4s_v5", "Standard_D16s_v5", "Standard_E32-16s_v5"],
    );
    const d2 = options[0];
    assert.equal(d2.label, "D2s v5");
    assert.equal(d2.family, "Dsv5");
    assert.deepEqual(d2.specs, { vCPUs: 2, memoryGB: 8, family: "Dsv5" });
    assert.equal(d2.vCPUs, 2);
    assert.equal(d2.memoryGB, 8);
    assert.equal(d2.linuxHourUsd, 0.096);
    assert.equal(d2.windowsHourUsd, 0.188);
    assert.equal(d2.ri1yTotalUsd, 504);
    assert.equal(d2.ri3yTotalUsd, 972);
    assert.equal(d2.sp1yHourUsd, 0.0658368);
    assert.equal(d2.sp3yHourUsd, 0.0441792);
    assert.equal(d2.spotLinuxHourUsd, 0.0192);
    assert.equal(d2.spotWindowsHourUsd, 0.1112);
    const d4 = options[1];
    assert.equal(d4.linuxHourUsd, undefined);
    assert.equal(d4.ri1yTotalUsd, 1000);
    assert.equal(d4.vCPUs, 4); // parsed from the name (no specs)
    assert.equal(d4.specs, null);
    const e32 = options[3];
    assert.equal(e32.family, "Esv5");
    assert.equal(e32.vCPUs, 16);
    assert.equal(e32.memoryGB, undefined);
  });

  test("memoized by rows identity", () => {
    const a = buildVmCatalog(MAIN, specs, SPOT);
    assert.equal(buildVmCatalog(MAIN, specs, SPOT), a);
    assert.notEqual(buildVmCatalog(MAIN, specs), a);
    assert.equal(buildVmCatalog(MAIN, specs, SPOT), a); // several combinations are kept
    assert.notEqual(buildVmCatalog([...MAIN], specs, SPOT), a);
  });

  test("filterVmSkus: query, vCPU, memory, family, price availability", () => {
    const options = buildVmCatalog(MAIN, specs, SPOT);
    for (const q of ["D2s_v5", "Standard_D2s_v5", "d2s v5"]) {
      assert.equal(filterVmSkus(options, { query: q })[0].armSkuName, "Standard_D2s_v5");
    }
    assert.deepEqual(
      filterVmSkus(options, { minVcpu: 4, maxVcpu: 16 }).map((o) => o.armSkuName),
      ["Standard_D4s_v5", "Standard_D16s_v5", "Standard_E32-16s_v5"],
    );
    assert.deepEqual(
      filterVmSkus(options, { minMemGB: 16 }).map((o) => o.armSkuName),
      ["Standard_D16s_v5"],
    );
    assert.equal(filterVmSkus(options, { family: "esv5" }).length, 1);
    assert.equal(filterVmSkus(options, { family: /^Standard_D/ }).length, 3);
    assert.deepEqual(
      filterVmSkus(options, { priceFor: { os: "linux", commitment: "payg" } }).map((o) => o.armSkuName),
      ["Standard_D2s_v5", "Standard_E32-16s_v5"],
    );
    assert.equal(filterVmSkus(options, { minVcpu: 0, maxVcpu: 0 }).length, options.length);
    assert.deepEqual(vmFamilies(options), ["Dsv5", "Esv5"]);
  });

  test("vmOptionMonthlyUsd", () => {
    const d2 = findVmOption(buildVmCatalog(MAIN, specs, SPOT), "d2s v5");
    assert.ok(d2);
    near(vmOptionMonthlyUsd(d2, { os: "linux", commitment: "payg" }) ?? NaN, 70.08);
    near(vmOptionMonthlyUsd(d2, { os: "windows", commitment: "payg" }) ?? NaN, 0.188 * 730);
    near(vmOptionMonthlyUsd(d2, { os: "windows", commitment: "ri3y" }) ?? NaN, 27 + 0.092 * 730);
    near(vmOptionMonthlyUsd(d2, { os: "windows-ahb", commitment: "sp1y" }) ?? NaN, 48.060864);
    near(vmOptionMonthlyUsd(d2, { os: "linux", commitment: "payg", spot: true }) ?? NaN, 0.0192 * 730);
  });

  test("resolveVmSku reports rows found", () => {
    assert.equal(resolveVmSku(MAIN, "Standard_D8as_v5").rowCount, 0);
    const p = resolveVmSku(MAIN, "Standard_D2s_v5", SPOT);
    assert.equal(p.linux?.retailPrice, 0.096);
    assert.equal(p.windows?.retailPrice, 0.188);
    assert.equal(p.spotLinux?.retailPrice, 0.0192);
  });

  test("name helpers", () => {
    assert.equal(parseVcpuFromSku("Standard_D8as_v5"), 8);
    assert.equal(parseVcpuFromSku("Standard_E32-16s_v5"), 16);
    assert.equal(parseVcpuFromSku("Standard_M416ms_v2"), 416);
    assert.equal(parseVcpuFromSku("Standard_NC24ads_A100_v4"), 24);
    assert.equal(parseVcpuFromSku("Standard_B1ls"), 1);
    assert.equal(parseVcpuFromSku("Standard_A0"), null);
    assert.equal(parseVcpuFromSku("weird"), null);
    assert.equal(vmSkuLabel("Standard_D8as_v5"), "D8as v5");
    assert.equal(vmFamilyFromProduct("Virtual Machines Dasv5 Series Windows"), "Dasv5");
    assert.equal(vmFamilyFromProduct("Something else"), null);
    assert.equal(vmFamilyFromSku("Standard_D8as_v5"), "Dasv5");
    assert.equal(vmFamilyFromSku("Standard_E32-16s_v5"), "Esv5");
    assert.equal(vmFamilyFromSku("Standard_NC24ads_A100_v4"), "NCadsA100v4");
  });
});
