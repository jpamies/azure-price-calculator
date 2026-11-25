// Region picker helpers: geography grouping and the regions an item can be priced in.
// Pure TypeScript with relative `.ts` imports so it runs under `node --test`.
import type { Item } from "../domain/model.ts";
import { SERVICE_MATCHERS, matchService, serviceByName } from "../domain/serviceMatch.ts";
import type { RegionInfo, ServiceInfo } from "../domain/types.ts";

export const GLOBAL_REGION_KEY = "_global";

/** Display order of geographies (others follow alphabetically, "Other" last). */
const GEOGRAPHY_ORDER = ["Americas", "Europe", "Asia Pacific", "Middle East", "Africa", "Azure Government"];

export interface RegionGroup {
  geography: string;
  regions: RegionInfo[];
}

function geographyRank(geography: string): number {
  const i = GEOGRAPHY_ORDER.indexOf(geography);
  if (i >= 0) return i;
  return geography === "Other" ? GEOGRAPHY_ORDER.length + 1 : GEOGRAPHY_ORDER.length;
}

/** Selectable regions (no "_global") grouped by geography; groups and regions sorted for display. */
export function groupRegions(regions: readonly RegionInfo[], allowed?: ReadonlySet<string> | null): RegionGroup[] {
  const groups = new Map<string, RegionInfo[]>();
  for (const r of regions) {
    if (r.key === GLOBAL_REGION_KEY || !r.key) continue;
    if (allowed && !allowed.has(r.key)) continue;
    const geography = r.geography || "Other";
    const list = groups.get(geography);
    if (list) list.push(r);
    else groups.set(geography, [r]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => geographyRank(a) - geographyRank(b) || a.localeCompare(b))
    .map(([geography, list]) => ({
      geography,
      regions: list.sort((a, b) => a.displayName.localeCompare(b.displayName)),
    }));
}

/**
 * The service whose shards define where an item can be priced, `null` when any region works
 * (SQL license meters are global, generic items on "_global" meters or without a service) and
 * `undefined` when the service is not in the snapshot.
 */
export function primaryServiceOf(item: Item, services: readonly ServiceInfo[]): ServiceInfo | null | undefined {
  switch (item.moduleId) {
    case "vm":
      return matchService(services, SERVICE_MATCHERS.vm);
    case "disks":
      return matchService(services, SERVICE_MATCHERS.storage);
    case "backup":
      return matchService(services, SERVICE_MATCHERS.backup);
    case "asr":
      return matchService(services, SERVICE_MATCHERS.asr);
    case "sqlLicense":
      return null;
    case "generic": {
      const name = item.config.serviceName.trim();
      if (!name || item.config.useGlobalRegion) return null;
      return serviceByName(services, name);
    }
    default:
      return null;
  }
}

/** Region keys an item can be priced in, or `null` = every region. */
export function allowedRegionKeys(item: Item, services: readonly ServiceInfo[]): ReadonlySet<string> | null {
  const service = primaryServiceOf(item, services);
  if (!service) return null;
  const keys = service.regions.filter((r) => r !== GLOBAL_REGION_KEY);
  return keys.length > 0 ? new Set(keys) : null;
}

/** True when a service is only published as global meters (no regional shard). */
export function isGlobalOnlyService(service: Pick<ServiceInfo, "regions">): boolean {
  return service.regions.length > 0 && service.regions.every((r) => r === GLOBAL_REGION_KEY);
}

export interface FamilyGroup {
  family: string;
  services: ServiceInfo[];
}

/** Services grouped by serviceFamily (families and names sorted alphabetically, "Other" last). */
export function groupServicesByFamily(services: readonly ServiceInfo[]): FamilyGroup[] {
  const groups = new Map<string, ServiceInfo[]>();
  for (const s of services) {
    const family = s.serviceFamily || "Other";
    const list = groups.get(family);
    if (list) list.push(s);
    else groups.set(family, [s]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === "Other" ? 1 : 0) - (b === "Other" ? 1 : 0) || a.localeCompare(b))
    .map(([family, list]) => ({ family, services: list.sort((a, b) => a.serviceName.localeCompare(b.serviceName)) }));
}
