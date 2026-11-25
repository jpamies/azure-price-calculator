// "Any service" (generic meter): service, global meters, meter, quantity in the meter's unit
// semantics, hours for time-based units and the marginal tier table.
import { useMemo } from "react";
import type { GenericConfig as GenericConfigValues } from "@/domain/model";
import { findMeterOption, listMeters, type MeterOption } from "@/domain/meters";
import { formatNumber } from "@/domain/money";
import { genericModule } from "@/domain/pricing";
import { meterMonthlyUsd } from "@/domain/pricing/generic";
import { serviceByName } from "@/domain/serviceMatch";
import { freeAllowance, tieredBreakdown } from "@/domain/tiered";
import type { ServiceInfo } from "@/domain/types";
import { billingUnitLabel, monthlyFactor, parseUnit } from "@/domain/units";
import type { MoneyFormatter } from "@/lib/format";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { ModuleConfigProps } from "./types";
import { MeterPicker } from "./pickers/MeterPicker";
import { ServiceCombobox } from "./pickers/ServiceCombobox";
import { PriceText, SelectorSkeleton, ShardsError } from "./shared/data";
import { isLoading, rowsOf } from "./shared/rows";
import { Field, FieldGrid, FormRoot } from "./shared/Field";
import { HoursField } from "./shared/HoursField";
import { meterHeadlinePrice, meterTypeBadge, meterUnitText, quantitySemantics } from "./shared/logic";
import { NumberField } from "./shared/NumberField";

const GLOBAL_LABEL = "Global (no region)";

const RESET_METER: Partial<GenericConfigValues> = {
  meterId: "",
  type: "Consumption",
  reservationTerm: "",
  productName: "",
  skuName: "",
  meterName: "",
  unitOfMeasure: "",
};

