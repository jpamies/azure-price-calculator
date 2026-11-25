// Share links: CONFIGURATION ONLY (never prices). Format: "1." + base64url(deflate-raw(JSON)).
// Pure TypeScript (no DOM; uses the native CompressionStream) so it runs under `node --test`.
import { DEFAULT_ITEM_NAMES, configDefaults, isRecord, sanitizeEstimate } from "./factory.ts";
import { moduleIdSchema } from "./model.ts";
import type { Estimate, ModuleId } from "./model.ts";
import { deflateRaw, inflateRaw } from "./export/zip.ts";

/** Query-string parameter carrying the encoded estimate (?s=…). */
export const SHARE_PARAM = "s";
export const SHARE_VERSION = 1;
/** Warn the user above this URL length (characters). */
export const SHARE_URL_WARN = 6000;
/** Above this URL length offer "Export JSON" instead of a link. */
export const SHARE_URL_MAX = 8000;

const PREFIX = `${SHARE_VERSION}.`;
const MAX_JSON_BYTES = 2_000_000;
const MAX_ITEMS = 2000;
const DAMAGED = "This share link is damaged or incomplete. Ask the sender to copy the whole link again.";

export interface SharePayloadItem {
  moduleId: ModuleId;
  /** Omitted when equal to the module default name. */
  name?: string;
  region: string;
  /** Only the keys that differ from the schema defaults. */
  config: Record<string, unknown>;
}

export interface SharePayload {
  v: 1;
  pricesDate?: string;
  estimate: { name: string; currency: string; notes?: string; items: SharePayloadItem[] };
}

export interface DecodedShare {
  /** Fresh ids, validated with estimateSchema defaults; `pricesDate` = snapshot of the sender. */
  estimate: Estimate;
  pricesDate?: string;
  /** Items dropped because they were invalid (unknown module…). */
  skippedItems: number;
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const LOOKUP: Record<string, number> = Object.fromEntries([...ALPHABET].map((c, i) => [c, i]));

/** RFC 4648 §5 base64url without padding. */
export function base64UrlEncode(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63] + ALPHABET[(n >> 6) & 63] + ALPHABET[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63];
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63] + ALPHABET[(n >> 6) & 63];
  }
  return out;
}

/** Decodes base64url (also accepts standard base64 and padding). Throws on invalid input. */
export function base64UrlDecode(text: string): Uint8Array {
  const clean = text.replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  if (!/^[A-Za-z0-9_-]*$/.test(clean) || clean.length % 4 === 1) throw new Error("Invalid base64url data.");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let o = 0;
  for (const ch of clean) {
    buffer = ((buffer << 6) | LOOKUP[ch]) & 0xffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buffer >> bits) & 0xff;
    }
  }
  return out.subarray(0, o);
}

function isDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** The JSON object carried by a share link (pure; defaults omitted from every config). */
export function buildSharePayload(estimate: Estimate, pricesDate?: string): SharePayload {
  const items = estimate.items.map((item): SharePayloadItem => {
    const defaults = configDefaults(item.moduleId) as Record<string, unknown>;
    const config: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(item.config as Record<string, unknown>)) {
      const def = defaults[key];
      const same = Object.is(value, def) || (typeof value === "object" && JSON.stringify(value) === JSON.stringify(def));
      if (!same && value !== undefined) config[key] = value;
    }
    const out: SharePayloadItem = { moduleId: item.moduleId, region: item.region, config };
    if (item.name !== DEFAULT_ITEM_NAMES[item.moduleId]) out.name = item.name;
    return out;
  });
  const payload: SharePayload = { v: 1, estimate: { name: estimate.name, currency: estimate.currency, items } };
  if (pricesDate) payload.pricesDate = pricesDate;
  if (estimate.notes?.trim()) payload.estimate.notes = estimate.notes;
  return payload;
}

/** Encodes the configuration of `estimate` (never prices): "1." + base64url(deflate-raw(JSON)). */
export async function encodeShare(estimate: Estimate, pricesDate?: string): Promise<string> {
  const json = JSON.stringify(buildSharePayload(estimate, pricesDate));
  return PREFIX + base64UrlEncode(await deflateRaw(new TextEncoder().encode(json)));
}

/**
 * Decodes a share parameter into a fresh estimate (new ids, schema defaults applied).
 * Throws an Error with a user-facing message on garbage or unsupported versions.
 */
