// Azure service -> icon key resolution and the fallback tiles drawn when an icon is unavailable.
// Pure TypeScript (no React, no DOM, no import.meta.env) so it can run under `node --test`.
// ICON_KEYS must match ICONS in scripts/sync_icons.py, which copies the official Azure Architecture
// Icons to public/icons/azure/<key>.svg (scripts/test_sync_icons.py checks that both lists agree).
import type { ModuleId } from "../domain/model.ts";

export const ICON_KEYS = [
  // Calculator modules
  "virtual-machines",
  "managed-disks",
  "backup",
  "site-recovery",
  "sql-server",
  "generic",
  // serviceFamily fallbacks
  "compute",
  "storage",
  "networking",
  "databases",
  "ai-machine-learning",
  "analytics",
  "containers",
  "security",
  "identity",
  "integration",
  "iot",
  "management-governance",
  "web",
  "developer-tools",
  "migration",
  "mixed-reality",
  "other",
  // Compute and containers
  "app-service",
  "functions",
  "virtual-desktop",
  "vmware",
  "batch",
  "kubernetes",
  "container-apps",
  "container-instances",
  "container-registry",
  // Storage
  "storage-accounts",
  "blob",
  "files",
  "netapp-files",
  // Databases
  "sql-database",
  "sql-managed-instance",
  "cosmos-db",
  "postgresql",
  "mysql",
  "redis",
  // Networking
  "virtual-network",
  "load-balancer",
  "application-gateway",
  "firewall",
  "vpn-gateway",
  "expressroute",
  "dns",
  "front-door",
  "cdn",
  "traffic-manager",
  "nat-gateway",
  "bandwidth",
  "public-ip",
  "private-link",
  "ddos-protection",
  "bastion",
  // Security
  "key-vault",
  "defender",
  "sentinel",
  // Management and monitoring
  "monitor",
  "log-analytics",
  "application-insights",
  "automation",
  "azure-arc",
  // AI + machine learning
  "openai",
  "foundry",
  "ai-services",
  "ai-search",
  "machine-learning",
  // Analytics
  "synapse",
  "data-factory",
  "databricks",
  "data-explorer",
  "stream-analytics",
  "hdinsight",
  "power-bi-embedded",
  // Integration
  "event-hubs",
  "event-grid",
  "service-bus",
  "logic-apps",
  "api-management",
  // Web, developer and other
  "static-web-apps",
  "signalr",
  "communication-services",
  "devops",
  "azure-stack",
  "power-platform",
] as const;

export type IconKey = (typeof ICON_KEYS)[number];

const ICON_KEY_SET: ReadonlySet<string> = new Set<string>(ICON_KEYS);

export function isIconKey(value: unknown): value is IconKey {
  return typeof value === "string" && ICON_KEY_SET.has(value);
}

export const MODULE_ICON_KEYS = {
  vm: "virtual-machines",
  disks: "managed-disks",
  backup: "backup",
  asr: "site-recovery",
  sqlLicense: "sql-server",
  generic: "generic",
} as const satisfies Record<ModuleId, IconKey>;

export function iconKeyForModule(moduleId: ModuleId): IconKey {
  return MODULE_ICON_KEYS[moduleId];
}