function TierTable({ option, quantity, hours, money }: { option: MeterOption; quantity: number; hours: number; money: MoneyFormatter }) {
  const unit = parseUnit(option.unitOfMeasure);
  const billable = quantity * monthlyFactor(unit, hours);
  const bands = tieredBreakdown(option.tiers, billable);
  const free = freeAllowance(option.tiers);
  const unitLabel = billingUnitLabel(unit);
  const total = bands.reduce((s, b) => s + b.cost, 0);
  const cell = "px-2 py-1 text-right whitespace-nowrap tabular-nums @lg:px-2.5";
  return (
    <div className="overflow-x-auto rounded-md border" data-testid="tier-table">
      <table className="w-full text-xs">
        <caption className="sr-only">Marginal price tiers for {option.meterName}</caption>
        <thead className="bg-muted/60 text-muted-foreground">
          <tr>
            <th scope="col" className="px-2 py-1.5 text-left font-semibold whitespace-nowrap @lg:px-2.5">
              Tier ({unitLabel}/month)
            </th>
            <th scope="col" className={cn(cell, "font-semibold")}>
              Price <span className="hidden font-normal @lg:inline">per {unitLabel || "unit"}</span>
            </th>
            <th scope="col" className={cn(cell, "font-semibold")}>
              Usage
            </th>
            <th scope="col" className={cn(cell, "font-semibold")}>
              Cost
            </th>
          </tr>
        </thead>
        <tbody>
          {free > 0 ? (
            <tr className={cn("border-t", billable > 0 ? "" : "text-muted-foreground")}>
              <td className="px-2 py-1 whitespace-nowrap tabular-nums @lg:px-2.5">0 – {formatNumber(free)}</td>
              <td className={cn(cell, "text-success")}>Free</td>
              <td className={cell}>{billable > 0 ? formatNumber(Math.min(billable, free)) : "—"}</td>
              <td className={cell}>{billable > 0 ? money.format(0) : "—"}</td>
            </tr>
          ) : null}
          {bands.map((b) => {
            const used = b.units > 0;
            return (
              <tr key={b.from} className={cn("border-t", used ? "bg-accent/40 font-medium" : "text-muted-foreground")}>
                <td className="px-2 py-1 whitespace-nowrap tabular-nums @lg:px-2.5">
                  {formatNumber(b.from)} – {b.to === null ? "∞" : formatNumber(b.to)}
                </td>
                <td className={cn(cell, b.price === 0 && "text-success")}>{b.price === 0 ? "Free" : money.unit(b.price)}</td>
                <td className={cell}>{used ? formatNumber(b.units) : "—"}</td>
                <td className={cell}>{used ? money.format(b.cost) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot className="border-t bg-muted/40">
          <tr>
            <td colSpan={3} className="px-2 py-1.5 font-medium @lg:px-2.5">
              {formatNumber(billable)} {unitLabel} per month
            </td>
            <td className={cn(cell, "py-1.5 font-semibold")}>{money.format(total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export function GenericConfig({ item, onChange, catalog, shards, money, regionName, settings }: ModuleConfigProps<"generic">) {
  const config = item.config;
  const services = catalog.services;
  const svc = config.serviceName.trim() ? serviceByName(services, config.serviceName) : undefined;
  const hasGlobal = Boolean(svc?.regions.includes("_global"));
  const hasRegion = Boolean(svc && item.region && svc.regions.includes(item.region));
  const onlyGlobal = Boolean(svc) && hasGlobal && svc!.regions.every((r) => r === "_global");
  const whereLabel = config.useGlobalRegion ? GLOBAL_LABEL : regionName;

  const refs = useMemo(() => genericModule.shards(config, item.region, services), [config, item.region, services]);
  const rows = rowsOf(shards, refs[0]);
  const loading = refs.length > 0 && isLoading(shards, rows);
  const options = useMemo(() => (rows && refs.length > 0 ? listMeters(rows) : refs.length === 0 ? [] : undefined), [rows, refs.length]);
  const selected = useMemo(() => (rows && config.meterId.trim() ? findMeterOption(rows, config) : undefined), [rows, config]);
  const missingMeter = Boolean(config.meterId.trim()) && Boolean(rows) && refs.length > 0 && !loading && !selected;

  const unitOfMeasure = selected?.unitOfMeasure ?? config.unitOfMeasure;
  const type = selected?.type ?? config.type;
  const semantics = quantitySemantics(unitOfMeasure, type || "Consumption");
  const hasMeter = Boolean(config.meterId.trim());

  const selectService = (s: ServiceInfo) => {
    if (s.serviceName === config.serviceName) return;
    const inRegion = Boolean(item.region) && s.regions.includes(item.region);
    onChange({ ...RESET_METER, quantity: 1, serviceName: s.serviceName, useGlobalRegion: !inRegion && s.regions.includes("_global") });
  };

  const unavailableText = !config.serviceName.trim()
    ? "Choose a service first"
    : !config.useGlobalRegion && !item.region
      ? "Choose a region first"
      : refs.length === 0
        ? `No ${config.serviceName} prices in ${whereLabel}${hasGlobal && !config.useGlobalRegion ? " (try global meters)" : ""}`
        : shards.status === "error" && !rows
          ? "Prices unavailable"
          : undefined;

  const monthly = selected ? meterMonthlyUsd(selected, config.quantity, config.hoursPerMonth) : null;
  const headline = selected ? meterHeadlinePrice(selected) : undefined;
  const tiered = Boolean(selected) && selected!.type.toLowerCase() !== "reservation" && (selected!.tiers.length > 1 || freeAllowance(selected!.tiers) > 0);
  const quantityHint = selected ? (
    <span data-testid="generic-quantity-hint">
      {headline === 0 ? "Free" : <PriceText usd={headline} money={money} unit={selected.type.toLowerCase() !== "reservation"} className="text-foreground" />}{" "}
      {meterUnitText(selected)}
      {tiered ? " · tiered (see below)" : ""}
      {monthly !== null ? (
        <span className="whitespace-nowrap">
          {" · ≈ "}
          <PriceText usd={monthly} money={money} per="/month" className="font-medium text-foreground" />
        </span>
      ) : null}
    </span>
  ) : hasMeter ? undefined : (
    "Choose a meter to see its unit."
  );

  return (
    <FormRoot data-module="generic">
      <ShardsError shards={shards} regionName={whereLabel} />
      <FieldGrid>
        <Field label="Service" className="@3xl:col-span-2" hint={svc ? `${svc.serviceFamily} · ${svc.regions.filter((r) => r !== "_global").length} regions${hasGlobal ? " + global" : ""}` : undefined}>
          {(fieldProps) => (
            <ServiceCombobox
              fieldProps={fieldProps}
              services={services}
              value={config.serviceName}
              region={item.region}
              regionName={regionName}
              onSelect={selectService}
            />
          )}
        </Field>
        {hasGlobal ? (
          <Field
            label="Use global meters"
            hint={
              onlyGlobal
                ? "This service is only priced globally."
                : !hasRegion
                  ? `Not priced in ${regionName || "this region"}; uses the global price list.`
                  : "Meters without a region (global price list)."
            }
          >
            {(fieldProps) => (
              <div className="flex h-8 items-center gap-2.5">
                <Switch
                  id={fieldProps.id}
                  aria-describedby={fieldProps["aria-describedby"]}
                  checked={config.useGlobalRegion}
                  disabled={(onlyGlobal || !hasRegion) && config.useGlobalRegion}
                  onCheckedChange={(useGlobalRegion) => onChange({ ...RESET_METER, useGlobalRegion })}
                />
                <span className="truncate text-[13px] text-foreground/90">{config.useGlobalRegion ? GLOBAL_LABEL : regionName || "Item region"}</span>
              </div>
            )}
          </Field>
        ) : null}
        <Field
          label="Meter"
          className="col-span-full"
          error={missingMeter ? `"${config.meterName || config.meterId}" is not in the ${whereLabel} price list. Choose another meter.` : undefined}
          hint={
            selected
              ? [
                  `Unit "${selected.unitOfMeasure}"`,
                  meterTypeBadge(selected.type, selected.reservationTerm),
                  selected.tiers.length > 1 ? `${selected.tiers.length} tiers` : "",
                  selected.armSkuName,
                  selected.effectiveStartDate ? `effective ${selected.effectiveStartDate}` : "",
                ]
                  .filter(Boolean)
                  .join(" · ")
              : undefined
          }
        >
          {(fieldProps) =>
            loading ? (
              <SelectorSkeleton label="Loading meters…" />
            ) : (
              <MeterPicker
                fieldProps={fieldProps}
                options={options}
                selected={selected}
                display={config}
                loading={loading}
                unavailableText={unavailableText}
                missing={missingMeter}
                money={money}
                whereLabel={whereLabel}
                onSelect={(o) => {
                  // A quantity only carries over between meters billed in the same unit.
                  const sameUnit = hasMeter && quantitySemantics(o.unitOfMeasure, o.type).label === semantics.label;
                  onChange({
                    meterId: o.meterId,
                    type: o.type,
                    reservationTerm: o.reservationTerm,
                    productName: o.productName,
                    skuName: o.skuName,
                    meterName: o.meterName,
                    unitOfMeasure: o.unitOfMeasure,
                    ...(sameUnit ? {} : { quantity: 1 }),
                  });
                }}
              />
            )
          }
        </Field>
        <Field label={hasMeter ? semantics.label : "Quantity"} hint={quantityHint}>
          <NumberField
            value={config.quantity}
            onCommit={(quantity) => onChange({ quantity })}
            min={0}
            max={1e12}
            step={semantics.timeBased || type.toLowerCase() === "reservation" ? 1 : 10}
            suffix={semantics.suffix || undefined}
          />
        </Field>
        {hasMeter && semantics.timeBased ? (
          <HoursField value={config.hoursPerMonth} onCommit={(hoursPerMonth) => onChange({ hoursPerMonth })} defaultHours={settings.hoursPerMonth} />
        ) : null}
      </FieldGrid>
      {selected && tiered ? <TierTable option={selected} quantity={config.quantity} hours={config.hoursPerMonth} money={money} /> : null}
    </FormRoot>
  );
}
