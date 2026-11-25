import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { safeFileName } from "../src/domain/export/download.ts";
import { exportBackupJson, exportEstimateJson, parseImportJson } from "../src/domain/export/json.ts";
import { newEstimate } from "../src/domain/factory.ts";
import { settingsSchema } from "../src/domain/model.ts";
import { SETTINGS, sampleEstimate, titleOf } from "./_platform-fixtures.ts";

describe("exportEstimateJson", () => {
  it("writes the estimate file envelope with optional lines", () => {
    const { estimate, results, ids } = sampleEstimate();
    const file = JSON.parse(exportEstimateJson(estimate, { pricesDate: "2026-11-24", results, titleOf }));
    assert.equal(file.kind, "azcalc-estimate");
    assert.equal(file.v, 1);
    assert.ok(!Number.isNaN(Date.parse(file.exportedAt)));
    assert.equal(file.pricesDate, "2026-11-24");
    assert.deepEqual(file.estimate, estimate);
    assert.equal(file.lines.length, 5);
    assert.deepEqual(
      { itemId: file.lines[0].itemId, itemName: file.lines[0].itemName, service: file.lines[0].service, region: file.lines[0].region, monthlyUsd: file.lines[0].monthlyUsd },
      { itemId: ids.vm1, itemName: "Web tier", service: "Virtual Machines", region: "westeurope", monthlyUsd: 200 },
    );
    const bare = JSON.parse(exportEstimateJson(estimate));
    assert.equal(bare.pricesDate, null);
    assert.ok(!("lines" in bare));
  });
});

describe("parseImportJson", () => {
  it("imports an estimate file with fresh ids and the snapshot date", () => {
    const { estimate } = sampleEstimate();
    const { estimates, source, warnings, settings } = parseImportJson(exportEstimateJson(estimate, { pricesDate: "2026-11-20" }));
    assert.equal(source, "estimate-file");
    assert.deepEqual(warnings, []);
    assert.equal(settings, undefined);
    assert.equal(estimates.length, 1);
    const e = estimates[0];
    assert.notEqual(e.id, estimate.id);
    assert.equal(e.name, estimate.name);
    assert.equal(e.pricesDate, "2026-11-20");
    assert.deepEqual(
      e.items.map((i) => [i.moduleId, i.name, i.region, i.config]),
      estimate.items.map((i) => [i.moduleId, i.name, i.region, i.config]),
    );
    assert.ok(e.items.every((item, i) => item.id !== estimate.items[i].id));
  });

  it("imports a backup with settings", () => {
    const a = newEstimate(SETTINGS, "A");
    const b = newEstimate(SETTINGS, "B");
    const settings = settingsSchema.parse({ defaultCurrency: "EUR", theme: "dark" });
    const result = parseImportJson(exportBackupJson({ estimates: [a, b], settings }));
    assert.equal(result.source, "backup-file");
    assert.deepEqual(result.estimates.map((e) => e.name), ["A", "B"]);
    assert.ok(result.estimates.every((e) => e.id !== a.id && e.id !== b.id));
    assert.deepEqual(result.settings, settings);
  });

  it("accepts a bare estimate, an array and a localStorage dump", () => {
    const { estimate } = sampleEstimate();
    assert.equal(parseImportJson(JSON.stringify(estimate)).source, "estimate");
    const list = parseImportJson(`\uFEFF${JSON.stringify([estimate, { items: [] }, { foo: 1 }])}`);
    assert.equal(list.source, "estimate-list");
    assert.equal(list.estimates.length, 2);
    assert.equal(list.warnings.length, 1);
    assert.match(list.warnings[0], /#3 was skipped/);
    const dump = parseImportJson(JSON.stringify({ state: { estimates: [estimate], settings: { theme: "light" } }, version: 1 }));
    assert.equal(dump.source, "local-storage");
    assert.equal(dump.settings?.theme, "light");
  });

  it("drops invalid items with warnings", () => {
    const text = JSON.stringify({ kind: "azcalc-estimate", v: 1, estimate: { name: "X", items: [{ moduleId: "vm" }, { moduleId: "warp-drive" }] } });
    const { estimates, warnings } = parseImportJson(text);
    assert.equal(estimates[0].items.length, 1);
    assert.ok(warnings.some((w) => /item 2 was dropped/.test(w)));
  });

  it("fails with clear errors", () => {
    assert.throws(() => parseImportJson(""), /empty/);
    assert.throws(() => parseImportJson("{"), /not valid JSON/);
    assert.throws(() => parseImportJson("[]"), /no estimates/);
    assert.throws(() => parseImportJson("[1, 2]"), /None of the estimates/);
    assert.throws(() => parseImportJson('"text"'), /Unrecognized file/);
    assert.throws(() => parseImportJson('{"foo": 1}'), /Unrecognized file/);
    assert.throws(() => parseImportJson('{"kind": "other"}'), /Unsupported file type "other"/);
    assert.throws(() => parseImportJson('{"kind": "azcalc-estimate", "v": 2, "estimate": {"items": []}}'), /newer version/);
    assert.throws(() => parseImportJson('{"kind": "azcalc-estimate", "v": 1, "estimate": 5}'), /does not contain a valid estimate/);
    assert.throws(() => parseImportJson('{"kind": "azcalc-backup", "v": 1, "estimates": {}}'), /list of estimates/);
  });
});

describe("safeFileName", () => {
  it("strips reserved characters and handles edge cases", () => {
    assert.equal(safeFileName('Contoso: "Phase 1" <draft>/v2?'), "Contoso Phase 1 draft v2");
    assert.equal(safeFileName("  ...  "), "estimate");
    assert.equal(safeFileName("CON"), "CON_");
    assert.equal(safeFileName("Producción €"), "Producción €");
    assert.equal(safeFileName("x".repeat(200)).length, 80);
    assert.equal(safeFileName("", "backup"), "backup");
  });
});
