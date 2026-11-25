// Service titles of estimate items (the `titleOf` used by totals and exports).
// Pure TypeScript with relative `.ts` imports so it runs under `node --test`.
// Deliberately does NOT import domain/pricing: the estimates list (Home) needs titles without
// downloading the pricing modules. tests/ui-helpers.test.ts checks these against the module titles.
import type { Item, ModuleId } from "../domain/model.ts";

/** Same strings as `modules[id].title` in domain/pricing. */
export const MODULE_TITLES: Readonly<Record<ModuleId, string>> = {
  vm: "Virtual Machines",
  disks: "Managed Disks",
  backup: "Azure Backup",
  asr: "Azure Site Recovery",
  sqlLicense: "SQL Server license (on VMs)",
  generic: "Any service (meter)",
};

/** Module title, e.g. "Virtual Machines". */
export function moduleTitle(moduleId: ModuleId): string {
  return MODULE_TITLES[moduleId] ?? moduleId;
}

/** Service title of an item: the module title, or the chosen serviceName for generic items. */
export function serviceTitleOf(item: Item): string {
  if (item.moduleId === "generic") return item.config.serviceName.trim() || moduleTitle("generic");
  return moduleTitle(item.moduleId);
}
