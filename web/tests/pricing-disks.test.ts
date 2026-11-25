import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { disksConfigSchema } from "../src/domain/model.ts";
import type { DisksConfig } from "../src/domain/model.ts";
import { refKey } from "../src/domain/types.ts";
import type { PriceRow, PricingContext, ServiceInfo } from "../src/domain/types.ts";
import { disksModule } from "../src/domain/pricing/disks.ts";
import {
  diskRedundancies,
  diskTierOptions,
  diskTypeLabel,
  premiumV2BillableSizeGiB,
  ultraBillableSizeGiB,
} from "../src/domain/diskCatalog.ts";
import { DISK_TIER_SIZES, pickTierForSize, standardTiers, tierSizeGB } from "../src/domain/tiers.ts";

const near = (actual: number, expected: number, eps = 1e-6) =>
  assert.ok(Math.abs(actual - expected) < eps, `${actual} != ${expected}`);

function r(p: Partial<PriceRow>): PriceRow {
  return {
    meterId: `id-${p.productName}-${p.meterName}`,
    meterName: "",
    productName: "Premium SSD Managed Disks",
    skuName: "",
    armSkuName: "",
    unitOfMeasure: "1/Month",
    type: "Consumption",
    reservationTerm: "",
    tierMinimumUnits: 0,
    retailPrice: 0,
    effectiveStartDate: "2024-01-01",
    isWindows: false,
    ...p,
  };
}

const premium = (tier: string, red: string, price: number, extra: Partial<PriceRow> = {}) =>
  r({ skuName: `${tier} ${red}`, meterName: `${tier} ${red} Disk`, retailPrice: price, ...extra });

const ROWS: PriceRow[] = [
  // Distractors first so that naive matching would pick them.
  r({ skuName: "P30 LRS", meterName: "P30 LRS Disk Mount", retailPrice: 1 }),
  r({ skuName: "P30 LRS", meterName: "Burst Enablement", retailPrice: 2 }),
  r({ skuName: "P30 LRS", meterName: "P30 LRS Disk Operations", unitOfMeasure: "10K", retailPrice: 3 }),
  r({ skuName: "P30 LRS", meterName: "P30 LRS Snapshot", unitOfMeasure: "1 GB/Month", retailPrice: 4 }),
  r({ productName: "Premium Page Blob", skuName: "P30 LRS", meterName: "P30 LRS Disk", retailPrice: 5 }),
  premium("P30", "LRS", 135, { type: "Reservation", reservationTerm: "1 Year", retailPrice: 1400 }),
  premium("P10", "LRS", 20),
  premium("P15", "LRS", 38),
  premium("P20", "LRS", 73),
  premium("P30", "LRS", 130, { effectiveStartDate: "2020-01-01" }),
  premium("P30", "LRS", 135),
  premium("P30", "ZRS", 203),
  premium("P20", "ZRS", 110),
  r({ productName: "Standard SSD Managed Disks", skuName: "E10 LRS", meterName: "E10 LRS Disk", retailPrice: 9.6 }),
  r({ productName: "Standard SSD Managed Disks", skuName: "E15 ZRS", meterName: "E15 ZRS Disk", retailPrice: 23.04 }),
  r({ productName: "Standard SSD Managed Disks", skuName: "E15 LRS", meterName: "E15 LRS Disk Operations", unitOfMeasure: "10K", retailPrice: 0.002 }),
  r({ productName: "Standard HDD Managed Disks", skuName: "S10 LRS", meterName: "S10 LRS Disk", retailPrice: 5.89 }),
  r({ productName: "Standard HDD Managed Disks", skuName: "S10 LRS", meterName: "S10 LRS Disk Transactions", unitOfMeasure: "10K", retailPrice: 0.0005 }),
  // Premium SSD v2 (hourly meters).
  r({ productName: "Azure Premium SSD v2", skuName: "Premium LRS", meterName: "Premium LRS Provisioned Capacity", unitOfMeasure: "1 GiB/Hour", retailPrice: 0.00011 }),
  r({ productName: "Azure Premium SSD v2", skuName: "Premium LRS", meterName: "Premium LRS Provisioned IOPS", unitOfMeasure: "1/Hour", retailPrice: 0.0000068 }),
  r({ productName: "Azure Premium SSD v2", skuName: "Premium LRS", meterName: "Premium LRS Provisioned Throughput (MBps)", unitOfMeasure: "1/Hour", retailPrice: 0.000055 }),
  // Ultra Disk.
  r({ productName: "Ultra Disks", skuName: "Ultra LRS", meterName: "Ultra LRS Reservation per vCPU Provisioned", unitOfMeasure: "1/Hour", retailPrice: 0.004 }),
  r({ productName: "Ultra Disks", skuName: "Ultra LRS", meterName: "Ultra LRS Provisioned Capacity", unitOfMeasure: "1 GiB/Hour", retailPrice: 0.000164 }),
  r({ productName: "Ultra Disks", skuName: "Ultra LRS", meterName: "Ultra LRS Provisioned IOPS", unitOfMeasure: "1/Hour", retailPrice: 0.0000672 }),
  r({ productName: "Ultra Disks", skuName: "Ultra LRS", meterName: "Ultra LRS Provisioned Throughput (MBps)", unitOfMeasure: "1/Hour", retailPrice: 0.000468 }),
];

