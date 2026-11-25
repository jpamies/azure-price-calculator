import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  billingUnitLabel,
  describeUnit,
  formatPackSize,
  monthlyFactor,
  parseUnit,
  periodsPerMonth,
  quantityLabel,
  termMonths,
} from "../src/domain/units.ts";

const near = (actual: number, expected: number, eps = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < eps, `${actual} != ${expected}`);

describe("parseUnit", () => {
  const table: [string, number, string, string | null, boolean, string][] = [
    // raw, packSize, measure, per, timeBased, describeUnit
    ["1 Hour", 1, "", "hour", true, "per hour"],
    ["1/Hour", 1, "", "hour", true, "per hour"],
    ["1/Month", 1, "", "month", false, "per month"],
    ["1 GB/Month", 1, "GB", "month", false, "per GB/month"],
    ["1 GiB/Hour", 1, "GiB", "hour", true, "per GiB/hour"],
    ["1 GB", 1, "GB", null, false, "per GB"],
    ["10K", 10000, "", null, false, "per 10K"],
    ["100", 100, "", null, false, "per 100"],
    ["1M", 1_000_000, "", null, false, "per 1M"],
    ["1/Day", 1, "", "day", true, "per day"],
    ["1 TB/Month", 1, "TB", "month", false, "per TB/month"],
    ["100 Hours", 100, "", "hour", true, "per 100 hours"],
    ["10K/Month", 10000, "", "month", false, "per 10K/month"],
    ["1 Count", 1, "", null, false, "per unit"],
  ];
  for (const [raw, packSize, measure, per, timeBased, text] of table) {
    test(raw, () => {
      const p = parseUnit(raw);
      assert.equal(p.raw, raw);
      assert.equal(p.packSize, packSize);
      assert.equal(p.measure, measure);
      assert.equal(p.per, per);
      assert.equal(p.timeBased, timeBased);
      assert.equal(p.recognized, true);
      assert.equal(describeUnit(raw), text);
    });
  }

  test("tolerates spacing, case, thousands separators and decimals", () => {
    assert.deepEqual(
      { ...parseUnit("1 /month") },
      { raw: "1 /month", packSize: 1, measure: "", per: "month", timeBased: false, recognized: true },
    );
    assert.equal(parseUnit("1,000 Hours").packSize, 1000);
    assert.equal(parseUnit("0.5 GB").packSize, 0.5);
    assert.equal(parseUnit("1 gib/hour").measure, "GiB");
    assert.equal(parseUnit("1 GB Hour").per, "hour");
    assert.equal(parseUnit("1 GB Hour").measure, "GB");
    assert.equal(parseUnit("1/Year").per, "year");
    assert.equal(parseUnit("1 MB").measure, "MB");
    assert.equal(parseUnit("1 MB").packSize, 1);
  });

  test("usage-based minutes/seconds are not time-based", () => {
    const p = parseUnit("1 Minute");
    assert.equal(p.per, null);
    assert.equal(p.measure, "Minute");
    assert.equal(p.timeBased, false);
  });

  test("unknown shapes never throw", () => {
    assert.equal(parseUnit("").recognized, false);
    assert.equal(parseUnit("").packSize, 1);
    assert.equal(parseUnit("1/Fortnight").recognized, false);
    assert.equal(parseUnit("1/Fortnight").per, null);
    assert.equal(describeUnit(""), "per unit");
  });
});

describe("monthly conversion", () => {
  test("monthlyFactor per period and pack", () => {
    near(monthlyFactor(parseUnit("1 Hour"), 730), 730);
    near(monthlyFactor("1/Hour", 200), 200);
    near(monthlyFactor("100 Hours", 730), 7.3);
    near(monthlyFactor("1/Day", 730), 730 / 24);
    near(monthlyFactor("1/Month", 730), 1);
    near(monthlyFactor("1 GB/Month", 730), 1);
    near(monthlyFactor("10K", 730), 1 / 10000);
    near(monthlyFactor("10K/Month", 730), 1 / 10000);
    near(monthlyFactor("1M", 730), 1e-6);
    near(monthlyFactor("1/Year", 730), 1 / 12);
    near(monthlyFactor("1 GiB/Hour"), 730);
  });

  test("periodsPerMonth", () => {
    assert.equal(periodsPerMonth("hour", 744), 744);
    assert.equal(periodsPerMonth("day", 720), 30);
    assert.equal(periodsPerMonth("month", 730), 1);
    assert.equal(periodsPerMonth(null, 730), 1);
  });

  test("labels", () => {
    assert.equal(billingUnitLabel("1 Hour"), "hours");
    assert.equal(billingUnitLabel("100 Hours"), "100 hours");
    assert.equal(billingUnitLabel("1 GiB/Hour"), "GiB-hours");
    assert.equal(billingUnitLabel("1 GB/Month"), "GB/month");
    assert.equal(billingUnitLabel("1/Month"), "units");
    assert.equal(billingUnitLabel("10K"), "10K");
    assert.equal(billingUnitLabel("1 GB"), "GB");
    assert.equal(billingUnitLabel("1/Day"), "days");
    assert.equal(quantityLabel("1 Hour"), "instances");
    assert.equal(quantityLabel("1 Hour", 1), "instance");
    assert.equal(quantityLabel("1 Hour", 2), "instances");
    assert.equal(quantityLabel("10K", 1), "unit per month");
    assert.equal(quantityLabel("1/Month", 1), "unit");
    assert.equal(quantityLabel("1 GB", 1), "GB per month");
    assert.equal(quantityLabel("1 Minute", 1), "Minute per month");
    assert.equal(quantityLabel("1 Minute", 5), "Minutes per month");
    assert.equal(billingUnitLabel("1 Hour", 1), "hour");
    assert.equal(billingUnitLabel("1 Hour", 730), "hours");
    assert.equal(billingUnitLabel("1/Month", 1), "unit");
    assert.equal(billingUnitLabel("100 Hours", 1), "100 hours");
    assert.equal(billingUnitLabel("1 GiB/Hour", 1), "GiB-hour");
    assert.equal(billingUnitLabel("1 GB", 1), "GB");
    assert.equal(quantityLabel("1 GiB/Hour"), "GiB");
    assert.equal(quantityLabel("1 GB/Month"), "GB");
    assert.equal(quantityLabel("1 GB"), "GB per month");
    assert.equal(quantityLabel("10K"), "units per month");
    assert.equal(formatPackSize(10000), "10K");
    assert.equal(formatPackSize(1_000_000), "1M");
    assert.equal(formatPackSize(100), "100");
  });

  test("termMonths", () => {
    assert.equal(termMonths("1 Year"), 12);
    assert.equal(termMonths("3 Years"), 36);
    assert.equal(termMonths("5 Years"), 60);
    assert.equal(termMonths("6 Months"), 6);
    assert.equal(termMonths(""), null);
  });
});
