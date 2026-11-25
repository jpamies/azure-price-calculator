// VM SKU catalog: one option per armSkuName with its Linux/Windows PAYG, reservation, savings plan
// and Spot prices, joined with vm-skus.json specs. Also the per-SKU price resolver used by pricing/vm.ts.
import type { CommitmentId, VmConfig } from "./model.ts";
import { HOURS_PER_MONTH } from "./model.ts";
import type { PriceRow, VmSpec, VmSpecs } from "./types.ts";
import { isType, pickEffective, preferShortestProduct, todayIso } from "./effective.ts";
import { normalize, rankBy } from "./search.ts";
import { parseUnit, termMonths } from "./units.ts";

/** Products never used for VM OS prices (software bundles, hosts, other services). */
const VM_HARD_EXCLUDED = /dedicated host|cloud services|sql|red hat|rhel|suse|ubuntu|byol/i;
/** Full exclusion list; "promo"/"basic" products are used only when a SKU has nothing else. */
export const VM_EXCLUDED_PRODUCT = /dedicated host|cloud services|promo|basic|sql|red hat|rhel|suse|ubuntu|byol/i;

const SPOT_RE = /\bspot\b/i;
const LOW_PRIORITY_RE = /low priority/i;

export interface VmSkuOption {
  armSkuName: string;
  /** e.g. "D8as v5". */
  label: string;
  /** e.g. "Dasv5". */
  family: string;
  specs: VmSpec | null;
  /** From specs, else parsed from the SKU name (see parseVcpuFromSku). */
  vCPUs?: number;
  memoryGB?: number;
  linuxHourUsd?: number;
  windowsHourUsd?: number;
  /** Reservation: total price for the whole term, per instance. */
  ri1yTotalUsd?: number;
  ri3yTotalUsd?: number;
  /** Savings plan hourly rate (compute only, Linux product). */
  sp1yHourUsd?: number;
  sp3yHourUsd?: number;
  spotLinuxHourUsd?: number;
  spotWindowsHourUsd?: number;
}

/** The rows chosen for one SKU (undefined = no price for that option). */
export interface VmSkuPrices {
  armSkuName: string;
  label: string;
  family: string;
  /** Rows of this SKU in the main shard; 0 = the SKU is not offered in the region. */
  rowCount: number;
  linux?: PriceRow;
  windows?: PriceRow;
  ri1y?: PriceRow;
  ri3y?: PriceRow;
  sp1y?: PriceRow;
  sp3y?: PriceRow;
  spotLinux?: PriceRow;
  spotWindows?: PriceRow;
}

export function isSpotRow(row: PriceRow): boolean {
  const text = `${row.skuName} ${row.meterName}`;
  return SPOT_RE.test(text) || LOW_PRIORITY_RE.test(text);
}

function isWin(row: PriceRow): boolean {
  return row.isWindows || /windows/i.test(row.productName);
}

function isHourly(row: PriceRow): boolean {
  return row.unitOfMeasure.trim() === "" || parseUnit(row.unitOfMeasure).per === "hour";
}

/** Hourly USD of a Consumption/SavingsPlans row ("1 Hour" → retailPrice; "100 Hours" → /100). */
export function hourlyUsd(row: PriceRow): number {
  const u = parseUnit(row.unitOfMeasure);
  return u.per === "hour" ? row.retailPrice / u.packSize : row.retailPrice;
}

/** "Standard_D8as_v5" → "D8as v5". */
export function vmSkuLabel(armSkuName: string): string {
  const s = armSkuName.trim();
  const basic = /^basic_/i.test(s);
  const label = s.replace(/^(standard|basic)_/i, "").replace(/_/g, " ").trim();
  return basic ? `${label} Basic` : label;
}

/** "Virtual Machines Dasv5 Series Windows" → "Dasv5"; null when the name has no "… Series". */
export function vmFamilyFromProduct(productName: string): string | null {
  const m = /^virtual machines\s+(.+?)\s+series\b/i.exec(productName.trim());
  return m ? m[1] : null;
}

/** Heuristic family from the SKU name: "Standard_D8as_v5" → "Dasv5", "Standard_E32-16s_v5" → "Esv5". */
export function vmFamilyFromSku(armSkuName: string): string {
  const parts = armSkuName.trim().replace(/^(standard|basic)_/i, "").split("_");
  const m = /^([a-z]+)\d+(?:-\d+)?([a-z]*)$/i.exec(parts[0] ?? "");
  if (!m) return parts[0] ?? armSkuName;
  return `${m[1]}${m[2]}${parts.slice(1).join("")}`;
}

/**
 * Heuristic vCPU count from the SKU name (used only when specs are unknown): the first number of
 * the size, or the constrained count after "-": "Standard_D8as_v5" → 8, "Standard_E32-16s_v5" → 16.
 */
