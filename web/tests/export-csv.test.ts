import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { csvField, csvNumber, csvText, estimateToCsv } from "../src/domain/export/csv.ts";
import { FX, sampleEstimate, titleOf } from "./_platform-fixtures.ts";

/** Minimal RFC 4180 parser (quoted fields, doubled quotes, CRLF). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\r" && text[i + 1] === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

describe("csv helpers", () => {
  it("quotes only when needed and doubles quotes", () => {
    assert.equal(csvField("plain"), "plain");
    assert.equal(csvField("a,b"), '"a,b"');
    assert.equal(csvField('say "hi"'), '"say ""hi"""');
    assert.equal(csvField("two\nlines"), '"two\nlines"');
    assert.equal(csvField("cr\rhere"), '"cr\rhere"');
  });

  it("neutralizes formula injection in text fields", () => {
    assert.equal(csvText("=HYPERLINK(\"x\")"), '"\'=HYPERLINK(""x"")"');
    assert.equal(csvText("+1"), "'+1");
    assert.equal(csvText("@cmd"), "'@cmd");
    assert.equal(csvText("-x"), "'-x");
    assert.equal(csvText("a\u0001b"), "ab");
  });

  it("formats numbers without grouping", () => {
    assert.equal(csvNumber(1234.5, 2, true), "1234.50");
    assert.equal(csvNumber(0.0068, 6), "0.0068");
    assert.equal(csvNumber(730, 4), "730");
    assert.equal(csvNumber(-0.001, 2, true), "0.00");
    assert.equal(csvNumber(null, 2), "");
    assert.equal(csvNumber(Number.NaN, 2), "");
  });
});

describe("estimateToCsv", () => {
  const { estimate, results } = sampleEstimate();

  it("writes a header, one row per line, rows for unpriced items and a TOTAL row", () => {
    const csv = estimateToCsv(estimate, results, { currency: "USD", fx: FX, titleOf, regionName: (k) => (k === "westeurope" ? "West Europe" : k) });
    assert.ok(csv.endsWith("\r\n"));
    assert.ok(!csv.startsWith("\uFEFF"));
    const rows = parseCsv(csv);
    assert.deepEqual(rows[0], [
      "Item",
      "Service",
      "Region",
      "Line",
      "Detail",
      "Commitment",
      "Quantity",
      "Unit",
      "Unit price (USD)",
      "Monthly (USD)",
      "Upfront (USD)",
      "Amortized monthly (USD)",
      "Notes",
    ]);
    // 5 lines + backup (pending) + asr (unavailable) + header + TOTAL
    assert.equal(rows.length, 9);
    assert.ok(rows.every((r) => r.length === 13));
    assert.deepEqual(rows[1], ["Web tier", "Virtual Machines", "West Europe", "D8as v5 compute", "", "Reserved 3Y", "2", "instances", "3600", "200.00", "0.00", "200.00", ""]);
    assert.deepEqual(rows[2].slice(5, 13), ["PAYG", "1460", "hours", "0.0685", "100.00", "0.00", "100.00", "PAYG, not reserved"]);
    assert.equal(rows[3][5], "Spot");
    assert.deepEqual(rows[4].slice(3, 5), ["P30 LRS", "Premium SSD Managed Disks"]);
    assert.deepEqual(rows[5].slice(9, 12), ["0.00", "1200.00", "100.00"]);
    assert.equal(rows[5][2], "eastus");
    assert.equal(rows[6][0], "Backup");
    assert.match(rows[6][12], /Not priced yet/);
    assert.equal(rows[6][9], "");
    assert.equal(rows[7][12], "Not available; Not available in West Europe");
    assert.deepEqual(rows[8].slice(0, 12), ["TOTAL", "", "", "", "", "", "", "", "", "590.00", "1200.00", "690.00"]);
    assert.match(rows[8][12], /Annual \(monthly × 12 \+ upfront\): 8280.00 USD/);
  });

  it("quotes user text with commas, quotes and newlines", () => {
    const e = structuredClone(estimate);
    e.items[0].name = 'Web, "front"\nend';
    const rows = parseCsv(estimateToCsv(e, results, { currency: "USD", fx: FX, titleOf }));
    assert.equal(rows[1][0], 'Web, "front"\nend');
    assert.equal(rows[1][2], "westeurope");
  });

  it("converts to the display currency and adds a BOM on request", () => {
    const csv = estimateToCsv(estimate, results, { currency: "EUR", fx: FX, titleOf, bom: true });
    assert.ok(csv.startsWith("\uFEFFItem,"));
    const rows = parseCsv(csv.slice(1));
    assert.equal(rows[0][9], "Monthly (EUR)");
    assert.equal(rows[1][9], "170.00");
    assert.equal(rows[8][9], "501.50");
  });

  it("falls back to USD for an unknown currency", () => {
    const rows = parseCsv(estimateToCsv(estimate, results, { currency: "XYZ", fx: FX, titleOf }));
    assert.equal(rows[0][9], "Monthly (USD)");
  });
});