const SERVICES: ServiceInfo[] = [
  { serviceFamily: "Storage", serviceName: "Storage", slug: "storage", regions: ["southcentralus"], rowCount: 1, hasSpot: false },
];

const ctx = (rows: PriceRow[] = ROWS): PricingContext => ({
  region: "southcentralus",
  regionName: "South Central US",
  shards: { [refKey({ serviceName: "Storage", regionKey: "southcentralus" })]: rows },
  services: SERVICES,
  vmSpecs: {},
  hasSavingsPlan: true,
});

const cfg = (p: Partial<DisksConfig>) => disksConfigSchema.parse(p);
const price = (p: Partial<DisksConfig>, c = ctx()) => disksModule.compute(cfg(p), c);

describe("tier table", () => {
  test("sizes and picking", () => {
    assert.equal(DISK_TIER_SIZES[30], 1024);
    assert.equal(tierSizeGB("P30"), 1024);
    assert.equal(tierSizeGB("e15"), 256);
    assert.equal(tierSizeGB("S4"), 32);
    assert.equal(tierSizeGB("S1"), null);
    assert.equal(tierSizeGB("P35"), null);
    assert.equal(tierSizeGB("X1"), null);
    assert.equal(pickTierForSize("P", 300), "P20");
    assert.equal(pickTierForSize("P", 512), "P20");
    assert.equal(pickTierForSize("P", 513), "P30");
    assert.equal(pickTierForSize("S", 10), "S4");
    assert.equal(pickTierForSize("E", 40000), null);
    assert.equal(pickTierForSize("P", 300, ["P10", "P30", "E20"]), "P30");
    assert.equal(standardTiers("S")[0], "S4");
    assert.equal(standardTiers("P").length, 14);
  });
});

