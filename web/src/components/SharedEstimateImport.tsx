import { useEffect, useRef, useState } from "react";
import { CalendarClock, Info, TriangleAlert } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ItemIcon } from "@/components/ItemIcon";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useCatalog } from "@/data/hooks";
import { itemDisplayName } from "@/domain/factory";
import { summarizeItem } from "@/domain/pricing";
import { decodeShare, readShareParam, stripShareParam } from "@/domain/share";
import type { DecodedShare } from "@/domain/share";
import { errorMessage } from "@/lib/files";
import { useStore } from "@/store/useStore";

const PREVIEW_ITEMS = 6;

// Read the share parameter once per page load (StrictMode runs effects twice in development).
let shareChecked = false;

function stripShareFromUrl(): void {
  const href = window.location.href;
  const next = stripShareParam(href);
  // Keep the router's history state (index/key) intact.
  if (next !== href) window.history.replaceState(window.history.state, "", next);
}

/** Handles `?s=…` share links on startup: preview dialog, then "Open as copy" or "Cancel". */
export function SharedEstimateImport() {
  const [shared, setShared] = useState<DecodedShare | null>(null);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { status, catalog } = useCatalog();
  const primaryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (shareChecked) return;
    shareChecked = true;
    const param = readShareParam(window.location.href);
    if (!param) return;
    decodeShare(param).then(
      (decoded) => {
        setShared(decoded);
        setOpen(true);
      },
      (e: unknown) => {
        stripShareFromUrl();
        toast.error("Couldn't open the shared estimate", { description: errorMessage(e), duration: 10_000 });
      },
    );
  }, []);

  const close = () => {
    setOpen(false);
    stripShareFromUrl();
  };

  const openAsCopy = () => {
    if (!shared) return;
    const [id] = useStore.getState().importEstimates([shared.estimate]);
    close();
    if (id) {
      navigate(`/estimate/${id}`);
      toast.success(`Opened “${shared.estimate.name}” as a copy`, { description: "It is saved in this browser only." });
    }
  };

  const estimate = shared?.estimate;
  const items = estimate?.items ?? [];
  const senderDate = shared?.pricesDate;
  const currentDate = catalog?.manifest.pricesDate;

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <DialogContent
        className="sm:max-w-lg"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          primaryRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Import shared estimate</DialogTitle>
          <DialogDescription>Someone shared an estimate with you. Open it as a copy in this browser to view and edit it.</DialogDescription>
        </DialogHeader>

        {estimate && (
          <div className="grid gap-3">
            <div className="rounded-lg border bg-muted/40 p-3">
              <p className="font-heading text-base font-semibold break-words">{estimate.name}</p>
              <p className="text-sm text-muted-foreground">
                {items.length} {items.length === 1 ? "item" : "items"} · {estimate.currency}
              </p>
              {items.length > 0 && (
                <ul className="mt-3 grid gap-2" aria-label="Items in the shared estimate">
                  {items.slice(0, PREVIEW_ITEMS).map((item) => (
                    <li key={item.id} className="flex min-w-0 items-center gap-2.5 text-sm">
                      <ItemIcon item={item} catalog={catalog} size={20} />
                      <span className="min-w-0 truncate">
                        <span className="font-medium">{itemDisplayName(item)}</span>
                        <span className="text-muted-foreground"> · {summarizeItem(item)}</span>
                      </span>
                    </li>
                  ))}
                  {items.length > PREVIEW_ITEMS && <li className="pl-7.5 text-sm text-muted-foreground">and {items.length - PREVIEW_ITEMS} more</li>}
                </ul>
              )}
            </div>

            <div className="flex gap-2.5 rounded-lg border border-primary/20 bg-accent px-3 py-2.5 text-sm text-accent-foreground">
              <CalendarClock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                {status === "loading" ? (
                  <Skeleton className="h-4 w-56" />
                ) : senderDate && currentDate && senderDate !== currentDate ? (
                  <p>
                    Shared with prices of <strong>{senderDate}</strong>. Prices are recalculated with today's snapshot (<strong>{currentDate}</strong>), so
                    totals may differ from what the sender saw.
                  </p>
                ) : senderDate && currentDate ? (
                  <p>
                    Same price snapshot as the sender (<strong>{currentDate}</strong>).
                  </p>
                ) : (
                  <p>Share links carry configuration only. Prices are recalculated with the current snapshot{currentDate ? ` (${currentDate})` : ""}.</p>
                )}
              </div>
            </div>

            {shared.skippedItems > 0 && (
              <div className="flex gap-2.5 rounded-lg border border-warning/30 bg-warning-bg px-3 py-2.5 text-sm text-warning">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <p>
                  {shared.skippedItems} {shared.skippedItems === 1 ? "item" : "items"} couldn't be read and will be skipped.
                </p>
              </div>
            )}
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Info className="size-3.5 shrink-0" aria-hidden="true" />
              Your existing estimates are not changed.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button ref={primaryRef} onClick={openAsCopy} disabled={!estimate}>
            Open as copy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
