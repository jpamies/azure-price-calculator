import { memo, useCallback, useMemo } from "react";
import type { ComponentType } from "react";
import { ArrowDown, ArrowUp, ChevronDown, Copy, Ellipsis, FoldVertical, RotateCw, Trash2, UnfoldVertical } from "lucide-react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ItemLines } from "@/components/estimate/ItemLines";
import { ItemMessages, LoadErrorAlert } from "@/components/estimate/ItemMessages";
import { RegionSelect } from "@/components/estimate/RegionSelect";
import { InlineEdit } from "@/components/InlineEdit";
import { ItemIcon } from "@/components/ItemIcon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import type { Catalog } from "@/data/catalog";
import { regionName } from "@/data/catalog";
import { useShards } from "@/data/hooks";
import type { LoadStatus } from "@/data/hooks";
import { DEFAULT_ITEM_NAMES, itemDisplayName } from "@/domain/factory";
import type { Item, Settings } from "@/domain/model";
import { shardsForItem, summarizeItem } from "@/domain/pricing";
import type { ItemResult } from "@/domain/types";
import type { MoneyFormatter } from "@/lib/format";
import { allowedRegionKeys } from "@/lib/regions";
import { serviceTitleOf } from "@/lib/serviceTitle";
import { cn } from "@/lib/utils";
import { configComponents } from "@/modules/registry";
import type { ModuleConfigProps } from "@/modules/types";
import { useStore } from "@/store/useStore";

export interface ItemCardProps {
  estimateId: string;
  item: Item;
  index: number;
  count: number;
  result?: ItemResult;
  /** Price download / pricing failure for this item. */
  error?: string;
  catalog?: Catalog;
  catalogStatus: LoadStatus;
  money: MoneyFormatter;
  settings: Settings;
  highlight?: boolean;
  onRetry: () => void;
  onDuplicate: (item: Item) => void;
  onRemove: (item: Item, index: number) => void;
}

const NO_REFS: never[] = [];

function Subtotal({ result, error, loading, money }: { result?: ItemResult; error?: string; loading: boolean; money: MoneyFormatter }) {
  if (error) {
    return (
      <Badge variant="outline" className="border-destructive/40 text-destructive">
        Prices unavailable
      </Badge>
    );
  }
  if (loading || !result) return <Skeleton className="h-5 w-24" aria-label="Loading price" />;
  if (result.status === "unavailable") {
    return (
      <Badge variant="outline" className="border-destructive/40 bg-destructive/5 text-destructive">
        Not available
      </Badge>
    );
  }
  if (result.status === "incomplete") {
    return (
      <Badge variant="outline" className="border-warning/40 bg-warning-bg text-warning">
        Incomplete
      </Badge>
    );
  }
  return (
    <div className="flex flex-col items-end leading-tight">
      <span className="text-base font-semibold whitespace-nowrap tabular-nums">
        {money.format(result.monthlyUsd)}
        <span className="text-xs font-normal text-muted-foreground">/mo</span>
      </span>
      {result.upfrontUsd > 0 && (
        <Badge variant="secondary" className="mt-1 h-5 px-1.5 text-[11px] font-medium tabular-nums">
          + {money.format(result.upfrontUsd)} upfront
        </Badge>
      )}
    </div>
  );
}

function ConfigSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2" aria-label="Loading configuration">
      <Skeleton className="h-9" />
      <Skeleton className="h-9" />
      <Skeleton className="h-9 sm:col-span-2" />
    </div>
  );
}

function LinesSkeleton() {
  return (
    <div className="grid gap-2" aria-label="Loading prices">
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-8" />
      <Skeleton className="h-8" />
    </div>
  );
}