describe("tiered disks", () => {
  test("tier mode: P30 LRS × 2 (effective row, distractor meters ignored)", () => {
    const res = price({ diskType: "premium-ssd", sizingMode: "tier", tier: "P30", redundancy: "LRS", disks: 2 });
    assert.equal(res.status, "ok");
    assert.equal(res.lines.length, 1);
    const [l] = res.lines;
    assert.equal(l.unit, "disks");
    assert.equal(l.quantity, 2);
    assert.equal(price({ diskType: "premium-ssd", tier: "P30", disks: 1 }).lines[0].unit, "disk");
    assert.equal(l.unitPriceUsd, 135);
    assert.equal(l.monthlyUsd, 270);
    assert.equal(l.kind, "storage");
    assert.equal(l.label, "Premium SSD P30 LRS");
  });

  test("size mode: 300 GB → P20 (512 GiB)", () => {
    const res = price({ diskType: "premium-ssd", sizingMode: "size", sizeGB: 300 });
    assert.equal(res.status, "ok");
    assert.equal(res.monthlyUsd, 73);
    assert.ok(res.assumptions.includes("Disk size 300 GB rounded up to tier P20 (512 GiB)."));
  });

  test("size mode only considers tiers present in the data", () => {
    const rows = ROWS.filter((x) => x.skuName !== "P20 LRS");
    const res = price({ diskType: "premium-ssd", sizingMode: "size", sizeGB: 300 }, ctx(rows));
    assert.equal(res.monthlyUsd, 135);
    assert.match(res.assumptions[0], /tier P30 \(1,024 GiB\)/);
  });

  test("ZRS", () => {
    assert.equal(price({ diskType: "premium-ssd", tier: "P30", redundancy: "ZRS" }).monthlyUsd, 203);
    assert.equal(price({ diskType: "standard-ssd", tier: "E15", redundancy: "ZRS" }).monthlyUsd, 23.04);
    const missing = price({ diskType: "premium-ssd", tier: "P10", redundancy: "ZRS" });
    assert.equal(missing.status, "unavailable");
    assert.match(missing.messages[0].text, /tier P10 ZRS is not available in South Central US/);
  });

  test("Standard HDD with ZRS is unavailable", () => {
    const res = price({ diskType: "standard-hdd", tier: "S10", redundancy: "ZRS" });
    assert.equal(res.status, "unavailable");
    assert.equal(res.monthlyUsd, 0);
    assert.match(res.messages[0].text, /LRS only/);
    assert.equal(price({ diskType: "standard-hdd", tier: "S10" }).monthlyUsd, 5.89);
  });

  test("standard disks note that transactions are excluded", () => {
    const res = price({ diskType: "standard-ssd", tier: "E10" });
    assert.equal(res.monthlyUsd, 9.6);
    assert.ok(res.lines[0].notes.some((n) => /Transactions/.test(n)));
  });

  test("a tier of another type is mapped by size", () => {
    const res = price({ diskType: "standard-ssd", tier: "P10" });
    assert.equal(res.status, "ok");
    assert.equal(res.lines[0].label, "Standard SSD E10 LRS");
    assert.ok(res.messages.some((m) => m.level === "info" && /priced as E10/.test(m.text)));
  });

  test("unavailable / incomplete", () => {
    assert.equal(price({ diskType: "premium-ssd", sizingMode: "size", sizeGB: 40000 }).status, "unavailable");
    assert.equal(price({ diskType: "premium-ssd", tier: "" }).status, "incomplete");
    assert.equal(price({ diskType: "premium-ssd" }, ctx([])).status, "unavailable");
    assert.equal(disksModule.compute(cfg({}), { ...ctx(), region: "" }).status, "incomplete");
  });

  test("diskTierOptions / diskRedundancies", () => {
    const opts = diskTierOptions(ROWS, "premium-ssd", "LRS");
    assert.deepEqual(
      opts.map((o) => [o.tier, o.sizeGB, o.monthlyUsd]),
      [
        ["P10", 128, 20],
        ["P15", 256, 38],
        ["P20", 512, 73],
        ["P30", 1024, 135],
      ],
    );
    assert.equal(diskTierOptions(ROWS, "premium-ssd", "LRS"), opts); // memoized
    assert.deepEqual(diskTierOptions(ROWS, "premium-ssd-v2", "LRS"), []);
    assert.deepEqual(diskRedundancies(ROWS, "premium-ssd"), ["LRS", "ZRS"]);
    assert.deepEqual(diskRedundancies(ROWS, "standard-hdd"), ["LRS"]);
    assert.deepEqual(diskRedundancies(ROWS, "ultra"), ["LRS"]);
    assert.equal(diskTypeLabel("ultra"), "Ultra Disk");
  });
});

