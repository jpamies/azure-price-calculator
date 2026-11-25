import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeShard, isColumnarDoc } from "../src/data/columnar.ts";

const COLS = [
  "meterId",
  "meterName",
  "productName",
  "skuName",
  "armSkuName",
  "unitOfMeasure",
  "type",
  "reservationTerm",
  "tierMinimumUnits",
  "retailPrice",
  "effectiveStartDate",
  "isWindows",
];

describe("decodeShard", () => {
  it("decodes rows by column name", () => {
    const rows = decodeShard({
      cols: COLS,
      rows: [
        ["m1", "D8as v5", "Virtual Machines Dasv5 Series", "D8as v5", "Standard_D8as_v5", "1 Hour", "Consumption", "", 0, 0.344, "2022-10-01", 0],
        ["m2", "D8as v5", "Virtual Machines Dasv5 Series Windows", "D8as v5", "Standard_D8as_v5", "1 Hour", "Reservation", "3 Years", 0, 4500, "2022-10-01", 1],
      ],
    });
    assert.deepEqual(rows[0], {
      meterId: "m1",
      meterName: "D8as v5",
      productName: "Virtual Machines Dasv5 Series",
      skuName: "D8as v5",
      armSkuName: "Standard_D8as_v5",
      unitOfMeasure: "1 Hour",
      type: "Consumption",
      reservationTerm: "",
      tierMinimumUnits: 0,
      retailPrice: 0.344,
      effectiveStartDate: "2022-10-01",
      isWindows: false,
    });
    assert.equal(rows[1].isWindows, true);
    assert.equal(rows[1].reservationTerm, "3 Years");
    assert.equal(rows[1].retailPrice, 4500);
  });

  it("does not depend on column order and defaults missing values", () => {
    const rows = decodeShard({
      cols: ["retailPrice", "isWindows", "meterId", "productName", "tierMinimumUnits", "extra"],
      rows: [
        [1.5, 1, "a", "Windows Server", null, "x"],
        [null, 0, null, null, "100", "y"],
        ["bad", "1", "c", "", undefined],
        "not-a-row",
      ],
    });
    assert.equal(rows.length, 3);
    assert.deepEqual(
      rows.map((r) => [r.meterId, r.retailPrice, r.isWindows, r.tierMinimumUnits, r.meterName, r.unitOfMeasure, r.reservationTerm]),
      [
        ["a", 1.5, true, 0, "", "", ""],
        ["", 0, false, 100, "", "", ""],
        ["c", 0, true, 0, "", "", ""],
      ],
    );
  });

  it("derives isWindows from productName when the column is absent", () => {
    const rows = decodeShard({ cols: ["meterId", "retailPrice", "productName"], rows: [["a", 1, "Virtual Machines Windows"], ["b", 1, "Linux"]] });
    assert.deepEqual(rows.map((r) => r.isWindows), [true, false]);
  });

  it("validates cols and rows", () => {
    assert.throws(() => decodeShard(null as unknown as { cols: unknown; rows: unknown }), /expected an object/);
    assert.throws(() => decodeShard({ cols: "meterId", rows: [] }), /cols must be an array/);
    assert.throws(() => decodeShard({ cols: ["meterId", 3], rows: [] }), /cols must be an array/);
    assert.throws(() => decodeShard({ cols: ["meterId", "meterId", "retailPrice"], rows: [] }), /duplicate/);
    assert.throws(() => decodeShard({ cols: ["meterId"], rows: [] }), /missing column "retailPrice"/);
    assert.throws(() => decodeShard({ cols: COLS, rows: {} }), /rows must be an array/);
    assert.deepEqual(decodeShard({ cols: COLS, rows: [] }), []);
  });

  it("isColumnarDoc", () => {
    assert.equal(isColumnarDoc({ cols: [], rows: [] }), true);
    assert.equal(isColumnarDoc({ cols: [] }), false);
    assert.equal(isColumnarDoc(undefined), false);
  });
});
