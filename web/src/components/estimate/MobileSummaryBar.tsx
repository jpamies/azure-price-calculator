import { useState } from "react";
import { ChevronUp, X } from "lucide-react";
import { SummaryPanel } from "@/components/estimate/SummaryPanel";
import type { SummaryPanelProps } from "@/components/estimate/SummaryPanel";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";

/** Phones/tablets: fixed bottom bar with the monthly total; opens the full summary in a bottom sheet. */
export function MobileSummaryBar(props: Omit<SummaryPanelProps, "live" | "className">) {
  const [open, setOpen] = useState(false);
  const { totals, money, loading, estimate, results, catalogStatus } = props;
  const monthly = totals?.monthlyUsd ?? 0;
  const upfront = totals?.upfrontUsd ?? 0;
  const noData = catalogStatus === "error";
  const calculating = !noData && (loading || (totals?.pendingItems.length ?? 0) > 0);
  const priced = estimate.items.some((i) => results[i.id]?.status === "ok");
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-6px_16px_-8px_rgb(0_0_0/0.15)] backdrop-blur-md lg:hidden">
      <div className="mx-auto flex h-[4.5rem] w-full max-w-[1440px] items-center gap-3 px-4 sm:px-6">
        <div className="min-w-0 flex-1" aria-live="polite" aria-atomic="true">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Estimated monthly cost
            {calculating && estimate.items.length > 0 && <Spinner className="size-3" aria-label="Calculating" />}
          </p>
          {calculating && !priced && estimate.items.length > 0 ? (
            <Skeleton className="mt-1 h-6 w-32" aria-label="Calculating" />
          ) : (
            <p className="truncate text-xl leading-tight font-semibold tabular-nums">
              {noData && !priced ? "—" : money.format(monthly)}
              {upfront > 0 && <span className="ml-1.5 text-xs font-normal text-muted-foreground">+ {money.format(upfront)} upfront</span>}
            </p>
          )}
        </div>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" className="shrink-0" aria-label="Show estimate summary">
              <ChevronUp />
              Summary
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" showCloseButton={false} className="max-h-[88dvh] gap-0 rounded-t-2xl p-0 pb-[env(safe-area-inset-bottom)]">
            <SheetHeader className="sr-only">
              <SheetTitle>Estimate summary</SheetTitle>
              <SheetDescription>Totals, breakdowns and assumptions of this estimate.</SheetDescription>
            </SheetHeader>
            <div className="relative flex h-9 shrink-0 items-center justify-center">
              <div className="h-1 w-10 rounded-full bg-muted-foreground/30" aria-hidden="true" />
              <SheetClose asChild>
                <Button variant="ghost" size="icon-sm" className="absolute top-1 right-2" aria-label="Close summary">
                  <X />
                </Button>
              </SheetClose>
            </div>
            <SummaryPanel
              {...props}
              className="rounded-none border-0 shadow-none"
              onJumpToItem={(id) => {
                setOpen(false);
                // Let the sheet close (and restore scrolling) before jumping.
                window.setTimeout(() => props.onJumpToItem(id), 250);
              }}
            />
          </SheetContent>
        </Sheet>
      </div>
    </div>
  );
}
