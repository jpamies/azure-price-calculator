import { ArrowLeft, CopyPlus, Ellipsis, ListCollapse, ListTree, Share2, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { CurrencySelect } from "@/components/estimate/CurrencySelect";
import { ExportMenu } from "@/components/estimate/ExportMenu";
import { InlineEdit } from "@/components/InlineEdit";
import { SaveIndicator } from "@/components/SaveIndicator";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DEFAULT_ESTIMATE_NAME } from "@/domain/factory";
import type { Estimate } from "@/domain/model";
import type { FxTable } from "@/domain/types";
import { useNow } from "@/hooks/useNow";
import type { ExportContext } from "@/lib/assumptions";
import { formatDateTime, formatRelativeTime } from "@/lib/time";
import { useStore } from "@/store/useStore";

export interface EstimateHeaderProps {
  estimate: Estimate;
  fx?: FxTable;
  catalogReady: boolean;
  pricesPending: boolean;
  getExportContext: () => ExportContext;
  onShare: () => void;
  onSaveAs: () => void;
  onDelete: () => void;
}

export function EstimateHeader({ estimate, fx, catalogReady, pricesPending, getExportContext, onShare, onSaveAs, onDelete }: EstimateHeaderProps) {
  const now = useNow();
  const count = estimate.items.length;
  const allCollapsed = count > 0 && estimate.items.every((i) => i.collapsed);
  return (
    <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0 flex-1">
        <Link
          to="/"
          className="inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Estimates
        </Link>
        <h1 className="mt-1.5 flex min-w-0 font-heading text-2xl leading-tight font-semibold tracking-tight sm:text-[1.75rem]">
          <InlineEdit
            value={estimate.name}
            label="Estimate name"
            placeholder={DEFAULT_ESTIMATE_NAME}
            onCommit={(name) => useStore.getState().updateEstimate(estimate.id, { name })}
            className="py-0.5"
          />
        </h1>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <span>
            {count} {count === 1 ? "service" : "services"}
          </span>
          <span aria-hidden="true">·</span>
          <span title={formatDateTime(estimate.updatedAt)}>Edited {formatRelativeTime(estimate.updatedAt, now)}</span>
          <span aria-hidden="true">·</span>
          <SaveIndicator />
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <CurrencySelect
          value={estimate.currency}
          fx={fx}
          disabled={!catalogReady}
          onChange={(currency) => useStore.getState().updateEstimate(estimate.id, { currency })}
        />
        <Button size="sm" onClick={onShare}>
          <Share2 />
          Share
        </Button>
        <ExportMenu getContext={getExportContext} pricesPending={pricesPending} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon-sm" aria-label="More actions">
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onSelect={onSaveAs}>
              <CopyPlus />
              Save as…
            </DropdownMenuItem>
            {count > 1 && (
              <DropdownMenuItem onSelect={() => useStore.getState().setAllCollapsed(estimate.id, !allCollapsed)}>
                {allCollapsed ? <ListTree /> : <ListCollapse />}
                {allCollapsed ? "Expand all services" : "Collapse all services"}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              <Trash2 />
              Delete estimate
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
