// VM size picker: a trigger showing the chosen SKU (specs + price) and a dialog with search,
// filters, sortable price columns and a virtualized list driven by ↑/↓/PageUp/PageDown/Enter/Esc.
import { useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type RefObject } from "react";
import { ArrowDown, ArrowUp, Check, ChevronsUpDown, Search, X } from "lucide-react";
import type { VmConfig } from "@/domain/model";
import { COMMITMENT_LABELS, VM_OS_LABELS } from "@/domain/pricing/vm";
import { filterVmSkus, vmFamilies, vmSkuLabel, type VmSkuOption } from "@/domain/vmCatalog";
import type { MoneyFormatter } from "@/lib/format";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import type { FieldRenderProps } from "../shared/Field";
import { PriceText } from "../shared/data";
import { navigateIndex, useElementWidth } from "../shared/hooks";
import { activeVmColumn, parseNumberInput, sortVmOptions, vmColumnValue, vmPriceSummary, type VmColumnKey, type VmSort } from "../shared/logic";
import { VirtualList, type VirtualListHandle } from "../shared/VirtualList";

interface ColumnSpec {
  key: VmColumnKey;
  label: string;
  title: string;
  /** Hourly prices use unit formatting; monthly equivalents use amounts. */
  per?: "hour" | "month";
}

const PRICE_COLUMNS: readonly ColumnSpec[] = [
  { key: "linux", label: "Linux /h", title: "Pay-as-you-go Linux price per hour", per: "hour" },
  { key: "windows", label: "Windows /h", title: "Pay-as-you-go Windows price per hour (license included)", per: "hour" },
  { key: "ri1y", label: "RI 1Y /mo", title: "1-year reservation, monthly equivalent (term total ÷ 12, compute only)", per: "month" },
  { key: "ri3y", label: "RI 3Y /mo", title: "3-year reservation, monthly equivalent (term total ÷ 36, compute only)", per: "month" },
  { key: "sp1y", label: "SP 1Y /h", title: "1-year savings plan price per hour (compute only)", per: "hour" },
  { key: "sp3y", label: "SP 3Y /h", title: "3-year savings plan price per hour (compute only)", per: "hour" },
  { key: "spot", label: "Spot /h", title: "Spot price per hour (capacity can be evicted)", per: "hour" },
];

const ROW_HEIGHT = 32;
const HEADER_HEIGHT = 32;
/** px taken by the check, SKU, vCPU and RAM columns + gaps/padding. */
const FIXED_WIDTH = 20 + 128 + 48 + 64 + 6 * 12 + 24;
const PRICE_COLUMN_WIDTH = 92;

export interface VmSkuPickerProps {
  config: VmConfig;
  /** undefined while prices load. */
  options: VmSkuOption[] | undefined;
  selected: VmSkuOption | undefined;
  loading: boolean;
  /** Disables the picker with this text (no region, failed download…). */
  unavailableText?: string;
  money: MoneyFormatter;
  regionName: string;
  hasSavingsPlan: boolean;
  /** Spot prices are loaded (Spot column available). */
  showSpot: boolean;
  onSelect: (armSkuName: string) => void;
  fieldProps?: FieldRenderProps;
}

interface Filters {
  minVcpu: string;
  maxVcpu: string;
  minMem: string;
  maxMem: string;
  family: string;
  onlyPriced: boolean;
}

const NO_FILTERS: Filters = { minVcpu: "", maxVcpu: "", minMem: "", maxMem: "", family: "", onlyPriced: true };

/** Filter box text → bound (undefined when empty/invalid). */
function num(text: string): number | undefined {
  return parseNumberInput(text) ?? undefined;
}

function specsText(o: VmSkuOption): string {
  if (!o.specs) return "Specs unknown";
  const parts: string[] = [];
  if (o.vCPUs !== undefined) parts.push(`${o.vCPUs} vCPU`);
  if (o.memoryGB !== undefined) parts.push(`${o.memoryGB.toLocaleString("en-US", { maximumFractionDigits: 2 })} GiB RAM`);
  return parts.join(" · ");
}

