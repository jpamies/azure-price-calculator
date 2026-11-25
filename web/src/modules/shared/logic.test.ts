// Unit tests of the pure form helpers: `node --test src/modules/shared/logic.test.ts` (from web/).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { disksConfigSchema } from "../../domain/model.ts";
import type { VmSkuOption } from "../../domain/vmCatalog.ts";
import { diskTierPrefix } from "../../domain/diskCatalog.ts";
import {
  activeVmColumn,
  backupBand,
  backupStorageGB,
  clampNumber,
  diskTypeChangePatch,
  formatGiB,
  formatSavings,
  meterHeadlinePrice,
  meterTypeBadge,
  meterUnitText,
  numberIssue,
  parseNumberInput,
  premiumV2MaxIops,
  premiumV2MaxMbps,
  provisionedDiskWarnings,
  quantitySemantics,
  savingsFraction,
  sortVmOptions,
  tierPerformance,
  ultraMaxIops,
  vmCommitmentSavings,
  vmPriceSummary,
} from "./logic.ts";

const near = (actual: number, expected: number, eps = 1e-6) =>
  assert.ok(Math.abs(actual - expected) < eps, `${actual} != ${expected}`);

describe("parseNumberInput", () => {
  test("plain, grouped and suffixed numbers", () => {
    assert.equal(parseNumberInput("730"), 730);
    assert.equal(parseNumberInput(" 1,000 "), 1000);
    assert.equal(parseNumberInput("12,345,678"), 12345678);
    assert.equal(parseNumberInput("1 000"), 1000);
    assert.equal(parseNumberInput("0.25"), 0.25);
    assert.equal(parseNumberInput(".5"), 0.5);
    assert.equal(parseNumberInput("5k"), 5000);
    assert.equal(parseNumberInput("2M"), 2_000_000);
    assert.equal(parseNumberInput("1e3"), 1000);
    assert.equal(parseNumberInput("-3"), -3);
  });
  test("decimal comma when it cannot be grouping", () => {
    assert.equal(parseNumberInput("1,5"), 1.5);
    assert.equal(parseNumberInput("1,25"), 1.25);
    assert.equal(parseNumberInput("1.234,5"), 1234.5);
    assert.equal(parseNumberInput("1,234.5"), 1234.5);
  });
  test("garbage is null", () => {
    for (const s of ["", "  ", "abc", "1,2,3", "12a", "--1", "1..2"]) assert.equal(parseNumberInput(s), null, s);
  });
});

describe("clampNumber / numberIssue", () => {
  test("rounds integers and clamps", () => {
    assert.equal(clampNumber(800, { min: 0, max: 744 }), 744);
    assert.equal(clampNumber(-1, { min: 0 }), 0);
    assert.equal(clampNumber(2.6, { integer: true }), 3);
    assert.equal(clampNumber(-0, {}), 0);
  });
  test("messages", () => {
    assert.equal(numberIssue(null, {}), "Enter a number.");
    assert.match(numberIssue(800, { min: 0, max: 744 }) ?? "", /0–744/);
    assert.match(numberIssue(1.5, { integer: true }) ?? "", /Whole numbers/);
    assert.equal(numberIssue(5, { min: 0, max: 10, integer: true }), null);
  });
});

describe("formatting", () => {
  test("GiB and savings", () => {
    assert.equal(formatGiB(512), "512 GiB");
    assert.equal(formatGiB(1024), "1 TiB");
    assert.equal(formatGiB(32767), "32,767 GiB");
    assert.equal(formatSavings(0.624), "\u221262%");
    assert.equal(formatSavings(-0.05), "+5%");
    assert.equal(formatSavings(0.001), "±0%");
    assert.equal(formatSavings(null), "");
    assert.equal(savingsFraction(0, 5), null);
    near(savingsFraction(100, 38) ?? 0, 0.62);
  });
});

const D8AS: VmSkuOption = {
  armSkuName: "Standard_D8as_v5",
  label: "D8as v5",
  family: "Dasv5",
  specs: { vCPUs: 8, memoryGB: 32 },
  vCPUs: 8,
  memoryGB: 32,
  linuxHourUsd: 0.38528,
  windowsHourUsd: 0.79744,
  ri1yTotalUsd: 1991.28,
  ri3yTotalUsd: 3847.56,
  sp1yHourUsd: 0.264302,
  sp3yHourUsd: 0.177229,
};
const D2AS: VmSkuOption = { ...D8AS, armSkuName: "Standard_D2as_v5", label: "D2as v5", vCPUs: 2, memoryGB: 8, linuxHourUsd: 0.09632, windowsHourUsd: 0.19936, ri1yTotalUsd: 497.82, ri3yTotalUsd: undefined };
const NOSPEC: VmSkuOption = { armSkuName: "Standard_X4_v9", label: "X4 v9", family: "Xv9", specs: null, vCPUs: 4, linuxHourUsd: 0.2 };