/** One service of the estimate: header (icon, name, summary, region, subtotal, menu) + module form + price lines. */
export const ItemCard = memo(function ItemCard({
  estimateId,
  item,
  index,
  count,
  result,
  error,
  catalog,
  catalogStatus,
  money,
  settings,
  highlight,
  onRetry,
  onDuplicate,
  onRemove,
}: ItemCardProps) {
  const open = !item.collapsed;
  const title = itemDisplayName(item);
  const serviceTitle = serviceTitleOf(item);
  const summary = summarizeItem(item);
  // Catalog failed: nothing can load (the page banner offers the retry).
  const noData = catalogStatus === "error" && !result;
  const loading = !result && !error && !noData;
  const headingId = `item-${item.id}-title`;

  const refs = catalog ? shardsForItem(item, catalog.services) : NO_REFS;
  const shards = useShards(refs);
  // A shard download failure is reported by the module form itself ("Couldn't load prices" + Retry,
  // shared/data.tsx ShardsError): never show a second alert in the card footer for it.
  const formShowsLoadError = catalog !== undefined && shards.status === "error";
  const showLoadError = error !== undefined && !formShowsLoadError;
  const allowed = useMemo(() => (catalog ? allowedRegionKeys(item, catalog.services) : null), [item, catalog]);

  const setOpen = useCallback((next: boolean) => useStore.getState().updateItem(estimateId, item.id, { collapsed: !next }), [estimateId, item.id]);
  const onConfigChange = useCallback(
    (patch: Partial<Item["config"]>) => useStore.getState().updateItem(estimateId, item.id, { config: patch }),
    [estimateId, item.id],
  );
  const move = (to: number) => useStore.getState().moveItem(estimateId, item.id, to);

  const Config = configComponents[item.moduleId] as ComponentType<ModuleConfigProps>;
  const name = regionName(catalog, item.region);

  return (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
      <article
        id={`item-${item.id}`}
        tabIndex={-1}
        aria-label={title === serviceTitle ? title : `${title} (${serviceTitle})`}
        className={cn(
          "scroll-mt-20 rounded-xl border bg-card shadow-sm transition-[box-shadow,border-color] duration-500 outline-none",
          highlight && "border-primary/60 ring-4 ring-primary/15",
        )}
      >
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2.5 p-3 sm:px-4">
          <div className="flex min-w-0 flex-1 basis-56 items-center gap-2 sm:gap-3">
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="icon-sm" className="-ml-1 shrink-0 text-muted-foreground" aria-label={open ? `Collapse ${title}` : `Expand ${title}`}>
                <ChevronDown className={cn("transition-transform duration-200", !open && "-rotate-90")} />
              </Button>
            </CollapsibleTrigger>
            <ItemIcon item={item} catalog={catalog} size={36} title={serviceTitle} />
            <div className="min-w-0 flex-1">
              <h3 id={headingId} className="flex min-w-0 text-[15px] leading-snug font-semibold">
                <InlineEdit
                  value={item.name}
                  label="Service name"
                  placeholder={DEFAULT_ITEM_NAMES[item.moduleId]}
                  onCommit={(next) => useStore.getState().updateItem(estimateId, item.id, { name: next })}
                />
              </h3>
              <p className="truncate text-xs text-muted-foreground sm:text-[13px]" title={`${serviceTitle} · ${summary}`}>
                {summary === serviceTitle ? summary : `${serviceTitle} · ${summary}`}
              </p>
            </div>
          </div>

          <div className="flex w-full items-center gap-2 sm:gap-3 md:ml-auto md:w-auto">
            <RegionSelect
              value={item.region}
              valueName={name}
              regions={catalog?.regions ?? []}
              allowed={allowed}
              disabled={!catalog}
              label={`Region for ${title}`}
              onChange={(region) => useStore.getState().updateItem(estimateId, item.id, { region })}
              className="flex-1 md:w-44 md:flex-none"
            />
            <div className="ml-auto flex min-w-[6.5rem] justify-end text-right">
              <Subtotal result={result} error={error ?? (noData ? "Price data unavailable" : undefined)} loading={loading} money={money} />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" className="-mr-1 shrink-0" aria-label={`Actions for ${title}`}>
                  <Ellipsis />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onSelect={() => setOpen(!open)}>
                  {open ? <FoldVertical /> : <UnfoldVertical />}
                  {open ? "Collapse" : "Expand"}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onDuplicate(item)}>
                  <Copy />
                  Duplicate
                </DropdownMenuItem>
                <DropdownMenuItem disabled={index === 0} onSelect={() => move(index - 1)}>
                  <ArrowUp />
                  Move up
                </DropdownMenuItem>
                <DropdownMenuItem disabled={index >= count - 1} onSelect={() => move(index + 1)}>
                  <ArrowDown />
                  Move down
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => onRemove(item, index)}>
                  <Trash2 />
                  Remove
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <CollapsibleContent className="data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0">
          <div className="border-t px-3 py-4 sm:px-5">
            {catalog ? (
              <ErrorBoundary
                resetKey={item.config}
                fallback={(e, reset) => (
                  <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                    <span>This configuration panel failed to render: {e.message}</span>
                    <Button size="xs" variant="outline" onClick={reset}>
                      <RotateCw />
                      Try again
                    </Button>
                  </div>
                )}
              >
                <Config
                  item={item}
                  onChange={onConfigChange}
                  catalog={catalog}
                  shards={shards}
                  result={result}
                  money={money}
                  regionName={name}
                  settings={settings}
                />
              </ErrorBoundary>
            ) : catalogStatus === "error" ? (
              <p className="text-sm text-muted-foreground">Price data is unavailable, so this service can't be configured right now. Retry from the banner above.</p>
            ) : (
              <ConfigSkeleton />
            )}
          </div>
          {(showLoadError || loading || (result && (result.lines.length > 0 || result.messages.length > 0))) && (
            <div className="grid gap-3 rounded-b-xl border-t bg-muted/30 px-3 py-3.5 sm:px-5">
              {showLoadError ? (
                <LoadErrorAlert message={error ?? ""} onRetry={onRetry} />
              ) : loading ? (
                <LinesSkeleton />
              ) : result ? (
                <>
                  <ItemMessages messages={result.messages} />
                  <ItemLines result={result} money={money} />
                </>
              ) : null}
            </div>
          )}
        </CollapsibleContent>
      </article>
    </Collapsible>
  );
});

