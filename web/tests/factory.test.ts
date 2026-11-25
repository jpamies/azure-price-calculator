import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_ITEM_NAMES,
  configDefaults,
  duplicateEstimate,
  duplicateItem,
  itemDisplayName,
  newEstimate,
  newId,
  newItem,
  nowIso,
  sanitizeEstimate,
  sanitizeSettings,
} from "../src/domain/factory.ts";
import { HOURS_PER_MONTH, estimateSchema, itemSchema } from "../src/domain/model.ts";
import type { ModuleId } from "../src/domain/model.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("newId / nowIso", () => {
  it("returns unique v4 UUIDs", () => {
    const ids = new Set(Array.from({ length: 200 }, () => newId()));
    assert.equal(ids.size, 200);
    for (const id of ids) assert.match(id, UUID);
  });

  it("falls back when crypto.randomUUID is unavailable", (t) => {
    t.mock.method(globalThis.crypto, "randomUUID", () => {
      throw new Error("insecure context");
    });
    const id = newId();
    assert.match(id, UUID);
    assert.notEqual(newId(), id);
  });

  it("nowIso is an ISO timestamp", () => {
    assert.ok(!Number.isNaN(Date.parse(nowIso())));
    assert.match(nowIso(), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

describe("newEstimate", () => {
  it("uses the default currency and a default name", () => {
    const e = newEstimate({ defaultCurrency: "eur" });
    assert.equal(e.name, "Untitled estimate");
    assert.equal(e.currency, "EUR");
    assert.deepEqual(e.items, []);
    assert.equal(e.createdAt, e.updatedAt);
    assert.ok(estimateSchema.safeParse(e).success);
  });

  it("keeps a given name", () => {
    assert.equal(newEstimate({ defaultCurrency: "USD" }, "  Landing zone  ").name, "Landing zone");
  });
});

describe("newItem", () => {
  const settings = { hoursPerMonth: 744 };

  it("creates every module with its default name and a valid config", () => {
    for (const moduleId of Object.keys(DEFAULT_ITEM_NAMES) as ModuleId[]) {
      const item = newItem(moduleId, { region: "westeurope", settings });
      assert.equal(item.moduleId, moduleId);
      assert.equal(item.name, DEFAULT_ITEM_NAMES[moduleId]);
      assert.equal(item.region, "westeurope");
      assert.equal(item.collapsed, false);
      assert.match(item.id, UUID);
      assert.ok(itemSchema.safeParse(item).success, moduleId);
    }
    assert.equal(DEFAULT_ITEM_NAMES.vm, "Virtual machine");
    assert.equal(DEFAULT_ITEM_NAMES.generic, "Custom meter");
  });

  it("seeds hoursPerMonth from settings only where the schema has it", () => {
    assert.equal(newItem("vm", { region: "", settings }).config.hoursPerMonth, 744);
    assert.equal(newItem("sqlLicense", { region: "", settings }).config.hoursPerMonth, 744);
    assert.equal(newItem("generic", { region: "", settings }).config.hoursPerMonth, 744);
    assert.ok(!("hoursPerMonth" in newItem("disks", { region: "", settings }).config));
  });

  it("merges config overrides (they win over settings) and ignores invalid values", () => {
    const vm = newItem("vm", {
      region: "eastus",
      settings,
      name: "Web",
      config: { armSkuName: "Standard_D8as_v5", instances: 3, hoursPerMonth: 100 },
    });
    assert.equal(vm.name, "Web");
    assert.equal(vm.config.armSkuName, "Standard_D8as_v5");
    assert.equal(vm.config.instances, 3);
    assert.equal(vm.config.hoursPerMonth, 100);
    assert.equal(vm.config.os, "windows");
    const bad = newItem("vm", { region: "", settings, config: { instances: -4 } });
    assert.equal(bad.config.instances, 1);
  });

  it("configDefaults are the schema defaults", () => {
    assert.equal(configDefaults("vm").hoursPerMonth, HOURS_PER_MONTH);
    assert.equal(configDefaults("disks").tier, "P10");
  });
});

describe("duplicates", () => {
  it("duplicateEstimate deep-copies with fresh ids and a (copy) suffix", () => {
    const e = newEstimate({ defaultCurrency: "USD" }, "Prod");
    e.items = [newItem("vm", { region: "westeurope", settings: { hoursPerMonth: 730 } }), newItem("disks", { region: "westeurope", settings: { hoursPerMonth: 730 } })];
    e.notes = "n";
    const copy = duplicateEstimate(e);
    assert.notEqual(copy.id, e.id);
    assert.equal(copy.name, "Prod (copy)");
    assert.equal(copy.notes, "n");
    assert.equal(copy.items.length, 2);
    copy.items.forEach((item, i) => {
      assert.notEqual(item.id, e.items[i].id);
      assert.equal(item.name, e.items[i].name);
      assert.deepEqual(item.config, e.items[i].config);
      assert.notEqual(item.config, e.items[i].config);
    });
  });

  it("duplicateItem uses the display name for unnamed items", () => {
    const item = newItem("backup", { region: "x", settings: { hoursPerMonth: 730 } });
    const copy = duplicateItem(item);
    assert.notEqual(copy.id, item.id);
    assert.equal(copy.name, "Backup (copy)");
    const unnamed = duplicateItem({ ...item, name: "" });
    assert.equal(unnamed.name, "Backup (copy)");
    assert.equal(itemDisplayName({ ...item, name: "  " }), "Backup");
  });
});

describe("sanitizeEstimate", () => {
  it("fills ids, timestamps and defaults", () => {
    const e = sanitizeEstimate({ name: "Old", items: [{ moduleId: "vm", config: { instances: 2 } }] }, { now: "2026-01-01T00:00:00.000Z" });
    assert.match(e.id, UUID);
    assert.equal(e.createdAt, "2026-01-01T00:00:00.000Z");
    assert.equal(e.updatedAt, "2026-01-01T00:00:00.000Z");
    assert.equal(e.currency, "USD");
    const [vm] = e.items;
    assert.ok(vm.moduleId === "vm");
    assert.equal(vm.config.instances, 2);
    assert.equal(vm.config.hoursPerMonth, 730);
    assert.equal(vm.region, "");
    assert.ok(estimateSchema.safeParse(e).success);
  });

  it("keeps ids unless freshIds, and repairs duplicates", () => {
    const raw = {
      id: "e1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      items: [
        { id: "a", moduleId: "asr" },
        { id: "a", moduleId: "asr" },
      ],
    };
    const kept = sanitizeEstimate(raw);
    assert.equal(kept.id, "e1");
    assert.equal(kept.items[0].id, "a");
    assert.notEqual(kept.items[1].id, "a");
    assert.equal(kept.updatedAt, "2026-01-02T00:00:00.000Z");
    const fresh = sanitizeEstimate(raw, { freshIds: true });
    assert.notEqual(fresh.id, "e1");
    assert.ok(fresh.items.every((i) => i.id !== "a"));
  });

  it("drops invalid items and repairs invalid fields with warnings", () => {
    const warnings: string[] = [];
    const e = sanitizeEstimate(
      {
        name: 42,
        currency: "eur",
        items: [{ moduleId: "nope" }, "junk", { moduleId: "disks", name: "D", config: { disks: -1, tier: "P30", extra: 1 } }],
      },
      { onWarning: (m) => warnings.push(m) },
    );
    assert.equal(e.name, "Untitled estimate");
    assert.equal(e.currency, "EUR");
    assert.equal(e.items.length, 1);
    assert.equal(e.items[0].moduleId, "disks");
    assert.equal(e.items[0].config.disks, 1);
    assert.equal(e.items[0].config.tier, "P30");
    assert.ok(!("extra" in e.items[0].config));
    assert.ok(warnings.some((w) => /dropped/.test(w)));
    assert.ok(warnings.some((w) => /"disks"/.test(w)));
  });

  it("throws on non-objects", () => {
    assert.throws(() => sanitizeEstimate("x"), /Invalid estimate/);
    assert.throws(() => sanitizeEstimate([]), /Invalid estimate/);
    assert.throws(() => sanitizeEstimate(null), /Invalid estimate/);
  });

  it("sanitizeSettings repairs fields", () => {
    const s = sanitizeSettings({ theme: "neon", hoursPerMonth: 700, defaultCurrency: "gbp" });
    assert.equal(s.theme, "system");
    assert.equal(s.hoursPerMonth, 700);
    assert.equal(s.defaultCurrency, "GBP");
    assert.equal(s.defaultRegion, "westeurope");
  });
});
