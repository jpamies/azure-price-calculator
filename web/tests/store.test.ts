// Store (browser code) exercised in Node with an in-memory localStorage, seeded with v0 data.
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import type { Estimate } from "../src/domain/model.ts";

class MemoryStorage {
  map = new Map<string, string>();
  failWrites = false;
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    if (this.failWrites) throw new DOMException("Quota exceeded", "QuotaExceededError");
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
}

const storage = new MemoryStorage();
storage.setItem(
  "azcalc.v1",
  JSON.stringify({
    state: {
      estimates: [{ id: "legacy", name: "Legacy", items: [{ id: "i1", moduleId: "vm" }, { id: "i2", moduleId: "bogus" }] }],
      settings: { defaultRegion: "northeurope", defaultCurrency: "EUR" },
    },
    version: 0,
  }),
);
Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true, writable: true });

type StoreModule = typeof import("../src/store/useStore.ts");
let mod: StoreModule;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const est = (id: string): Estimate => {
  const e = mod.useStore.getState().estimates.find((x) => x.id === id);
  assert.ok(e, `estimate ${id}`);
  return e;
};
const persisted = () => JSON.parse(storage.getItem("azcalc.v1") ?? "null");

before(async () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    mod = await import("../src/store/useStore.ts");
  } finally {
    console.warn = warn;
  }
});