describe("VM picker helpers", () => {
  test("sort by a price column keeps missing values last in both directions", () => {
    const asc = sortVmOptions([D8AS, NOSPEC, D2AS], { key: "ri3y", dir: "asc" }, "linux").map((o) => o.label);
    assert.deepEqual(asc, ["D8as v5", "X4 v9", "D2as v5"]);
    const descRi = sortVmOptions([NOSPEC, D2AS, D8AS], { key: "ri3y", dir: "desc" }, "linux").map((o) => o.label);
    assert.deepEqual(descRi, ["D8as v5", "X4 v9", "D2as v5"]);
    const desc = sortVmOptions([NOSPEC, D2AS, D8AS], { key: "ram", dir: "desc" }, "linux").map((o) => o.label);
    assert.deepEqual(desc, ["D8as v5", "D2as v5", "X4 v9"]);
    const byVcpu = sortVmOptions([D8AS, NOSPEC, D2AS], { key: "vcpu", dir: "asc" }, "linux").map((o) => o.label);
    assert.deepEqual(byVcpu, ["D2as v5", "D8as v5", "X4 v9"]);
  });
  test("active column follows OS, commitment and Spot", () => {
    assert.equal(activeVmColumn({ os: "windows", commitment: "payg", spot: false }), "windows");
    assert.equal(activeVmColumn({ os: "windows-ahb", commitment: "payg", spot: false }), "linux");
    assert.equal(activeVmColumn({ os: "linux", commitment: "ri3y", spot: true }), "ri3y");
    assert.equal(activeVmColumn({ os: "linux", commitment: "payg", spot: true }), "spot");
  });
  test("price summary: PAYG Windows, RI 3Y Windows (license on top)", () => {
    const payg = vmPriceSummary(D8AS, { os: "windows", commitment: "payg", spot: false, hoursPerMonth: 730 });
    near(payg?.hourlyUsd ?? 0, 0.79744);
    near(payg?.monthlyUsd ?? 0, 0.79744 * 730);
    const ri = vmPriceSummary(D8AS, { os: "windows", commitment: "ri3y", spot: false, hoursPerMonth: 730 });
    near(ri?.licenseMonthlyUsd ?? 0, (0.79744 - 0.38528) * 730);
    near(ri?.monthlyUsd ?? 0, 3847.56 / 36 + (0.79744 - 0.38528) * 730);
    assert.equal(ri?.termMonths, 36);
    assert.equal(ri?.termTotalUsd, 3847.56);
    assert.equal(vmPriceSummary(D2AS, { os: "linux", commitment: "ri3y", spot: false, hoursPerMonth: 730 }), null);
  });
  test("savings vs PAYG for the same OS", () => {
    const s = vmCommitmentSavings(D8AS, { os: "linux", hoursPerMonth: 730 }, ["payg", "ri1y", "ri3y", "sp3y"]);
    assert.equal(s.payg.savings, null);
    near(s.ri3y.savings ?? 0, 1 - 3847.56 / 36 / (0.38528 * 730));
    near(s.sp3y.savings ?? 0, 1 - 0.177229 / 0.38528);
    const none = vmCommitmentSavings(undefined, { os: "linux", hoursPerMonth: 730 }, ["ri1y"]);
    assert.equal(none.ri1y.monthlyUsd, null);
  });
});

describe("quantitySemantics", () => {
  test("unit semantics of generic meters", () => {
    assert.equal(quantitySemantics("1 Hour", "Consumption").label, "Instances");
    assert.equal(quantitySemantics("1 Hour", "Consumption").timeBased, true);
    assert.equal(quantitySemantics("100 Hours", "Consumption").label, "Instances");
    assert.equal(quantitySemantics("1 GiB/Hour", "Consumption").label, "GiB provisioned");
    assert.equal(quantitySemantics("1 GB/Month", "Consumption").label, "GB per month");
    assert.equal(quantitySemantics("1 GB", "Consumption").label, "GB per month");
    assert.equal(quantitySemantics("10K", "Consumption").label, "Transactions per month");
    assert.equal(quantitySemantics("1M", "Consumption").label, "Transactions per month");
    assert.equal(quantitySemantics("1/Month", "Consumption").label, "Units per month");
    assert.equal(quantitySemantics("1 Hour", "Reservation").label, "Reserved units");
    assert.equal(quantitySemantics("1 GB", "Consumption").timeBased, false);
  });
});