describe("Premium SSD v2 / Ultra", () => {
  test("v2 bills only IOPS/throughput above the free baseline", () => {
    const res = price({ diskType: "premium-ssd-v2", sizeGB: 512, iops: 5000, throughputMBps: 200, disks: 2 });
    assert.equal(res.status, "ok");
    assert.deepEqual(
      res.lines.map((l) => [l.id, l.unit, l.quantity]),
      [
        ["capacity", "GiB", 1024],
        ["iops", "IOPS", 4000],
        ["throughput", "MB/s", 150],
      ],
    );
    near(res.lines[0].unitPriceUsd, 0.00011 * 730);
    const expected = 2 * (512 * 0.00011 * 730 + 2000 * 0.0000068 * 730 + 75 * 0.000055 * 730);
    near(res.monthlyUsd, expected);
  });

  test("v2 at the baseline pays capacity only", () => {
    const res = price({ diskType: "premium-ssd-v2", sizeGB: 100, iops: 3000, throughputMBps: 125 });
    near(res.monthlyUsd, 100 * 0.00011 * 730);
    assert.equal(res.lines[1].quantity, 0);
    assert.equal(res.lines[2].monthlyUsd, 0);
  });

  test("v2 ZRS without ZRS meters is unavailable", () => {
    const res = price({ diskType: "premium-ssd-v2", redundancy: "ZRS" });
    assert.equal(res.status, "unavailable");
    assert.match(res.messages[0].text, /Premium SSD v2 ZRS is not available in South Central US/);
  });

  test("ultra bills all provisioned capacity, IOPS and throughput (no free baseline)", () => {
    const res = price({ diskType: "ultra", sizeGB: 1024, iops: 5000, throughputMBps: 200 });
    assert.equal(res.status, "ok");
    assert.equal(res.lines.length, 3);
    assert.deepEqual(
      res.lines.map((l) => l.quantity),
      [1024, 5000, 200],
    );
    near(res.monthlyUsd, 1024 * 0.000164 * 730 + 5000 * 0.0000672 * 730 + 200 * 0.000468 * 730);
    assert.ok(!res.lines.some((l) => /Reservation/.test(l.detail ?? "")));
    assert.ok(res.lines[1].notes.some((n) => /no free baseline/.test(n)));
    assert.ok(res.assumptions.includes("Ultra Disk bills all provisioned IOPS and throughput (no free baseline)."));
  });

  test("ultra capacity is billed per GiB with a 4 GiB minimum (no size steps)", () => {
    assert.equal(ultraBillableSizeGiB(300), 300);
    assert.equal(ultraBillableSizeGiB(300.5), 301);
    assert.equal(ultraBillableSizeGiB(4), 4);
    assert.equal(ultraBillableSizeGiB(2), 4);
    assert.equal(ultraBillableSizeGiB(1500), 1500);
    assert.equal(premiumV2BillableSizeGiB(100.2), 101);
    assert.equal(premiumV2BillableSizeGiB(1), 1);
    const res = price({ diskType: "ultra", sizeGB: 300, iops: 0, throughputMBps: 0 });
    near(res.monthlyUsd, 300 * 0.000164 * 730);
    assert.ok(!res.assumptions.some((a) => /billed as/.test(a)));
    const tiny = price({ diskType: "ultra", sizeGB: 2, iops: 0, throughputMBps: 0, disks: 3 });
    near(tiny.monthlyUsd, 3 * 4 * 0.000164 * 730);
    assert.equal(tiny.lines[0].quantity, 12);
    assert.ok(tiny.assumptions.includes("Ultra Disk size 2 GiB billed as 4 GiB (per GiB, 4 GiB minimum)."));
    const v2 = price({ diskType: "premium-ssd-v2", sizeGB: 100.5, iops: 3000, throughputMBps: 125 });
    near(v2.monthlyUsd, 101 * 0.00011 * 730);
    assert.ok(v2.assumptions.includes("Premium SSD v2 size 100.5 GiB billed as 101 GiB (per GiB)."));
  });

  test("missing IOPS meter with billable IOPS is unavailable", () => {
    const rows = ROWS.filter((x) => !/Provisioned IOPS/.test(x.meterName));
    assert.equal(price({ diskType: "premium-ssd-v2", iops: 5000 }, ctx(rows)).status, "unavailable");
    assert.equal(price({ diskType: "premium-ssd-v2", iops: 3000 }, ctx(rows)).status, "ok");
  });
});

describe("disks module metadata", () => {
  test("shards and summary", () => {
    assert.deepEqual(disksModule.shards(cfg({}), "southcentralus", SERVICES), [
      { serviceName: "Storage", regionKey: "southcentralus" },
    ]);
    assert.deepEqual(disksModule.shards(cfg({}), "westeurope", SERVICES), []);
    assert.equal(disksModule.summarize(cfg({ tier: "P30", disks: 2 })), "2 × P30 LRS · Premium SSD");
    assert.equal(
      disksModule.summarize(cfg({ diskType: "standard-ssd", sizingMode: "size", sizeGB: 300, redundancy: "ZRS" })),
      "1 × 300 GB ZRS · Standard SSD",
    );
    assert.equal(
      disksModule.summarize(cfg({ diskType: "premium-ssd-v2", sizeGB: 512, iops: 5000, throughputMBps: 200 })),
      "1 × 512 GiB · 5,000 IOPS · 200 MB/s · Premium SSD v2 LRS",
    );
  });
});
