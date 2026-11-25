// Currency conversion and formatting. All prices are USD; conversion happens only for display.
// Pure TypeScript (no DOM) so it runs under `node --test`.
import type { FxTable } from "./types.ts";

export const BASE_CURRENCY = "USD";
export const FX_DISCLAIMER =
  "USD is Microsoft's pricing currency; other currencies are indicative and converted with the daily FX snapshot.";

/** Anything with a `rates` table; null/undefined (FX not loaded yet) only knows USD. */
export type FxLike = Pick<FxTable, "rates"> | null | undefined;

export interface MoneyFormatOptions {
  /**
   * Unit price (table columns): |x| < 0.01 → up to 4 significant digits ($0.0068);
   * 0.01 ≤ |x| < 10 → fixed 4 decimals ($0.2150, $1.5000; 2 for 0-decimal currencies: ¥3.37);
   * |x| ≥ 10 → the currency's decimals ($135.17, ¥1,235).
   */
  unitPrice?: boolean;
  /** Compact notation, e.g. "$1.2K" (Intl defaults). */
  compact?: boolean;
}

export function normalizeCurrency(code: string | undefined | null): string {
  return (code ?? "").trim().toUpperCase();
}

/**
 * Units of `currency` per 1 USD. USD is always 1 (even without an FX table).
 * Returns null for an unknown currency or an invalid rate — it never throws.
 */
export function currencyRate(fx: FxLike, currency: string): number | null {
  const cur = normalizeCurrency(currency);
  if (cur === BASE_CURRENCY) return 1;
  const rate = fx?.rates?.[cur];
  return typeof rate === "number" && Number.isFinite(rate) && rate > 0 ? rate : null;
}

export function isKnownCurrency(fx: FxLike, currency: string): boolean {
  return currencyRate(fx, currency) !== null;
}

/** `currency` if the FX table knows it, otherwise "USD". Use it before converting/formatting. */
export function resolveCurrency(currency: string | undefined | null, fx: FxLike): string {
  const cur = normalizeCurrency(currency);
  return cur !== "" && currencyRate(fx, cur) !== null ? cur : BASE_CURRENCY;
}

/** usd × rate. Unknown currency → NaN (formatMoney renders it as "—"); call resolveCurrency first. */
export function convertUsd(usd: number, currency: string, fx: FxLike): number {
  const rate = currencyRate(fx, currency);
  return rate === null ? Number.NaN : usd * rate;
}

/** USD first, then every other valid code of the FX table alphabetically. */
export function listCurrencies(fx: FxLike): string[] {
  const codes = new Set<string>();
  for (const code of Object.keys(fx?.rates ?? {})) {
    const cur = normalizeCurrency(code);
    if (cur !== BASE_CURRENCY && /^[A-Z]{3}$/.test(cur) && currencyRate(fx, cur) !== null) codes.add(cur);
  }
  return [BASE_CURRENCY, ...[...codes].sort()];
}

const formatterCache = new Map<string, Intl.NumberFormat>();

function formatter(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let f = formatterCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, options);
    formatterCache.set(key, f);
  }
  return f;
}

/** Default number of decimals of a currency (USD/EUR 2, JPY/KRW 0). Unknown codes → 2. */
export function currencyFractionDigits(currency: string): number {
  try {
    return formatter("en-US", { style: "currency", currency: normalizeCurrency(currency) }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/** e.g. "Euro"; falls back to the code. */
export function currencyDisplayName(currency: string): string {
  const cur = normalizeCurrency(currency);
  try {
    return new Intl.DisplayNames(["en"], { type: "currency" }).of(cur) ?? cur;
  } catch {
    return cur;
  }
}

const UNIT_SIG_DIGITS = 4;
const UNIT_LOW = 0.01;
const UNIT_HIGH = 10;

/** Intl options of a unit price (see MoneyFormatOptions.unitPrice); buckets use the rounded value. */
function unitPriceOptions(abs: number, digits: number): Intl.NumberFormatOptions {
  const fixed = (n: number): Intl.NumberFormatOptions => ({ minimumFractionDigits: n, maximumFractionDigits: n });
  if (abs === 0) return fixed(digits);
  const mid = digits === 0 ? 2 : Math.max(4, digits);
  // 0.0099996 rounds to 0.01000 (→ middle bucket); 9.99996 rounds to 10.0000 (→ top bucket).
  if (abs < UNIT_LOW - 0.5 * UNIT_LOW * 10 ** -UNIT_SIG_DIGITS) return { maximumSignificantDigits: UNIT_SIG_DIGITS };
  if (abs < UNIT_HIGH - 0.5 * 10 ** -mid) return fixed(mid);
  return fixed(digits);
}

/**
 * Formats an amount already expressed in `currency` (convert USD first with convertUsd).
 * Amounts: the currency's default decimals (2 for USD/EUR, 0 for JPY/KRW).
 * Unit prices: see MoneyFormatOptions.unitPrice. Non-finite → "—".
 */
export function formatMoney(amount: number, currency: string, opts: MoneyFormatOptions = {}): string {
  if (!Number.isFinite(amount)) return "—";
  const value = amount === 0 ? 0 : amount;
  const cur = normalizeCurrency(currency) || BASE_CURRENCY;
  const digits = currencyFractionDigits(cur);
  let options: Intl.NumberFormatOptions;
  if (opts.compact) {
    options = { notation: "compact" };
  } else if (opts.unitPrice) {
    options = unitPriceOptions(Math.abs(value), digits);
  } else {
    options = { minimumFractionDigits: digits, maximumFractionDigits: digits };
  }
  try {
    return formatter("en-US", { style: "currency", currency: cur, ...options }).format(value);
  } catch {
    return `${formatNumber(value, { maximumFractionDigits: opts.unitPrice ? 6 : 2 })} ${cur}`;
  }
}

export interface NumberFormatOptions {
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
  compact?: boolean;
}

/** en-US grouping ("1,234.5"); up to 2 decimals by default, 3 significant digits below 0.01. Non-finite → "—". */
export function formatNumber(value: number, opts: NumberFormatOptions = {}): string {
  if (!Number.isFinite(value)) return "—";
  const v = value === 0 ? 0 : value;
  let options: Intl.NumberFormatOptions;
  if (opts.compact) options = { notation: "compact" };
  else if (opts.maximumFractionDigits === undefined && opts.minimumFractionDigits === undefined && v !== 0 && Math.abs(v) < 0.01)
    options = { maximumSignificantDigits: 3 };
  else {
    const max = Math.max(opts.maximumFractionDigits ?? 2, opts.minimumFractionDigits ?? 0);
    options = { minimumFractionDigits: opts.minimumFractionDigits ?? 0, maximumFractionDigits: max };
  }
  return formatter("en-US", options).format(v);
}