describe("meter helpers", () => {
  test("badges, headline price and unit text", () => {
    assert.equal(meterTypeBadge("Consumption", ""), "PAYG");
    assert.equal(meterTypeBadge("Reservation", "3 Years"), "RI 3Y");
    assert.equal(meterTypeBadge("SavingsPlans", "1 Year"), "SP 1Y");
    assert.equal(meterTypeBadge("DevTestConsumption", ""), "DevTestConsumption");
    const bandwidth = [
      { tierMinimumUnits: 0, retailPrice: 0 },
      { tierMinimumUnits: 100, retailPrice: 0.09744 },
      { tierMinimumUnits: 10340, retailPrice: 0.09296 },
    ];
    assert.equal(meterHeadlinePrice({ tiers: bandwidth }), 0.09744);
    assert.equal(meterHeadlinePrice({ tiers: [{ tierMinimumUnits: 0, retailPrice: 0 }] }), 0);
    assert.equal(meterHeadlinePrice({ tiers: [] }), undefined);
    assert.equal(meterUnitText({ unitOfMeasure: "1 GB", type: "Consumption", reservationTerm: "" }), "per GB");
    assert.equal(meterUnitText({ unitOfMeasure: "1 Hour", type: "Reservation", reservationTerm: "3 Years" }), "per 3 Years");
  });
});

describe("disk helpers", () => {
  test("Premium SSD v2 and Ultra limits", () => {
    assert.equal(premiumV2MaxIops(4), 3000);
    assert.equal(premiumV2MaxIops(8), 4000);
    assert.equal(premiumV2MaxIops(160), 80000);
    assert.equal(premiumV2MaxIops(1000), 80000);
    assert.equal(premiumV2MaxMbps(3000), 750);
    assert.equal(premiumV2MaxMbps(4000), 1000);
    assert.equal(premiumV2MaxMbps(80000), 2000);
    assert.equal(premiumV2MaxMbps(80000, 6), 125);
    assert.equal(ultraMaxIops(4), 4000);
    assert.equal(ultraMaxIops(1024), 400000);
    assert.deepEqual(provisionedDiskWarnings({ diskType: "premium-ssd-v2", sizeGB: 128, iops: 3000, throughputMBps: 125 }), []);
    assert.equal(provisionedDiskWarnings({ diskType: "premium-ssd-v2", sizeGB: 128, iops: 50, throughputMBps: 25 }).length, 2);
    assert.equal(provisionedDiskWarnings({ diskType: "premium-ssd-v2", sizeGB: 8, iops: 5000, throughputMBps: 125 }).length, 1);
    assert.equal(provisionedDiskWarnings({ diskType: "ultra", sizeGB: 1024, iops: 50, throughputMBps: 0 }).length, 2);
    assert.deepEqual(provisionedDiskWarnings({ diskType: "premium-ssd", sizeGB: 8, iops: 999999, throughputMBps: 99999 }), []);
  });
  test("tier performance labels", () => {
    assert.equal(tierPerformance("P30"), "5,000 IOPS · 200 MB/s");
    assert.equal(tierPerformance("E10"), "≤ 500 IOPS · ≤ 100 MB/s");
    assert.equal(tierPerformance("S1"), "");
    assert.equal(tierPerformance("X9"), "");
  });
  test("disk type change keeps the capacity and a valid redundancy", () => {
    const p30 = disksConfigSchema.parse({ diskType: "premium-ssd", sizingMode: "tier", tier: "P30", redundancy: "ZRS" });
    assert.deepEqual(diskTypeChangePatch(p30, "standard-ssd", diskTierPrefix), { diskType: "standard-ssd", tier: "E30", sizeGB: 1024 });
    assert.deepEqual(diskTypeChangePatch(p30, "standard-hdd", diskTierPrefix), { diskType: "standard-hdd", tier: "S30", sizeGB: 1024, redundancy: "LRS" });
    assert.deepEqual(diskTypeChangePatch(p30, "premium-ssd-v2", diskTierPrefix), { diskType: "premium-ssd-v2", sizeGB: 1024 });
    assert.deepEqual(diskTypeChangePatch(p30, "ultra", diskTierPrefix), { diskType: "ultra", sizeGB: 1024, redundancy: "LRS" });
    const v2 = disksConfigSchema.parse({ diskType: "premium-ssd-v2", sizeGB: 300 });
    assert.deepEqual(diskTypeChangePatch(v2, "premium-ssd", diskTierPrefix), { diskType: "premium-ssd", tier: "P20", sizeGB: 300 });
    assert.deepEqual(diskTypeChangePatch(v2, "premium-ssd", diskTierPrefix, ["P10", "P30"]), { diskType: "premium-ssd", tier: "P30", sizeGB: 300 });
  });
});

describe("backup helpers", () => {
  test("fee band and storage GB", () => {
    assert.deepEqual(backupBand(50), { index: 0, fees: 0.5 });
    assert.deepEqual(backupBand(200), { index: 1, fees: 1 });
    assert.deepEqual(backupBand(1200), { index: 2, fees: 3 });
    const base = { instances: 2, avgInstanceSizeGB: 200, storagePercent: 50, storageGB: 999 };
    assert.equal(backupStorageGB({ ...base, storageMode: "percent" }), 200);
    assert.equal(backupStorageGB({ ...base, storageMode: "gb" }), 999);
  });
});