/** Exact serviceName values as published by the Azure Retail Prices API (compared case-insensitively). */
const SERVICE_NAME_ICON_KEYS: Readonly<Record<string, IconKey>> = {
  "Virtual Machines": "virtual-machines",
  "Virtual Machines Licenses": "virtual-machines",
  Storage: "storage-accounts",
  Backup: "backup",
  "Azure Site Recovery": "site-recovery",
  "Azure App Service": "app-service",
  Functions: "functions",
  "Azure Functions": "functions",
  "Windows Virtual Desktop": "virtual-desktop",
  "Azure Virtual Desktop": "virtual-desktop",
  "Azure VMware Solution": "vmware",
  Batch: "batch",
  "Azure Kubernetes Service": "kubernetes",
  "Container Apps": "container-apps",
  "Azure Container Apps": "container-apps",
  "Container Instances": "container-instances",
  "Container Registry": "container-registry",
  "Azure NetApp Files": "netapp-files",
  "SQL Database": "sql-database",
  "SQL Managed Instance": "sql-managed-instance",
  "Azure Cosmos DB": "cosmos-db",
  "Azure Database for PostgreSQL": "postgresql",
  "Azure Database for MySQL": "mysql",
  "Redis Cache": "redis",
  "Azure Cache for Redis": "redis",
  "Azure Managed Redis": "redis",
  "Virtual Network": "virtual-network",
  "Virtual WAN": "virtual-network",
  "Load Balancer": "load-balancer",
  "Application Gateway": "application-gateway",
  "Azure Firewall": "firewall",
  "Azure Firewall Manager": "firewall",
  "VPN Gateway": "vpn-gateway",
  ExpressRoute: "expressroute",
  "Azure DNS": "dns",
  "Azure Front Door Service": "front-door",
  "Azure Front Door": "front-door",
  "Content Delivery Network": "cdn",
  "Traffic Manager": "traffic-manager",
  "NAT Gateway": "nat-gateway",
  Bandwidth: "bandwidth",
  "IP Addresses": "public-ip",
  "Azure Private Link": "private-link",
  "Azure DDoS Protection": "ddos-protection",
  "Azure Bastion": "bastion",
  "Key Vault": "key-vault",
  "Microsoft Defender for Cloud": "defender",
  Sentinel: "sentinel",
  "Microsoft Sentinel": "sentinel",
  "Azure Monitor": "monitor",
  "Log Analytics": "log-analytics",
  "Application Insights": "application-insights",
  Automation: "automation",
  "Azure Arc": "azure-arc",
  "Azure OpenAI": "openai",
  "Azure OpenAI Service": "openai",
  "Foundry Models": "foundry",
  "Foundry Tools": "foundry",
  "Azure AI Foundry": "foundry",
  "Cognitive Services": "ai-services",
  "Azure AI Services": "ai-services",
  "Azure AI Search": "ai-search",
  "Azure Cognitive Search": "ai-search",
  "Azure Machine Learning": "machine-learning",
  "Azure Synapse Analytics": "synapse",
  "Azure Data Factory v2": "data-factory",
  "Azure Data Factory": "data-factory",
  "Azure Databricks": "databricks",
  "Azure Data Explorer": "data-explorer",
  "Stream Analytics": "stream-analytics",
  HDInsight: "hdinsight",
  "Power BI Embedded": "power-bi-embedded",
  "Event Hubs": "event-hubs",
  "Event Grid": "event-grid",
  "Service Bus": "service-bus",
  "Logic Apps": "logic-apps",
  "API Management": "api-management",
  "Azure Static Web Apps": "static-web-apps",
  SignalR: "signalr",
  "Azure Communication Services": "communication-services",
  "Azure DevOps": "devops",
  "Azure Stack HCI": "azure-stack",
  "Azure Stack Hub": "azure-stack",
  "Azure Stack Edge": "azure-stack",
  "Azure Migrate": "migration",
  "Azure Database Migration Service": "migration",
};

