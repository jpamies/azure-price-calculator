import { useId, useMemo } from "react";
import type { ReactNode } from "react";
import { CalendarClock, CircleX, TriangleAlert } from "lucide-react";
import { AssumptionsSection } from "@/components/estimate/AssumptionsSection";
import { Breakdown } from "@/components/estimate/Breakdown";
import { InfoTip } from "@/components/InfoTip";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { Catalog } from "@/data/catalog";
import type { LoadStatus } from "@/data/hooks";
import type { Estimate } from "@/domain/model";
import { FX_DISCLAIMER } from "@/domain/money";
import type { BreakdownEntry, EstimateTotals, ItemRef } from "@/domain/totals";
import { estimateAssumptions } from "@/lib/assumptions";
import type { Results } from "@/lib/assumptions";
import type { MoneyFormatter } from "@/lib/format";
import { cn } from "@/lib/utils";

export type Period = "monthly" | "annual";

export interface SummaryPanelProps {
  estimate: Estimate;
  totals?: EstimateTotals;
  results: Results;
  /** itemId → price download / pricing error. */
  errors: Record<string, string>;
  loading: boolean;
  money: MoneyFormatter;
  currency: string;
  catalog?: Catalog;
  catalogStatus: LoadStatus;
  period: Period;
  onPeriodChange: (period: Period) => void;
  onJumpToItem: (itemId: string) => void;
  /** Announce total changes (aria-live). Only one summary on screen should do it. */
  live?: boolean;
  className?: string;
}

function Row({ label, value, hint, strong }: { label: ReactNode; value: string; hint?: ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1 text-sm">
      <dt className="flex items-center gap-1 text-muted-foreground">
        {label}
        {hint}
      </dt>
      <dd className={cn("tabular-nums", strong ? "font-semibold" : "font-medium")}>{value}</dd>
    </div>
  );
}

function ItemLinks({ items, onJump }: { items: ItemRef[]; onJump: (id: string) => void }) {
  return (
    <span>
      {items.map((ref, i) => (
        <span key={ref.id}>
          {i > 0 && ", "}
          <button type="button" className="font-medium underline underline-offset-2 hover:no-underline" onClick={() => onJump(ref.id)}>
            {ref.title}
          </button>
        </span>
      ))}
    </span>
  );
}

