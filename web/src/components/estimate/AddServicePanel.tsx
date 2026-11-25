import { forwardRef, useId, useImperativeHandle, useMemo, useRef, useState } from "react";
import { ChevronDown, Globe, Plus, Search, X } from "lucide-react";
import { iconKeyForModule } from "@/catalog/icon-map";
import { ServiceIcon } from "@/components/ServiceIcon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { Catalog } from "@/data/catalog";
import type { LoadStatus } from "@/data/hooks";
import type { ModuleId } from "@/domain/model";
import { moduleList } from "@/domain/pricing";
import { tokenMatch } from "@/domain/search";
import type { ServiceInfo } from "@/domain/types";
import { groupServicesByFamily, isGlobalOnlyService } from "@/lib/regions";
import { cn } from "@/lib/utils";

export interface AddServicePanelHandle {
  /** Scrolls the panel into view and focuses the search box. */
  focusSearch(): void;
}

export interface AddServicePanelProps {
  catalog?: Catalog;
  catalogStatus: LoadStatus;
  onAddModule: (moduleId: ModuleId) => void;
  onAddService: (service: ServiceInfo) => void;
}

function ModuleCard({ moduleId, title, description, onAdd }: { moduleId: ModuleId; title: string; description: string; onAdd: () => void }) {
  const descId = useId();
  return (
    <button
      type="button"
      onClick={onAdd}
      aria-label={`Add ${title}`}
      aria-describedby={descId}
      className="group flex h-full w-full items-center gap-2.5 rounded-lg border bg-background p-2.5 text-left sm:items-start sm:gap-3 sm:p-3 transition-[border-color,background-color,box-shadow] outline-none hover:border-primary/50 hover:bg-accent/50 hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:bg-accent dark:bg-card"
    >
      <ServiceIcon iconKey={iconKeyForModule(moduleId)} size={36} className="max-sm:size-7!" />
      <span className="min-w-0 flex-1">
        <span className="flex items-start justify-between gap-2">
          <span className="text-[13px] leading-snug font-semibold sm:text-sm">{title}</span>
          <Plus className="mt-px hidden size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary sm:block" aria-hidden="true" />
        </span>
        <span id={descId} className="mt-0.5 hidden text-xs leading-relaxed text-muted-foreground sm:line-clamp-2">
          {description}
        </span>
      </span>
    </button>
  );
}

function ServiceButton({ service, onAdd }: { service: ServiceInfo; onAdd: () => void }) {
  const global = isGlobalOnlyService(service);
  return (
    <button
      type="button"
      onClick={onAdd}
      aria-label={`Add ${service.serviceName}${global ? " (global pricing)" : ""}`}
      className="group flex w-full min-w-0 items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors outline-none hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
    >
      <ServiceIcon serviceName={service.serviceName} serviceFamily={service.serviceFamily} size={22} />
      <span className="min-w-0 truncate">{service.serviceName}</span>
      {global && (
        <Badge variant="outline" className="h-5 shrink-0 gap-0.5 px-1.5 text-[10px] text-muted-foreground" title="Priced globally (no region)">
          <Globe aria-hidden="true" />
          Global
        </Badge>
      )}
      <Plus className="ml-auto size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden="true" />
    </button>
  );
}

