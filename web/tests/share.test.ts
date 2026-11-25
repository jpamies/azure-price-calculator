import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { newEstimate, newItem } from "../src/domain/factory.ts";
import { deflateRaw } from "../src/domain/export/zip.ts";
import {
  SHARE_PARAM,
  SHARE_URL_MAX,
  SHARE_URL_WARN,
  base64UrlDecode,
  base64UrlEncode,
  buildSharePayload,
  buildShareUrl,
  decodeShare,
  encodeShare,
  readShareParam,
  shareUrlLevel,
  stripShareParam,
} from "../src/domain/share.ts";
import { SETTINGS, sampleEstimate } from "./_platform-fixtures.ts";

async function encodeRaw(value: unknown, version = "1"): Promise<string> {
  const bytes = await deflateRaw(new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value)));
  return `${version}.${base64UrlEncode(bytes)}`;
}

describe("base64url", () => {
  it("roundtrips every length", () => {
    for (let n = 0; n < 40; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + n) & 0xff);
      const text = base64UrlEncode(bytes);
      assert.match(text, /^[A-Za-z0-9_-]*$/);
      assert.deepEqual(base64UrlDecode(text), bytes);
    }
  });

  it("matches Node's base64url and rejects invalid input", () => {
    const bytes = new TextEncoder().encode("¿Producción? ✓ <>&");
    assert.equal(base64UrlEncode(bytes), Buffer.from(bytes).toString("base64url"));
    assert.throws(() => base64UrlDecode("ab$c"));
    assert.throws(() => base64UrlDecode("abcde"));
  });
});

describe("share links", () => {
  it("roundtrips configuration (never prices) with fresh ids", async () => {
    const { estimate } = sampleEstimate();
    estimate.name = "Producción €";
    estimate.currency = "EUR";
    estimate.notes = "Phase 1";
    const encoded = await encodeShare(estimate, "2026-11-24");
    assert.match(encoded, /^1\.[A-Za-z0-9_-]+$/);
    const { estimate: decoded, pricesDate, skippedItems } = await decodeShare(encoded);
    assert.equal(pricesDate, "2026-11-24");
    assert.equal(skippedItems, 0);
    assert.equal(decoded.name, "Producción €");
    assert.equal(decoded.currency, "EUR");
    assert.equal(decoded.notes, "Phase 1");
    assert.equal(decoded.pricesDate, "2026-11-24");
    assert.notEqual(decoded.id, estimate.id);
    assert.equal(decoded.items.length, estimate.items.length);
    decoded.items.forEach((item, i) => {
      const src = estimate.items[i];
      assert.notEqual(item.id, src.id);
      assert.equal(item.moduleId, src.moduleId);
      assert.equal(item.name, src.name);
      assert.equal(item.region, src.region);
      assert.deepEqual(item.config, src.config);
    });
  });

  it("omits config keys equal to the defaults and default names", () => {
    const e = newEstimate(SETTINGS, "E");
    e.items = [
      newItem("vm", { region: "westeurope", settings: SETTINGS, config: { instances: 3 } }),
      newItem("disks", { region: "eastus", settings: SETTINGS, name: "Data disks" }),
    ];
    const payload = buildSharePayload(e, "2026-11-24");
    assert.deepEqual(payload, {
      v: 1,
      pricesDate: "2026-11-24",
      estimate: {
        name: "E",
        currency: "USD",
        items: [
          { moduleId: "vm", region: "westeurope", config: { instances: 3 } },
          { moduleId: "disks", name: "Data disks", region: "eastus", config: {} },
        ],
      },
    });
    assert.ok(!JSON.stringify(payload).includes("Price"));
  });

  it("keeps a 50-VM estimate under the URL limits", async () => {
    const e = newEstimate(SETTINGS, "Big");
    e.items = Array.from({ length: 50 }, (_, i) =>
      newItem("vm", { region: "westeurope", settings: SETTINGS, name: `Server ${i}`, config: { armSkuName: `Standard_D${(i % 8) + 2}s_v5`, instances: i + 1 } }),
    );
    const url = buildShareUrl("https://example.github.io/azure-price-calculator/", await encodeShare(e, "2026-11-24"));
    assert.ok(url.length < SHARE_URL_WARN, `url length ${url.length}`);
    assert.equal(shareUrlLevel(url), "ok");
    assert.equal(shareUrlLevel("x".repeat(SHARE_URL_WARN + 1)), "warn");
    assert.equal(shareUrlLevel("x".repeat(SHARE_URL_MAX + 1)), "too-long");
  });

  it("rejects garbage with friendly errors", async () => {
    await assert.rejects(decodeShare(""), /empty/);
    await assert.rejects(decodeShare("garbage"), /damaged or incomplete/);
    await assert.rejects(decodeShare("1.!!!"), /damaged or incomplete/);
    await assert.rejects(decodeShare("1.AAAAAAAA"), /damaged or incomplete/);
    await assert.rejects(decodeShare("2.AAAA"), /newer version/);
    await assert.rejects(decodeShare(await encodeRaw("not json")), /damaged or incomplete/);
    await assert.rejects(decodeShare(await encodeRaw({ v: 1, estimate: { items: 3 } })), /damaged or incomplete/);
    await assert.rejects(decodeShare(await encodeRaw({ v: 2, estimate: { items: [] } })), /newer version/);
    const valid = await encodeShare(newEstimate(SETTINGS, "x"));
    await assert.rejects(decodeShare(valid.slice(0, -4)), /damaged or incomplete/);
  });

  it("skips invalid items, applies defaults and accepts URL-encoded input", async () => {
    const encoded = await encodeRaw({
      v: 1,
      pricesDate: "not-a-date",
      estimate: { name: "Mixed", currency: "gbp", items: [{ moduleId: "nope" }, { moduleId: "asr", region: "uksouth", config: { instances: 4 } }, 7] },
    });
    const { estimate, pricesDate, skippedItems } = await decodeShare(encoded.replace(".", "%2E"));
    assert.equal(pricesDate, undefined);
    assert.equal(skippedItems, 2);
    assert.equal(estimate.currency, "GBP");
    assert.equal(estimate.items.length, 1);
    assert.equal(estimate.items[0].name, "Site Recovery");
    assert.deepEqual(estimate.items[0].config, { scenario: "azure-to-azure", instances: 4 });
  });
});

