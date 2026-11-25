// Meter picker (generic module): search over product · SKU · meter and a virtualized list showing
// unit, price, commitment badge and tier count. ↑/↓/PageUp/PageDown/Enter/Esc from the search box.
import { useDeferredValue, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { ChevronsUpDown, Search } from "lucide-react";
import { searchMeters, type MeterOption } from "@/domain/meters";
import type { MoneyFormatter } from "@/lib/format";
import { Kbd } from "@/components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { FieldRenderProps } from "../shared/Field";
import { PriceText } from "../shared/data";
import { navigateIndex } from "../shared/hooks";
import { meterHeadlinePrice, meterTypeBadge, meterUnitText } from "../shared/logic";
import { VirtualList, type VirtualListHandle } from "../shared/VirtualList";

const ROW_HEIGHT = 48;

export interface MeterDisplay {
  meterName: string;
  productName: string;
  skuName: string;
  unitOfMeasure: string;
  type: string;
  reservationTerm: string;
}

export interface MeterPickerProps {
  /** undefined while the shard loads. */
  options: MeterOption[] | undefined;
  selected: MeterOption | undefined;
  /** Display copies from the config (shown before prices load). */
  display: MeterDisplay;
  loading: boolean;
  unavailableText?: string;
  /** The configured meter is not in the loaded shard. */
  missing?: boolean;
  money: MoneyFormatter;
  /** "West Europe" or "Global (no region)". */
  whereLabel: string;
  onSelect: (option: MeterOption) => void;
  fieldProps?: FieldRenderProps;
}

function Badges({ o }: { o: Pick<MeterOption, "type" | "reservationTerm" | "tiers"> }) {
  const badge = meterTypeBadge(o.type, o.reservationTerm);
  return (
    <>
      <span
        className={cn(
          "shrink-0 rounded-sm px-1 text-[10px] leading-4 font-semibold",
          badge === "PAYG" ? "bg-muted text-muted-foreground" : "bg-primary/12 text-primary",
        )}
      >
        {badge}
      </span>
      {o.tiers.length > 1 ? (
        <span className="shrink-0 rounded-sm bg-muted px-1 text-[10px] leading-4 font-medium text-muted-foreground">{o.tiers.length} tiers</span>
      ) : null}
    </>
  );
}

export function MeterPicker(props: MeterPickerProps) {
  const { selected, display, loading, unavailableText, missing, money, fieldProps } = props;
  const [open, setOpen] = useState(false);
  const name = selected?.meterName || display.meterName;
  const sub = [selected?.productName ?? display.productName, selected?.skuName ?? display.skuName].filter(Boolean).join(" · ");
  const price = selected ? meterHeadlinePrice(selected) : undefined;
  const disabled = loading || Boolean(unavailableText);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          {...fieldProps}
          disabled={disabled}
          aria-label={`Meter: ${name ? [name, sub].filter(Boolean).join(", ") : unavailableText ?? "none selected"}. Change`}
          data-slot="meter-picker-trigger"
          className={cn(
            "flex h-8 w-full min-w-0 items-center gap-2 rounded-md border border-control-border bg-transparent px-2.5 text-left text-sm shadow-xs transition-colors dark:bg-input/30",
            "hover:bg-accent/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid",
            "disabled:cursor-not-allowed disabled:opacity-60",
            missing && "border-destructive",
          )}
        >
          {name ? (
            <>
              <span className="min-w-0 shrink truncate font-semibold @lg:max-w-[60%] @lg:shrink-0">{name}</span>
              <span className="hidden min-w-0 truncate text-xs text-muted-foreground @lg:inline">{sub}</span>
            </>
          ) : (
            <span className="min-w-0 truncate text-muted-foreground">{unavailableText ?? "Choose a meter"}</span>
          )}
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            {selected && price !== undefined ? (
              <span className="hidden text-xs tabular-nums @md:inline">
                <PriceText usd={price} money={money} unit={selected.type.toLowerCase() !== "reservation"} />{" "}
                <span className="text-muted-foreground">{meterUnitText(selected)}</span>
              </span>
            ) : null}
            <ChevronsUpDown aria-hidden="true" className="size-4 text-muted-foreground" />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="flex w-[min(44rem,calc(100vw-1rem))] flex-col overflow-hidden p-0"
        onOpenAutoFocus={(e) => e.preventDefault() /* MeterList focuses its search box */}
      >
        {open ? (
          <MeterList
            {...props}
            options={props.options ?? []}
            onChoose={(o) => {
              props.onSelect(o);
              setOpen(false);
            }}
          />
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function MeterList({
  options,
  selected,
  money,
  whereLabel,
  onChoose,
}: Omit<MeterPickerProps, "options"> & { options: MeterOption[]; onChoose: (o: MeterOption) => void }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const listboxId = `meter-${uid}-list`;
  const optionId = (i: number) => `meter-${uid}-opt-${i}`;
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<VirtualListHandle>(null);
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const results = useMemo(() => searchMeters(options, deferred), [options, deferred]);
  const [active, setActive] = useState(-1);

  useEffect(() => {
    const current = selected ? results.findIndex((o) => o.key === selected.key) : -1;
    const idx = results.length === 0 ? -1 : deferred.trim() ? 0 : Math.max(0, current);
    setActive(idx);
    if (idx >= 0) listRef.current?.scrollToIndex(idx, deferred.trim() ? "auto" : "center");
  }, [results, selected, deferred]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const next = navigateIndex(e.key, active, results.length, 6, e.ctrlKey || e.metaKey);
    if (next !== null) {
      e.preventDefault();
      setActive(next);
      listRef.current?.scrollToIndex(next);
      return;
    }
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      // The deferred list may lag behind fast typing: resolve against the text in the box.
      const o = query !== deferred ? searchMeters(options, query, 1)[0] : results[active];
      if (o) onChoose(o);
    }
  };

  const renderRow = (o: MeterOption, i: number, style: CSSProperties) => {
    const isActive = i === active;
    const isCurrent = selected?.key === o.key;
    const price = meterHeadlinePrice(o);
    const reservation = o.type.toLowerCase() === "reservation";
    return (
      <div
        key={o.key}
        id={optionId(i)}
        role="option"
        aria-selected={isActive}
        aria-posinset={i + 1}
        aria-setsize={results.length}
        data-meter={o.meterName}
        style={style}
        onMouseMove={() => {
          if (!isActive) setActive(i);
        }}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onChoose(o)}
        className={cn(
          "flex cursor-pointer flex-col justify-center gap-0.5 border-b border-border/50 px-3",
          isActive && "bg-accent text-accent-foreground",
          isCurrent && "shadow-[inset_3px_0_0_var(--primary)]",
        )}
      >
        <div className="flex min-w-0 items-center gap-1.5 text-[13px]">
          <span className={cn("min-w-0 truncate", isCurrent ? "font-semibold" : "font-medium")}>{o.meterName || o.skuName || o.meterId}</span>
          <Badges o={o} />
          <span className="ml-auto shrink-0 pl-2 tabular-nums">
            {price === undefined ? "—" : price === 0 ? <span className="text-success">Free</span> : <PriceText usd={price} money={money} unit={!reservation} />}
          </span>
        </div>
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <span className="min-w-0 truncate">{[o.productName, o.skuName].filter(Boolean).join(" · ")}</span>
          <span className="ml-auto shrink-0 pl-2">{meterUnitText(o)}</span>
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="relative border-b">
        <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 && results[active] ? optionId(active) : undefined}
          aria-label="Search meters"
          placeholder="Search product, SKU or meter…"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          className="h-10 w-full bg-transparent pr-3 pl-9 text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      <VirtualList
        items={results}
        rowHeight={ROW_HEIGHT}
        renderRow={renderRow}
        handleRef={listRef}
        className="max-h-[min(22rem,50dvh)]"
        style={{ height: Math.max(3, results.length) * ROW_HEIGHT }}
        listProps={{ id: listboxId, role: "listbox", "aria-label": "Meters" }}
        empty={<div className="px-4 py-8 text-center text-sm text-muted-foreground">{options.length === 0 ? `No meters in ${whereLabel}.` : "No meter matches the search."}</div>}
      />
      <div className="flex items-center justify-between gap-3 border-t bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
        <span aria-live="polite">
          {results.length.toLocaleString("en-US")} of {options.length.toLocaleString("en-US")} meters · {whereLabel}
        </span>
        <span className="hidden items-center gap-1 sm:flex">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> move <Kbd>Enter</Kbd> select
        </span>
      </div>
    </>
  );
}
