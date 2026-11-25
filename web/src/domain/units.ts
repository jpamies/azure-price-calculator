// Parser for the Retail Prices API `unitOfMeasure` column ("1 Hour", "1 GB/Month", "10K", ...).
// Pure TypeScript: safe for node --test.
import { HOURS_PER_MONTH } from "./model.ts";

export type UnitPeriod = "hour" | "day" | "month" | "year";

export interface ParsedUnit {
  /** The original string. */
  raw: string;
  /** How many measured units one price covers: "10K" → 10000, "100 Hours" → 100, "1 GB" → 1. */
  packSize: number;
  /** Measured thing without the period, canonical case: "GB", "GiB", "TB", "" (plain count/instances). */
  measure: string;
  /** Billing period of the rate; null = usage-based (GB transferred, transactions, ...). */
  per: UnitPeriod | null;
  /** true when the charge scales with running time (per hour or per day) → show an hours/month input. */
  timeBased: boolean;
  /** false when the string did not follow the usual "<number> <measure>/<period>" shape. */
  recognized: boolean;
}

const PERIOD_WORDS: Record<string, UnitPeriod> = {
  hour: "hour",
  hours: "hour",
  hr: "hour",
  hrs: "hour",
  day: "day",
  days: "day",
  month: "month",
  months: "month",
  mo: "month",
  year: "year",
  years: "year",
  yr: "year",
  yrs: "year",
};

const MULTIPLIERS: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9 };

function canonicalWord(word: string): string {
  const size = /^([kmgtp])(i?)b$/i.exec(word);
  if (size) return size[1].toUpperCase() + (size[2] ? "i" : "") + "B";
  return word;
}

function canonicalMeasure(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (!t || /^(counts?|units?|items?)$/i.test(t)) return "";
  return t.split(" ").map(canonicalWord).join(" ");
}

const cache = new Map<string, ParsedUnit>();

/** Parse a unitOfMeasure string. Never throws; unknown shapes come back with recognized = false. */
export function parseUnit(uom: string): ParsedUnit {
  const raw = uom ?? "";
  const hit = cache.get(raw);
  if (hit) return hit;

  let rest = raw.trim();
  let packSize = 1;
  const num = /^(\d[\d,]*(?:\.\d+)?)\s*(?:([kmb])(?=[\s/]|$))?/i.exec(rest);
  if (num) {
    const n = Number(num[1].replace(/,/g, ""));
    const mult = num[2] ? MULTIPLIERS[num[2].toLowerCase()] : 1;
    if (Number.isFinite(n) && n > 0) packSize = n * mult;
    rest = rest.slice(num[0].length).trim();
  }

  let measure = rest;
  let per: UnitPeriod | null = null;
  let recognized = num !== null;
  const slash = rest.indexOf("/");
  if (slash >= 0) {
    const period = rest.slice(slash + 1).trim().toLowerCase();
    const p = PERIOD_WORDS[period];
    if (p) {
      per = p;
      measure = rest.slice(0, slash);
    } else {
      recognized = false;
    }
  } else {
    const words = rest.split(/\s+/).filter(Boolean);
    const last = words.length ? PERIOD_WORDS[words[words.length - 1].toLowerCase()] : undefined;
    if (last) {
      per = last;
      words.pop();
      measure = words.join(" ");
      recognized = true;
    }
  }

  const parsed: ParsedUnit = Object.freeze({
    raw,
    packSize,
    measure: canonicalMeasure(measure),
    per,
    timeBased: per === "hour" || per === "day",
    recognized,
  });
  if (cache.size > 5000) cache.clear();
  cache.set(raw, parsed);
  return parsed;
}

function asParsed(unit: ParsedUnit | string): ParsedUnit {
  return typeof unit === "string" ? parseUnit(unit) : unit;
}

/** Compact pack size: 10000 → "10K", 1000000 → "1M", 100 → "100". */
export function formatPackSize(n: number): string {
  if (n >= 1e9 && n % 1e9 === 0) return `${n / 1e9}B`;
  if (n >= 1e6 && n % 1e6 === 0) return `${n / 1e6}M`;
  if (n >= 1e3 && n % 1e3 === 0) return `${n / 1e3}K`;
  return String(n);
}

