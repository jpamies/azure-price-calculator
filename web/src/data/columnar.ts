// Decodes a columnar price shard ({ cols, rows }) into PriceRow objects, reading columns BY NAME.
// Pure TypeScript (no DOM) so it runs under `node --test`. See docs/data-contract.md.
import type { PriceRow } from "../domain/types.ts";

export interface ColumnarDoc {
  cols: unknown;
  rows: unknown;
  service?: unknown;
  region?: unknown;
}

const REQUIRED_COLUMNS = ["meterId", "retailPrice"] as const;

export function isColumnarDoc(value: unknown): value is ColumnarDoc {
  return typeof value === "object" && value !== null && Array.isArray((value as ColumnarDoc).cols) && Array.isArray((value as ColumnarDoc).rows);
}

function str(row: unknown[], i: number): string {
  if (i < 0) return "";
  const v = row[i];
  if (typeof v === "string") return v;
  return v === null || v === undefined ? "" : String(v);
}

function num(row: unknown[], i: number): number {
  if (i < 0) return 0;
  const v = row[i];
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : 0;
}

function bool(row: unknown[], i: number): boolean {
  const v = row[i];
  return v === 1 || v === true || v === "1" || v === "true";
}

/**
 * Validates `cols` (array of unique strings including meterId and retailPrice) and decodes `rows`.
 * Missing strings → "", missing numbers → 0, isWindows 0/1 → boolean (derived from productName
 * when the column is absent). Non-array rows are skipped. Throws an Error on an invalid document.
 */
export function decodeShard(doc: { cols: unknown; rows: unknown }): PriceRow[] {
  if (!doc || typeof doc !== "object") throw new Error("Invalid price shard: expected an object with cols and rows.");
  const { cols, rows } = doc;
  if (!Array.isArray(cols) || !cols.every((c) => typeof c === "string")) {
    throw new Error("Invalid price shard: cols must be an array of column names.");
  }
  const names = cols as string[];
  if (new Set(names).size !== names.length) throw new Error("Invalid price shard: duplicate column names.");
  for (const required of REQUIRED_COLUMNS) {
    if (!names.includes(required)) throw new Error(`Invalid price shard: missing column "${required}".`);
  }
  if (!Array.isArray(rows)) throw new Error("Invalid price shard: rows must be an array.");

  const at = (name: string) => names.indexOf(name);
  const iMeterId = at("meterId");
  const iMeterName = at("meterName");
  const iProductName = at("productName");
  const iSkuName = at("skuName");
  const iArmSkuName = at("armSkuName");
  const iUnit = at("unitOfMeasure");
  const iType = at("type");
  const iTerm = at("reservationTerm");
  const iTier = at("tierMinimumUnits");
  const iPrice = at("retailPrice");
  const iStart = at("effectiveStartDate");
  const iWindows = at("isWindows");

  const out: PriceRow[] = [];
  for (const row of rows as unknown[]) {
    if (!Array.isArray(row)) continue;
    const productName = str(row, iProductName);
    out.push({
      meterId: str(row, iMeterId),
      meterName: str(row, iMeterName),
      productName,
      skuName: str(row, iSkuName),
      armSkuName: str(row, iArmSkuName),
      unitOfMeasure: str(row, iUnit),
      type: str(row, iType),
      reservationTerm: str(row, iTerm),
      tierMinimumUnits: num(row, iTier),
      retailPrice: num(row, iPrice),
      effectiveStartDate: str(row, iStart),
      isWindows: iWindows >= 0 ? bool(row, iWindows) : /windows/i.test(productName),
    });
  }
  return out;
}
