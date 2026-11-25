// Data layer (browser code) exercised in Node with a mocked fetch; IndexedDB is absent → no-op cache.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { clearCatalogCache, loadCatalog, regionName, slugFor } from "../src/data/catalog.ts";
import { clearShardCache, loadShard, peekShard, shardError, shardPlan } from "../src/data/shards.ts";

const DATE = "2026-11-24";
const COLS = ["meterId", "meterName", "productName", "skuName", "armSkuName", "unitOfMeasure", "type", "reservationTerm", "tierMinimumUnits", "retailPrice", "effectiveStartDate", "isWindows"];
const row = (id: string, price: number) => [id, "D2s v5", "Virtual Machines Dsv5 Series", "D2s v5", "Standard_D2s_v5", "1 Hour", "Consumption", "", 0, price, "2024-01-01", 0];

const SHARD_MAP = {
  "virtual-machines": {
    westeurope: { parts: 2, rows: 3, bytes: 1, spot: true, spotRows: 1 },
    eastus: { parts: 1, rows: 1, bytes: 1, spot: false },
    japaneast: { parts: 0, rows: 0, bytes: 0, spot: true, spotRows: 1 },
  },
  storage: { _global: { parts: 1, rows: 1, bytes: 1, spot: false } },
};

function baseFiles(): Record<string, unknown> {
  return {
    "./data/manifest.json": {
      schemaVersion: 1,
      pricesDate: DATE,
      generatedAt: `${DATE}T05:00:00Z`,
      currencyBase: "USD",
      hasSavingsPlan: false,
      source: { type: "fixture" },
      paths: {
        root: DATE,
        services: `${DATE}/index/services.json`,
        regions: `${DATE}/index/regions.json`,
        vmSkus: `${DATE}/index/vm-skus.json`,
        fx: `${DATE}/fx.json`,
        prices: `${DATE}/prices`,
        shards: `${DATE}/index/shards.json`,
      },
    },
    [`./data/${DATE}/index/shards.json`]: SHARD_MAP,
    [`./data/${DATE}/index/services.json`]: [
      { serviceFamily: "Compute", serviceName: "Virtual Machines", slug: "virtual-machines", regions: ["westeurope", "eastus"], rowCount: 4, hasSpot: true },
      { serviceFamily: "Storage", serviceName: "Storage", slug: "storage", regions: ["_global"], rowCount: 1, hasSpot: false },
    ],
    [`./data/${DATE}/index/regions.json`]: [
      { key: "westeurope", armRegionName: "westeurope", location: "EU West", displayName: "West Europe", geography: "Europe", rowCount: 3 },
    ],
    [`./data/${DATE}/index/vm-skus.json`]: { source: "seed", skus: { Standard_D2s_v5: { vCPUs: 2, memoryGB: 8, family: "Dsv5" } } },
    [`./data/${DATE}/fx.json`]: { asOf: DATE, base: "USD", rates: { USD: 1, EUR: 0.9 } },
    [`./data/${DATE}/prices/virtual-machines/westeurope.part1.json`]: { cols: COLS, rows: [row("a", 0.1), row("b", 0.2)] },
    [`./data/${DATE}/prices/virtual-machines/westeurope.part2.json`]: { cols: COLS, rows: [row("c", 0.3)] },
    [`./data/${DATE}/prices/virtual-machines/westeurope.spot.json`]: { cols: COLS, rows: [row("s", 0.01)] },
    [`./data/${DATE}/prices/virtual-machines/japaneast.spot.json`]: { cols: COLS, rows: [row("js", 0.02)] },
    [`./data/${DATE}/prices/storage/_global.json`]: { cols: COLS, rows: [row("g", 1)] },
  };
}

let files: Record<string, unknown> = {};
let calls: Array<{ url: string; init?: RequestInit }> = [];
const realFetch = globalThis.fetch;