/** Keyword rules for serviceNames not listed above, tried in order (most specific first). */
const KEYWORD_RULES: ReadonlyArray<readonly [RegExp, IconKey]> = [
  [/site recovery/, "site-recovery"],
  [/backup/, "backup"],
  [/\bazure arc\b|\barc[- ]enabled\b/, "azure-arc"],
  [/sql managed instance/, "sql-managed-instance"],
  [/sql server/, "sql-server"],
  [/sql database|\bazure sql\b|\bsql\b/, "sql-database"],
  [/cosmos/, "cosmos-db"],
  [/postgres/, "postgresql"],
  [/mysql/, "mysql"],
  [/redis/, "redis"],
  [/kubernetes|\baks\b/, "kubernetes"],
  [/container apps?\b/, "container-apps"],
  [/container instances?\b/, "container-instances"],
  [/container registry/, "container-registry"],
  [/static web apps?\b/, "static-web-apps"],
  [/app service/, "app-service"],
  [/\bfunctions\b/, "functions"],
  [/virtual desktop/, "virtual-desktop"],
  [/vmware/, "vmware"],
  [/virtual machines?\b|dedicated host/, "virtual-machines"],
  [/\bdisks?\b/, "managed-disks"],
  [/netapp/, "netapp-files"],
  [/file sync|\bfiles\b/, "files"],
  [/\bblob|data lake storage/, "blob"],
  [/front door/, "front-door"],
  [/\bcdn\b|content delivery/, "cdn"],
  [/application gateway/, "application-gateway"],
  [/firewall/, "firewall"],
  [/\bvpn\b/, "vpn-gateway"],
  [/expressroute/, "expressroute"],
  [/\bdns\b/, "dns"],
  [/load balanc/, "load-balancer"],
  [/traffic manager/, "traffic-manager"],
  [/nat gateway/, "nat-gateway"],
  [/ddos/, "ddos-protection"],
  [/bastion/, "bastion"],
  [/private link|private endpoint/, "private-link"],
  [/bandwidth|data transfer/, "bandwidth"],
  [/public ip|\bip address/, "public-ip"],
  [/virtual network|virtual wan|\bvnet\b/, "virtual-network"],
  [/key vault|managed hsm/, "key-vault"],
  [/defender|security center/, "defender"],
  [/sentinel/, "sentinel"],
  [/\bentra\b|active directory|\bidentity\b|\bb2c\b/, "identity"],
  [/openai/, "openai"],
  [/foundry/, "foundry"],
  [/cognitive search|\bai search\b/, "ai-search"],
  [/machine learning/, "machine-learning"],
  [/cognitive|ai services|\bspeech\b|translator|\bvision\b|\blanguage\b|document intelligence|form recognizer|content safety/, "ai-services"],
  [/synapse/, "synapse"],
  [/data factory/, "data-factory"],
  [/databricks/, "databricks"],
  [/data explorer/, "data-explorer"],
  [/stream analytics/, "stream-analytics"],
  [/hdinsight/, "hdinsight"],
  [/power bi/, "power-bi-embedded"],
  [/event hubs?\b/, "event-hubs"],
  [/event grid/, "event-grid"],
  [/service bus/, "service-bus"],
  [/logic apps?\b/, "logic-apps"],
  [/api management/, "api-management"],
  [/signalr|web pubsub/, "signalr"],
  [/log analytics/, "log-analytics"],
  [/application insights/, "application-insights"],
  [/\bmonitor\b/, "monitor"],
  [/\bautomation\b/, "automation"],
  [/devops/, "devops"],
  [/communication/, "communication-services"],
  [/azure stack|azure local|stack hci/, "azure-stack"],
  [/\bbatch\b/, "batch"],
  [/migrat/, "migration"],
  [/\biot\b|digital twins|time series insights|\bsphere\b/, "iot"],
  [/remote rendering|spatial anchors|object anchors|mixed reality/, "mixed-reality"],
  [/power platform|power apps|power automate|power pages|dataverse/, "power-platform"],
];

/** serviceFamily values seen in the Azure Retail Prices API (compared case-insensitively). */
const FAMILY_ICON_KEYS: Readonly<Record<string, IconKey>> = {
  Compute: "compute",
  Storage: "storage",
  Networking: "networking",
  Databases: "databases",
  "AI + Machine Learning": "ai-machine-learning",
  Analytics: "analytics",
  Containers: "containers",
  Security: "security",
  Identity: "identity",
  Integration: "integration",
  "Internet of Things": "iot",
  IoT: "iot",
  "Management and Governance": "management-governance",
  "Management + Governance": "management-governance",
  Web: "web",
  "Developer Tools": "developer-tools",
  DevOps: "developer-tools",
  Migration: "migration",
  "Mixed Reality": "mixed-reality",
  "Azure Arc": "azure-arc",
  "Azure Communication Services": "communication-services",
  "Azure Stack": "azure-stack",
  "Power Platform": "power-platform",
  "Windows Virtual Desktop": "virtual-desktop",
  Telecommunications: "networking",
  Blockchain: "other",
  Gaming: "other",
  "Microsoft Syntex": "other",
  "Quantum Computing": "other",
  Other: "other",
};

