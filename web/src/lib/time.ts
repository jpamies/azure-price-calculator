// Date/time display helpers (English). Pure TypeScript so it runs under `node --test`.

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30.4375 * DAY;
const YEAR = 365.25 * DAY;

let rtf: Intl.RelativeTimeFormat | undefined;

/** "just now", "5 minutes ago", "yesterday", "3 weeks ago"…; "—" for an invalid date. */
export function formatRelativeTime(iso: string | undefined, now: number = Date.now()): string {
  const t = iso ? Date.parse(iso) : Number.NaN;
  if (!Number.isFinite(t)) return "—";
  const diff = (t - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return "just now";
  rtf ??= new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (abs < HOUR) return rtf.format(Math.round(diff / MINUTE), "minute");
  if (abs < DAY) return rtf.format(Math.round(diff / HOUR), "hour");
  if (abs < WEEK) return rtf.format(Math.round(diff / DAY), "day");
  if (abs < MONTH) return rtf.format(Math.round(diff / WEEK), "week");
  if (abs < YEAR) return rtf.format(Math.round(diff / MONTH), "month");
  return rtf.format(Math.round(diff / YEAR), "year");
}

/** "Nov 24, 2026, 9:51 PM" in the user's time zone; "—" for an invalid date. */
export function formatDateTime(iso: string | undefined): string {
  const t = iso ? Date.parse(iso) : Number.NaN;
  if (!Number.isFinite(t)) return "—";
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(t);
}

/** "2026-11-24 21:29 UTC" for an ISO timestamp; the input itself when it is not a date. */
export function formatUtc(iso: string | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return `${new Date(t).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** Today's date as YYYY-MM-DD (local time), for file names. */
export function todayStamp(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