beforeEach(() => {
  files = baseFiles();
  calls = [];
  clearCatalogCache();
  clearShardCache();
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const path = url.split("?")[0];
    return path in files ? new Response(JSON.stringify(files[path])) : new Response("not found", { status: 404 });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const fetched = (suffix: string) => calls.filter((c) => c.url.split("?")[0].endsWith(suffix)).length;

describe("loadCatalog", () => {
  it("fetches the manifest without caching, then the indexes (incl. shards.json), once", async () => {
    const catalog = await loadCatalog();
    const manifestCall = calls.find((c) => c.url.startsWith("./data/manifest.json?t="));
    assert.ok(manifestCall, calls.map((c) => c.url).join(", "));
    assert.equal(manifestCall.init?.cache, "no-store");
    const indexCall = calls.find((c) => c.url === `./data/${DATE}/index/shards.json`);
    assert.ok(indexCall);
    assert.equal(indexCall.init?.cache, undefined);
    assert.deepEqual(catalog.shards["virtual-machines"].westeurope, SHARD_MAP["virtual-machines"].westeurope);
    assert.equal(catalog.manifest.shards, undefined);
    assert.equal(catalog.manifest.pricesDate, DATE);
    assert.equal(catalog.manifest.source.type, "fixture");
    assert.equal(catalog.services.length, 2);
    assert.deepEqual(catalog.fx.rates, { USD: 1, EUR: 0.9 });
    assert.deepEqual(catalog.vmSpecs.Standard_D2s_v5, { vCPUs: 2, memoryGB: 8, family: "Dsv5" });
    assert.equal(slugFor(catalog, "Virtual Machines"), "virtual-machines");
    assert.equal(slugFor(catalog, "virtual machines"), undefined);
    assert.equal(regionName(catalog, "westeurope"), "West Europe");
    assert.equal(regionName(catalog, "eastus"), "eastus");
    assert.equal(await loadCatalog(), catalog);
    assert.equal(calls.length, 6);
  });

  it("falls back to the inline manifest.shards of legacy snapshots", async () => {
    const manifest = files["./data/manifest.json"] as { paths: Record<string, string> };
    const paths = { ...manifest.paths };
    delete paths.shards;
    files["./data/manifest.json"] = { ...manifest, paths, shards: SHARD_MAP };
    delete files[`./data/${DATE}/index/shards.json`];
    const catalog = await loadCatalog();
    assert.equal(fetched("shards.json"), 0);
    assert.deepEqual(catalog.shards, SHARD_MAP);
    const rows = await loadShard(catalog, { serviceName: "Virtual Machines", regionKey: "westeurope" });
    assert.deepEqual(rows.map((r) => r.meterId), ["a", "b", "c"]);
  });

  it("fails (retryable) when the shard index is missing", async () => {
    const index = files[`./data/${DATE}/index/shards.json`];
    delete files[`./data/${DATE}/index/shards.json`];
    await assert.rejects(loadCatalog(), /shard index \(HTTP 404\)/);
    files[`./data/${DATE}/index/shards.json`] = index;
    assert.ok((await loadCatalog()).shards.storage);
  });

  it("tolerates missing VM specs / FX but fails (and can retry) without the manifest", async (t) => {
    const warn = t.mock.method(console, "warn", () => {});
    delete files[`./data/${DATE}/fx.json`];
    delete files[`./data/${DATE}/index/vm-skus.json`];
    const catalog = await loadCatalog();
    assert.deepEqual(catalog.fx.rates, { USD: 1 });
    assert.deepEqual(catalog.vmSpecs, {});
    assert.equal(warn.mock.callCount(), 2);
    clearCatalogCache();
    const manifest = files["./data/manifest.json"];
    delete files["./data/manifest.json"];
    await assert.rejects(loadCatalog(), /price manifest \(HTTP 404\)/);
    files["./data/manifest.json"] = manifest;
    assert.equal((await loadCatalog()).manifest.pricesDate, DATE);
  });
});

describe("loadShard", () => {
  it("concatenates parts, caches in memory and dedupes concurrent loads", async () => {
    const catalog = await loadCatalog();
    const ref = { serviceName: "Virtual Machines", regionKey: "westeurope" };
    assert.deepEqual(shardPlan(catalog, ref)?.files, ["westeurope.part1.json", "westeurope.part2.json"]);
    assert.equal(peekShard(catalog, ref), undefined);
    const [a, b] = await Promise.all([loadShard(catalog, ref), loadShard(catalog, ref)]);
    assert.equal(a, b);
    assert.deepEqual(a.map((r) => r.meterId), ["a", "b", "c"]);
    assert.equal(fetched("westeurope.part1.json"), 1);
    assert.equal(fetched("westeurope.part2.json"), 1);
    assert.equal(peekShard(catalog, ref), a);
    assert.equal(await loadShard(catalog, ref), a);
    assert.equal(fetched("westeurope.part1.json"), 1);
  });

  it("loads Spot only when the manifest says so; missing shards are []", async () => {
    const catalog = await loadCatalog();
    const spot = await loadShard(catalog, { serviceName: "Virtual Machines", regionKey: "westeurope", spot: true });
    assert.deepEqual(spot.map((r) => r.meterId), ["s"]);
    assert.deepEqual(await loadShard(catalog, { serviceName: "Virtual Machines", regionKey: "eastus", spot: true }), []);
    assert.deepEqual(await loadShard(catalog, { serviceName: "Virtual Machines", regionKey: "brazilsouth" }), []);
    // Spot-only region (parts 0): no main file is requested, the Spot file loads.
    assert.deepEqual(await loadShard(catalog, { serviceName: "Virtual Machines", regionKey: "japaneast" }), []);
    assert.deepEqual(peekShard(catalog, { serviceName: "Virtual Machines", regionKey: "japaneast" }), []);
    const jpSpot = await loadShard(catalog, { serviceName: "Virtual Machines", regionKey: "japaneast", spot: true });
    assert.deepEqual(jpSpot.map((r) => r.meterId), ["js"]);
    assert.deepEqual(await loadShard(catalog, { serviceName: "Unknown Service", regionKey: "westeurope" }), []);
    assert.deepEqual(peekShard(catalog, { serviceName: "Unknown Service", regionKey: "westeurope" }), []);
    const global = await loadShard(catalog, { serviceName: "Storage", regionKey: "" });
    assert.deepEqual(global.map((r) => r.meterId), ["g"]);
    assert.equal(fetched("eastus.spot.json") + fetched("japaneast.json") + fetched("brazilsouth.json"), 0);
  });

  it("propagates HTTP errors, records them and retries on the next call", async () => {
    const catalog = await loadCatalog();
    const ref = { serviceName: "Virtual Machines", regionKey: "eastus" };
    await assert.rejects(loadShard(catalog, ref), /prices for Virtual Machines \(eastus\) \(HTTP 404\)/);
    assert.match(shardError(catalog, ref) ?? "", /HTTP 404/);
    files[`./data/${DATE}/prices/virtual-machines/eastus.json`] = { cols: COLS, rows: [row("e", 0.5)] };
    const rows = await loadShard(catalog, ref);
    assert.deepEqual(rows.map((r) => r.meterId), ["e"]);
    assert.equal(shardError(catalog, ref), undefined);
  });

  it("rejects invalid shard documents", async () => {
    const catalog = await loadCatalog();
    files[`./data/${DATE}/prices/virtual-machines/eastus.json`] = { cols: ["meterName"], rows: [] };
    await assert.rejects(loadShard(catalog, { serviceName: "Virtual Machines", regionKey: "eastus" }), /missing column "meterId"/);
  });
});
