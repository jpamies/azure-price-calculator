// Pure UI helpers: region grouping / item regions, service titles, relative time.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { newItem } from "../src/domain/factory.ts";
import { moduleIdSchema, settingsSchema } from "../src/domain/model.ts";
import type { RegionInfo, ServiceInfo } from "../src/domain/types.ts";
import { allowedRegionKeys, groupRegions, groupServicesByFamily, isGlobalOnlyService, primaryServiceOf } from "../src/lib/regions.ts";
import { modules } from "../src/domain/pricing/index.ts";
import { MODULE_TITLES, serviceTitleOf } from "../src/lib/serviceTitle.ts";
import { formatRelativeTime, formatUtc, todayStamp } from "../src/lib/time.ts";

const settings = settingsSchema.parse({});
const region = (key: string, displayName: string, geography: string): RegionInfo => ({
  key,
  armRegionName: key,
  location: displayName,
  displayName,
  geography,
  rowCount: 1,
});
const service = (serviceName: string, serviceFamily: string, regions: string[]): ServiceInfo => ({
  serviceName,
  serviceFamily,
  slug: serviceName.toLowerCase().replace(/\W+/g, "-"),
  regions,
  rowCount: 1,
  hasSpot: false,
});

const REGIONS = [
  region("_global", "Global (no region)", "Global"),
  region("westeurope", "West Europe", "Europe"),
  region("eastus", "East US", "Americas"),
  region("northeurope", "North Europe", "Europe"),
  region("usgovvirginia", "US Gov Virginia", "Azure Government"),
  region("mystery", "Mystery", "Other"),
  region("israelcentral", "Israel Central", "Middle East"),
];
const SERVICES = [
  service("Virtual Machines", "Compute", ["eastus", "westeurope"]),
  service("Storage", "Storage", ["westeurope"]),
  service("Azure DNS", "Networking", ["_global"]),
  service("Key Vault", "Security", ["eastus", "westeurope", "northeurope"]),
  service("Virtual Machines Licenses", "Compute", ["_global"]),
];

describe("groupRegions", () => {
  it("drops _global, orders geographies (Other last) and names", () => {
    const groups = groupRegions(REGIONS);
    assert.deepEqual(
      groups.map((g) => g.geography),
      ["Americas", "Europe", "Middle East", "Azure Government", "Other"],
    );
    assert.deepEqual(
      groups[1].regions.map((r) => r.key),
      ["northeurope", "westeurope"],
    );
  });

  it("keeps only allowed regions", () => {
    const groups = groupRegions(REGIONS, new Set(["westeurope"]));
    assert.deepEqual(groups, [{ geography: "Europe", regions: [REGIONS[1]] }]);
  });
});

describe("item regions", () => {
  it("restricts rich modules to their service regions", () => {
    const vm = newItem("vm", { region: "westeurope", settings });
    assert.equal(primaryServiceOf(vm, SERVICES)?.serviceName, "Virtual Machines");
    assert.deepEqual([...(allowedRegionKeys(vm, SERVICES) ?? [])], ["eastus", "westeurope"]);
    const disks = newItem("disks", { region: "westeurope", settings });
    assert.deepEqual([...(allowedRegionKeys(disks, SERVICES) ?? [])], ["westeurope"]);
  });

  it("allows any region for SQL licenses, global meters and unchosen services", () => {
    assert.equal(allowedRegionKeys(newItem("sqlLicense", { region: "eastus", settings }), SERVICES), null);
    const dns = newItem("generic", { region: "eastus", settings, config: { serviceName: "Azure DNS", useGlobalRegion: true } });
    assert.equal(allowedRegionKeys(dns, SERVICES), null);
    assert.equal(allowedRegionKeys(newItem("generic", { region: "eastus", settings }), SERVICES), null);
  });

  it("uses the generic item's service regions", () => {
    const kv = newItem("generic", { region: "eastus", settings, config: { serviceName: "Key Vault" } });
    assert.deepEqual([...(allowedRegionKeys(kv, SERVICES) ?? [])], ["eastus", "westeurope", "northeurope"]);
  });

  it("detects global-only services and groups services by family", () => {
    assert.equal(isGlobalOnlyService(SERVICES[2]), true);
    assert.equal(isGlobalOnlyService(SERVICES[0]), false);
    const families = groupServicesByFamily(SERVICES);
    assert.deepEqual(
      families.map((f) => [f.family, f.services.map((s) => s.serviceName)]),
      [
        ["Compute", ["Virtual Machines", "Virtual Machines Licenses"]],
        ["Networking", ["Azure DNS"]],
        ["Security", ["Key Vault"]],
        ["Storage", ["Storage"]],
      ],
    );
  });
});

describe("serviceTitleOf", () => {
  it("keeps MODULE_TITLES in sync with the pricing modules", () => {
    for (const id of moduleIdSchema.options) assert.equal(MODULE_TITLES[id], modules[id].title, id);
  });

  it("returns the module title, or the generic item's service", () => {
    assert.equal(serviceTitleOf(newItem("vm", { region: "eastus", settings })), "Virtual Machines");
    assert.equal(serviceTitleOf(newItem("generic", { region: "eastus", settings, config: { serviceName: "Key Vault" } })), "Key Vault");
    assert.equal(serviceTitleOf(newItem("generic", { region: "eastus", settings })), "Any service (meter)");
  });
});

describe("time helpers", () => {
  const now = Date.parse("2026-11-24T12:00:00Z");
  it("formats relative times", () => {
    assert.equal(formatRelativeTime("2026-11-24T11:59:40Z", now), "just now");
    assert.equal(formatRelativeTime("2026-11-24T11:55:00Z", now), "5 minutes ago");
    assert.equal(formatRelativeTime("2026-11-24T09:00:00Z", now), "3 hours ago");
    assert.equal(formatRelativeTime("2026-11-23T12:00:00Z", now), "yesterday");
    assert.equal(formatRelativeTime("2026-11-03T12:00:00Z", now), "3 weeks ago");
    assert.equal(formatRelativeTime("bogus", now), "—");
    assert.equal(formatRelativeTime(undefined, now), "—");
  });

  it("formats UTC timestamps and file-name dates", () => {
    assert.equal(formatUtc("2026-11-24T21:29:54Z"), "2026-11-24 21:29 UTC");
    assert.equal(formatUtc("n/a"), "n/a");
    assert.equal(todayStamp(new Date(2026, 0, 5)), "2026-01-05");
  });
});
