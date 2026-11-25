// Persisted-state migrations for the zustand store ("azcalc.v1"). Pure (no DOM, no React) so it
// runs under `node --test`. Imports use relative paths with the `.ts` extension.
import { isRecord, newId, sanitizeEstimate, sanitizeSettings } from "../domain/factory.ts";
import { SCHEMA_VERSION, persistedStateSchema } from "../domain/model.ts";
import type { Estimate, PersistedState } from "../domain/model.ts";

type RawState = Record<string, unknown>;

/**
 * Step migrations: MIGRATIONS[n] turns version n into n + 1. Applied in order before validation.
 * v0 (pre-release) stored the same shape with fewer fields; schema defaults fill the gaps.
 */
const MIGRATIONS: Record<number, (state: RawState) => RawState> = {
  0: (state) => state,
};

export interface MigrateOptions {
  /** Receives every repair/drop message (default: console.warn). */
  warn?: (message: string) => void;
}

/**
 * Migrates and validates persisted state of any version: applies the step migrations, then
 * validates everything with persistedStateSchema defaults. Invalid items/estimates are dropped and
 * invalid fields repaired (each reported through `warn`) instead of failing the whole store.
 */
export function migratePersistedState(persisted: unknown, fromVersion: number, options: MigrateOptions = {}): PersistedState {
  const warn = options.warn ?? ((m: string) => console.warn(`[azcalc] ${m}`));
  if (persisted !== undefined && persisted !== null && !isRecord(persisted)) {
    warn("Stored data is not an object and was ignored.");
  }
  let state: RawState = isRecord(persisted) ? { ...persisted } : {};
  const from = Number.isInteger(fromVersion) && fromVersion >= 0 ? fromVersion : 0;
  if (from > SCHEMA_VERSION) {
    warn(`Stored data has version ${from}, newer than this app (${SCHEMA_VERSION}); unknown fields are ignored.`);
  }
  for (let v = from; v < SCHEMA_VERSION; v++) state = MIGRATIONS[v]?.(state) ?? state;

  const estimates: Estimate[] = [];
  const seen = new Set<string>();
  if (state.estimates !== undefined && !Array.isArray(state.estimates)) warn("Stored estimates are not a list and were ignored.");
  const rawEstimates: unknown[] = Array.isArray(state.estimates) ? state.estimates : [];
  rawEstimates.forEach((raw, index) => {
    const label = isRecord(raw) && typeof raw.name === "string" && raw.name.trim() ? `Estimate "${raw.name.trim()}"` : `Estimate ${index + 1}`;
    if (!isRecord(raw)) {
      warn(`${label} was dropped (not an object).`);
      return;
    }
    try {
      const estimate = sanitizeEstimate(raw, { freshIds: false, onWarning: (m) => warn(`${label}: ${m}.`) });
      if (seen.has(estimate.id)) estimate.id = newId();
      seen.add(estimate.id);
      estimates.push(estimate);
    } catch (e) {
      warn(`${label} was dropped: ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  const settings = sanitizeSettings(state.settings, (m) => warn(`${m}.`));
  return persistedStateSchema.parse({ estimates, settings });
}
