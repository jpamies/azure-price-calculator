import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { normalize, rankBy, score, tokenMatch } from "../src/domain/search.ts";

describe("normalize", () => {
  test("lowercases, strips Standard_, maps _ and - to spaces, collapses spaces", () => {
    assert.equal(normalize("Standard_D8as_v5"), "d8as v5");
    assert.equal(normalize("D8as_v5"), "d8as v5");
    assert.equal(normalize("  d8as   v5 "), "d8as v5");
    assert.equal(normalize("Standard_E32-16s_v5"), "e32 16s v5");
    assert.equal(normalize("Standard SSD Managed Disks"), "standard ssd managed disks");
    assert.equal(normalize(""), "");
  });
});

describe("tokenMatch", () => {
  test("every token must occur", () => {
    assert.ok(tokenMatch("Standard_D8as_v5", "d8as v5"));
    assert.ok(tokenMatch("Standard_D8as_v5", "v5 D8AS"));
    assert.ok(tokenMatch(["Virtual Machines Dasv5 Series", "D8as v5"], "dasv5 d8as"));
    assert.ok(!tokenMatch("Standard_D8as_v5", "d8as v6"));
    assert.ok(tokenMatch("anything", ""));
  });
});

describe("score / rankBy", () => {
  const skus = [
    "Standard_D48as_v5",
    "Standard_D8ads_v5",
    "Standard_D8as_v4",
    "Standard_D8as_v5_Promo",
    "Standard_D8as_v5",
    "Standard_D8a_v4",
  ];

  for (const q of ["D8as_v5", "Standard_D8as_v5", "d8as v5", "D8AS V5"]) {
    test(`"${q}" finds Standard_D8as_v5 first`, () => {
      const ranked = rankBy(skus, q, (s) => s);
      assert.equal(ranked[0], "Standard_D8as_v5");
      assert.ok(!ranked.includes("Standard_D8ads_v5"));
      assert.ok(!ranked.includes("Standard_D8as_v4"));
    });
  }

  test("exact > prefix > contains > spread tokens > none", () => {
    const exact = score("Standard_D8as_v5", "d8as v5");
    const prefix = score("Standard_D8as_v5_Promo", "d8as v5");
    const contains = score("Virtual Machines D8as v5 Windows", "d8as v5");
    const spread = score(["D8as", "v5"], "d8as v5");
    assert.equal(exact, 1000);
    assert.ok(exact > prefix && prefix > contains && contains > spread && spread > 0);
    assert.equal(score("Standard_D4s_v5", "d8as"), 0);
  });

  test("empty query keeps items and order", () => {
    assert.deepEqual(rankBy(skus, "", (s) => s), skus);
    assert.deepEqual(rankBy(skus, "  ", (s) => s, 2), skus.slice(0, 2));
  });

  test("limit and multi-field ranking", () => {
    const items = [
      { name: "Hot LRS Write Operations", product: "General Block Blob v2" },
      { name: "Hot LRS Data Stored", product: "General Block Blob v2" },
      { name: "LRS Data Stored", product: "Backup" },
    ];
    const ranked = rankBy(items, "lrs data stored", (i) => [i.name, i.product]);
    assert.equal(ranked[0].name, "LRS Data Stored");
    assert.equal(ranked.length, 2);
    assert.equal(rankBy(items, "lrs", (i) => [i.name], 1).length, 1);
  });
});
