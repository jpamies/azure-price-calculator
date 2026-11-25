import { convertUsd, formatMoney, formatNumber, type FxLike } from "@/domain/money";

/** Formats USD amounts in the display currency (USD is the pricing currency; others are indicative). */
export interface MoneyFormatter {
  currency: string;
  /** Totals / monthly amounts, 2 decimals (currency default for JPY/KRW…). */
  format(usd: number): string;
  /** Unit prices (more decimals for tiny prices, e.g. $0.0068). */
  unit(usd: number): string;
  /** Short form for charts/badges, e.g. $12.3K. */
  compact(usd: number): string;
  /** Converted numeric value. */
  convert(usd: number): number;
}

export function moneyFormatter(currency: string, fx: FxLike): MoneyFormatter {
  return {
    currency,
    format: (usd) => formatMoney(convertUsd(usd, currency, fx), currency),
    unit: (usd) => formatMoney(convertUsd(usd, currency, fx), currency, { unitPrice: true }),
    compact: (usd) => formatMoney(convertUsd(usd, currency, fx), currency, { compact: true }),
    convert: (usd) => convertUsd(usd, currency, fx),
  };
}

export { formatNumber };
