// Pure helpers of the (browser) catalog module: manifest/index parsing and date checks.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  dataUrl,
  isStale,
  parseFx,
  parseManifest,
  parseRegions,
  parseShardIndex,
  parseServices,
  parseVmSpecs,
  regionKeyFor,
  regionName,
  slugify,
  snapshotAgeDays,
} from "../src/data/catalog.ts";

const MANIFEST = {
  schemaVersion: 1,
  pricesDate: "2026-11-24",
  generatedAt: "2026-11-24T09:41:07Z",
  currencyBase: "USD",
  hasSavingsPlan: true,
  source: { type: "fixture", repo: "sbroenne/azureretailprices-exporter" },
  paths: {
    root: "2026-11-24",
    services: "2026-11-24/index/services.json",
    regions: "2026-11-24/index/regions.json",
    vmSkus: "2026-11-24/index/vm-skus.json",
    fx: "2026-11-24/fx.json",
    prices: "2026-11-24/prices",
    shards: "2026-11-24/index/shards.json",
  },
  stats: { rowsPublished: 10, shardCount: 1, files: 4, bytes: 1000 },
};

const SHARD_MAP = { "virtual-machines": { westeurope: { parts: 2, rows: 10, bytes: 100, spot: true, spotRows: 3 }, bad: 5 } };

/** Snapshot published before index/shards.json existed: the map is inline. */
const LEGACY_MANIFEST = { ...MANIFEST, paths: { ...MANIFEST.paths, shards: undefined }, shards: SHARD_MAP };

describe("catalog helpers", () => {
  it("parses a manifest pointing to index/shards.json", () => {
    const m = parseManifest(MANIFEST);
    assert.equal(m.pricesDate, "2026-11-24");
    assert.equal(m.source.type, "fixture");
    assert.equal(m.hasSavingsPlan, true);
    assert.equal(m.paths.shards, "2026-11-24/index/shards.json");
    assert.equal(m.shards, undefined);
    assert.equal(m.stats?.shardCount, 1);
  });

  it("still parses legacy manifests with an inline shard map", () => {
    const m = parseManifest(LEGACY_MANIFEST);
    assert.equal(m.paths.shards, undefined);
    assert.deepEqual(m.shards, { "virtual-machines": { westeurope: { parts: 2, rows: 10, bytes: 100, spot: true, spotRows: 3 } } });
  });

  it("parses the shard index (bare or wrapped), keeping parts 0", () => {
    const index = parseShardIndex({
      storage: { eastus: { parts: 0, rows: 0, bytes: 0, spot: true, spotRows: 4 }, westus: { rows: 3 } },
      broken: 7,
    });
    assert.deepEqual(index, {
      storage: {
        eastus: { parts: 0, rows: 0, bytes: 0, spot: true, spotRows: 4 },
        westus: { parts: 1, rows: 3, bytes: 0, spot: false },
      },
    });
    assert.deepEqual(parseShardIndex({ schemaVersion: 1, shards: SHARD_MAP }), parseShardIndex(SHARD_MAP));
    assert.deepEqual(parseShardIndex({}), {});
    assert.throws(() => parseShardIndex([]), /shard index is invalid/);
    assert.throws(() => parseShardIndex(null), /shard index is invalid/);
  });

  it("rejects invalid or newer manifests", () => {
    assert.throws(() => parseManifest(null), /invalid/);
    assert.throws(() => parseManifest({ ...MANIFEST, paths: { ...MANIFEST.paths, shards: "" } }), /missing paths\.shards/);
    assert.throws(() => parseManifest({ ...MANIFEST, pricesDate: "24/11/2026" }), /pricesDate/);
    assert.throws(() => parseManifest({ ...MANIFEST, paths: { ...MANIFEST.paths, fx: "" } }), /paths\.fx/);
    assert.throws(() => parseManifest({ ...MANIFEST, schemaVersion: 2 }), /newer than this app/);
  });

  it("parses the indexes leniently", () => {
    assert.deepEqual(parseServices([{ serviceName: "Storage", slug: "storage", regions: ["westeurope", 3] }, { slug: "x" }]), [
      { serviceFamily: "Other", serviceName: "Storage", slug: "storage", regions: ["westeurope"], rowCount: 0, hasSpot: false },
    ]);
    assert.throws(() => parseServices({}), /expected a list/);
    const [global] = parseRegions([{ key: "_global", armRegionName: "" }]);
    assert.equal(global.displayName, "Global (no region)");
    assert.deepEqual(parseVmSpecs({ skus: { A: { vCPUs: 2, memoryGB: 8, family: "D" }, B: null } }), { A: { vCPUs: 2, memoryGB: 8, family: "D" }, B: null });
    assert.deepEqual(parseFx({ asOf: "2026-11-24", rates: { eur: 0.9, USD: 1.1, BAD: -1 } }, "x"), { asOf: "2026-11-24", base: "USD", rates: { USD: 1, EUR: 0.9 } });
    assert.deepEqual(parseFx(null, "2026-11-24"), { asOf: "2026-11-24", base: "USD", rates: { USD: 1 } });
  });

  it("slugify / regionKeyFor / regionName / dataUrl", () => {
    assert.equal(slugify("Azure Site Recovery"), "azure-site-recovery");
    assert.equal(slugify("Data & AI (preview)"), "data-and-ai-preview");
    assert.equal(regionKeyFor(""), "_global");
    assert.equal(regionKeyFor("westeurope"), "westeurope");
    assert.equal(regionName(undefined, "_global"), "Global (no region)");
    assert.equal(regionName(undefined, "westeurope"), "westeurope");
    assert.equal(dataUrl("manifest.json"), "./data/manifest.json");
  });

  it("isStale: more than N days old", () => {
    const now = new Date("2026-11-27T23:00:00Z");
    assert.equal(snapshotAgeDays("2026-11-24", now), 3);
    assert.equal(isStale("2026-11-24", now), false);
    assert.equal(isStale("2026-11-23", now), true);
    assert.equal(isStale("2026-11-20", now, 7), false);
    assert.equal(isStale("garbage", now), false);
  });
});
