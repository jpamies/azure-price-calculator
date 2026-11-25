// Data-state UI for the forms: loading skeletons, error alert with retry, and the price display
// primitives (PriceText / PriceCell). Row lookups live in ./rows.ts.
import type { ReactNode } from "react";
import { CircleAlert, RotateCw } from "lucide-react";
import type { ShardsState } from "@/data/hooks";
import type { MoneyFormatter } from "@/lib/format";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** Placeholder for a data-driven selector while its prices load. */
export function SelectorSkeleton({ className, label = "Loading prices…" }: { className?: string; label?: string }) {
  return (
    <div role="status" aria-label={label} className={cn("w-full", className)}>
      <Skeleton className="h-8 w-full rounded-md bg-muted" />
    </div>
  );
}

/** Error alert with a Retry button when a price shard could not be downloaded. */
export function ShardsError({ shards, regionName, className }: { shards: ShardsState; regionName: string; className?: string }) {
  if (shards.status !== "error") return null;
  return (
    <Alert variant="destructive" className={cn("border-destructive/40 py-2.5", className)}>
      <CircleAlert aria-hidden="true" />
      <AlertTitle>Couldn&apos;t load prices{regionName ? ` for ${regionName}` : ""}</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="min-w-0 text-xs">{shards.error ?? "The price data could not be downloaded."}</span>
        <Button type="button" size="xs" variant="outline" onClick={shards.retry} className="text-foreground">
          <RotateCw aria-hidden="true" />
          Retry
        </Button>
      </AlertDescription>
    </Alert>
  );
}

export interface PriceTextProps {
  usd: number | null | undefined;
  money: MoneyFormatter;
  /** Unit price formatting (more decimals for tiny prices). */
  unit?: boolean;
  /** Muted suffix, e.g. "/hour". */
  per?: ReactNode;
  className?: string;
  /** Rendered when the price is missing. */
  missing?: ReactNode;
}

/** Inline price in the display currency ("$0.385/hour"); "—" when missing. */
export function PriceText({ usd, money, unit, per, className, missing = "—" }: PriceTextProps) {
  if (usd === null || usd === undefined || !Number.isFinite(usd)) {
    return <span className={cn("text-muted-foreground", className)}>{missing}</span>;
  }
  return (
    <span className={cn("tabular-nums", className)}>
      {unit ? money.unit(usd) : money.format(usd)}
      {per ? <span className="text-muted-foreground">{per}</span> : null}
    </span>
  );
}

/** Right-aligned price cell for picker rows/tables. */
export function PriceCell({ className, highlight, ...props }: PriceTextProps & { highlight?: boolean }) {
  return (
    <div className={cn("truncate text-right tabular-nums", highlight && "font-semibold text-primary", className)}>
      <PriceText {...props} />
    </div>
  );
}
