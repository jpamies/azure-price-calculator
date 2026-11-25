// Store: setCachedTotals (display cache of the estimates list) never counts as an edit.
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { estimateSchema } from "../src/domain/model.ts";

const memory = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  writable: true,
  value: {
    get length() {
      return memory.size;
    },
    key: (i: number) => [...memory.keys()][i] ?? null,
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, String(v)),
    removeItem: (k: string) => void memory.delete(k),
    clear: () => memory.clear(),
  },
});

type StoreModule = typeof import("../src/store/useStore.ts");
let mod: StoreModule;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  mod = await import("../src/store/useStore.ts");
});

const totals = (monthlyUsd: number, computedAt: string, pricesDate = "2026-11-24") => ({
  monthlyUsd,
  upfrontUsd: 0,
  amortizedMonthlyUsd: monthlyUsd,
  pricesDate,
  computedAt,
});

describe("setCachedTotals", () => {
  it("stores the totals without bumping updatedAt, and persists them", async () => {
    const s = mod.useStore.getState();
    const id = s.createEstimate("Cached");
    const before = mod.useStore.getState().estimates.find((e) => e.id === id)!;
    await sleep(5);
    s.setCachedTotals(id, totals(123.45, new Date().toISOString()));
    const after = mod.useStore.getState().estimates.find((e) => e.id === id)!;
    assert.equal(after.updatedAt, before.updatedAt);
    assert.equal(after.cachedTotals?.monthlyUsd, 123.45);
    assert.ok(estimateSchema.safeParse(after).success);
    mod.flushSave();
    const saved = JSON.parse(memory.get("azcalc.v1") ?? "{}");
    assert.equal(saved.state.estimates.find((e: { id: string }) => e.id === id).cachedTotals.monthlyUsd, 123.45);
  });

  it("is a no-op when unchanged and newer than the last edit", () => {
    const s = mod.useStore.getState();
    const id = s.estimates[0].id;
    const estimatesBefore = mod.useStore.getState().estimates;
    s.setCachedTotals(id, totals(123.45, new Date().toISOString()));
    assert.equal(mod.useStore.getState().estimates, estimatesBefore);
  });

  it("refreshes the timestamp after an edit even when the amounts are equal", async () => {
    const s = mod.useStore.getState();
    const id = s.estimates[0].id;
    await sleep(5);
    s.updateEstimate(id, { name: "Renamed" });
    const edited = mod.useStore.getState().estimates[0];
    assert.ok(edited.cachedTotals!.computedAt < edited.updatedAt);
    await sleep(5);
    const stamp = new Date().toISOString();
    s.setCachedTotals(id, totals(123.45, stamp));
    const refreshed = mod.useStore.getState().estimates[0];
    assert.equal(refreshed.cachedTotals?.computedAt, stamp);
    assert.equal(refreshed.updatedAt, edited.updatedAt);
  });

  it("ignores non-finite amounts and removes the cache with undefined", () => {
    const s = mod.useStore.getState();
    const id = s.estimates[0].id;
    const warn = console.warn;
    console.warn = () => {};
    try {
      s.setCachedTotals(id, totals(Number.NaN, new Date().toISOString()));
    } finally {
      console.warn = warn;
    }
    assert.equal(mod.useStore.getState().estimates[0].cachedTotals?.monthlyUsd, 123.45);
    s.setCachedTotals(id, undefined);
    assert.equal(mod.useStore.getState().estimates[0].cachedTotals, undefined);
    assert.equal("cachedTotals" in mod.useStore.getState().estimates[0], false);
  });

  it("ignores unknown estimates", () => {
    const before = mod.useStore.getState().estimates;
    mod.useStore.getState().setCachedTotals("nope", totals(1, new Date().toISOString()));
    assert.equal(mod.useStore.getState().estimates, before);
  });
});
