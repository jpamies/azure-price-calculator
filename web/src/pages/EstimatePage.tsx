import { useCallback, useEffect, useRef, useState } from "react";
import { FileQuestion, PackagePlus, Plus } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { AddServicePanel } from "@/components/estimate/AddServicePanel";
import type { AddServicePanelHandle } from "@/components/estimate/AddServicePanel";
import { EstimateHeader } from "@/components/estimate/EstimateHeader";
import { runExport } from "@/components/estimate/ExportMenu";
import { ItemCard } from "@/components/estimate/ItemCard";
import { MobileSummaryBar } from "@/components/estimate/MobileSummaryBar";
import { SaveAsDialog } from "@/components/estimate/SaveAsDialog";
import { ShareDialog } from "@/components/estimate/ShareDialog";
import { SummaryPanel } from "@/components/estimate/SummaryPanel";
import type { Period, SummaryPanelProps } from "@/components/estimate/SummaryPanel";
import { PageContainer } from "@/components/PageContainer";
import { Button } from "@/components/ui/button";
import { useMediaQuery } from "@/data/hooks";
import { itemDisplayName } from "@/domain/factory";
import type { Item, ModuleId } from "@/domain/model";
import type { ServiceInfo } from "@/domain/types";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useCacheTotals, useEstimatePricing } from "@/hooks/useEstimatePricing";
import type { ExportContext } from "@/lib/assumptions";
import { isGlobalOnlyService } from "@/lib/regions";
import { restoreEstimate, restoreItem } from "@/lib/undo";
import { useEstimate, useSettings, useStore } from "@/store/useStore";
import { StatusMessage } from "./NotFoundPage";

const HIGHLIGHT_MS = 2200;