describe("useStore", () => {
  it("hydrates and migrates v0 data (invalid item dropped), then saves v1", () => {
    const s = mod.useStore.getState();
    assert.equal(s.estimates.length, 1);
    assert.deepEqual(s.estimates[0].items.map((i) => i.id), ["i1"]);
    assert.equal(s.settings.defaultRegion, "northeurope");
    assert.equal(mod.useSaveStatus.getState().status, "saving");
    mod.flushSave();
    assert.equal(mod.useSaveStatus.getState().status, "saved");
    assert.equal(persisted().version, 1);
    assert.deepEqual(persisted().state.estimates[0].items.length, 1);
  });

  it("creates estimates with the default currency and adds items in the last/default region", () => {
    const s = mod.useStore.getState();
    const id = s.createEstimate("New one");
    const e = est(id);
    assert.equal(mod.useStore.getState().estimates[0].id, id);
    assert.equal(e.currency, "EUR");
    const vmId = s.addItem(id, "vm", { config: { instances: 2 } });
    assert.ok(vmId);
    const item = est(id).items[0];
    assert.equal(item.region, "northeurope");
    assert.equal(item.name, "Virtual machine");
    assert.equal(s.addItem("missing", "vm"), undefined);
  });

  it("updates items: region → lastRegion, shallow config merge, invalid keys ignored, collapse is view-only", async () => {
    const s = mod.useStore.getState();
    const id = s.createEstimate();
    const itemId = s.addItem(id, "vm") as string;
    const before = est(id).updatedAt;
    await sleep(5);
    const warn = console.warn;
    console.warn = () => {};
    try {
      s.updateItem(id, itemId, { region: "uksouth", config: { instances: 5, os: "linux", hoursPerMonth: -1 } as never });
    } finally {
      console.warn = warn;
    }
    const item = est(id).items[0];
    assert.equal(item.region, "uksouth");
    assert.equal(mod.useStore.getState().settings.lastRegion, "uksouth");
    assert.ok(item.moduleId === "vm");
    assert.equal(item.config.instances, 5);
    assert.equal(item.config.os, "linux");
    assert.equal(item.config.hoursPerMonth, 730);
    assert.notEqual(est(id).updatedAt, before);
    const edited = est(id).updatedAt;
    await sleep(5);
    s.updateItem(id, itemId, { collapsed: true });
    assert.equal(est(id).items[0].collapsed, true);
    assert.equal(est(id).updatedAt, edited);
    s.setAllCollapsed(id, false);
    assert.equal(est(id).items[0].collapsed, false);
    assert.equal(s.addItem(id, "disks"), est(id).items[1].id);
    assert.equal(est(id).items[1].region, "uksouth");
  });

  it("duplicates, moves and removes items", () => {
    const s = mod.useStore.getState();
    const id = s.createEstimate();
    const a = s.addItem(id, "vm", { name: "A" }) as string;
    const b = s.addItem(id, "disks", { name: "B" }) as string;
    const copy = s.duplicateItem(id, a) as string;
    assert.deepEqual(est(id).items.map((i) => i.name), ["A", "A (copy)", "B"]);
    s.moveItem(id, b, 0);
    assert.deepEqual(est(id).items.map((i) => i.id), [b, a, copy]);
    s.moveItem(id, b, 99);
    assert.deepEqual(est(id).items.map((i) => i.id), [a, copy, b]);
    s.removeItem(id, copy);
    assert.deepEqual(est(id).items.map((i) => i.id), [a, b]);
  });

  it("updates, duplicates, imports and deletes estimates", () => {
    const s = mod.useStore.getState();
    const id = s.createEstimate("Orig");
    s.updateEstimate(id, { name: "Renamed", currency: "gbp", notes: "hello" });
    assert.equal(est(id).name, "Renamed");
    assert.equal(est(id).currency, "GBP");
    assert.equal(est(id).notes, "hello");
    s.updateEstimate(id, { notes: "" });
    assert.ok(!("notes" in est(id)));
    const warn = console.warn;
    console.warn = () => {};
    try {
      s.updateEstimate(id, { currency: "Euro" });
      s.updateSettings({ defaultCurrency: "Euro" });
    } finally {
      console.warn = warn;
    }
    assert.equal(est(id).currency, "GBP");
    assert.notEqual(mod.useStore.getState().settings.defaultCurrency, "USD");
    const dup = s.duplicateEstimate(id) as string;
    assert.equal(est(dup).name, "Renamed (copy)");
    const [imported] = s.importEstimates([est(id)]);
    assert.notEqual(imported, id);
    assert.equal(est(imported).name, "Renamed");
    s.deleteEstimate(dup);
    assert.equal(mod.useStore.getState().estimates.some((e) => e.id === dup), false);
  });

  it("validates settings patches", () => {
    const s = mod.useStore.getState();
    const warn = console.warn;
    console.warn = () => {};
    try {
      s.updateSettings({ theme: "dark", hoursPerMonth: 5000, defaultCurrency: "jpy" });
    } finally {
      console.warn = warn;
    }
    const settings = mod.useStore.getState().settings;
    assert.equal(settings.theme, "dark");
    assert.equal(settings.hoursPerMonth, 730);
    assert.equal(settings.defaultCurrency, "JPY");
  });

  it("debounces writes and reports quota errors", async () => {
    mod.flushSave();
    const s = mod.useStore.getState();
    s.createEstimate("Debounced");
    assert.equal(mod.useSaveStatus.getState().status, "saving");
    assert.ok(!storage.getItem("azcalc.v1")?.includes("Debounced"));
    await sleep(mod.SAVE_DEBOUNCE_MS + 100);
    assert.equal(mod.useSaveStatus.getState().status, "saved");
    assert.ok(storage.getItem("azcalc.v1")?.includes("Debounced"));
    storage.failWrites = true;
    s.createEstimate("Too big");
    mod.flushSave();
    assert.equal(mod.useSaveStatus.getState().status, "error");
    assert.match(mod.useSaveStatus.getState().error ?? "", /storage is full/);
    storage.failWrites = false;
    s.createEstimate("Recovered");
    mod.flushSave();
    assert.equal(mod.useSaveStatus.getState().status, "saved");
  });

  it("replaceAll validates, clearAll resets", () => {
    const s = mod.useStore.getState();
    const warn = console.warn;
    console.warn = () => {};
    try {
      s.replaceAll({ estimates: [{ id: "r", name: "Restored", items: [{ moduleId: "nope" }] }], settings: { theme: "x" } } as never);
    } finally {
      console.warn = warn;
    }
    const state = mod.useStore.getState();
    assert.deepEqual(state.estimates.map((e) => [e.id, e.name, e.items.length]), [["r", "Restored", 0]]);
    assert.equal(state.settings.theme, "system");
    s.clearAll();
    assert.deepEqual(mod.useStore.getState().estimates, []);
    assert.equal(mod.useStore.getState().settings.defaultRegion, "westeurope");
    mod.flushSave();
  });

  it("keeps a copy of corrupted storage and starts fresh on rehydrate", async () => {
    storage.setItem("azcalc.v1", "{not json");
    const warn = console.warn;
    console.warn = () => {};
    try {
      await mod.useStore.persist.rehydrate();
    } finally {
      console.warn = warn;
    }
    assert.ok([...storage.map.keys()].some((k) => k.startsWith("azcalc.v1.corrupt-")));
  });
});