/** Human text for a unit price: "per hour", "per GB/month", "per 10K", "per 100 hours", "per unit". */
export function describeUnit(uom: ParsedUnit | string): string {
  const p = asParsed(uom);
  const pack = p.packSize === 1 ? "" : formatPackSize(p.packSize);
  if (p.per && !p.measure) {
    if (!pack) return `per ${p.per}`;
    return p.timeBased ? `per ${pack} ${p.per}s` : `per ${pack}/${p.per}`;
  }
  const what = [pack, p.measure].filter(Boolean).join(" ");
  if (p.per) return `per ${what}/${p.per}`;
  return what ? `per ${what}` : "per unit";
}

/** Word measures get an "s" when plural ("Minute" → "Minutes"); sizes/acronyms ("GB", "IOPS") do not. */
function measureFor(measure: string, isPlural: boolean): string {
  if (!isPlural || /^[KMGTPE]i?B$/.test(measure) || !/[a-z]$/.test(measure)) return measure;
  return `${measure}s`;
}

/**
 * Label of a quantity expressed in billing units (packs) of this meter, for Line.unit. Plural by
 * default; pass the quantity to get the singular for exactly 1 ("hour", "unit").
 */
export function billingUnitLabel(uom: ParsedUnit | string, count?: number): string {
  const p = asParsed(uom);
  const pack = p.packSize === 1 ? "" : `${formatPackSize(p.packSize)} `;
  const s = count === 1 && p.packSize === 1 ? "" : "s";
  switch (p.per) {
    case "hour":
    case "day":
    case "year":
      return p.measure ? `${pack}${p.measure}-${p.per}${s}` : `${pack}${p.per}${s}`;
    case "month":
      return p.measure ? `${pack}${p.measure}/month` : `${pack}unit${pack ? "s" : s}`;
    default:
      return p.measure ? `${pack}${measureFor(p.measure, s === "s")}` : pack ? pack.trim() : `unit${s}`;
  }
}

/**
 * Label for the user-entered quantity of a meter (GenericConfig.quantity): "instances", "GB",
 * "units per month"… Pass the quantity to get the singular for exactly 1 ("1 instance").
 */
export function quantityLabel(uom: ParsedUnit | string, count?: number): string {
  const p = asParsed(uom);
  const many = count !== 1;
  const units = many ? "units" : "unit";
  if (p.timeBased) return p.measure ? measureFor(p.measure, many) : many ? "instances" : "instance";
  if (p.per) return p.measure ? measureFor(p.measure, many) : units;
  return `${p.measure ? measureFor(p.measure, many) : units} per month`;
}

/** Number of billing periods in a month: hour → hoursPerMonth, day → hoursPerMonth / 24, year → 1/12. */
export function periodsPerMonth(per: UnitPeriod | null, hoursPerMonth: number = HOURS_PER_MONTH): number {
  switch (per) {
    case "hour":
      return hoursPerMonth;
    case "day":
      return hoursPerMonth / 24;
    case "year":
      return 1 / 12;
    default:
      return 1;
  }
}

/**
 * Multiplier from (user quantity × unit price) to USD per month:
 * monthly = quantity × retailPrice × monthlyFactor. Also converts a quantity into billing units:
 * billingUnits = quantity × monthlyFactor (e.g. 2 instances of a "1 Hour" meter → 1460).
 */
export function monthlyFactor(parsed: ParsedUnit | string, hoursPerMonth: number = HOURS_PER_MONTH): number {
  const p = asParsed(parsed);
  return periodsPerMonth(p.per, hoursPerMonth) / p.packSize;
}

/** Months in a reservation/savings plan term: "1 Year" → 12, "3 Years" → 36, "6 Months" → 6; null if unknown. */
export function termMonths(term: string): number | null {
  const y = /(\d+(?:\.\d+)?)\s*(?:years?|yrs?)\b/i.exec(term ?? "");
  if (y) return Math.round(Number(y[1]) * 12);
  const m = /(\d+)\s*months?\b/i.exec(term ?? "");
  if (m) return Number(m[1]);
  return null;
}
