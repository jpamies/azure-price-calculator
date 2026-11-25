import { CalendarClock, CircleAlert } from "lucide-react";
import { Link } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { isStale } from "@/data/catalog";
import { useCatalog } from "@/data/hooks";
import { formatUtc } from "@/lib/time";
import { cn } from "@/lib/utils";

const chip =
  "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2 text-[11px] font-medium sm:px-2.5 sm:text-xs whitespace-nowrap tabular-nums transition-colors outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** "Prices as of <date>" chip (links to About); the tooltip describes the snapshot. */
export function PricesChip({ className }: { className?: string }) {
  const { status, catalog } = useCatalog();

  if (status === "loading") return <Skeleton className={cn("h-7 w-24 rounded-full sm:w-40", className)} aria-label="Loading price data" />;

  if (status === "error" || !catalog) {
    return (
      <span className={cn(chip, "border-destructive/40 bg-destructive/5 text-destructive", className)}>
        <CircleAlert className="size-3.5" aria-hidden="true" />
        <span className="hidden sm:inline">Prices unavailable</span>
        <span className="sm:hidden">No prices</span>
      </span>
    );
  }

  const { manifest } = catalog;
  const stale = isStale(manifest.pricesDate);
  const sample = manifest.source.type === "fixture";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          to="/about"
          aria-label={`Prices as of ${manifest.pricesDate}${sample ? " (sample data)" : ""}. About the price data`}
          className={cn(
            chip,
            stale || sample
              ? "border-warning/40 bg-warning-bg text-warning hover:border-warning/70"
              : "border-primary/25 bg-accent text-accent-foreground hover:border-primary/50",
            className,
          )}
        >
          <CalendarClock className="hidden size-3.5 min-[400px]:block" aria-hidden="true" />
          <span className="hidden lg:inline">Prices as of</span>
          <span>{manifest.pricesDate}</span>
          {sample && <span className="hidden font-semibold lg:inline">· Sample</span>}
        </Link>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="end" className="max-w-xs text-left">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 py-0.5">
          <dt className="opacity-70">Source</dt>
          <dd>{sample ? "Synthetic sample data (test fixture)" : manifest.source.repo ?? "Azure Retail Prices API export"}</dd>
          {manifest.source.tag && (
            <>
              <dt className="opacity-70">Release</dt>
              <dd>{manifest.source.tag}</dd>
            </>
          )}
          <dt className="opacity-70">Generated</dt>
          <dd>{formatUtc(manifest.generatedAt)}</dd>
          <dt className="opacity-70">Savings plans</dt>
          <dd>{manifest.hasSavingsPlan ? "Included" : "Not in this snapshot"}</dd>
        </dl>
        <p className="mt-1.5 opacity-80">List prices in USD. Click for details.</p>
      </TooltipContent>
    </Tooltip>
  );
}