export function parseVcpuFromSku(armSkuName: string): number | null {
  const first = armSkuName.trim().replace(/^(standard|basic)_/i, "").split("_")[0] ?? "";
  const m = /^[a-z]+(\d+)(?:-(\d+))?/i.exec(first);
  if (!m) return null;
  const n = Number(m[2] ?? m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function cleanSkuLabel(skuName: string): string {
  return skuName.replace(/\s+(spot|low priority)\s*$/i, "").trim();
}

function chooseProductRows(rows: readonly PriceRow[]): PriceRow[] {
  let pool = rows.filter((r) => !VM_HARD_EXCLUDED.test(r.productName));
  const preferred = pool.filter((r) => !VM_EXCLUDED_PRODUCT.test(r.productName));
  if (preferred.length > 0) pool = preferred;
  return preferShortestProduct(pool);
}

function pickVmRow(rows: readonly PriceRow[], today: string): PriceRow | undefined {
  const chosen = chooseProductRows(rows);
  if (chosen.length === 0) return undefined;
  let minTier = Infinity;
  for (const r of chosen) minTier = Math.min(minTier, r.tierMinimumUnits);
  return pickEffective(
    chosen.filter((r) => r.tierMinimumUnits === minTier),
    today,
  );
}

function resolveGroup(
  armSkuName: string,
  rows: readonly PriceRow[],
  spotRows: readonly PriceRow[],
  today: string,
  specFamily?: string,
): VmSkuPrices {
  const payg = rows.filter((r) => isType(r, "Consumption") && !isSpotRow(r) && isHourly(r));
  const linux = pickVmRow(
    payg.filter((r) => !isWin(r)),
    today,
  );
  const windows = pickVmRow(
    payg.filter((r) => isWin(r)),
    today,
  );
  const reservation = (months: number) => {
    const all = rows.filter((r) => isType(r, "Reservation") && !isSpotRow(r) && termMonths(r.reservationTerm) === months);
    const lin = all.filter((r) => !isWin(r));
    return pickVmRow(lin.length > 0 ? lin : all, today);
  };
  const savingsPlan = (months: number) =>
    pickVmRow(
      rows.filter(
        (r) =>
          isType(r, "SavingsPlans") &&
          !isSpotRow(r) &&
          !isWin(r) &&
          isHourly(r) &&
          termMonths(r.reservationTerm) === months,
      ),
      today,
    );
  const spot = spotRows.filter((r) => {
    const text = `${r.skuName} ${r.meterName}`;
    return isType(r, "Consumption") && SPOT_RE.test(text) && !LOW_PRIORITY_RE.test(text) && isHourly(r);
  });
  const prices: VmSkuPrices = {
    armSkuName,
    label: "",
    family: "",
    rowCount: rows.length,
    linux,
    windows,
    ri1y: reservation(12),
    ri3y: reservation(36),
    sp1y: savingsPlan(12),
    sp3y: savingsPlan(36),
    spotLinux: pickVmRow(
      spot.filter((r) => !isWin(r)),
      today,
    ),
    spotWindows: pickVmRow(
      spot.filter((r) => isWin(r)),
      today,
    ),
  };
  const rep =
    prices.linux ??
    prices.windows ??
    prices.ri3y ??
    prices.ri1y ??
    prices.sp1y ??
    prices.sp3y ??
    prices.spotLinux ??
    prices.spotWindows;
  prices.label = (rep && cleanSkuLabel(rep.skuName)) || vmSkuLabel(armSkuName);
  prices.family =
    (rep && vmFamilyFromProduct(rep.productName)) || specFamily || vmFamilyFromSku(armSkuName);
  return prices;
}

const indexMemo = new WeakMap<readonly PriceRow[], Map<string, PriceRow[]>>();

/** Rows grouped by lowercase armSkuName (rows without armSkuName are skipped). Memoized per array. */
export function indexVmRows(rows: readonly PriceRow[]): Map<string, PriceRow[]> {
  const hit = indexMemo.get(rows);
  if (hit) return hit;
  const index = new Map<string, PriceRow[]>();
  for (const r of rows) {
    const key = r.armSkuName.trim().toLowerCase();
    if (!key) continue;
    const list = index.get(key);
    if (list) list.push(r);
    else index.set(key, [r]);
  }
  indexMemo.set(rows, index);
  return index;
}

function lookupSku(index: Map<string, PriceRow[]>, armSkuName: string): PriceRow[] {
  const direct = index.get(armSkuName.trim().toLowerCase());
  if (direct) return direct;
  const wanted = normalize(armSkuName);
  if (!wanted) return [];
  for (const [key, rows] of index) if (normalize(key) === wanted) return rows;
  return [];
}

/**
 * Resolve the prices of one SKU (case-insensitive; "D8as v5" / "D8as_v5" also find
 * "Standard_D8as_v5"). rowCount 0 means the SKU is not offered in the shard's region.
 */
export function resolveVmSku(
  mainRows: readonly PriceRow[],
  armSkuName: string,
  spotRows: readonly PriceRow[] = [],
  today: string = todayIso(),
): VmSkuPrices {
  const rows = lookupSku(indexVmRows(mainRows), armSkuName);
  const spot = spotRows.length > 0 ? lookupSku(indexVmRows(spotRows), armSkuName) : [];
  const canonical = rows[0]?.armSkuName || spot[0]?.armSkuName || armSkuName.trim();
  return resolveGroup(canonical, rows, spot, today);
}

const specMemo = new WeakMap<VmSpecs, Map<string, VmSpec | null>>();

/** Specs of a SKU (exact key, then case-insensitive); null when unknown. */
export function lookupVmSpec(specs: VmSpecs | undefined, armSkuName: string): VmSpec | null {
  if (!specs) return null;
  const exact = specs[armSkuName];
  if (exact !== undefined) return exact;
  let lower = specMemo.get(specs);
  if (!lower) {
    lower = new Map();
    for (const [k, v] of Object.entries(specs)) lower.set(k.toLowerCase(), v);
    specMemo.set(specs, lower);
  }
  return lower.get(armSkuName.toLowerCase()) ?? null;
}

function hasAnyPrice(p: VmSkuPrices): boolean {
  return Boolean(p.linux || p.windows || p.ri1y || p.ri3y || p.sp1y || p.sp3y || p.spotLinux || p.spotWindows);
}

function toOption(p: VmSkuPrices, spec: VmSpec | null): VmSkuOption {
  const option: VmSkuOption = { armSkuName: p.armSkuName, label: p.label, family: p.family, specs: spec };
  const vcpus = spec?.vCPUs ?? parseVcpuFromSku(p.armSkuName);
  if (vcpus !== null && vcpus !== undefined) option.vCPUs = vcpus;
  if (spec && Number.isFinite(spec.memoryGB)) option.memoryGB = spec.memoryGB;
  if (p.linux) option.linuxHourUsd = hourlyUsd(p.linux);
  if (p.windows) option.windowsHourUsd = hourlyUsd(p.windows);
  if (p.ri1y) option.ri1yTotalUsd = p.ri1y.retailPrice;
  if (p.ri3y) option.ri3yTotalUsd = p.ri3y.retailPrice;
  if (p.sp1y) option.sp1yHourUsd = hourlyUsd(p.sp1y);
  if (p.sp3y) option.sp3yHourUsd = hourlyUsd(p.sp3y);
  if (p.spotLinux) option.spotLinuxHourUsd = hourlyUsd(p.spotLinux);
  if (p.spotWindows) option.spotWindowsHourUsd = hourlyUsd(p.spotWindows);
  return option;
}

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/** Default catalog order: family, vCPUs (unknown last), memory, label (natural sort). */
export function compareVmOptions(a: VmSkuOption, b: VmSkuOption): number {
  return (
    collator.compare(a.family, b.family) ||
    (a.vCPUs ?? Infinity) - (b.vCPUs ?? Infinity) ||
    (a.memoryGB ?? Infinity) - (b.memoryGB ?? Infinity) ||
    collator.compare(a.label, b.label) ||
    collator.compare(a.armSkuName, b.armSkuName)
  );
}

interface CatalogMemo {
  specs: VmSpecs;
  spotRows: readonly PriceRow[] | undefined;
  today: string;
  result: VmSkuOption[];
}
const catalogMemo = new WeakMap<readonly PriceRow[], CatalogMemo[]>();

/**
 * One option per armSkuName with at least one usable price (main shard + optional spot shard),
 * sorted by compareVmOptions. Memoized by the identity of mainRows (+ specs/spotRows identity).
 */
export function buildVmCatalog(
  mainRows: readonly PriceRow[],
  specs: VmSpecs,
  spotRows?: readonly PriceRow[],
): VmSkuOption[] {
  const today = todayIso();
  const entries = catalogMemo.get(mainRows) ?? [];
  const hit = entries.find((e) => e.specs === specs && e.spotRows === spotRows && e.today === today);
  if (hit) return hit.result;
  const index = indexVmRows(mainRows);
  const spotIndex = spotRows && spotRows.length > 0 ? indexVmRows(spotRows) : undefined;
  const out: VmSkuOption[] = [];
  for (const [key, rows] of index) {
    const armSkuName = rows[0].armSkuName.trim();
    const spec = lookupVmSpec(specs, armSkuName);
    const prices = resolveGroup(armSkuName, rows, spotIndex?.get(key) ?? [], today, spec?.family);
    if (hasAnyPrice(prices)) out.push(toOption(prices, spec));
  }
  out.sort(compareVmOptions);
  catalogMemo.set(mainRows, [{ specs, spotRows, today, result: out }, ...entries.filter((e) => e.today === today)].slice(0, 4));
  return out;
}

/** Selection of OS/commitment used to price an option (per instance). */
export interface VmPriceSelector {
  os: VmConfig["os"];
  commitment: CommitmentId;
  spot?: boolean;
  hoursPerMonth?: number;
}

/**
 * Monthly USD per instance for the picker table (reservations amortized: total / term months;
 * Windows license PAYG on top of RI/SP). null when a needed price is missing.
 */
export function vmOptionMonthlyUsd(option: VmSkuOption, sel: VmPriceSelector): number | null {
  const hours = sel.hoursPerMonth ?? HOURS_PER_MONTH;
  const windows = sel.os === "windows";
  if (sel.spot && sel.commitment === "payg") {
    const spot = windows ? option.spotWindowsHourUsd : option.spotLinuxHourUsd;
    return spot === undefined ? null : spot * hours;
  }
  let license = 0;
  if (windows && sel.commitment !== "payg") {
    if (option.windowsHourUsd === undefined || option.linuxHourUsd === undefined) return null;
    license = Math.max(0, option.windowsHourUsd - option.linuxHourUsd) * hours;
  }
  switch (sel.commitment) {
    case "payg": {
      const rate = windows ? option.windowsHourUsd : option.linuxHourUsd;
      return rate === undefined ? null : rate * hours;
    }
    case "ri1y":
      return option.ri1yTotalUsd === undefined ? null : option.ri1yTotalUsd / 12 + license;
    case "ri3y":
      return option.ri3yTotalUsd === undefined ? null : option.ri3yTotalUsd / 36 + license;
    case "sp1y":
      return option.sp1yHourUsd === undefined ? null : option.sp1yHourUsd * hours + license;
    case "sp3y":
      return option.sp3yHourUsd === undefined ? null : option.sp3yHourUsd * hours + license;
  }
}

export interface VmSkuFilter {
  query?: string;
  minVcpu?: number;
  maxVcpu?: number;
  minMemGB?: number;
  maxMemGB?: number;
  /** Exact family (case-insensitive, e.g. "Dasv5") or a RegExp tested on armSkuName and family. */
  family?: string | RegExp;
  /** Keep only SKUs priced for this OS/commitment (see vmOptionMonthlyUsd). */
  priceFor?: VmPriceSelector;
}

function bound(n: number | undefined | null): number | null {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Filter + search. Bounds <= 0 / undefined are ignored; options with unknown vCPUs/memory are
 * dropped when the matching bound is set. With a query, results are ranked (exact SKU first).
 */
export function filterVmSkus(options: readonly VmSkuOption[], filter: VmSkuFilter = {}): VmSkuOption[] {
  const minV = bound(filter.minVcpu);
  const maxV = bound(filter.maxVcpu);
  const minM = bound(filter.minMemGB);
  const maxM = bound(filter.maxMemGB);
  const fam = filter.family;
  const famLower = typeof fam === "string" ? fam.trim().toLowerCase() : "";
  const out = options.filter((o) => {
    if ((minV !== null || maxV !== null) && o.vCPUs === undefined) return false;
    if (minV !== null && (o.vCPUs ?? 0) < minV) return false;
    if (maxV !== null && (o.vCPUs ?? 0) > maxV) return false;
    if ((minM !== null || maxM !== null) && o.memoryGB === undefined) return false;
    if (minM !== null && (o.memoryGB ?? 0) < minM) return false;
    if (maxM !== null && (o.memoryGB ?? 0) > maxM) return false;
    if (fam instanceof RegExp) {
      if (!fam.test(o.armSkuName) && !fam.test(o.family)) return false;
    } else if (famLower && o.family.toLowerCase() !== famLower) {
      return false;
    }
    if (filter.priceFor && vmOptionMonthlyUsd(o, filter.priceFor) === null) return false;
    return true;
  });
  const query = filter.query ?? "";
  return rankBy(out, query, (o) => [o.armSkuName, o.label, o.family]);
}

/** Sorted distinct families (for a family dropdown). */
export function vmFamilies(options: readonly VmSkuOption[]): string[] {
  return [...new Set(options.map((o) => o.family).filter(Boolean))].sort((a, b) => collator.compare(a, b));
}

/** Option by armSkuName (case-insensitive, then normalized: "D8as v5" finds Standard_D8as_v5). */
export function findVmOption(options: readonly VmSkuOption[], armSkuName: string): VmSkuOption | undefined {
  const lower = armSkuName.trim().toLowerCase();
  const exact = options.find((o) => o.armSkuName.toLowerCase() === lower);
  if (exact) return exact;
  const wanted = normalize(armSkuName);
  return wanted ? options.find((o) => normalize(o.armSkuName) === wanted) : undefined;
}
