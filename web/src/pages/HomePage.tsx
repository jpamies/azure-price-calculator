import { useCallback, useState } from "react";
import { Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/home/EmptyState";
import { EstimateRow } from "@/components/home/EstimateRow";
import { ImportJsonButton } from "@/components/ImportJsonButton";
import { PageContainer } from "@/components/PageContainer";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCatalog } from "@/data/hooks";
import type { Estimate } from "@/domain/model";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useNow } from "@/hooks/useNow";
import { prefetchEditorProps } from "@/pages/loaders";
import { restoreEstimate } from "@/lib/undo";
import { useEstimates, useStore } from "@/store/useStore";

function SnapshotLine() {
  const { status, catalog } = useCatalog();
  if (status === "loading") return <Skeleton className="mt-2 h-4 w-72" />;
  if (!catalog) return <p className="mt-1 text-sm text-muted-foreground">Price data unavailable · Source: Azure Retail Prices API</p>;
  return (
    <p className="mt-1 text-sm text-muted-foreground">
      Prices as of <span className="font-medium text-foreground tabular-nums">{catalog.manifest.pricesDate}</span> · Source: Azure Retail Prices API
      {catalog.manifest.source.type === "fixture" && " (sample data)"}
    </p>
  );
}

export default function HomePage() {
  useDocumentTitle("Estimates");
  const estimates = useEstimates();
  const navigate = useNavigate();
  const { status, catalog } = useCatalog();
  const now = useNow();
  const [pendingDelete, setPendingDelete] = useState<Estimate | null>(null);

  const create = () => {
    const id = useStore.getState().createEstimate();
    navigate(`/estimate/${id}`);
  };

  const duplicate = useCallback(
    (estimate: Estimate) => {
      const id = useStore.getState().duplicateEstimate(estimate.id);
      if (!id) return;
      const copy = useStore.getState().estimates.find((e) => e.id === id);
      toast.success(`Duplicated as “${copy?.name ?? "copy"}”`, { action: { label: "Open", onClick: () => navigate(`/estimate/${id}`) } });
    },
    [navigate],
  );

  const confirmDelete = () => {
    const target = pendingDelete;
    if (!target) return;
    const index = useStore.getState().estimates.findIndex((e) => e.id === target.id);
    useStore.getState().deleteEstimate(target.id);
    toast(`Deleted “${target.name}”`, {
      action: { label: "Undo", onClick: () => restoreEstimate(target, index) },
    });
  };

  return (
    <PageContainer className="max-w-6xl">
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">Estimates</h1>
          <SnapshotLine />
        </div>
        {estimates.length > 0 && (
          <div className="flex shrink-0 gap-2">
            <ImportJsonButton />
            <Button onClick={create} {...prefetchEditorProps}>
              <Plus />
              New estimate
            </Button>
          </div>
        )}
      </header>

      {estimates.length === 0 ? (
        <EmptyState onCreate={create} />
      ) : (
        <section aria-label="Saved estimates" className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <div
            className="hidden grid-cols-[minmax(0,1fr)_4.5rem_10rem_9rem_8.75rem] items-center gap-x-4 border-b bg-muted/40 px-5 py-2.5 text-xs font-medium tracking-wide text-muted-foreground uppercase md:grid"
            aria-hidden="true"
          >
            <span>Name</span>
            <span>Items</span>
            <span className="pr-2 text-right">Monthly</span>
            <span>Last edited</span>
            <span />
          </div>
          <ul className="divide-y">
            {estimates.map((estimate) => (
              <EstimateRow
                key={estimate.id}
                estimate={estimate}
                catalog={catalog}
                catalogStatus={status}
                now={now}
                onDuplicate={duplicate}
                onDelete={setPendingDelete}
              />
            ))}
          </ul>
        </section>
      )}
      {estimates.length > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          Estimates are saved in this browser only. Use Settings → Backup to move them to another device.
        </p>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title="Delete estimate?"
        description={
          <p>
            “{pendingDelete?.name}” and its {pendingDelete?.items.length ?? 0} {pendingDelete?.items.length === 1 ? "item" : "items"} will be deleted from this
            browser.
          </p>
        }
        confirmLabel="Delete"
        destructive
        onConfirm={confirmDelete}
      />
    </PageContainer>
  );
}