export function VmSkuPicker(props: VmSkuPickerProps) {
  const { config, options, selected, loading, unavailableText, money, regionName, fieldProps } = props;
  const [open, setOpen] = useState(false);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [sort, setSort] = useState<VmSort | null>(null);

  const sku = config.armSkuName.trim();
  const label = selected?.label ?? (sku ? vmSkuLabel(sku) : "Choose a VM size");
  const summary = selected ? vmPriceSummary(selected, config) : null;
  const isRi = config.commitment === "ri1y" || config.commitment === "ri3y";
  const missing = Boolean(sku) && !loading && options !== undefined && !selected;
  const disabled = loading || Boolean(unavailableText);

  const accessibleName = [
    "VM size:",
    label,
    selected ? specsText(selected) : "",
    missing ? `not available in ${regionName}` : "",
    "Change",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          {...fieldProps}
          disabled={disabled}
          aria-label={accessibleName}
          data-slot="vm-sku-trigger"
          className={cn(
            "group flex h-8 w-full min-w-0 items-center gap-2 rounded-md border border-control-border bg-transparent px-2.5 text-left text-sm shadow-xs transition-colors dark:bg-input/30",
            "hover:bg-accent/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid",
            "disabled:cursor-not-allowed disabled:opacity-60",
            missing && "border-destructive",
          )}
        >
          <span className={cn("shrink-0 font-semibold", !sku && "font-normal text-muted-foreground")}>{label}</span>
          {unavailableText ? (
            <span className="min-w-0 truncate text-xs text-muted-foreground">{unavailableText}</span>
          ) : missing ? (
            <span className="min-w-0 truncate text-xs text-destructive">Not available in {regionName}</span>
          ) : selected ? (
            <span className="min-w-0 truncate text-xs text-muted-foreground">{specsText(selected)}</span>
          ) : null}
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            {summary ? (
              <span className="text-xs text-foreground tabular-nums">
                {isRi ? (
                  <PriceText usd={summary.monthlyUsd} money={money} per="/mo" />
                ) : (
                  <PriceText usd={summary.hourlyUsd} money={money} unit per="/h" />
                )}
              </span>
            ) : null}
            <ChevronsUpDown aria-hidden="true" className="size-4 text-muted-foreground" />
          </span>
        </button>
      </DialogTrigger>
      {open ? (
        <VmSkuDialog
          {...props}
          options={options ?? []}
          filters={filters}
          onFiltersChange={setFilters}
          sort={sort}
          onSortChange={setSort}
          onChoose={(name) => {
            props.onSelect(name);
            setOpen(false);
          }}
        />
      ) : null}
    </Dialog>
  );
}

interface VmSkuDialogProps extends Omit<VmSkuPickerProps, "options" | "fieldProps"> {
  options: VmSkuOption[];
  filters: Filters;
  onFiltersChange: (f: Filters) => void;
  sort: VmSort | null;
  onSortChange: (s: VmSort | null) => void;
  onChoose: (armSkuName: string) => void;
}

function VmSkuDialog(props: VmSkuDialogProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const searchRef = useRef<HTMLInputElement>(null);
  return (
    <DialogContent
      aria-describedby={`vmsku-${uid}-desc`}
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        searchRef.current?.focus();
      }}
      className={cn(
        "flex h-[min(42rem,calc(100dvh-2rem))] flex-col gap-0 overflow-hidden bg-card p-0 sm:max-w-5xl",
        "max-sm:h-dvh max-sm:max-h-dvh max-sm:max-w-full max-sm:rounded-none max-sm:border-0",
      )}
    >
      {/* Rendered inside the portal so its refs/measurements exist on mount. */}
      <VmSkuDialogBody {...props} uid={uid} searchRef={searchRef} />
    </DialogContent>
  );
}

