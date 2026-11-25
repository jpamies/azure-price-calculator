import type { BreakdownEntry } from "@/domain/totals";
import type { MoneyFormatter } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Chart colours (literal class names so Tailwind generates them). */
const COLORS = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-5", "bg-chart-6"] as const;

function percentLabel(pct: number): string {
  if (pct <= 0) return "0%";
  if (pct < 1) return "<1%";
  return `${Math.round(pct)}%`;
}

export interface BreakdownProps {
  entries: BreakdownEntry[];
  /** Amount shown for an entry (USD), e.g. amortized monthly or annual. */
  valueOf: (entry: BreakdownEntry) => number;
  money: MoneyFormatter;
  label: string;
}

/** Proportional breakdown: a stacked bar plus one row (amount, share, bar) per entry. */
export function Breakdown({ entries, valueOf, money, label }: BreakdownProps) {
  const rows = entries.map((e) => ({ entry: e, value: Math.max(0, valueOf(e)) }));
  const total = rows.reduce((sum, r) => sum + r.value, 0);
  if (rows.length === 0 || total <= 0) {
    return <p className="py-3 text-sm text-muted-foreground">Nothing priced yet.</p>;
  }
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex h-2 w-full gap-px overflow-hidden rounded-full bg-muted" aria-hidden="true">
        {rows.map((r, i) =>
          r.value > 0 ? (
            <div key={r.entry.key} className={cn("h-full first:rounded-l-full last:rounded-r-full", COLORS[i % COLORS.length])} style={{ width: `${(r.value / total) * 100}%` }} />
          ) : null,
        )}
      </div>
      <ul className="flex min-w-0 flex-col gap-2.5" aria-label={label}>
        {rows.map((r, i) => {
          const pct = (r.value / total) * 100;
          return (
            <li key={r.entry.key} className="flex min-w-0 flex-col gap-1">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <span className={cn("size-2.5 shrink-0 rounded-[3px]", COLORS[i % COLORS.length])} aria-hidden="true" />
                  <span className="truncate" title={r.entry.label}>
                    {r.entry.label}
                  </span>
                </span>
                <span className="flex shrink-0 items-baseline gap-2 tabular-nums">
                  <span className="font-medium">{money.format(r.value)}</span>
                  <span className="w-9 text-right text-xs text-muted-foreground">{percentLabel(pct)}</span>
                </span>
              </div>
              <div className="h-1 w-full rounded-full bg-muted" aria-hidden="true">
                <div className={cn("h-full rounded-full", COLORS[i % COLORS.length])} style={{ width: `${pct}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
