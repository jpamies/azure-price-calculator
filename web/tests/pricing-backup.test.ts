import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { backupConfigSchema } from "../src/domain/model.ts";
import type { BackupConfig } from "../src/domain/model.ts";
import { refKey } from "../src/domain/types.ts";
import type { PriceRow, PricingContext, ServiceInfo } from "../src/domain/types.ts";
import {
  backupModule,
  findBackupStorageTiers,
  findProtectedInstanceRow,
  protectedInstanceFees,
} from "../src/domain/pricing/backup.ts";

const near = (actual: number, expected: number, eps = 1e-6) =>
  assert.ok(Math.abs(actual - expected) < eps, `${actual} != ${expected}`);

function r(meterName: string, retailPrice: number, p: Partial<PriceRow> = {}): PriceRow {
  return {
    meterId: `id-${meterName}`,
    meterName,
    productName: "Backup",
    skuName: "Standard",
    armSkuName: "",
    unitOfMeasure: meterName.includes("Protected Instance") ? "1/Month" : "1 GB/Month",
    type: "Consumption",
    reservationTerm: "",
    tierMinimumUnits: 0,
    retailPrice,
    effectiveStartDate: "2024-01-01",
    isWindows: false,
    ...p,
  };
}

const ROWS: PriceRow[] = [
  r("SAP HANA in Azure VM Protected Instances", 80),
  r("Azure Files Protected Instances", 4),
  r("SQL Server in Azure VM Protected Instances", 15),
  r("Azure VM Protected Instances", 10),
  // RA-GRS listed before GRS: a substring match would pick the wrong meter.
  r("RA-GRS Data Stored", 0.0569),
  r("Vault-Archive GRS Data Stored", 0.002),
  r("GRS Snapshot Data Stored", 0.001),
  r("GRS Data Stored", 0.0448),
  r("ZRS Data Stored", 0.028),
  r("LRS Data Stored", 0.0224),
];

const SERVICES: ServiceInfo[] = [
  { serviceFamily: "Storage", serviceName: "Backup", slug: "backup", regions: ["westeurope"], rowCount: 1, hasSpot: false },
];

const ctx = (rows: PriceRow[] = ROWS): PricingContext => ({
  region: "westeurope",
  regionName: "West Europe",
  shards: { [refKey({ serviceName: "Backup", regionKey: "westeurope" })]: rows },
  services: SERVICES,
  vmSpecs: {},
  hasSavingsPlan: true,
});

const cfg = (p: Partial<BackupConfig>) => backupConfigSchema.parse(p);
const price = (p: Partial<BackupConfig>, c = ctx()) => backupModule.compute(cfg(p), c);

describe("protected-instance fee bands", () => {
  test("≤ 50 GB half, 50–500 GB one fee, > 500 GB one fee per started 500 GB", () => {
    assert.equal(protectedInstanceFees(0), 0.5);
    assert.equal(protectedInstanceFees(40), 0.5);
    assert.equal(protectedInstanceFees(50), 0.5);
    assert.equal(protectedInstanceFees(51), 1);
    assert.equal(protectedInstanceFees(200), 1);
    assert.equal(protectedInstanceFees(500), 1);
    assert.equal(protectedInstanceFees(501), 2);
    assert.equal(protectedInstanceFees(1200), 3);
  });

  test("40 GB instances pay half the fee", () => {
    const res = price({ instances: 2, avgInstanceSizeGB: 40, storageMode: "gb", storageGB: 0 });
    assert.equal(res.status, "ok");
    assert.equal(res.lines.length, 1);
    assert.equal(res.lines[0].unitPriceUsd, 5);
    assert.equal(res.monthlyUsd, 10);
  });

  test("200 GB instances pay one fee + GRS storage at 100%", () => {
    const res = price({ instances: 1, avgInstanceSizeGB: 200 });
    assert.equal(res.status, "ok");
    assert.deepEqual(
      res.lines.map((l) => [l.id, l.kind, l.unit, l.quantity]),
      [
        ["instances", "backup", "instance", 1],
        ["storage", "storage", "GB", 200],
      ],
    );
    assert.equal(res.lines[0].unitPriceUsd, 10);
    near(res.lines[1].monthlyUsd, 200 * 0.0448);
    near(res.monthlyUsd, 10 + 200 * 0.0448);
    assert.ok(!res.assumptions.some((a) => /Backup storage assumed/.test(a)), "storage sizing is stated at estimate level");
  });

  test("1200 GB instances pay three fees", () => {
    const res = price({ instances: 2, avgInstanceSizeGB: 1200, storagePercent: 50 });
    assert.equal(res.lines[0].unitPriceUsd, 30);
    assert.equal(res.lines[0].unit, "instances");
    assert.equal(res.lines[0].monthlyUsd, 60);
    near(res.lines[1].quantity, 1200);
    near(res.monthlyUsd, 60 + 1200 * 0.0448);
  });
});

