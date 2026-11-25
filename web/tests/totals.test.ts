import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { newEstimate, newItem } from "../src/domain/factory.ts";
import { CATEGORY_LABELS, COMMITMENT_LABELS, estimateTotals, isSpotLine, lineCommitment } from "../src/domain/totals.ts";
import { SETTINGS, line, result, sampleEstimate, titleOf } from "./_platform-fixtures.ts";

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

describe("estimateTotals", () => {
  const { estimate, results, ids } = sampleEstimate();
  const t = estimateTotals(estimate, results, titleOf);

  it("sums monthly, upfront, amortized and annual", () => {
    close(t.monthlyUsd, 590);
    close(t.upfrontUsd, 1200);
    close(t.amortizedMonthlyUsd, 690);
    close(t.annualUsd, 590 * 12 + 1200);
  });

  it("reports pending and unavailable items", () => {
    assert.deepEqual(t.pendingItems, [{ id: ids.backup, title: "Backup" }]);
    assert.deepEqual(t.unavailableItems, [{ id: ids.asr, title: "Site Recovery" }]);
    assert.deepEqual(t.incompleteItems, []);
  });

  it("breaks down by service (titleOf), sorted by amortized monthly desc", () => {
    assert.deepEqual(
      t.byService.map((e) => [e.key, e.label, e.monthlyUsd, e.upfrontUsd, e.amortizedMonthlyUsd]),
      [
        ["Virtual Machines", "Virtual Machines", 320, 1200, 420],
        ["Managed Disks", "Managed Disks", 270, 0, 270],
      ],
    );
  });

  it("breaks down by category with labels", () => {
    assert.deepEqual(
      t.byCategory.map((e) => [e.key, e.label, e.monthlyUsd, e.upfrontUsd, e.amortizedMonthlyUsd]),
      [
        ["compute", "Compute", 220, 1200, 320],
        ["storage", "Storage", 270, 0, 270],
        ["license", "Licenses", 100, 0, 100],
      ],
    );
    assert.equal(CATEGORY_LABELS.dr, "Disaster recovery");
    assert.equal(CATEGORY_LABELS.network, "Networking");
  });

  it("breaks down by commitment (no commitment = PAYG, Spot detected)", () => {
    assert.deepEqual(
      t.byCommitment.map((e) => [e.key, e.label, e.monthlyUsd, e.upfrontUsd, e.amortizedMonthlyUsd]),
      [
        ["payg", "PAYG", 370, 0, 370],
        ["ri3y", "Reserved 3Y", 200, 0, 200],
        ["ri1y", "Reserved 1Y", 0, 1200, 100],
        ["spot", "Spot", 20, 0, 20],
      ],
    );
    assert.equal(COMMITMENT_LABELS.sp3y, "Savings plan 3Y");
  });

  it("handles an empty estimate and missing results", () => {
    const empty = estimateTotals(newEstimate(SETTINGS), {}, titleOf);
    assert.equal(empty.monthlyUsd, 0);
    assert.equal(empty.annualUsd, 0);
    assert.deepEqual(empty.byService, []);
    const pending = estimateTotals(estimate, {}, titleOf);
    assert.equal(pending.pendingItems.length, estimate.items.length);
    assert.equal(pending.monthlyUsd, 0);
  });

  it("ignores non-finite amounts", () => {
    const e = newEstimate(SETTINGS);
    const item = newItem("generic", { region: "westeurope", settings: SETTINGS });
    e.items = [item];
    const r = result([line({ id: "x", monthlyUsd: Number.NaN })]);
    const tt = estimateTotals(e, { [item.id]: { ...r, monthlyUsd: Number.NaN, amortizedMonthlyUsd: Number.NaN } }, titleOf);
    assert.equal(tt.monthlyUsd, 0);
    assert.equal(tt.byCategory[0].monthlyUsd, 0);
  });
});

describe("Spot / commitment classification", () => {
  it("uses the line commitment when it is not PAYG", () => {
    const vm = newItem("vm", { region: "", settings: SETTINGS, config: { spot: true } });
    assert.equal(lineCommitment(line({ id: "c", commitment: "sp1y" }), vm), "sp1y");
  });

  it("VM items with spot and PAYG are Spot for compute/license lines only", () => {
    const vm = newItem("vm", { region: "", settings: SETTINGS, config: { spot: true } });
    assert.equal(lineCommitment(line({ id: "c" }), vm), "spot");
    assert.equal(lineCommitment(line({ id: "l", kind: "license", commitment: "payg" }), vm), "spot");
    assert.equal(lineCommitment(line({ id: "o", kind: "other" }), vm), "payg");
    const reserved = newItem("vm", { region: "", settings: SETTINGS, config: { spot: true, commitment: "ri1y" } });
    assert.equal(isSpotLine(line({ id: "c" }), reserved), false);
  });

  it("generic Spot/Low Priority meters and 'Spot' notes are Spot", () => {
    const g = newItem("generic", { region: "", settings: SETTINGS, config: { meterName: "D2 v3 Low Priority" } });
    assert.equal(lineCommitment(line({ id: "g" }), g), "spot");
    assert.equal(lineCommitment(line({ id: "n", notes: ["Spot price; can be evicted"] })), "spot");
    assert.equal(lineCommitment(line({ id: "p" })), "payg");
  });
});
