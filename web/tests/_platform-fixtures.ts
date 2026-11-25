// Shared fixtures for the platform tests (not a test file itself).
import { newEstimate, newItem } from "../src/domain/factory.ts";
import type { Estimate, Item } from "../src/domain/model.ts";
import type { FxTable, ItemResult, Line } from "../src/domain/types.ts";

export const SETTINGS = { defaultCurrency: "USD", hoursPerMonth: 730 };
export const FX: FxTable = { asOf: "2026-11-24", base: "USD", rates: { USD: 1, EUR: 0.85, GBP: 0.75, JPY: 150 } };

const SERVICE_TITLES: Record<Item["moduleId"], string> = {
  vm: "Virtual Machines",
  disks: "Managed Disks",
  backup: "Azure Backup",
  asr: "Azure Site Recovery",
  sqlLicense: "SQL Server",
  generic: "Custom meter",
};

export function titleOf(item: Item): string {
  if (item.moduleId === "generic" && item.config.serviceName) return item.config.serviceName;
  return SERVICE_TITLES[item.moduleId];
}

export function line(partial: Partial<Line> & Pick<Line, "id">): Line {
  const monthlyUsd = partial.monthlyUsd ?? 0;
  return {
    label: partial.id,
    unit: "hours",
    quantity: 1,
    unitPriceUsd: 0,
    monthlyUsd,
    upfrontUsd: 0,
    amortizedMonthlyUsd: monthlyUsd,
    kind: "compute",
    notes: [],
    ...partial,
  };
}

export function result(lines: Line[], extra: Partial<ItemResult> = {}): ItemResult {
  const sum = (f: "monthlyUsd" | "upfrontUsd" | "amortizedMonthlyUsd") => lines.reduce((n, l) => n + l[f], 0);
  return {
    status: "ok",
    lines,
    messages: [],
    monthlyUsd: sum("monthlyUsd"),
    upfrontUsd: sum("upfrontUsd"),
    amortizedMonthlyUsd: sum("amortizedMonthlyUsd"),
    assumptions: [],
    ...extra,
  };
}

/**
 * Sample estimate:
 *  vm1 "Web tier"  Windows RI 3Y monthly: compute 200 (ri3y) + license 100 (payg)
 *  vm2             Linux Spot: compute 20
 *  disks           2 × P30: storage 270
 *  vm3 "Batch"     RI 1Y upfront: upfront 1200, amortized 100
 *  backup          pending (no result)
 *  asr             unavailable
 */
export function sampleEstimate(): { estimate: Estimate; results: Record<string, ItemResult | undefined>; ids: Record<string, string> } {
  const estimate = newEstimate(SETTINGS, "Contoso, \"migration\" | phase 1");
  const vm1 = newItem("vm", {
    region: "westeurope",
    settings: SETTINGS,
    name: "Web tier",
    config: { os: "windows", armSkuName: "Standard_D8as_v5", instances: 2, commitment: "ri3y" },
  });
  const vm2 = newItem("vm", { region: "westeurope", settings: SETTINGS, config: { os: "linux", spot: true } });
  const disks = newItem("disks", { region: "westeurope", settings: SETTINGS, config: { tier: "P30", disks: 2 } });
  const vm3 = newItem("vm", {
    region: "eastus",
    settings: SETTINGS,
    name: "Batch",
    config: { os: "linux", commitment: "ri1y", riPayment: "upfront", hoursPerMonth: 500 },
  });
  const backup = newItem("backup", { region: "westeurope", settings: SETTINGS });
  const asr = newItem("asr", { region: "westeurope", settings: SETTINGS });
  estimate.items = [vm1, vm2, disks, vm3, backup, asr];

  const results: Record<string, ItemResult | undefined> = {
    [vm1.id]: result(
      [
        line({ id: "compute", label: "D8as v5 compute", commitment: "ri3y", quantity: 2, unit: "instances", unitPriceUsd: 3600, monthlyUsd: 200, termMonths: 36 }),
        line({ id: "license", label: "Windows license", kind: "license", commitment: "payg", quantity: 1460, unitPriceUsd: 0.0685, monthlyUsd: 100, notes: ["PAYG, not reserved"] }),
      ],
      { assumptions: ["D8as v5 prices effective since 2022-10-01."] },
    ),
    [vm2.id]: result([line({ id: "compute", label: "D2s v5 Spot", quantity: 730, unitPriceUsd: 0.0274, monthlyUsd: 20 })]),
    [disks.id]: result([
      line({ id: "disk", label: "P30 LRS", detail: "Premium SSD Managed Disks", kind: "storage", unit: "disks", quantity: 2, unitPriceUsd: 135, monthlyUsd: 270 }),
    ]),
    [vm3.id]: result(
      [line({ id: "compute", label: "D2s v5 RI 1Y", commitment: "ri1y", quantity: 1, unit: "instances", unitPriceUsd: 1200, monthlyUsd: 0, upfrontUsd: 1200, amortizedMonthlyUsd: 100, termMonths: 12 })],
      { assumptions: ["D8as v5 prices effective since 2022-10-01."] },
    ),
    [asr.id]: result([], { status: "unavailable", messages: [{ level: "error", text: "Not available in West Europe" }] }),
  };
  return { estimate, results, ids: { vm1: vm1.id, vm2: vm2.id, disks: disks.id, vm3: vm3.id, backup: backup.id, asr: asr.id } };
}