export default function EstimatePage() {
  const { id = "" } = useParams();
  const estimate = useEstimate(id);
  const settings = useSettings();
  const navigate = useNavigate();
  const pricing = useEstimatePricing(estimate);
  useCacheTotals(estimate, pricing);
  useDocumentTitle(estimate ? estimate.name : "Estimate not found");
  const isDesktop = useMediaQuery("(min-width: 1024px)");

  const [period, setPeriod] = useState<Period>("monthly");
  const [shareOpen, setShareOpen] = useState(false);
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const addPanelRef = useRef<AddServicePanelHandle>(null);

  const { catalogState, results, errors, loading, money, currency, totals, retry } = pricing;
  const { catalog, status: catalogStatus } = catalogState;

  // Latest values for stable callbacks (export menu, share dialog).
  const latest = useRef({ estimate, results, catalog, currency });
  latest.current = { estimate, results, catalog, currency };
  const getExportContext = useCallback((): ExportContext => {
    const { estimate: e, results: r, catalog: c, currency: cur } = latest.current;
    if (!e) throw new Error("The estimate no longer exists.");
    return { estimate: e, results: r, catalog: c, currency: cur };
  }, []);

  const showItem = useCallback((itemId: string) => {
    const item = useStore.getState().estimates.find((e) => e.id === id)?.items.find((i) => i.id === itemId);
    if (item?.collapsed) useStore.getState().updateItem(id, itemId, { collapsed: false });
    setFocusTarget(itemId);
    setHighlightId(itemId);
  }, [id]);

  // Scroll a new/duplicated/restored item into view once it is rendered, then focus it.
  useEffect(() => {
    if (!focusTarget) return;
    const el = document.getElementById(`item-${focusTarget}`);
    if (!el) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    el.focus({ preventScroll: true });
    setFocusTarget(null);
  }, [focusTarget, estimate?.items]);

  useEffect(() => {
    if (!highlightId) return;
    const t = window.setTimeout(() => setHighlightId(null), HIGHLIGHT_MS);
    return () => window.clearTimeout(t);
  }, [highlightId]);

  const addModule = useCallback(
    (moduleId: ModuleId) => {
      const itemId = useStore.getState().addItem(id, moduleId);
      if (itemId) showItem(itemId);
    },
    [id, showItem],
  );

  const addService = useCallback(
    (service: ServiceInfo) => {
      const itemId = useStore.getState().addItem(id, "generic", {
        name: service.serviceName,
        config: { serviceName: service.serviceName, useGlobalRegion: isGlobalOnlyService(service) },
      });
      if (itemId) showItem(itemId);
    },
    [id, showItem],
  );

  const duplicateItem = useCallback(
    (item: Item) => {
      const copyId = useStore.getState().duplicateItem(id, item.id);
      if (copyId) showItem(copyId);
    },
    [id, showItem],
  );

  const removeItem = useCallback(
    (item: Item, index: number) => {
      useStore.getState().removeItem(id, item.id);
      toast(`Removed “${itemDisplayName(item)}”`, {
        action: {
          label: "Undo",
          onClick: () => {
            if (restoreItem(id, item, index)) showItem(item.id);
          },
        },
      });
    },
    [id, showItem],
  );

  if (!estimate) {
    return (
      <StatusMessage
        icon={<FileQuestion />}
        title="Estimate not found"
        action={
          <Button asChild>
            <Link to="/">Go to estimates</Link>
          </Button>
        }
      >
        <p>It may have been deleted, or it was saved in another browser. Estimates live in the browser where they were created.</p>
      </StatusMessage>
    );
  }

  const saveAs = (name: string) => {
    const copyId = useStore.getState().duplicateEstimate(estimate.id);
    if (!copyId) return;
    useStore.getState().updateEstimate(copyId, { name });
    navigate(`/estimate/${copyId}`);
    toast.success(`Saved as “${name}”`, { description: "You are now editing the copy." });
  };

  const deleteEstimate = () => {
    const snapshot = estimate;
    const index = useStore.getState().estimates.findIndex((e) => e.id === snapshot.id);
    navigate("/");
    useStore.getState().deleteEstimate(snapshot.id);
    toast(`Deleted “${snapshot.name}”`, { action: { label: "Undo", onClick: () => restoreEstimate(snapshot, index) } });
  };

  const items = estimate.items;
  const summaryProps: Omit<SummaryPanelProps, "live" | "className"> = {
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
    onPeriodChange: setPeriod,
    onJumpToItem: showItem,
  };

  return (
    <PageContainer className="pb-10 sm:pb-12">
      <EstimateHeader
        estimate={estimate}
        fx={catalog?.fx}
        catalogReady={catalogStatus === "ready"}
        pricesPending={loading}
        getExportContext={getExportContext}
        onShare={() => setShareOpen(true)}
        onSaveAs={() => setSaveAsOpen(true)}
        onDelete={() => setDeleteOpen(true)}
      />

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="grid min-w-0 content-start gap-6">
          <AddServicePanel
            ref={addPanelRef}
            catalog={catalog}
            catalogStatus={catalogStatus}
            onAddModule={addModule}
            onAddService={addService}
          />

          <section aria-labelledby="services-title" className="grid gap-3">
            <div className="flex items-center justify-between gap-2">
              <h2 id="services-title" className="font-heading text-lg font-semibold">
                Your estimate <span className="font-normal text-muted-foreground tabular-nums">({items.length})</span>
              </h2>
              {items.length > 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  onClick={() => useStore.getState().setAllCollapsed(estimate.id, !items.every((i) => i.collapsed))}
                >
                  {items.every((i) => i.collapsed) ? "Expand all" : "Collapse all"}
                </Button>
              )}
            </div>

            {items.length === 0 ? (
              <div className="flex flex-col items-center rounded-xl border border-dashed bg-card/50 px-6 py-10 text-center">
                <span className="mb-3 inline-flex size-11 items-center justify-center rounded-xl bg-accent text-accent-foreground" aria-hidden="true">
                  <PackagePlus className="size-5" />
                </span>
                <p className="font-medium">No services yet</p>
                <p className="mt-1 max-w-sm text-sm text-muted-foreground">Choose a calculator above — for example Virtual Machines — to start pricing.</p>
              </div>
            ) : (
              <ol className="grid gap-3" aria-label="Services in this estimate">
                {items.map((item, index) => (
                  <li key={item.id} className="min-w-0">
                    <ItemCard
                      estimateId={estimate.id}
                      item={item}
                      index={index}
                      count={items.length}
                      result={results[item.id]}
                      error={errors[item.id]}
                      catalog={catalog}
                      catalogStatus={catalogStatus}
                      money={money}
                      settings={settings}
                      highlight={highlightId === item.id}
                      onRetry={retry}
                      onDuplicate={duplicateItem}
                      onRemove={removeItem}
                    />
                  </li>
                ))}
              </ol>
            )}

            {items.length > 0 && (
              <Button
                variant="outline"
                className="h-11 border-dashed text-muted-foreground hover:text-foreground"
                onClick={() => addPanelRef.current?.focusSearch()}
              >
                <Plus />
                Add another service
              </Button>
            )}
          </section>
        </div>

        {isDesktop && (
          <aside className="sticky top-18 max-h-[calc(100dvh-5.5rem)] self-start overflow-y-auto rounded-xl [scrollbar-width:thin]">
            <SummaryPanel {...summaryProps} live />
          </aside>
        )}
      </div>

      {!isDesktop && <MobileSummaryBar {...summaryProps} />}

      <ShareDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        estimate={estimate}
        pricesDate={catalog?.manifest.pricesDate}
        onExportJson={() => {
          setShareOpen(false);
          void runExport("json", getExportContext());
        }}
      />
      <SaveAsDialog open={saveAsOpen} onOpenChange={setSaveAsOpen} defaultName={`${estimate.name} (copy)`} onSave={saveAs} />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete estimate?"
        description={
          <p>
            “{estimate.name}” and its {items.length} {items.length === 1 ? "service" : "services"} will be deleted from this browser.
          </p>
        }
        confirmLabel="Delete"
        destructive
        onConfirm={deleteEstimate}
      />
    </PageContainer>
  );
}
