// JSON export/import (single estimate, full backup). Pure TypeScript (no DOM).
import { isRecord, itemDisplayName, sanitizeEstimate, sanitizeSettings } from "../factory.ts";
import type { Estimate, Item, Settings } from "../model.ts";
import type { ItemResult, Line } from "../types.ts";

export const ESTIMATE_FILE_KIND = "azcalc-estimate";
export const BACKUP_FILE_KIND = "azcalc-backup";
export const EXPORT_VERSION = 1;

/** Priced line exported for reference (USD); ignored on import. */
export interface ExportedLine extends Line {
  itemId: string;
  itemName: string;
  service: string;
  region: string;
}

export interface EstimateFile {
  kind: typeof ESTIMATE_FILE_KIND;
  v: 1;
  exportedAt: string;
  pricesDate: string | null;
  estimate: Estimate;
  lines?: ExportedLine[];
}

export interface BackupFile {
  kind: typeof BACKUP_FILE_KIND;
  v: 1;
  exportedAt: string;
  settings: Settings;
  estimates: Estimate[];
}

export interface ImportResult {
  estimates: Estimate[];
  settings?: Settings;
  /** What the file was: an estimate file, a backup, a bare estimate or an array of estimates. */
  source: "estimate-file" | "backup-file" | "estimate" | "estimate-list" | "local-storage";
  /** Non-fatal problems (repaired fields, skipped items/estimates). */
  warnings: string[];
}

export interface ExportEstimateOptions {
  pricesDate?: string;
  /** Include the priced lines (USD) for reference. */
  results?: Record<string, ItemResult | undefined>;
  titleOf?: (item: Item) => string;
}

/** `{ kind: "azcalc-estimate", v: 1, exportedAt, pricesDate, estimate, lines? }`, pretty-printed. */
export function exportEstimateJson(estimate: Estimate, opts: ExportEstimateOptions = {}): string {
  const file: EstimateFile = {
    kind: ESTIMATE_FILE_KIND,
    v: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    pricesDate: opts.pricesDate ?? null,
    estimate,
  };
  if (opts.results) {
    const titleOf = opts.titleOf ?? itemDisplayName;
    file.lines = estimate.items.flatMap((item) =>
      (opts.results?.[item.id]?.lines ?? []).map((line) => ({
        itemId: item.id,
        itemName: itemDisplayName(item),
        service: titleOf(item),
        region: item.region,
        ...line,
      })),
    );
  }
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** `{ kind: "azcalc-backup", v: 1, exportedAt, settings, estimates }`, pretty-printed. */
export function exportBackupJson(data: { estimates: Estimate[]; settings: Settings }): string {
  const file: BackupFile = {
    kind: BACKUP_FILE_KIND,
    v: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    settings: data.settings,
    estimates: data.estimates,
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

function checkVersion(v: unknown, what: string): void {
  if (v === undefined || v === EXPORT_VERSION) return;
  if (typeof v === "number" && v > EXPORT_VERSION) {
    throw new Error(`This ${what} was exported by a newer version of the calculator (format v${v}). Reload the page and try again.`);
  }
  throw new Error(`Unsupported ${what} format version (${String(v)}).`);
}

function looksLikeEstimate(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && Array.isArray(value.items);
}

function sanitizeList(list: unknown[], warnings: string[]): Estimate[] {
  const out: Estimate[] = [];
  list.forEach((raw, i) => {
    const label = isRecord(raw) && typeof raw.name === "string" && raw.name.trim() ? `"${raw.name.trim()}"` : `#${i + 1}`;
    if (!looksLikeEstimate(raw)) {
      warnings.push(`Estimate ${label} was skipped: it is not a valid estimate.`);
      return;
    }
    out.push(sanitizeEstimate(raw, { freshIds: true, onWarning: (m) => warnings.push(`Estimate ${label}: ${m}.`) }));
  });
  return out;
}

/**
 * Parses an imported JSON file: an estimate file, a backup file, a bare Estimate, an array of
 * estimates (or a raw "azcalc.v1" localStorage dump). Every estimate gets fresh ids.
 * Throws an Error with a user-facing message when nothing usable is found.
 */
export function parseImportJson(text: string): ImportResult {
  const trimmed = (text ?? "").replace(/^\uFEFF/, "").trim();
  if (!trimmed) throw new Error("The file is empty.");
  let data: unknown;
  try {
    data = JSON.parse(trimmed);
  } catch {
    throw new Error("The file is not valid JSON.");
  }
  const warnings: string[] = [];

  if (Array.isArray(data)) {
    if (data.length === 0) throw new Error("The file contains no estimates.");
    const estimates = sanitizeList(data, warnings);
    if (estimates.length === 0) throw new Error("None of the estimates in the file are valid.");
    return { estimates, source: "estimate-list", warnings };
  }
  if (!isRecord(data)) throw new Error("Unrecognized file: expected an estimate or a backup exported by this calculator.");

  if (data.kind === ESTIMATE_FILE_KIND) {
    checkVersion(data.v, "estimate file");
    if (!looksLikeEstimate(data.estimate)) throw new Error("The estimate file does not contain a valid estimate.");
    const estimate = sanitizeEstimate(data.estimate, { freshIds: true, onWarning: (m) => warnings.push(`${m}.`) });
    if (!estimate.pricesDate && typeof data.pricesDate === "string" && data.pricesDate) estimate.pricesDate = data.pricesDate;
    return { estimates: [estimate], source: "estimate-file", warnings };
  }

  if (data.kind === BACKUP_FILE_KIND || (data.kind === undefined && isRecord(data.state) && Array.isArray(data.state.estimates))) {
    const isBackup = data.kind === BACKUP_FILE_KIND;
    if (isBackup) checkVersion(data.v, "backup file");
    const body = isBackup ? data : (data.state as Record<string, unknown>);
    if (!Array.isArray(body.estimates)) throw new Error("The backup file does not contain a list of estimates.");
    const estimates = sanitizeList(body.estimates, warnings);
    if (body.estimates.length > 0 && estimates.length === 0) throw new Error("None of the estimates in the backup are valid.");
    const settings = body.settings === undefined ? undefined : sanitizeSettings(body.settings, (m) => warnings.push(`${m}.`));
    return { estimates, settings, source: isBackup ? "backup-file" : "local-storage", warnings };
  }

  if (typeof data.kind === "string") throw new Error(`Unsupported file type "${data.kind}".`);

  if (looksLikeEstimate(data)) {
    const estimate = sanitizeEstimate(data, { freshIds: true, onWarning: (m) => warnings.push(`${m}.`) });
    return { estimates: [estimate], source: "estimate", warnings };
  }
  throw new Error("Unrecognized file: expected an estimate or a backup exported by this calculator.");
}