function Note({ tone, icon, children }: { tone: "info" | "warning" | "error"; icon: ReactNode; children: ReactNode }) {
  return (
    <div
      className={cn(
        "flex gap-2 rounded-md px-2.5 py-2 text-xs leading-relaxed [&>svg]:mt-px [&>svg]:size-3.5 [&>svg]:shrink-0",
        tone === "error" && "bg-destructive/5 text-destructive",
        tone === "warning" && "bg-warning-bg text-warning",
        tone === "info" && "bg-muted text-muted-foreground",
      )}
    >
      {icon}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Estimate totals: monthly/annual toggle, upfront and effective cost, breakdowns, notes, assumptions. */
export function SummaryPanel({
  estimate,
  totals,
  results,
  errors,
  loading,
  money,
  currency,
  catalog,
  catalogStatus,
  period,
  onPeriodChange,
  onJumpToItem,
  live = false,
  className,
}: SummaryPanelProps) {
  const assumptions = useMemo(
    () => estimateAssumptions({ estimate, results, catalog, currency }),
    // Only items/currency/results/catalog matter (not name edits of the estimate itself).
    [estimate.items, results, catalog, currency],
  );

  const monthly = totals?.monthlyUsd ?? 0;
  const upfront = totals?.upfrontUsd ?? 0;
  const amortized = totals?.amortizedMonthlyUsd ?? 0;
  const annual = totals?.annualUsd ?? 0;
  const hasUpfront = upfront > 0;
  const errorIds = new Set(Object.keys(errors));
  const pending = (totals?.pendingItems ?? []).filter((r) => !errorIds.has(r.id));
  const failed = (totals?.pendingItems ?? []).filter((r) => errorIds.has(r.id));
  const breakdownLabelId = useId();
  const noData = catalogStatus === "error";
  const calculating = !noData && (loading || pending.length > 0);
  const itemCount = estimate.items.length;
  const pricedCount = estimate.items.filter((i) => results[i.id]?.status === "ok").length;
  // Never show a misleading $0.00: skeleton while nothing is priced yet, "—" without price data.
  const headlineState = noData && pricedCount === 0 ? "none" : calculating && pricedCount === 0 && itemCount > 0 ? "loading" : "value";
  const amount = (usd: number) => (headlineState === "none" ? "—" : money.format(usd));

  const valueOf =
    period === "monthly" ? (e: BreakdownEntry) => e.amortizedMonthlyUsd : (e: BreakdownEntry) => e.monthlyUsd * 12 + e.upfrontUsd;
  const caption =
    period === "monthly"
      ? hasUpfront
        ? "Effective monthly cost: upfront payments are spread over their term."
        : null
      : "Monthly cost × 12 plus upfront payments.";

  return (
    <section aria-label="Estimate summary" className={cn("rounded-xl border bg-card shadow-sm", className)}>
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <h2 className="font-heading text-base font-semibold">Summary</h2>
        <ToggleGroup
          type="single"
          size="sm"
          variant="outline"
          value={period}
          onValueChange={(v) => {
            if (v === "monthly" || v === "annual") onPeriodChange(v);
          }}
          aria-label="Show totals per"
        >
          <ToggleGroupItem value="monthly" className="px-2.5 text-xs">
            Monthly
          </ToggleGroupItem>
          <ToggleGroupItem value="annual" className="px-2.5 text-xs">
            Annual
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 p-4">
        <div>
          <div aria-live={live ? "polite" : undefined} aria-atomic="true">
            <p className="flex items-center gap-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {period === "monthly" ? "Estimated monthly cost" : "Estimated annual cost"}
              {calculating && itemCount > 0 && <Spinner className="size-3" aria-label="Calculating" />}
            </p>
            {headlineState === "loading" ? (
              <Skeleton className="mt-1 h-8 w-40" aria-label="Calculating" />
            ) : (
              <p
                className={cn(
                  "mt-1 font-heading text-[2rem] leading-none font-semibold tracking-tight tabular-nums transition-opacity",
                  (calculating || headlineState === "none") && "opacity-60",
                )}
              >
                {amount(period === "monthly" ? monthly : annual)}
              </p>
            )}
            {hasUpfront && (
              <p className="mt-1.5 text-sm text-muted-foreground tabular-nums">
                {period === "monthly" ? "+ " : "incl. "}
                {money.format(upfront)} upfront
              </p>
            )}
          </div>
          <dl className="mt-3 border-t pt-2">
            {period === "monthly" ? (
              <>
                <Row label="Upfront (one-time)" value={amount(upfront)} />
                {hasUpfront && (
                  <Row
                    label="Effective monthly"
                    value={money.format(amortized)}
                    hint={
                      <InfoTip label="About the effective monthly cost">
                        Monthly cost plus upfront payments spread evenly over their term (a 3-year reservation paid upfront counts ÷ 36 per month).
                      </InfoTip>
                    }
                  />
                )}
                <Row label="Annual (12 months + upfront)" value={amount(annual)} strong />
              </>
            ) : (
              <>
                <Row label="Monthly × 12" value={amount(monthly * 12)} />
                <Row label="Upfront (one-time)" value={amount(upfront)} />
                <Row label="Monthly" value={amount(monthly)} strong />
              </>
            )}
          </dl>
        </div>

        {(noData || failed.length > 0 || (totals && (totals.unavailableItems.length > 0 || totals.incompleteItems.length > 0)) || (calculating && pending.length > 0)) && (
          <div className="grid gap-2">
            {noData && itemCount > 0 && (
              <Note tone="error" icon={<CircleX />}>
                Price data couldn't be loaded, so these services can't be priced right now. Retry from the banner at the top of the page.
              </Note>
            )}
            {calculating && pending.length > 0 && (
              <Note tone="info" icon={<Spinner />}>
                Loading prices for {pending.length} {pending.length === 1 ? "service" : "services"}…
              </Note>
            )}
            {failed.length > 0 && (
              <Note tone="error" icon={<CircleX />}>
                Prices couldn't be loaded for <ItemLinks items={failed} onJump={onJumpToItem} />. Not included in the total.
              </Note>
            )}
            {totals && totals.unavailableItems.length > 0 && (
              <Note tone="error" icon={<CircleX />}>
                Not available in the selected region: <ItemLinks items={totals.unavailableItems} onJump={onJumpToItem} />. Not included in the total.
              </Note>
            )}
            {totals && totals.incompleteItems.length > 0 && (
              <Note tone="warning" icon={<TriangleAlert />}>
                Needs configuration: <ItemLinks items={totals.incompleteItems} onJump={onJumpToItem} />.
              </Note>
            )}
          </div>
        )}

        {itemCount > 0 && totals && (
          <Tabs defaultValue="service" className="gap-3">
            <div className="flex items-center gap-2">
              <span id={breakdownLabelId} className="shrink-0 text-xs text-muted-foreground">
                By
              </span>
              <TabsList className="w-full min-w-0" aria-labelledby={breakdownLabelId}>
                <TabsTrigger value="service" className="min-w-0 text-xs" aria-label="By service">
                  Service
                </TabsTrigger>
                <TabsTrigger value="category" className="min-w-0 text-xs" aria-label="By category">
                  Category
                </TabsTrigger>
                <TabsTrigger value="commitment" className="min-w-0 text-xs" aria-label="By commitment">
                  Commitment
                </TabsTrigger>
              </TabsList>
            </div>
            {caption && <p className="-mt-1 text-[11px] text-muted-foreground">{caption}</p>}
            {headlineState === "loading" ? (
              <div className="grid gap-3" aria-label="Calculating">
                <Skeleton className="h-2 w-full" />
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-4 w-3/5" />
              </div>
            ) : (
              <>
                <TabsContent value="service">
                  <Breakdown entries={totals.byService} valueOf={valueOf} money={money} label="Cost by service" />
                </TabsContent>
                <TabsContent value="category">
                  <Breakdown entries={totals.byCategory} valueOf={valueOf} money={money} label="Cost by category" />
                </TabsContent>
                <TabsContent value="commitment">
                  <Breakdown entries={totals.byCommitment} valueOf={valueOf} money={money} label="Cost by commitment" />
                </TabsContent>
              </>
            )}
          </Tabs>
        )}

        <div className="border-t pt-4">
          <AssumptionsSection assumptions={assumptions} />
        </div>

        <div className="grid gap-1.5 border-t pt-3 text-[11px] leading-relaxed text-muted-foreground">
          <p className="flex items-center gap-1.5">
            <CalendarClock className="size-3.5 shrink-0" aria-hidden="true" />
            <span>
              Prices as of <span className="font-medium text-foreground tabular-nums">{catalog?.manifest.pricesDate ?? "…"}</span> · Azure Retail Prices API, list
              prices in USD
            </span>
          </p>
          {currency !== "USD" && <p>{FX_DISCLAIMER}</p>}
        </div>
      </div>
    </section>
  );
}
