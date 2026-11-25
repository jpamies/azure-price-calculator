import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HOURS_PER_MONTH, SCHEMA_VERSION, persistedStateSchema } from "../src/domain/model.ts";
import { migratePersistedState } from "../src/store/migrations.ts";

function collect() {
  const messages: string[] = [];
  return { messages, warn: (m: string) => messages.push(m) };
}

describe("migratePersistedState", () => {
  it("fills defaults in v0-like data with missing fields", () => {
    const { messages, warn } = collect();
    const state = migratePersistedState(
      {
        estimates: [
          {
            id: "e1",
            name: "Legacy",
            items: [
              { id: "i1", moduleId: "vm", config: { armSkuName: "Standard_E4s_v5" } },
              { moduleId: "disks" },
            ],
          },
        ],
        settings: { defaultCurrency: "EUR" },
      },
      0,
      { warn },
    );
    assert.ok(persistedStateSchema.safeParse(state).success);
    const e = state.estimates[0];
    assert.equal(e.id, "e1");
    assert.equal(e.name, "Legacy");
    assert.equal(e.currency, "USD");
    assert.ok(!Number.isNaN(Date.parse(e.createdAt)));
    assert.equal(e.updatedAt, e.createdAt);
    assert.equal(e.items.length, 2);
    assert.equal(e.items[0].id, "i1");
    assert.equal(e.items[0].name, "");
    assert.equal(e.items[0].collapsed, false);
    assert.deepEqual(e.items[0].config, {
      os: "windows",
      armSkuName: "Standard_E4s_v5",
      instances: 1,
      hoursPerMonth: HOURS_PER_MONTH,
      commitment: "payg",
      riPayment: "monthly",
      spot: false,
    });
    assert.ok(e.items[1].id.length > 0);
    assert.equal(e.items[1].moduleId, "disks");
    assert.deepEqual(state.settings, { defaultCurrency: "EUR", defaultRegion: "westeurope", hoursPerMonth: 730, theme: "system" });
    assert.deepEqual(messages, []);
  });

  it("drops invalid items and estimates with warnings instead of failing", () => {
    const { messages, warn } = collect();
    const state = migratePersistedState(
      {
        estimates: [
          {
            id: "ok",
            name: "Keep me",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-02-01T00:00:00.000Z",
            items: [
              { id: "a", moduleId: "asr", name: "DR", config: { instances: 2 } },
              { id: "b", moduleId: "hologram", config: {} },
              null,
              { id: "c", moduleId: "backup", config: { instances: -3, redundancy: "LRS" } },
            ],
          },
          "garbage",
          { id: "ok", name: "Duplicate id", items: [] },
        ],
        settings: { theme: "neon", hoursPerMonth: 9999, lastRegion: "uksouth" },
      },
      SCHEMA_VERSION,
      { warn },
    );
    assert.equal(state.estimates.length, 2);
    const [keep, dup] = state.estimates;
    assert.equal(keep.updatedAt, "2026-02-01T00:00:00.000Z");
    assert.deepEqual(keep.items.map((i) => i.id), ["a", "c"]);
    assert.equal(keep.items[1].moduleId, "backup");
    if (keep.items[1].moduleId === "backup") {
      assert.equal(keep.items[1].config.instances, 1);
      assert.equal(keep.items[1].config.redundancy, "LRS");
    }
    assert.notEqual(dup.id, "ok");
    assert.equal(dup.name, "Duplicate id");
    assert.equal(state.settings.theme, "system");
    assert.equal(state.settings.hoursPerMonth, 730);
    assert.equal(state.settings.lastRegion, "uksouth");
    assert.ok(messages.some((m) => /item 2 was dropped/.test(m)), messages.join("\n"));
    assert.ok(messages.some((m) => /item 3 was dropped/.test(m)));
    assert.ok(messages.some((m) => /Estimate 2 was dropped/.test(m)));
    assert.ok(messages.some((m) => /"instances"/.test(m)));
    assert.ok(messages.some((m) => /settings: invalid value for "theme"/.test(m)));
  });

  it("returns defaults for missing or non-object state", () => {
    const empty = persistedStateSchema.parse({});
    assert.deepEqual(migratePersistedState(undefined, 0, { warn: () => {} }), empty);
    assert.deepEqual(migratePersistedState(null, 0, { warn: () => {} }), empty);
    const { messages, warn } = collect();
    assert.deepEqual(migratePersistedState("corrupt", 0, { warn }), empty);
    assert.deepEqual(migratePersistedState({ estimates: "nope" }, 0, { warn }), empty);
    assert.equal(messages.length, 2);
  });

  it("is idempotent and keeps valid current-version data unchanged", () => {
    const once = migratePersistedState({ estimates: [{ name: "A", items: [{ moduleId: "generic" }] }] }, 0, { warn: () => {} });
    const twice = migratePersistedState(JSON.parse(JSON.stringify(once)), SCHEMA_VERSION, { warn: () => {} });
    assert.deepEqual(twice, once);
  });

  it("tolerates data from a newer version (unknown fields stripped)", () => {
    const { messages, warn } = collect();
    const state = migratePersistedState({ estimates: [{ id: "x", name: "N", futureField: 1, items: [] }], settings: {} }, SCHEMA_VERSION + 1, { warn });
    assert.equal(state.estimates[0].name, "N");
    assert.ok(!("futureField" in state.estimates[0]));
    assert.ok(messages.some((m) => /newer than this app/.test(m)));
  });

  it("defaults to console.warn", (t) => {
    const spy = t.mock.method(console, "warn", () => {});
    migratePersistedState({ estimates: [{ items: [{ moduleId: "bogus" }] }] }, 0);
    assert.ok(spy.mock.callCount() >= 1);
    assert.match(String(spy.mock.calls[0].arguments[0]), /^\[azcalc\]/);
  });
});