describe("workload and redundancy", () => {
  test("SQL Server in Azure VM uses its own meter", () => {
    assert.equal(findProtectedInstanceRow(ROWS, "sql-in-azure-vm")?.retailPrice, 15);
    assert.equal(findProtectedInstanceRow(ROWS, "azure-vm")?.retailPrice, 10);
    const res = price({ workload: "sql-in-azure-vm", avgInstanceSizeGB: 100, storageGB: 0, storageMode: "gb" });
    assert.equal(res.monthlyUsd, 15);
  });

  test("loose workload match excludes other workloads", () => {
    const rows = ROWS.filter((x) => x.meterName !== "Azure VM Protected Instances").concat(r("Azure VMs Protected Instance", 11));
    assert.equal(findProtectedInstanceRow(rows, "azure-vm")?.retailPrice, 11);
    const bySku = [r("Protected Instances", 12, { skuName: "Azure VM" }), r("Protected Instances", 70, { skuName: "SAP HANA in Azure VM" })];
    assert.equal(findProtectedInstanceRow(bySku, "azure-vm")?.retailPrice, 12);
    assert.equal(findProtectedInstanceRow(bySku, "sql-in-azure-vm"), undefined);
  });

  test("GRS does not match RA-GRS (word boundary); archive/snapshot ignored", () => {
    assert.equal(findBackupStorageTiers(ROWS, "GRS")[0].retailPrice, 0.0448);
    assert.equal(findBackupStorageTiers(ROWS, "RA-GRS")[0].retailPrice, 0.0569);
    assert.equal(findBackupStorageTiers(ROWS, "LRS")[0].retailPrice, 0.0224);
    assert.equal(findBackupStorageTiers(ROWS, "ZRS")[0].retailPrice, 0.028);
    near(price({ redundancy: "RA-GRS", storageMode: "gb", storageGB: 1000 }).lines[1].monthlyUsd, 56.9);
  });

  test("tiered storage is priced marginally", () => {
    const rows = [
      ...ROWS.filter((x) => x.meterName !== "LRS Data Stored"),
      r("LRS Data Stored", 0.05),
      r("LRS Data Stored", 0.04, { tierMinimumUnits: 1000 }),
    ];
    const res = price({ redundancy: "LRS", storageMode: "gb", storageGB: 1500 }, ctx(rows));
    near(res.lines[1].monthlyUsd, 1000 * 0.05 + 500 * 0.04);
    near(res.lines[1].unitPriceUsd, 70 / 1500);
  });
});

describe("missing prices", () => {
  test("no instance meter → unavailable", () => {
    const res = price({}, ctx(ROWS.filter((x) => !/Protected Instance/.test(x.meterName))));
    assert.equal(res.status, "unavailable");
    assert.match(res.messages[0].text, /protected-instance price \(Azure VM\) is not available in West Europe/);
  });

  test("no storage meter → unavailable, unless no storage is needed", () => {
    const rows = ROWS.filter((x) => !/Data Stored/.test(x.meterName));
    const res = price({}, ctx(rows));
    assert.equal(res.status, "unavailable");
    assert.match(res.messages[0].text, /GRS backup storage is not available in West Europe/);
    assert.equal(price({ storagePercent: 0 }, ctx(rows)).status, "ok");
  });

  test("no region → incomplete", () => {
    assert.equal(backupModule.compute(cfg({}), { ...ctx(), region: "" }).status, "incomplete");
  });
});

describe("backup module metadata", () => {
  test("shards, summary, defaults", () => {
    assert.deepEqual(backupModule.shards(cfg({}), "westeurope", SERVICES), [{ serviceName: "Backup", regionKey: "westeurope" }]);
    assert.equal(backupModule.summarize(cfg({ instances: 10 })), "10 instances · Azure VM · 200 GB avg · GRS");
    assert.equal(backupModule.defaultConfig({ hoursPerMonth: 730 }).redundancy, "GRS");
  });
});