/** "Add services": search, the guided calculators and every catalog service grouped by family. */
export const AddServicePanel = forwardRef<AddServicePanelHandle, AddServicePanelProps>(function AddServicePanel(
  { catalog, catalogStatus, onAddModule, onAddService },
  ref,
) {
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const allId = useId();

  useImperativeHandle(ref, () => ({
    focusSearch() {
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      sectionRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
      inputRef.current?.focus({ preventScroll: true });
    },
  }));

  const searching = query.trim() !== "";
  const modules = useMemo(() => moduleList.filter((m) => tokenMatch([m.title, m.description, m.category], query)), [query]);
  const allFamilies = useMemo(() => groupServicesByFamily(catalog?.services ?? []), [catalog]);
  const families = useMemo(
    () =>
      allFamilies
        .map((f) => ({ ...f, services: f.services.filter((s) => tokenMatch([s.serviceName, s.serviceFamily], query)) }))
        .filter((f) => f.services.length > 0),
    [allFamilies, query],
  );
  const serviceCount = catalog?.services.length ?? 0;
  const matchCount = families.reduce((n, f) => n + f.services.length, 0);
  const listVisible = showAll || searching;

  return (
    <section ref={sectionRef} aria-labelledby="add-services-title" className="scroll-mt-20 rounded-xl border bg-card shadow-sm">
      <div className="flex flex-col gap-3 border-b px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="min-w-0">
          <h2 id="add-services-title" className="font-heading text-lg leading-tight font-semibold">
            Add services
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Guided calculators for common workloads, or any meter from the price catalog.</p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && query) {
                e.preventDefault();
                setQuery("");
              }
            }}
            placeholder="Search services"
            aria-label="Search services"
            className="h-9 pr-8 pl-8 [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              aria-label="Clear search"
              className="absolute top-1/2 right-1.5 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-4 p-4 sm:p-5">
        {modules.length > 0 && (
          <div>
            {searching && <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Guided calculators</h3>}
            <ul className="grid grid-cols-2 gap-2 xl:grid-cols-3" aria-label="Guided calculators">
              {modules.map((m) => (
                <li key={m.id}>
                  <ModuleCard moduleId={m.id} title={m.title} description={m.description} onAdd={() => onAddModule(m.id)} />
                </li>
              ))}
            </ul>
          </div>
        )}

        {!searching && (
          <button
            type="button"
            aria-expanded={showAll}
            aria-controls={allId}
            onClick={() => setShowAll((v) => !v)}
            className="flex w-full items-center gap-2 rounded-md py-1 text-sm font-medium text-primary outline-none hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <ChevronDown className={cn("size-4 transition-transform", !showAll && "-rotate-90")} aria-hidden="true" />
            All services
            {catalogStatus === "ready" && <span className="font-normal text-muted-foreground tabular-nums">({serviceCount})</span>}
          </button>
        )}

        {listVisible && (
          <div id={allId} className="min-w-0">
            {catalogStatus === "loading" ? (
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3" aria-label="Loading services">
                {Array.from({ length: 6 }, (_, i) => (
                  <Skeleton key={i} className="h-8" />
                ))}
              </div>
            ) : catalogStatus === "error" ? (
              <p className="text-sm text-muted-foreground">The service catalog couldn't be loaded. Use the guided calculators, or retry from the banner above.</p>
            ) : families.length === 0 ? (
              <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                {modules.length === 0 ? (
                  <>No services match “{query.trim()}”.</>
                ) : (
                  <>No other services match “{query.trim()}”.</>
                )}{" "}
                <Button variant="link" className="h-auto p-0 text-sm" onClick={() => onAddModule("generic")}>
                  Price any meter instead
                </Button>
              </p>
            ) : (
              <div className="rounded-lg border">
                {searching && (
                  <p className="border-b px-3 py-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    Services <span className="font-normal normal-case tabular-nums">({matchCount})</span>
                  </p>
                )}
                <div className={cn("overflow-y-auto overscroll-contain", !searching && "max-h-[26rem]")}>
                  {families.map((f) => (
                    <div key={f.family} role="group" aria-label={f.family} className="border-b last:border-b-0">
                      <p className="px-3 pt-2.5 pb-1 text-xs font-semibold text-muted-foreground" aria-hidden="true">
                        {f.family}
                      </p>
                      <ul className="grid gap-x-2 px-1.5 pb-2 sm:grid-cols-2 xl:grid-cols-3">
                        {f.services.map((s) => (
                          <li key={s.serviceName} className="min-w-0">
                            <ServiceButton service={s} onAdd={() => onAddService(s)} />
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
});
