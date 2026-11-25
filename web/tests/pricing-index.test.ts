import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { itemSchema } from "../src/domain/model.ts";
import type { Item } from "../src/domain/model.ts";
import { refKey } from "../src/domain/types.ts";
import type { PricingContext, ServiceInfo } from "../src/domain/types.ts";
import { computeItem, getModule, moduleList, modules, shardsForItem, summarizeItem } from "../src/domain/pricing/index.ts";

const SERVICES: ServiceInfo[] = [
  { serviceFamily: "Compute", serviceName: "Virtual Machines", slug: "virtual-machines", regions: ["westeurope"], rowCount: 1, hasSpot: true },
  { serviceFamily: "Storage", serviceName: "Storage", slug: "storage", regions: ["westeurope"], rowCount: 1, hasSpot: false },
  { serviceFamily: "Storage", serviceName: "Backup", slug: "backup", regions: ["westeurope"], rowCount: 1, hasSpot: false },
  { serviceFamily: "Management and Governance", serviceName: "Azure Site Recovery", slug: "azure-site-recovery", regions: ["westeurope"], rowCount: 1, hasSpot: false },
  { serviceFamily: "Compute", serviceName: "Virtual Machines Licenses", slug: "virtual-machines-licenses", regions: ["_global"], rowCount: 1, hasSpot: false },
];

const item = (moduleId: Item["moduleId"], config: Record<string, unknown> = {}, region = "westeurope"): Item =>
  itemSchema.parse({ id: `it-${moduleId}`, moduleId, region, config });

const ctx = (over: Partial<PricingContext> = {}): PricingContext => ({
  region: "westeurope",
  regionName: "West Europe",
  shards: {},
  services: SERVICES,
  vmSpecs: {},
  hasSavingsPlan: true,
  ...over,
});

describe("module registry", () => {
  test("catalog order and metadata", () => {
    assert.deepEqual(
      moduleList.map((m) => [m.id, m.title, m.category, m.iconKey]),
      [
        ["vm", "Virtual Machines", "Compute", "virtual-machines"],
        ["disks", "Managed Disks", "Storage", "managed-disks"],
        ["backup", "Azure Backup", "Storage", "backup"],
        ["asr", "Azure Site Recovery", "Management and Governance", "site-recovery"],
        ["sqlLicense", "SQL Server license (on VMs)", "Databases", "sql-server"],
        ["generic", "Any service (meter)", "Other", "generic"],
      ],
    );
    for (const m of moduleList) {
      assert.equal(modules[m.id], m);
      assert.ok(m.description.length > 10);
      const def = m.defaultConfig({ hoursPerMonth: 700 });
      assert.ok(m.configSchema.safeParse(def).success);
    }
    assert.equal(getModule("vm").defaultConfig({ hoursPerMonth: 700 }).hoursPerMonth, 700);
    assert.equal(getModule("generic").defaultConfig({ hoursPerMonth: 700 }).hoursPerMonth, 700);
    assert.equal(getModule("sqlLicense").defaultConfig({ hoursPerMonth: 700 }).hoursPerMonth, 700);
  });
});

describe("shardsForItem", () => {
  test("per module", () => {
    assert.deepEqual(shardsForItem(item("vm"), SERVICES), [{ serviceName: "Virtual Machines", regionKey: "westeurope" }]);
    assert.deepEqual(shardsForItem(item("disks"), SERVICES), [{ serviceName: "Storage", regionKey: "westeurope" }]);
    assert.deepEqual(shardsForItem(item("backup"), SERVICES), [{ serviceName: "Backup", regionKey: "westeurope" }]);
    assert.deepEqual(shardsForItem(item("asr"), SERVICES), [{ serviceName: "Azure Site Recovery", regionKey: "westeurope" }]);
    assert.deepEqual(shardsForItem(item("sqlLicense"), SERVICES), [{ serviceName: "Virtual Machines Licenses", regionKey: "_global" }]);
    assert.deepEqual(shardsForItem(item("generic"), SERVICES), []);
    assert.deepEqual(shardsForItem(item("vm", {}, ""), SERVICES), []);
  });
});

describe("computeItem / summarizeItem", () => {
  test("never throws: invalid config → incomplete, module error → unavailable", () => {
    const bad = { ...item("vm"), config: { instances: -3 } } as unknown as Item;
    const res = computeItem(bad, ctx());
    assert.equal(res.status, "incomplete");
    assert.match(res.messages[0].text, /Invalid configuration/);
    const throwing = new Proxy(
      {},
      {
        get() {
          throw new Error("boom");
        },
      },
    );
    const res2 = computeItem(item("vm"), ctx({ shards: throwing as Record<string, never> }));
    assert.equal(res2.status, "unavailable");
    assert.match(res2.messages[0].text, /boom/);
    const unknown = { ...item("vm"), moduleId: "nope" } as unknown as Item;
    assert.equal(computeItem(unknown, ctx()).status, "incomplete");
    assert.deepEqual(shardsForItem(unknown, SERVICES), []);
    assert.equal(summarizeItem(unknown), "Unknown item");
  });

  test("prices an item with its shards", () => {
    const vm = item("vm", { os: "linux", armSkuName: "Standard_D2s_v5" });
    const rows = [
      {
        meterId: "x",
        meterName: "D2s v5",
        productName: "Virtual Machines Dsv5 Series",
        skuName: "D2s v5",
        armSkuName: "Standard_D2s_v5",
        unitOfMeasure: "1 Hour",
        type: "Consumption",
        reservationTerm: "",
        tierMinimumUnits: 0,
        retailPrice: 0.1,
        effectiveStartDate: "2024-01-01",
        isWindows: false,
      },
    ];
    const res = computeItem(vm, ctx({ shards: { [refKey(shardsForItem(vm, SERVICES)[0])]: rows } }));
    assert.equal(res.status, "ok");
    assert.ok(Math.abs(res.monthlyUsd - 73) < 1e-9);
  });

  test("summaries", () => {
    assert.equal(
      summarizeItem(item("vm", { instances: 2, armSkuName: "Standard_D8as_v5", os: "windows", commitment: "ri3y" })),
      "2 × D8as v5 · Windows · RI 3Y",
    );
    assert.equal(summarizeItem(item("asr", { instances: 3 })), "3 instances · Azure → Azure");
    const bad = { ...item("disks"), config: { disks: "x" } } as unknown as Item;
    assert.equal(summarizeItem(bad), "Managed Disks");
  });
});