describe("share URL helpers", () => {
  it("buildShareUrl keeps the path and other params, replaces s and drops the hash", () => {
    assert.equal(
      buildShareUrl("https://u.github.io/repo/?s=old&utm=1#/estimate/abc", "1.abc_-"),
      "https://u.github.io/repo/?utm=1&s=1.abc_-",
    );
    assert.equal(buildShareUrl("http://localhost:5173/", "1.x"), "http://localhost:5173/?s=1.x");
  });

  it("readShareParam reads the query (and hash forms)", () => {
    assert.equal(SHARE_PARAM, "s");
    assert.equal(readShareParam("https://u.github.io/repo/?s=1.abc#/"), "1.abc");
    assert.equal(readShareParam("https://u.github.io/repo/#/?s=1.def"), "1.def");
    assert.equal(readShareParam("https://u.github.io/repo/#s=1.ghi"), "1.ghi");
    assert.equal(readShareParam("https://u.github.io/repo/#/estimate/1"), null);
    assert.equal(readShareParam("https://u.github.io/repo/?s="), null);
    assert.equal(readShareParam("not a url"), null);
  });

  it("stripShareParam removes only the share parameter", () => {
    assert.equal(stripShareParam("https://u.github.io/repo/?s=1.abc#/estimate/1"), "https://u.github.io/repo/#/estimate/1");
    assert.equal(stripShareParam("https://u.github.io/repo/?a=1&s=1.abc"), "https://u.github.io/repo/?a=1");
    assert.equal(stripShareParam("https://u.github.io/repo/#/?s=1.abc&x=2"), "https://u.github.io/repo/#/?x=2");
    assert.equal(stripShareParam("https://u.github.io/repo/#s=1.abc"), "https://u.github.io/repo/");
    assert.equal(stripShareParam("https://u.github.io/repo/"), "https://u.github.io/repo/");
  });
});
