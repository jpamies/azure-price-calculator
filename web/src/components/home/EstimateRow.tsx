import { memo } from "react";
import { Copy, MoreHorizontal, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { ItemIcon } from "@/components/ItemIcon";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Catalog } from "@/data/catalog";
import type { LoadStatus } from "@/data/hooks";
import type { Estimate, Item } from "@/domain/model";
import { resolveCurrency } from "@/domain/money";
import { moneyFormatter } from "@/lib/format";
import { serviceTitleOf } from "@/lib/serviceTitle";
import { formatDateTime, formatRelativeTime } from "@/lib/time";
import { prefetchEditorProps } from "@/pages/loaders";
import { cn } from "@/lib/utils";

const MAX_ICONS = 3;

/** First items of distinct services (for the icon stack). */
function distinctServices(items: Item[]): Item[] {
  const seen = new Set<string>();
  const out: Item[] = [];
  for (const item of items) {
    const key = item.moduleId === "generic" ? `g:${item.config.serviceName}` : item.moduleId;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function CachedTotal({ estimate, catalog, catalogStatus }: { estimate: Estimate; catalog?: Catalog; catalogStatus: LoadStatus }) {
  const cached = estimate.cachedTotals;
  if (!cached) {
    return (
      <span className="text-muted-foreground" title={estimate.items.length > 0 ? "Open the estimate to calculate its total" : undefined}>
        —
      </span>
    );
  }
  if (estimate.currency !== "USD" && catalogStatus === "loading") return <Skeleton className="ml-auto h-4 w-20" />;
  const money = moneyFormatter(resolveCurrency(estimate.currency, catalog?.fx), catalog?.fx);
  const stale = cached.computedAt < estimate.updatedAt || (catalog !== undefined && cached.pricesDate !== catalog.manifest.pricesDate);
  const amount = (
    <span className={cn("font-semibold tabular-nums", stale && "text-muted-foreground")}>
      {money.format(cached.monthlyUsd)}
      {stale && <span aria-hidden="true">*</span>}
    </span>
  );
  return (
    <span className="flex flex-col items-end leading-tight">
      {stale ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0} className="rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-ring">
              {amount}
              <span className="sr-only"> (last computed total; open the estimate to refresh)</span>
            </span>
          </TooltipTrigger>
          <TooltipContent>Last computed total ({cached.pricesDate} prices). Open the estimate to refresh it.</TooltipContent>
        </Tooltip>
      ) : (
        amount
      )}
      {cached.upfrontUsd > 0 && <span className="text-xs text-muted-foreground tabular-nums">+ {money.format(cached.upfrontUsd)} upfront</span>}
    </span>
  );
}

export interface EstimateRowProps {
  estimate: Estimate;
  catalog?: Catalog;
  catalogStatus: LoadStatus;
  now: number;
  onDuplicate: (estimate: Estimate) => void;
  onDelete: (estimate: Estimate) => void;
}

/** One estimate in the list: the whole row opens it (stretched link); actions sit above the link. */
export const EstimateRow = memo(function EstimateRow({ estimate, catalog, catalogStatus, now, onDuplicate, onDelete }: EstimateRowProps) {
  const services = distinctServices(estimate.items);
  const count = estimate.items.length;
  const edited = formatRelativeTime(estimate.updatedAt, now);
  return (
    <li className="group relative grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 sm:gap-x-4 gap-y-1 px-4 py-3.5 transition-colors hover:bg-accent/50 sm:px-5 md:grid-cols-[minmax(0,1fr)_4.5rem_10rem_9rem_8.75rem]">
      <div className="flex min-w-0 items-center gap-3">
        <span className="hidden shrink-0 items-center -space-x-2 min-[420px]:flex" aria-hidden="true">
          {services.length === 0 ? (
            <span className="size-8 rounded-[22%] border border-dashed border-control-border/60 bg-muted" />
          ) : (
            services.slice(0, MAX_ICONS).map((item) => (
              <span key={item.id} className="rounded-[24%] bg-card p-px ring-2 ring-card">
                <ItemIcon item={item} catalog={catalog} size={28} />
              </span>
            ))
          )}
        </span>
        <div className="min-w-0">
          <Link
            to={`/estimate/${estimate.id}`}
            {...prefetchEditorProps}
            className="block truncate font-medium text-foreground outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:rounded-md focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-ring"
          >
            {estimate.name || "Untitled estimate"}
          </Link>
          <p className="truncate text-xs text-muted-foreground">
            {services.length > 0 ? services.map(serviceTitleOf).slice(0, 3).join(", ") + (services.length > 3 ? "…" : "") : "No services yet"}
            <span className="md:hidden">
              {" · "}
              {count} {count === 1 ? "item" : "items"} · {edited}
            </span>
          </p>
        </div>
      </div>
      <span className="hidden text-sm text-muted-foreground tabular-nums md:block">{count}</span>
      <span className="text-right text-sm md:pr-2">
        <CachedTotal estimate={estimate} catalog={catalog} catalogStatus={catalogStatus} />
      </span>
      <span className="hidden text-sm text-muted-foreground md:block" title={formatDateTime(estimate.updatedAt)}>
        {edited}
      </span>
      <div className="relative z-10 flex items-center justify-end gap-1">
        <Button variant="outline" size="sm" asChild className="hidden md:inline-flex">
          <Link to={`/estimate/${estimate.id}`} tabIndex={-1} aria-hidden="true">
            Open
          </Link>
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="hidden md:inline-flex" aria-label={`Duplicate “${estimate.name}”`} onClick={() => onDuplicate(estimate)}>
              <Copy />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Duplicate</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="hidden text-muted-foreground hover:bg-destructive/10 hover:text-destructive md:inline-flex"
              aria-label={`Delete “${estimate.name}”`}
              onClick={() => onDelete(estimate)}
            >
              <Trash2 />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Delete</TooltipContent>
        </Tooltip>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="-mr-1 md:hidden" aria-label={`Actions for “${estimate.name}”`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link to={`/estimate/${estimate.id}`}>Open</Link>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onDuplicate(estimate)}>
              <Copy />
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => onDelete(estimate)}>
              <Trash2 />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
});
