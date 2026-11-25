import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { estimateToXlsx, sanitizeSheetName, xmlEscape, columnName } from "../src/domain/export/xlsx.ts";
import { crc32, createZip, inflateRaw } from "../src/domain/export/zip.ts";
import { FX, sampleEstimate, titleOf } from "./_platform-fixtures.ts";

interface UnzippedEntry {
  name: string;
  method: number;
  flags: number;
  data: Uint8Array;
}

/** Independent ZIP reader: walks the central directory, checks local headers and CRCs. */
async function unzip(zip: Uint8Array): Promise<UnzippedEntry[]> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const eocd = zip.byteLength - 22;
  assert.equal(view.getUint32(eocd, true), 0x06054b50, "end of central directory");
  const count = view.getUint16(eocd + 10, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  const entries: UnzippedEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    assert.equal(view.getUint32(p, true), 0x02014b50, "central directory header");
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const crc = view.getUint32(p + 16, true);
    const compSize = view.getUint32(p + 20, true);
    const size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(zip.subarray(p + 46, p + 46 + nameLen));
    assert.equal(view.getUint32(localOffset, true), 0x04034b50, "local header");
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtra = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLen + localExtra;
    const body = zip.subarray(start, start + compSize);
    const data = method === 8 ? await inflateRaw(body) : body;
    assert.equal(data.byteLength, size, `${name} size`);
    assert.equal(crc32(data), crc, `${name} crc`);
    entries.push({ name, method, flags, data });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function python(script: string, input: Uint8Array): { skipped: string | null; stdout: string; stderr: string; status: number | null } {
  const res = spawnSync("python3", ["-c", script], { input, encoding: "utf8", timeout: 60_000 });
  if (res.error) return { skipped: `python3 unavailable (${res.error.message})`, stdout: "", stderr: "", status: null };
  if (res.status === 3) return { skipped: "openpyxl not installed", stdout: res.stdout, stderr: res.stderr, status: res.status };
  return { skipped: null, stdout: res.stdout, stderr: res.stderr, status: res.status };
}

describe("zip", () => {
  it("crc32 matches the reference value", () => {
    assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
    assert.equal(crc32(new Uint8Array()), 0);
  });

  it("writes valid stored and deflated archives with UTF-8 names", async () => {
    const enc = new TextEncoder();
    const entries = [
      { name: "a.txt", data: enc.encode("hello ".repeat(200)) },
      { name: "dir/ñandú €.xml", data: enc.encode("<x>ü</x>") },
      { name: "empty.bin", data: new Uint8Array() },
    ];
    for (const compress of [true, false]) {
      const zip = await createZip(entries, { compress, date: new Date(2026, 10, 24, 12, 30, 10) });
      const out = await unzip(zip);
      assert.deepEqual(out.map((e) => e.name), entries.map((e) => e.name));
      out.forEach((e, i) => {
        assert.deepEqual(e.data, entries[i].data);
        assert.equal(e.flags & 0x0800, 0x0800);
      });
      assert.equal(out[0].method, compress ? 8 : 0);
      assert.equal(out[2].method, 0);
      const py = python(
        "import sys, io, zipfile\nz = zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))\nassert z.testzip() is None\nprint('|'.join(z.namelist()))",
        zip,
      );
      if (!py.skipped) {
        assert.equal(py.status, 0, py.stderr);
        assert.equal(py.stdout.trim(), "a.txt|dir/ñandú €.xml|empty.bin");
      }
    }
  });

  it("rejects duplicate names", async () => {
    await assert.rejects(createZip([{ name: "a", data: new Uint8Array() }, { name: "a", data: new Uint8Array() }]), /Duplicate/);
  });
});

describe("xlsx", () => {
  const { estimate, results } = sampleEstimate();
  estimate.items[0].name = 'Web <tier> & "front" \u0007 _x0041_';

  it("helpers escape XML, name columns and sanitize sheet names", () => {
    assert.equal(xmlEscape(`<a href="x">&'</a>\u0001`), "&lt;a href=&quot;x&quot;&gt;&amp;&apos;&lt;/a&gt;");
    assert.deepEqual([0, 25, 26, 27, 701, 702].map(columnName), ["A", "Z", "AA", "AB", "ZZ", "AAA"]);
    assert.equal(sanitizeSheetName("a/b:c*?[d]"), "a b c d");
    assert.equal(sanitizeSheetName("x".repeat(40)).length, 31);
    assert.equal(sanitizeSheetName("''"), "Sheet");
  });

  it("produces a complete OOXML package", async () => {
    const bytes = await estimateToXlsx(estimate, results, { currency: "EUR", fx: FX, titleOf, pricesDate: "2026-11-24", assumptions: ["Taxes not included."] });
    const entries = await unzip(bytes);
    const names = entries.map((e) => e.name);
    for (const required of [
      "[Content_Types].xml",
      "_rels/.rels",
      "docProps/app.xml",
      "docProps/core.xml",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/worksheets/sheet1.xml",
      "xl/worksheets/sheet2.xml",
      "xl/worksheets/sheet3.xml",
    ]) {
      assert.ok(names.includes(required), required);
    }
    const sheet2 = new TextDecoder().decode(entries.find((e) => e.name === "xl/worksheets/sheet2.xml")?.data);
    assert.match(sheet2, /<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"\/>/);
    assert.match(sheet2, /Web &lt;tier&gt; &amp; &quot;front&quot;  _x005F_x0041_/);
    assert.ok(!sheet2.includes("\u0007"));
    const styles = new TextDecoder().decode(entries.find((e) => e.name === "xl/styles.xml")?.data);
    assert.match(styles, /formatCode="#,##0\.00 &quot;EUR&quot;"/);
  });

  it("opens in openpyxl with the expected sheets, types and styles", async (t) => {
    const bytes = await estimateToXlsx(estimate, results, {
      currency: "EUR",
      fx: FX,
      titleOf,
      regionName: (k) => (k === "westeurope" ? "West Europe" : k),
      summarize: (item) => (item.moduleId === "vm" ? `${item.config.instances} × ${item.config.armSkuName}` : ""),
      pricesDate: "2026-11-24",
      assumptions: ["Prices are list prices.", "Taxes not included."],
    });
    const script = String.raw`
import sys, io, json
try:
    import openpyxl
except Exception:
    sys.exit(3)
wb = openpyxl.load_workbook(io.BytesIO(sys.stdin.buffer.read()))
s, d, a = wb["Summary"], wb["Detail"], wb["Assumptions"]
out = {
  "sheets": wb.sheetnames,
  "title": s["A1"].value,
  "prices": s["B2"].value,
  "summaryHeader": [c.value for c in s[6]],
  "summaryFreeze": s.freeze_panes,
  "firstItem": [s["A7"].value, s["C7"].value, s["D7"].value, s["F7"].value],
  "summaryTotal": [s["A13"].value, s["F13"].value, s["G13"].value, s["H13"].value],
  "summaryTotalBold": s["F13"].font.b,
  "annual": s["F14"].value,
  "detailHeader": [c.value for c in d[1]],
  "detailFreeze": d.freeze_panes,
  "headerBold": d["A1"].font.b,
  "row2": [d.cell(2, i).value for i in range(1, 14)],
  "moneyFormat": d["J2"].number_format,
  "unitFormat": d["I2"].number_format,
  "notesWrap": d["M2"].alignment.wrap_text,
  "rows": d.max_row,
  "total": [d.cell(d.max_row, 1).value, d.cell(d.max_row, 10).value],
  "widthA": d.column_dimensions["A"].width,
  "assumptions": [r[0].value for r in a.iter_rows()],
}
print(json.dumps(out))
`;
    const py = python(script, bytes);
    if (py.skipped) {
      t.skip(py.skipped);
      return;
    }
    assert.equal(py.status, 0, py.stderr);
    const out = JSON.parse(py.stdout);
    assert.deepEqual(out.sheets, ["Summary", "Detail", "Assumptions"]);
    assert.equal(out.title, estimate.name);
    assert.equal(out.prices, "2026-11-24 (Azure Retail Prices API, list prices)");
    assert.deepEqual(out.summaryHeader, ["Item", "Service", "Region", "Configuration", "Status", "Monthly (EUR)", "Upfront (EUR)", "Amortized monthly (EUR)"]);
    assert.equal(out.summaryFreeze, "A7");
    // Control chars are stripped; "_x0041_" is written as "_x005F_x0041_" (readers differ in unescaping it).
    assert.match(out.firstItem[0], /^Web <tier> & "front" {2}_x(005F_x)?0041_$/);
    assert.equal(out.firstItem[1], "West Europe");
    assert.match(out.firstItem[2], / — 2 × Standard_D8as_v5$/);
    assert.equal(out.firstItem[3], 255);
    assert.deepEqual(out.summaryTotal, ["TOTAL", 501.5, 1020, 586.5]);
    assert.equal(out.summaryTotalBold, true);
    assert.equal(out.annual, 501.5 * 12 + 1020);
    assert.equal(out.detailHeader[8], "Unit price (EUR)");
    assert.equal(out.detailFreeze, "A2");
    assert.equal(out.headerBold, true);
    assert.equal(out.row2[1], "Virtual Machines");
    assert.equal(out.row2[6], 2);
    assert.equal(out.row2[8], 3060);
    assert.equal(out.row2[9], 170);
    assert.match(out.moneyFormat, /EUR/);
    assert.match(out.unitFormat, /0\.00####/);
    assert.equal(out.notesWrap, true);
    assert.equal(out.rows, 9);
    assert.deepEqual(out.total, ["TOTAL", 501.5]);
    assert.equal(out.widthA, 24);
    assert.deepEqual(out.assumptions, ["Assumptions", "Prices are list prices.", "Taxes not included."]);
  });
});
