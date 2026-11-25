import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FX_DISCLAIMER,
  convertUsd,
  currencyDisplayName,
  currencyFractionDigits,
  currencyRate,
  formatMoney,
  formatNumber,
  listCurrencies,
  resolveCurrency,
} from "../src/domain/money.ts";
import { FX } from "./_platform-fixtures.ts";

describe("currency rates and conversion", () => {
  it("USD is always 1, even without an FX table", () => {
    assert.equal(currencyRate(undefined, "USD"), 1);
    assert.equal(currencyRate(null, "usd"), 1);
    assert.equal(currencyRate(FX, "USD"), 1);
  });

  it("returns the rate, or null for unknown/invalid currencies", () => {
    assert.equal(currencyRate(FX, "EUR"), 0.85);
    assert.equal(currencyRate(FX, " eur "), 0.85);
    assert.equal(currencyRate(FX, "XYZ"), null);
    assert.equal(currencyRate(undefined, "EUR"), null);
    assert.equal(currencyRate({ rates: { BAD: -1, NAN: Number.NaN } }, "BAD"), null);
  });

  it("converts USD; unknown currency → NaN", () => {
    assert.equal(convertUsd(100, "EUR", FX), 85);
    assert.equal(convertUsd(100, "USD", undefined), 100);
    assert.ok(Number.isNaN(convertUsd(100, "XYZ", FX)));
  });

  it("resolveCurrency falls back to USD", () => {
    assert.equal(resolveCurrency("eur", FX), "EUR");
    assert.equal(resolveCurrency("XYZ", FX), "USD");
    assert.equal(resolveCurrency("EUR", undefined), "USD");
    assert.equal(resolveCurrency(undefined, FX), "USD");
  });

  it("listCurrencies: USD first, then alphabetical", () => {
    assert.deepEqual(listCurrencies(FX), ["USD", "EUR", "GBP", "JPY"]);
    assert.deepEqual(listCurrencies({ rates: { ZAR: 18, AUD: 1.5, USD: 1, bad: 2, NOK: 0 } }), ["USD", "AUD", "ZAR"]);
    assert.deepEqual(listCurrencies(undefined), ["USD"]);
  });

  it("has the FX disclaimer", () => {
    assert.equal(FX_DISCLAIMER, "USD is Microsoft's pricing currency; other currencies are indicative and converted with the daily FX snapshot.");
  });
});

describe("formatMoney", () => {
  it("formats amounts with 2 decimals", () => {
    assert.equal(formatMoney(1234.5, "USD"), "$1,234.50");
    assert.equal(formatMoney(0, "USD"), "$0.00");
    assert.equal(formatMoney(-0, "USD"), "$0.00");
    assert.equal(formatMoney(0.004, "USD"), "$0.00");
    assert.equal(formatMoney(1234.5, "EUR"), "€1,234.50");
    assert.equal(formatMoney(99.999, "GBP"), "£100.00");
  });

  it("keeps Intl defaults for zero-decimal currencies", () => {
    assert.equal(currencyFractionDigits("JPY"), 0);
    assert.equal(formatMoney(12345.678, "JPY"), "¥12,346");
    assert.equal(formatMoney(12345.678, "KRW"), "₩12,346");
  });

  it("unit prices (2-decimal currencies): < 0.01 significant digits, < 10 fixed 4 decimals, else 2", () => {
    const unit = (x: number, cur = "USD") => formatMoney(x, cur, { unitPrice: true });
    // below 0.01: up to 4 significant digits
    assert.equal(unit(0.0068), "$0.0068");
    assert.equal(unit(0.00012345), "$0.0001235");
    assert.equal(unit(0.000004), "$0.000004");
    // 0.01 <= |x| < 10: fixed 4 decimals
    assert.equal(unit(0.01), "$0.0100");
    assert.equal(unit(0.0104), "$0.0104");
    assert.equal(unit(0.096), "$0.0960");
    assert.equal(unit(0.215), "$0.2150");
    assert.equal(unit(3.369), "$3.3690");
    assert.equal(unit(1.5), "$1.5000");
    assert.equal(unit(9.9999), "$9.9999");
    assert.equal(unit(-0.215), "-$0.2150");
    assert.equal(unit(0.2, "EUR"), "€0.2000");
    // >= 10: 2 decimals
    assert.equal(unit(10), "$10.00");
    assert.equal(unit(135.17), "$135.17");
    assert.equal(unit(3847.56), "$3,847.56");
    assert.equal(unit(3847.5612, "GBP"), "£3,847.56");
    // buckets follow the rounded value at the boundaries
    assert.equal(unit(9.99996), "$10.00");
    assert.equal(unit(0.0099996), "$0.0100");
    assert.equal(unit(0.0099994), "$0.009999");
    assert.equal(unit(0), "$0.00");
    assert.equal(unit(-0), "$0.00");
  });

  it("unit prices (0-decimal currencies): 2 decimals below 10, else 0", () => {
    const unit = (x: number, cur: string) => formatMoney(x, cur, { unitPrice: true });
    assert.equal(unit(0.5, "JPY"), "¥0.50");
    assert.equal(unit(3.369, "JPY"), "¥3.37");
    assert.equal(unit(9.996, "JPY"), "¥10");
    assert.equal(unit(135.17, "JPY"), "¥135");
    assert.equal(unit(1234.5, "KRW"), "₩1,235");
    assert.equal(unit(5.5, "KRW"), "₩5.50");
    assert.equal(unit(0.004, "JPY"), "¥0.004");
    assert.equal(unit(0, "JPY"), "¥0");
  });

  it("compact notation", () => {
    assert.equal(formatMoney(1234567, "USD", { compact: true }), "$1.2M");
  });

  it("non-finite → em dash; invalid code does not throw", () => {
    assert.equal(formatMoney(Number.NaN, "USD"), "—");
    assert.equal(formatMoney(Number.POSITIVE_INFINITY, "USD"), "—");
    assert.equal(formatMoney(1.5, "EURO"), "1.5 EURO");
  });

  it("currencyDisplayName", () => {
    assert.equal(currencyDisplayName("EUR"), "Euro");
  });
});

describe("formatNumber", () => {
  it("groups and limits decimals", () => {
    assert.equal(formatNumber(1234567.891), "1,234,567.89");
    assert.equal(formatNumber(730), "730");
    assert.equal(formatNumber(0.00012345), "0.000123");
    assert.equal(formatNumber(1.23456, { maximumFractionDigits: 4 }), "1.2346");
    assert.equal(formatNumber(2, { minimumFractionDigits: 2 }), "2.00");
    assert.equal(formatNumber(Number.NaN), "—");
  });
});
