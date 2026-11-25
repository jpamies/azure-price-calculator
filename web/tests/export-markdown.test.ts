import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { estimateToMarkdown, mdCell } from "../src/domain/export/markdown.ts";
import { FX, sampleEstimate, titleOf } from "./_platform-fixtures.ts";

describe("estimateToMarkdown", () => {
  const { estimate, results } = sampleEstimate();
  const summarize = (item: (typeof estimate.items)[number]) =>
    item.moduleId === "vm" ? `${item.config.instances} × ${item.config.armSkuName.replace("Standard_", "")} · ${item.config.os}` : "";

  it("renders heading, item table, totals and assumptions", () => {
    const md = estimateToMarkdown(estimate, results, {
      currency: "USD",
      fx: FX,
      titleOf,
      summarize,
      regionName: (k) => (k === "westeurope" ? "West Europe" : k),
      pricesDate: "2026-11-24",
      assumptions: ["Taxes not included.", "A | B"],
    });
    const lines = md.split("\n");
    assert.equal(lines[0], '## Contoso, "migration" \\| phase 1');
    assert.match(md, /Prices as of 2026-11-24 \(Azure Retail Prices API, list prices\) · Currency: USD/);
    assert.ok(lines.includes("| Service | Region | Configuration | Monthly | Upfront |"));
    assert.ok(lines.includes("|---|---|---|---:|---:|"));
    assert.ok(lines.includes("| Virtual Machines | West Europe | Web tier — 2 × D8as_v5 · windows | $300.00 | — |"));
    assert.ok(lines.includes("| Virtual Machines | eastus | Batch — 1 × D2s_v5 · linux | $0.00 | $1,200.00 |"));
    assert.ok(lines.includes("| Managed Disks | West Europe | Managed disks | $270.00 | — |"));
    assert.ok(lines.includes("| Azure Backup | West Europe | Backup | Pending | — |"));
    assert.ok(lines.includes("| Azure Site Recovery | West Europe | Site Recovery | Not available; Not available in West Europe | — |"));
    assert.ok(lines.includes("| **Total** | | | **$590.00** | **$1,200.00** |"));
    assert.match(md, /\*\*Monthly:\*\* \$590\.00 · \*\*Upfront:\*\* \$1,200\.00 · \*\*Amortized monthly:\*\* \$690\.00 · \*\*Annual \(monthly × 12 \+ upfront\):\*\* \$8,280\.00/);
    assert.match(md, /_2 items are not fully priced/);
    assert.ok(lines.includes("### Assumptions"));
    assert.ok(lines.includes("- Taxes not included."));
    assert.ok(lines.includes("- A \\| B"));
    assert.ok(md.endsWith("\n"));
  });

  it("converts the currency", () => {
    const md = estimateToMarkdown(estimate, results, { currency: "EUR", fx: FX, titleOf });
    assert.match(md, /Currency: EUR \(indicative, converted from USD\)/);
    assert.match(md, /\*\*€501\.50\*\*/);
    assert.ok(!md.includes("### Assumptions"));
  });

  it("escapes table cells", () => {
    assert.equal(mdCell("a|b\nc\\d"), "a\\|b c\\\\d");
  });
});