function VmSkuDialogBody({
  config,
  options,
  selected,
  money,
  regionName,
  hasSavingsPlan,
  showSpot,
  filters,
  onFiltersChange,
  sort,
  onSortChange,
  onChoose,
  uid,
  searchRef,
}: VmSkuDialogProps & { uid: string; searchRef: RefObject<HTMLInputElement | null> }) {
  const listboxId = `vmsku-${uid}-list`;
  const optionId = (i: number) => `vmsku-${uid}-opt-${i}`;
  const bodyRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<VirtualListHandle>(null);
  const width = useElementWidth(bodyRef, 960);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [active, setActive] = useState(-1);

  const os = config.os;
  const spot = config.spot && config.commitment === "payg";
  const activeKey = activeVmColumn(config);
  const families = useMemo(() => vmFamilies(options), [options]);

  const listFor = useCallback(
    (q: string) => {
      const filtered = filterVmSkus(options, {
      query: q,
        minVcpu: num(filters.minVcpu),
        maxVcpu: num(filters.maxVcpu),
        minMemGB: num(filters.minMem),
        maxMemGB: num(filters.maxMem),
        family: filters.family || undefined,
        priceFor: filters.onlyPriced ? { os, commitment: config.commitment, spot } : undefined,
      });
      return sort ? sortVmOptions(filtered, sort, os) : filtered;
    },
    [options, filters, os, config.commitment, spot, sort],
  );
  const rows = useMemo(() => listFor(deferredQuery), [listFor, deferredQuery]);

  // Price columns that fit, the one matching the item's OS/commitment first.
  const available = PRICE_COLUMNS.filter(
    (c) => ((c.key !== "sp1y" && c.key !== "sp3y") || hasSavingsPlan) && (c.key !== "spot" || showSpot),
  );
  const fit = Math.max(1, Math.floor((width - FIXED_WIDTH) / PRICE_COLUMN_WIDTH));
  const priority = [...available.filter((c) => c.key === activeKey), ...available.filter((c) => c.key !== activeKey)];
  const shown = new Set(priority.slice(0, fit).map((c) => c.key));
  const columns = available.filter((c) => shown.has(c.key));
  const compact = width < 520;
  const template = [
    "1rem",
    "minmax(6.5rem,1.5fr)",
    compact ? "2.25rem" : "3rem",
    compact ? "3rem" : "4rem",
    ...columns.map(() => `minmax(${compact ? "4.25rem" : "5rem"},1fr)`),
  ].join(" ");

  // Keep the active row on the current SKU (no query) or on the best match (query).
  useEffect(() => {
    const current = selected ? rows.indexOf(selected) : -1;
    const idx = rows.length === 0 ? -1 : deferredQuery.trim() ? 0 : Math.max(0, current);
    setActive(idx);
    if (idx >= 0) listRef.current?.scrollToIndex(idx, deferredQuery.trim() ? "auto" : "center");
  }, [rows, selected, deferredQuery]);

  const move = (next: number) => {
    setActive(next);
    listRef.current?.scrollToIndex(next);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const pageRows = Math.max(1, Math.floor(((bodyRef.current?.clientHeight ?? 320) - HEADER_HEIGHT) / ROW_HEIGHT) - 1);
    const next = navigateIndex(e.key, active, rows.length, pageRows, e.ctrlKey || e.metaKey);
    if (next !== null) {
      e.preventDefault();
      move(next);
      return;
    }
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      // The deferred list may lag behind fast typing: resolve against the text in the box.
      const o = query !== deferredQuery ? listFor(query)[0] : rows[active];
      if (o) onChoose(o.armSkuName);
    }
  };

  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => onFiltersChange({ ...filters, [key]: value });
  const filtersActive =
    filters.minVcpu !== "" || filters.maxVcpu !== "" || filters.minMem !== "" || filters.maxMem !== "" || filters.family !== "" || !filters.onlyPriced;

  const toggleSort = (key: VmColumnKey) => {
    if (!sort || sort.key !== key) onSortChange({ key, dir: "asc" });
    else if (sort.dir === "asc") onSortChange({ key, dir: "desc" });
    else onSortChange(null);
  };

  const headerCell = (key: VmColumnKey, labelText: string, title: string, align: "left" | "right") => {
    const dir = sort?.key === key ? sort.dir : null;
    const highlight = key === activeKey;
    return (
      <button
        key={key}
        type="button"
        title={title}
        onClick={() => toggleSort(key)}
        aria-label={`${title}${dir ? `, sorted ${dir === "asc" ? "ascending" : "descending"}` : ""}. Sort`}
        className={cn(
          "flex h-full min-w-0 items-center gap-1 rounded-sm text-xs font-semibold whitespace-nowrap text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid",
          align === "right" && "justify-end",
          highlight && "text-primary hover:text-primary",
        )}
      >
        <span className="truncate">{labelText}</span>
        {dir === "asc" ? <ArrowUp aria-hidden="true" className="size-3 shrink-0" /> : dir === "desc" ? <ArrowDown aria-hidden="true" className="size-3 shrink-0" /> : null}
      </button>
    );
  };

  const header = (
    <div
      className="grid h-full items-center gap-x-3 border-b bg-muted/95 px-3 backdrop-blur-sm dark:bg-secondary/95"
      style={{ gridTemplateColumns: template }}
    >
      <span aria-hidden="true" />
      {headerCell("sku", "VM size", "VM size", "left")}
      {headerCell("vcpu", "vCPU", "vCPUs", "right")}
      {headerCell("ram", compact ? "GiB" : "RAM GiB", "Memory in GiB", "right")}
      {columns.map((c) => headerCell(c.key, c.label, c.title, "right"))}
    </div>
  );

  const renderRow = (o: VmSkuOption, i: number, style: CSSProperties) => {
    const isCurrent = o === selected;
    const isActive = i === active;
    return (
      <div
        key={o.armSkuName}
        id={optionId(i)}
        role="option"
        aria-selected={isActive}
        aria-posinset={i + 1}
        aria-setsize={rows.length}
        data-sku={o.armSkuName}
        style={{ ...style, gridTemplateColumns: template }}
        onMouseMove={() => {
          if (!isActive) setActive(i);
        }}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onChoose(o.armSkuName)}
        className={cn(
          "grid cursor-pointer items-center gap-x-3 border-b border-border/50 px-3 text-[13px]",
          isActive && "bg-accent text-accent-foreground",
          isCurrent && "font-semibold",
        )}
      >
        <span className="flex items-center">{isCurrent ? <Check aria-hidden="true" className="size-3.5 text-primary" /> : null}</span>
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate">{o.label}</span>
          {!compact ? <span className="truncate text-[11px] font-normal text-muted-foreground">{o.family}</span> : null}
          {isCurrent ? <span className="sr-only">(current)</span> : null}
        </span>
        <span
          className="text-right tabular-nums"
          title={!o.specs ? `No specs for this size${o.vCPUs ? `; the name suggests ${o.vCPUs} vCPUs` : ""}` : undefined}
        >
          {o.specs && o.vCPUs !== undefined ? o.vCPUs : <span className="text-muted-foreground">—</span>}
        </span>
        <span className="text-right tabular-nums">
          {o.specs && o.memoryGB !== undefined ? (
            o.memoryGB.toLocaleString("en-US", { maximumFractionDigits: 2 })
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </span>
        {columns.map((c) => {
          const v = vmColumnValue(o, c.key, os) as number | undefined;
          return (
            <span key={c.key} className={cn("truncate text-right tabular-nums", c.key === activeKey && "font-semibold text-primary")}>
              <PriceText usd={v} money={money} unit={c.per === "hour"} />
            </span>
          );
        })}
      </div>
    );
  };

  const selectionText = `${VM_OS_LABELS[os]} · ${spot ? "Spot" : COMMITMENT_LABELS[config.commitment]}`;
  const filterInput = (key: "minVcpu" | "maxVcpu" | "minMem" | "maxMem", aria: string, placeholder: string) => (
    <input
      type="text"
      inputMode="decimal"
      value={filters[key]}
      placeholder={placeholder}
      aria-label={aria}
      aria-invalid={filters[key] !== "" && parseNumberInput(filters[key]) === null ? true : undefined}
      onChange={(e) => setFilter(key, e.target.value)}
      className="h-7 w-12 rounded-md border border-control-border bg-transparent px-1.5 text-xs tabular-nums outline-none placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring focus-visible:outline-solid aria-invalid:border-destructive dark:bg-input/30"
    />
  );

  return (
    <>
      <DialogHeader className="gap-1 border-b px-4 pt-3.5 pb-3 text-left">
        <DialogTitle className="text-base">Choose a VM size</DialogTitle>
        <DialogDescription id={`vmsku-${uid}-desc`} className="text-xs">
          {regionName} · prices in {money.currency} · highlighted column = {selectionText}
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-2 border-b px-4 py-2.5">
        <div className="relative">
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={searchRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 && rows[active] ? optionId(active) : undefined}
            aria-label="Search VM sizes"
            placeholder="Search, e.g. D8as v5, Standard_E16s_v5, d8as v5"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            className="h-9 w-full rounded-md border border-control-border bg-transparent pr-8 pl-8.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring focus-visible:outline-solid dark:bg-input/30"
          />
          {query ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setQuery("");
                searchRef.current?.focus();
              }}
              className="absolute top-1/2 right-1.5 flex size-6 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid"
            >
              <X aria-hidden="true" className="size-3.5" />
            </button>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 text-xs" role="group" aria-label="Filters">
          <span className="flex items-center gap-1.5">
            <span className="font-medium text-muted-foreground">vCPU</span>
            {filterInput("minVcpu", "Minimum vCPUs", "min")}
            <span aria-hidden="true" className="text-muted-foreground">–</span>
            {filterInput("maxVcpu", "Maximum vCPUs", "max")}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="font-medium text-muted-foreground">RAM GiB</span>
            {filterInput("minMem", "Minimum memory in GiB", "min")}
            <span aria-hidden="true" className="text-muted-foreground">–</span>
            {filterInput("maxMem", "Maximum memory in GiB", "max")}
          </span>
          <span className="flex items-center gap-1.5">
            <label htmlFor={`${listboxId}-family`} className="font-medium text-muted-foreground">
              Family
            </label>
            <NativeSelect
              id={`${listboxId}-family`}
              size="sm"
              value={filters.family}
              onChange={(e) => setFilter("family", e.target.value)}
              className="h-7 min-w-28 py-0 text-xs data-[size=sm]:h-7"
            >
              <NativeSelectOption value="">All families</NativeSelectOption>
              {families.map((f) => (
                <NativeSelectOption key={f} value={f}>
                  {f}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </span>
          <label className="flex cursor-pointer items-center gap-1.5 select-none" title={`Hide sizes without a ${selectionText} price in ${regionName}`}>
            <Checkbox checked={filters.onlyPriced} onCheckedChange={(v) => setFilter("onlyPriced", v === true)} />
            <span>Only with price in region</span>
          </label>
          {filtersActive ? (
            <button
              type="button"
              onClick={() => onFiltersChange(NO_FILTERS)}
              className="rounded-sm font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid"
            >
              Reset filters
            </button>
          ) : null}
        </div>
      </div>
      <div ref={bodyRef} className="flex min-h-0 flex-1 flex-col">
        <VirtualList
          items={rows}
          rowHeight={ROW_HEIGHT}
          header={header}
          headerHeight={HEADER_HEIGHT}
          renderRow={renderRow}
          handleRef={listRef}
          className="min-h-0 flex-1"
          listProps={{ id: listboxId, role: "listbox", "aria-label": "VM sizes" }}
          empty={
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
              {options.length === 0 ? `No VM sizes are priced in ${regionName}.` : "No VM size matches the search and filters."}
              {filtersActive ? (
                <>
                  {" "}
                  <button type="button" className="font-medium text-primary hover:underline" onClick={() => onFiltersChange(NO_FILTERS)}>
                    Reset filters
                  </button>
                </>
              ) : null}
            </div>
          }
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
        <span aria-live="polite">
          {rows.length.toLocaleString("en-US")} of {options.length.toLocaleString("en-US")} sizes
          {money.currency !== "USD" ? ` · ${money.currency} indicative (converted from USD)` : ""}
        </span>
        <span className="hidden items-center gap-1 sm:flex">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> move <Kbd>Enter</Kbd> select <Kbd>Esc</Kbd> close
        </span>
      </div>
    </>
  );
}
