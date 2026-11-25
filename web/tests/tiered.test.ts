import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { freeAllowance, tieredBreakdown, tieredCost } from "../src/domain/tiered.ts";
import {
  effectiveBaseRow,
  effectiveTiers,
  pickEffective,
  pickPreferredRow,
  preferShortestProduct,
  todayIso,
} from "../src/domain/effective.ts";
import type { PriceRow } from "../src/domain/types.ts";

const near = (actual: number, expected: number, eps = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < eps, `${actual} != ${expected}`);

function row(p: Partial<PriceRow>): PriceRow {
  return {
    meterId: "m1",
    meterName: "Meter",
    productName: "Product",
    skuName: "Sku",
    armSkuName: "",
    unitOfMeasure: "1 GB",
    type: "Consumption",
    reservationTerm: "",
    tierMinimumUnits: 0,
    retailPrice: 1,
    effectiveStartDate: "2024-01-01",
    isWindows: false,
    ...p,
  };
}

describe("tieredCost (marginal)", () => {
  const bandwidth = [
    { tierMinimumUnits: 0, retailPrice: 0 },
    { tierMinimumUnits: 100, retailPrice: 0.087 },
    { tierMinimumUnits: 10240, retailPrice: 0.083 },
    { tierMinimumUnits: 51200, retailPrice: 0.07 },
  ];

  test("single flat tier", () => {
    near(tieredCost([{ tierMinimumUnits: 0, retailPrice: 0.02 }], 500), 10);
  });

  test("bands are applied marginally", () => {
    near(tieredCost(bandwidth, 50), 0);
    near(tieredCost(bandwidth, 100), 0);
    near(tieredCost(bandwidth, 500), 400 * 0.087);
    near(tieredCost(bandwidth, 20000), (10240 - 100) * 0.087 + (20000 - 10240) * 0.083);
    near(tieredCost(bandwidth, 60000), (10240 - 100) * 0.087 + (51200 - 10240) * 0.083 + (60000 - 51200) * 0.07);
  });

  test("order of tiers does not matter", () => {
    near(tieredCost([...bandwidth].reverse(), 20000), tieredCost(bandwidth, 20000));
  });

  test("units below the lowest tier minimum are free", () => {
    const tiers = [{ tierMinimumUnits: 5, retailPrice: 2.3 }];
    near(tieredCost(tiers, 3), 0);
    near(tieredCost(tiers, 15), 10 * 2.3);
    assert.equal(freeAllowance(tiers), 5);
    assert.equal(freeAllowance(bandwidth), 0);
  });

  test("zero / negative quantity and no tiers cost 0", () => {
    assert.equal(tieredCost(bandwidth, 0), 0);
    assert.equal(tieredCost(bandwidth, -5), 0);
    assert.equal(tieredCost([], 100), 0);
  });

  test("breakdown", () => {
    const bands = tieredBreakdown(bandwidth, 500);
    assert.equal(bands.length, 4);
    assert.deepEqual(
      bands.map((b) => [b.from, b.to, b.units]),
      [
        [0, 100, 100],
        [100, 10240, 400],
        [10240, 51200, 0],
        [51200, null, 0],
      ],
    );
  });
});

describe("effective dates", () => {
  test("latest effectiveStartDate <= today wins", () => {
    const rows = [
      row({ retailPrice: 1, effectiveStartDate: "2022-01-01" }),
      row({ retailPrice: 2, effectiveStartDate: "2024-06-01" }),
      row({ retailPrice: 3, effectiveStartDate: "2099-01-01" }),
    ];
    assert.equal(pickEffective(rows, "2025-01-01")?.retailPrice, 2);
    assert.equal(pickEffective(rows, "2023-01-01")?.retailPrice, 1);
    assert.equal(pickEffective(rows, "2024-06-01")?.retailPrice, 2);
    assert.equal(pickEffective(rows)?.retailPrice, 2);
  });

  test("falls back to the latest when every row is in the future", () => {
    const rows = [
      row({ retailPrice: 5, effectiveStartDate: "2098-01-01" }),
      row({ retailPrice: 6, effectiveStartDate: "2099-01-01" }),
    ];
    assert.equal(pickEffective(rows, "2025-01-01")?.retailPrice, 6);
  });

  test("empty dates count as the oldest", () => {
    const rows = [row({ retailPrice: 7, effectiveStartDate: "" }), row({ retailPrice: 8, effectiveStartDate: "2020-01-01" })];
    assert.equal(pickEffective(rows, "2025-01-01")?.retailPrice, 8);
    assert.equal(pickEffective([row({ retailPrice: 9, effectiveStartDate: "" })], "2025-01-01")?.retailPrice, 9);
    assert.equal(pickEffective([], "2025-01-01"), undefined);
  });

  test("effectiveTiers picks one row per tier, sorted", () => {
    const rows = [
      row({ tierMinimumUnits: 100, retailPrice: 0.09, effectiveStartDate: "2020-01-01" }),
      row({ tierMinimumUnits: 100, retailPrice: 0.087, effectiveStartDate: "2024-01-01" }),
      row({ tierMinimumUnits: 0, retailPrice: 0, effectiveStartDate: "2020-01-01" }),
      row({ tierMinimumUnits: 0, retailPrice: 0.01, effectiveStartDate: "2099-01-01" }),
    ];
    const tiers = effectiveTiers(rows, "2025-01-01");
    assert.deepEqual(
      tiers.map((t) => [t.tierMinimumUnits, t.retailPrice]),
      [
        [0, 0],
        [100, 0.087],
      ],
    );
    assert.equal(effectiveBaseRow(rows, "2025-01-01")?.retailPrice, 0);
  });

  test("preferred product = shortest productName", () => {
    const rows = [
      row({ productName: "Virtual Machines Dsv5 Series Promo", retailPrice: 1 }),
      row({ productName: "Virtual Machines Dsv5 Series", retailPrice: 2 }),
    ];
    assert.equal(preferShortestProduct(rows).length, 1);
    assert.equal(pickPreferredRow(rows)?.retailPrice, 2);
  });

  test("todayIso format", () => {
    assert.match(todayIso(), /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(todayIso(new Date("2026-11-24T23:59:00Z")), "2026-11-24");
  });
});