export async function decodeShare(param: string): Promise<DecodedShare> {
  let text = (param ?? "").trim();
  if (!text) throw new Error("The share link is empty.");
  if (/%[0-9A-Fa-f]{2}/.test(text)) {
    try {
      text = decodeURIComponent(text);
    } catch {
      throw new Error(DAMAGED);
    }
  }
  const dot = text.indexOf(".");
  const version = dot > 0 ? text.slice(0, dot) : "";
  if (version !== String(SHARE_VERSION)) {
    if (/^\d+$/.test(version) && Number(version) > SHARE_VERSION) {
      throw new Error("This share link was created by a newer version of the calculator. Reload the page and try again.");
    }
    throw new Error(DAMAGED);
  }

  let payload: unknown;
  try {
    const bytes = base64UrlDecode(text.slice(dot + 1));
    const json = new TextDecoder("utf-8", { fatal: true }).decode(await inflateRaw(bytes, MAX_JSON_BYTES));
    payload = JSON.parse(json);
  } catch {
    throw new Error(DAMAGED);
  }

  if (!isRecord(payload) || !isRecord(payload.estimate) || !Array.isArray(payload.estimate.items)) throw new Error(DAMAGED);
  if (payload.v !== SHARE_VERSION) {
    if (typeof payload.v === "number" && payload.v > SHARE_VERSION) {
      throw new Error("This share link was created by a newer version of the calculator. Reload the page and try again.");
    }
    throw new Error(DAMAGED);
  }
  const src = payload.estimate;
  const rawItems = src.items as unknown[];
  if (rawItems.length > MAX_ITEMS) throw new Error(`This share link has too many items (${rawItems.length}).`);

  const items = rawItems.map((raw) => {
    if (!isRecord(raw)) return raw;
    const mod = moduleIdSchema.safeParse(raw.moduleId);
    const name = typeof raw.name === "string" ? raw.name : mod.success ? DEFAULT_ITEM_NAMES[mod.data] : undefined;
    return { moduleId: raw.moduleId, name, region: raw.region, config: isRecord(raw.config) ? raw.config : {} };
  });
  const pricesDate = isDate(payload.pricesDate) ? payload.pricesDate : undefined;
  const estimate = sanitizeEstimate(
    { name: src.name, currency: src.currency, notes: src.notes, pricesDate, items },
    { freshIds: true },
  );
  return { estimate, pricesDate, skippedItems: rawItems.length - estimate.items.length };
}

/** Share URL: same origin/path/query with ?s=<encoded> (any previous s and the hash removed). */
export function buildShareUrl(locationHref: string, encoded: string): string {
  const url = new URL(locationHref);
  url.searchParams.delete(SHARE_PARAM);
  url.searchParams.append(SHARE_PARAM, encoded);
  url.hash = "";
  return url.toString();
}

/** Query embedded in the hash: "#s=…" (bare) or "#/route?s=…" (prefix = "/route"). */
function hashQuery(hash: string): { prefix: string | null; params: URLSearchParams } | null {
  const h = hash.replace(/^#/, "");
  if (h.startsWith(`${SHARE_PARAM}=`)) return { prefix: null, params: new URLSearchParams(h) };
  const q = h.indexOf("?");
  return q >= 0 ? { prefix: h.slice(0, q), params: new URLSearchParams(h.slice(q + 1)) } : null;
}

/** The encoded share value from ?s=… (also accepts #s=… and #/route?s=…), or null. */
export function readShareParam(locationHref: string): string | null {
  let url: URL;
  try {
    url = new URL(locationHref);
  } catch {
    return null;
  }
  const fromQuery = url.searchParams.get(SHARE_PARAM);
  if (fromQuery) return fromQuery;
  return hashQuery(url.hash)?.params.get(SHARE_PARAM) || null;
}

/** `locationHref` without the share parameter (for history.replaceState after importing). */
export function stripShareParam(locationHref: string): string {
  let url: URL;
  try {
    url = new URL(locationHref);
  } catch {
    return locationHref;
  }
  if (url.searchParams.has(SHARE_PARAM)) url.searchParams.delete(SHARE_PARAM);
  const hq = hashQuery(url.hash);
  if (hq && hq.params.has(SHARE_PARAM)) {
    hq.params.delete(SHARE_PARAM);
    const rest = hq.params.toString();
    url.hash = hq.prefix === null ? rest : `${hq.prefix}${rest ? `?${rest}` : ""}`;
  }
  return url.toString();
}

/** "ok" ≤ SHARE_URL_WARN < "warn" ≤ SHARE_URL_MAX < "too-long". */
export function shareUrlLevel(url: string): "ok" | "warn" | "too-long" {
  if (url.length > SHARE_URL_MAX) return "too-long";
  return url.length > SHARE_URL_WARN ? "warn" : "ok";
}
