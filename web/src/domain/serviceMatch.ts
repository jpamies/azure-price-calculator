// Resolve the exact serviceName (as listed in services.json) a module needs. Names in the Retail
// Prices API can drift, so modules list preferred exact names plus a fallback regex.
import type { ServiceInfo } from "./types.ts";

export interface ServiceMatcher {
  /** Preferred exact names (case-insensitive), in order. */
  names: readonly string[];
  /** Used when no exact name is present. */
  fallback?: RegExp;
  /** Among several fallback matches, names matching this come first. */
  prefer?: RegExp;
}

export const SERVICE_MATCHERS = {
  vm: { names: ["Virtual Machines"], fallback: /^virtual machines$/i },
  storage: { names: ["Storage"], fallback: /^storage$/i },
  backup: { names: ["Backup", "Azure Backup"], fallback: /\bbackup\b/i },
  asr: { names: ["Azure Site Recovery", "Site Recovery"], fallback: /site recovery/i },
  sqlLicense: {
    names: ["Virtual Machines Licenses"],
    fallback: /licen[cs]e/i,
    prefer: /virtual machines|sql/i,
  },
} as const satisfies Record<string, ServiceMatcher>;

function byPreference(prefer: RegExp | undefined) {
  return (a: ServiceInfo, b: ServiceInfo) => {
    const pa = prefer && prefer.test(a.serviceName) ? 0 : 1;
    const pb = prefer && prefer.test(b.serviceName) ? 0 : 1;
    return pa - pb || a.serviceName.length - b.serviceName.length || a.serviceName.localeCompare(b.serviceName);
  };
}

/**
 * Every service matching, best first: exact names (in `names` order), then fallback matches
 * (preferred ones first, then shortest name).
 */
export function findServices(
  services: readonly ServiceInfo[],
  names: readonly string[],
  fallback?: RegExp,
  prefer?: RegExp,
): ServiceInfo[] {
  const out: ServiceInfo[] = [];
  for (const name of names) {
    const lower = name.toLowerCase();
    const hit = services.find((s) => s.serviceName.toLowerCase() === lower);
    if (hit && !out.includes(hit)) out.push(hit);
  }
  if (out.length > 0 || !fallback) return out;
  return services.filter((s) => fallback.test(s.serviceName)).sort(byPreference(prefer));
}

/** Best matching service (exact name first, then fallback regex); undefined if none. */
export function findService(
  services: readonly ServiceInfo[],
  names: readonly string[],
  fallback?: RegExp,
): ServiceInfo | undefined {
  return findServices(services, names, fallback)[0];
}

export function matchService(services: readonly ServiceInfo[], matcher: ServiceMatcher): ServiceInfo | undefined {
  return findServices(services, matcher.names, matcher.fallback, matcher.prefer)[0];
}

/**
 * serviceName to request for a matcher. When `services` is empty (index not loaded) the first
 * preferred name is returned so the data layer can still try; null = not in the snapshot.
 */
export function resolveServiceName(services: readonly ServiceInfo[], matcher: ServiceMatcher): string | null {
  if (services.length === 0) return matcher.names[0] ?? null;
  return matchService(services, matcher)?.serviceName ?? null;
}

/** Look up a service by exact name (case-insensitive). */
export function serviceByName(services: readonly ServiceInfo[], serviceName: string): ServiceInfo | undefined {
  const lower = serviceName.toLowerCase();
  return services.find((s) => s.serviceName.toLowerCase() === lower);
}

/** true when the service has a main shard for the region (unknown service/regions → true). */
export function serviceHasRegion(service: ServiceInfo | undefined, regionKey: string): boolean {
  if (!service || !Array.isArray(service.regions)) return true;
  return service.regions.includes(regionKey);
}