function normalize(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function lowerCaseLookup(table: Readonly<Record<string, IconKey>>): ReadonlyMap<string, IconKey> {
  return new Map(Object.entries(table).map(([name, key]) => [normalize(name), key]));
}

const NAME_LOOKUP = lowerCaseLookup(SERVICE_NAME_ICON_KEYS);
const FAMILY_LOOKUP = lowerCaseLookup(FAMILY_ICON_KEYS);

/**
 * Icon key for a Retail Prices API service: exact serviceName, then keyword rules, then the
 * serviceFamily. Unknown services resolve to "other"; no information at all resolves to "generic".
 */
export function iconKeyForService(serviceName?: string | null, serviceFamily?: string | null): IconKey {
  const name = normalize(serviceName);
  const family = normalize(serviceFamily);
  if (name) {
    const exact = NAME_LOOKUP.get(name);
    if (exact) return exact;
    for (const [pattern, key] of KEYWORD_RULES) {
      if (pattern.test(name)) return key;
    }
  }
  if (family) {
    const byFamily = FAMILY_LOOKUP.get(family);
    if (byFamily) return byFamily;
  }
  return name || family ? "other" : "generic";
}

/** lucide-react icons used by the fallback tiles (ServiceIcon maps each name to its component). */
export type LucideIconName =
  | "Activity"
  | "ArrowLeftRight"
  | "Brain"
  | "ChartColumn"
  | "Cloud"
  | "CodeXml"
  | "Container"
  | "Cpu"
  | "Database"
  | "FingerprintPattern"
  | "Glasses"
  | "Globe"
  | "HardDrive"
  | "KeyRound"
  | "Lock"
  | "MessagesSquare"
  | "Monitor"
  | "Network"
  | "Puzzle"
  | "RefreshCcw"
  | "Search"
  | "Server"
  | "Settings2"
  | "ShieldCheck"
  | "Sparkles"
  | "Truck"
  | "Workflow"
  | "Zap";

export interface FallbackStyle {
  /** lucide-react glyph, drawn white on the tile. */
  icon: LucideIconName;
  /** Tailwind background classes of the tile (literal strings so Tailwind can detect them). */
  tile: string;
}

/** Keys that own a fallback style: the calculator modules and the serviceFamily fallbacks. */
const FALLBACK_FAMILIES = [
  "virtual-machines",
  "managed-disks",
  "backup",
  "site-recovery",
  "sql-server",
  "generic",
  "compute",
  "storage",
  "networking",
  "databases",
  "ai-machine-learning",
  "analytics",
  "containers",
  "security",
  "identity",
  "integration",
  "iot",
  "management-governance",
  "web",
  "developer-tools",
  "migration",
  "mixed-reality",
  "other",
] as const satisfies readonly IconKey[];

export type FallbackFamily = (typeof FALLBACK_FAMILIES)[number];

export const FALLBACK_STYLE: Readonly<Record<FallbackFamily, FallbackStyle>> = {
  "virtual-machines": { icon: "Server", tile: "bg-linear-to-br from-sky-500 to-blue-700" },
  "managed-disks": { icon: "HardDrive", tile: "bg-linear-to-br from-cyan-500 to-sky-700" },
  backup: { icon: "ShieldCheck", tile: "bg-linear-to-br from-blue-500 to-indigo-700" },
  "site-recovery": { icon: "RefreshCcw", tile: "bg-linear-to-br from-sky-500 to-indigo-600" },
  "sql-server": { icon: "Database", tile: "bg-linear-to-br from-blue-600 to-indigo-800" },
  generic: { icon: "Puzzle", tile: "bg-linear-to-br from-slate-500 to-slate-700" },
  compute: { icon: "Server", tile: "bg-linear-to-br from-sky-500 to-blue-700" },
  storage: { icon: "HardDrive", tile: "bg-linear-to-br from-cyan-500 to-sky-700" },
  networking: { icon: "Network", tile: "bg-linear-to-br from-sky-400 to-blue-600" },
  databases: { icon: "Database", tile: "bg-linear-to-br from-blue-500 to-indigo-700" },
  "ai-machine-learning": { icon: "Brain", tile: "bg-linear-to-br from-indigo-500 to-violet-700" },
  analytics: { icon: "ChartColumn", tile: "bg-linear-to-br from-sky-600 to-indigo-700" },
  containers: { icon: "Container", tile: "bg-linear-to-br from-blue-400 to-blue-700" },
  security: { icon: "Lock", tile: "bg-linear-to-br from-blue-700 to-indigo-900" },
  identity: { icon: "FingerprintPattern", tile: "bg-linear-to-br from-sky-600 to-blue-800" },
  integration: { icon: "Workflow", tile: "bg-linear-to-br from-cyan-600 to-blue-700" },
  iot: { icon: "Cpu", tile: "bg-linear-to-br from-teal-500 to-cyan-700" },
  "management-governance": { icon: "Settings2", tile: "bg-linear-to-br from-slate-500 to-blue-700" },
  web: { icon: "Globe", tile: "bg-linear-to-br from-sky-400 to-cyan-600" },
  "developer-tools": { icon: "CodeXml", tile: "bg-linear-to-br from-indigo-400 to-blue-700" },
  migration: { icon: "Truck", tile: "bg-linear-to-br from-cyan-500 to-blue-600" },
  "mixed-reality": { icon: "Glasses", tile: "bg-linear-to-br from-violet-500 to-indigo-700" },
  other: { icon: "Cloud", tile: "bg-linear-to-br from-slate-400 to-slate-600" },
};

/** The fallback family each service key borrows its tile from. */
const SERVICE_FALLBACK_FAMILY: Readonly<Record<Exclude<IconKey, FallbackFamily>, FallbackFamily>> = {
  "app-service": "web",
  functions: "compute",
  "virtual-desktop": "compute",
  vmware: "compute",
  batch: "compute",
  kubernetes: "containers",
  "container-apps": "containers",
  "container-instances": "containers",
  "container-registry": "containers",
  "storage-accounts": "storage",
  blob: "storage",
  files: "storage",
  "netapp-files": "storage",
  "sql-database": "databases",
  "sql-managed-instance": "databases",
  "cosmos-db": "databases",
  postgresql: "databases",
  mysql: "databases",
  redis: "databases",
  "virtual-network": "networking",
  "load-balancer": "networking",
  "application-gateway": "networking",
  firewall: "security",
  "vpn-gateway": "networking",
  expressroute: "networking",
  dns: "networking",
  "front-door": "networking",
  cdn: "networking",
  "traffic-manager": "networking",
  "nat-gateway": "networking",
  bandwidth: "networking",
  "public-ip": "networking",
  "private-link": "networking",
  "ddos-protection": "security",
  bastion: "security",
  "key-vault": "security",
  defender: "security",
  sentinel: "security",
  monitor: "management-governance",
  "log-analytics": "management-governance",
  "application-insights": "management-governance",
  automation: "management-governance",
  "azure-arc": "management-governance",
  openai: "ai-machine-learning",
  foundry: "ai-machine-learning",
  "ai-services": "ai-machine-learning",
  "ai-search": "ai-machine-learning",
  "machine-learning": "ai-machine-learning",
  synapse: "analytics",
  "data-factory": "integration",
  databricks: "analytics",
  "data-explorer": "analytics",
  "stream-analytics": "analytics",
  hdinsight: "analytics",
  "power-bi-embedded": "analytics",
  "event-hubs": "integration",
  "event-grid": "integration",
  "service-bus": "integration",
  "logic-apps": "integration",
  "api-management": "integration",
  "static-web-apps": "web",
  signalr: "web",
  "communication-services": "web",
  devops: "developer-tools",
  "azure-stack": "compute",
  "power-platform": "other",
};

/** Glyphs that read better than the family glyph for a specific service. */
const GLYPH_OVERRIDES: Readonly<Partial<Record<IconKey, LucideIconName>>> = {
  functions: "Zap",
  "virtual-desktop": "Monitor",
  bandwidth: "ArrowLeftRight",
  dns: "Globe",
  "key-vault": "KeyRound",
  openai: "Sparkles",
  foundry: "Sparkles",
  "ai-search": "Search",
  monitor: "Activity",
  "application-insights": "Activity",
  "communication-services": "MessagesSquare",
};

function isFallbackFamily(key: IconKey): key is FallbackFamily {
  return Object.hasOwn(FALLBACK_STYLE, key);
}

export function fallbackFamilyOf(key: IconKey): FallbackFamily {
  return isFallbackFamily(key) ? key : SERVICE_FALLBACK_FAMILY[key];
}

/** Glyph and tile colours used by ServiceIcon when the official SVG for `key` is not available. */
export function fallbackStyleFor(key: IconKey): FallbackStyle {
  const style = FALLBACK_STYLE[fallbackFamilyOf(key)];
  const icon = GLYPH_OVERRIDES[key];
  return icon ? { icon, tile: style.tile } : style;
}
