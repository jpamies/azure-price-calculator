// Virtual Machines configuration: OS, VM size (picker dialog), instances, hours, commitment with
// savings vs pay-as-you-go, reservation payment and Spot (advanced).
import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { CommitmentId, VmConfig as VmConfigValues } from "@/domain/model";
import { vmModule } from "@/domain/pricing";
import { SERVICE_MATCHERS, resolveServiceName, serviceByName } from "@/domain/serviceMatch";
import { buildVmCatalog, findVmOption, vmSkuLabel } from "@/domain/vmCatalog";
import { refKey } from "@/domain/types";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { ModuleConfigProps } from "./types";
import { PriceText, SelectorSkeleton, ShardsError } from "./shared/data";
import { isLoading, rowsOf } from "./shared/rows";
import { Field, FieldGrid, FormRoot } from "./shared/Field";
import { HoursField } from "./shared/HoursField";
import { formatSavings, vmCommitmentSavings, vmPriceSummary } from "./shared/logic";
import { NumberField } from "./shared/NumberField";
import { RichSelect, SavingsChip, type RichOption } from "./shared/RichSelect";
import { Segmented } from "./shared/Segmented";
import { VmSkuPicker } from "./pickers/VmSkuPicker";

const OS_OPTIONS = [
  { value: "linux", label: "Linux" },
  { value: "windows", label: "Windows" },
  {
    value: "windows-ahb",
    label: (
      <>
        <span className="@min-[17rem]:hidden">Win + AHB</span>
        <span className="hidden @min-[17rem]:inline">Windows + AHB</span>
      </>
    ),
    ariaLabel: "Windows with Azure Hybrid Benefit",
    title: "Windows with Azure Hybrid Benefit",
  },
] as const;

const OS_HINTS: Record<VmConfigValues["os"], string> = {
  linux: "Compute only, no OS license.",
  windows: "Windows Server license included, billed pay-as-you-go.",
  "windows-ahb": "Azure Hybrid Benefit: your Windows Server licenses (with SA) cover the OS; priced at the Linux rate.",
};

const COMMITMENT_TEXT: Readonly<Record<CommitmentId, string>> = {
  payg: "Pay as you go",
  ri1y: "1-year reserved",
  ri3y: "3-year reserved",
  sp1y: "1-year savings plan",
  sp3y: "3-year savings plan",
};

const ALL_COMMITMENTS: readonly CommitmentId[] = ["payg", "ri1y", "ri3y", "sp1y", "sp3y"];

export function VmConfig({ item, onChange, catalog, shards, money, regionName, settings }: ModuleConfigProps<"vm">) {
  const config = item.config;
  const region = item.region;
  const services = catalog.services;
  const refs = useMemo(() => vmModule.shards(config, region, services), [config, region, services]);
  const mainRef = refs.find((r) => !r.spot);
  const spotRef = refs.find((r) => r.spot);
  const mainRows = rowsOf(shards, mainRef);
  const spotRows = spotRef ? shards.data[refKey(spotRef)] : undefined;
  const options = useMemo(
    () => (mainRows ? buildVmCatalog(mainRows, catalog.vmSpecs, spotRows) : undefined),
    [mainRows, catalog.vmSpecs, spotRows],
  );
  const selected = useMemo(
    () => (options && config.armSkuName.trim() ? findVmOption(options, config.armSkuName) : undefined),
    [options, config.armSkuName],
  );
  const loading = isLoading(shards, mainRows);
  const vmService = serviceByName(services, resolveServiceName(services, SERVICE_MATCHERS.vm) ?? "Virtual Machines");
  const regionHasVms = Boolean(region) && (!vmService || vmService.regions.includes(region));

  const hasSavingsPlan = catalog.manifest.hasSavingsPlan;
  const commitments = ALL_COMMITMENTS.filter((c) => hasSavingsPlan || !c.startsWith("sp") || c === config.commitment);
  const savings = vmCommitmentSavings(selected, { os: config.os, hoursPerMonth: config.hoursPerMonth }, commitments);
  const summary = selected ? vmPriceSummary(selected, config) : null;
  const isRi = config.commitment === "ri1y" || config.commitment === "ri3y";
  const spotActive = config.spot && config.commitment === "payg";
  const skuLabel = selected?.label ?? (config.armSkuName.trim() ? vmSkuLabel(config.armSkuName) : "");
  const missingSku = Boolean(config.armSkuName.trim()) && options !== undefined && !loading && !selected;
  const defaultHours = settings.hoursPerMonth;

  const [advancedOpen, setAdvancedOpen] = useState(config.spot);

  const unavailableText = !region
    ? "Choose a region first"
    : shards.status === "error" && !mainRows
      ? "Prices unavailable"
      : !regionHasVms
        ? `No VM prices in ${regionName}`
        : undefined;

  const commitmentOptions: RichOption<CommitmentId>[] = commitments.map((c) => {
    const info = savings[c];
    const unavailable = Boolean(selected) && info.monthlyUsd === null;
    const spDisabled = c.startsWith("sp") && !hasSavingsPlan;
    return {
      value: c,
      label: COMMITMENT_TEXT[c],
      textValue: COMMITMENT_TEXT[c],
      disabled: (unavailable || spDisabled) && c !== config.commitment,
      description: spDisabled
        ? "Not in this price snapshot"
        : unavailable
          ? `Not available for ${skuLabel} in ${regionName}`
          : c === "payg"
            ? "No commitment"
            : `${c.startsWith("ri") ? "Reserved instance" : "Compute savings plan"}, ${c.endsWith("1y") ? "1" : "3"}-year term`,
      aside:
        info.monthlyUsd !== null ? (
          <>
            <PriceText usd={info.monthlyUsd} money={money} per="/mo" className="text-muted-foreground" />
            <SavingsChip fraction={info.savings} text={formatSavings(info.savings)} />
          </>
        ) : null,
    };
  });

  const current = savings[config.commitment];
  const commitmentHint = (() => {
    if (!selected) return undefined;
    if (current.monthlyUsd === null) return `Not available for ${skuLabel} in ${regionName}.`;
    if (config.commitment === "payg") return spotActive ? "Spot pricing applies (see Advanced)." : "No commitment; billed per hour of use.";
    const pct = current.savings === null ? "" : Math.round(Math.abs(current.savings) * 100);
    const vs = current.savings !== null && current.savings < 0 ? `${pct}% more than` : `Saves ${pct}% vs`;
    const basis = `${config.hoursPerMonth.toLocaleString("en-US")} h, ${config.os === "linux" ? "Linux" : config.os === "windows" ? "Windows" : "AHB"}`;
    return `${vs} pay as you go (${basis}).${config.os === "windows" ? " Windows license stays pay-as-you-go." : ""}`;
  })();

  const priceHint = (() => {
    if (loading || !selected) return undefined;
    if (!summary) return <span className="text-destructive">No {spotActive ? "Spot " : ""}price for this OS and commitment.</span>;
    return (
      <span data-testid="vm-price-hint">
        {isRi ? "≈ " : ""}
        <PriceText usd={summary.hourlyUsd} money={money} unit per="/hour" className="font-medium text-foreground" />
        {" · "}
        <PriceText usd={summary.monthlyUsd} money={money} per="/month" className="font-medium text-foreground" /> per VM
        {summary.licenseMonthlyUsd ? <> (incl. {money.format(summary.licenseMonthlyUsd)} Windows license)</> : null}
      </span>
    );
  })();

  const paymentHint = (() => {
    if (!isRi || !summary?.termTotalUsd || !summary.termMonths) return undefined;
    const total = summary.termTotalUsd;
    return config.riPayment === "upfront"
      ? `${money.format(total)} per VM paid once for ${summary.termMonths} months (compute).`
      : `${money.format(total)} per VM spread as ${money.format(total / summary.termMonths)}/month over ${summary.termMonths} months.`;
  })();

  const hoursHint = isRi
    ? config.os === "windows"
      ? "Reservations bill every hour of the term; hours only change the Windows license."
      : "Reservations bill every hour of the term; hours are not applied."
    : undefined;

  const spotPrice = selected ? (config.os === "windows" ? selected.spotWindowsHourUsd : selected.spotLinuxHourUsd) : undefined;
  const paygRate = selected ? (config.os === "windows" ? selected.windowsHourUsd : selected.linuxHourUsd) : undefined;
  const spotLoading = spotActive && Boolean(spotRef) && spotRows === undefined && shards.status === "loading";

  return (
    <FormRoot data-module="vm">
      <ShardsError shards={shards} regionName={regionName} />
      <FieldGrid>
        <Field label="Operating system" hint={OS_HINTS[config.os]}>
          <Segmented value={config.os} onValueChange={(os) => onChange({ os })} options={OS_OPTIONS} />
        </Field>
        <Field
          label="VM size"
          className="@3xl:col-span-2"
          hint={priceHint}
          error={missingSku ? `${skuLabel} is not offered in ${regionName}. Choose another size or region.` : undefined}
        >
          {(fieldProps) =>
            loading ? (
              <SelectorSkeleton label="Loading VM sizes…" />
            ) : (
              <VmSkuPicker
                fieldProps={fieldProps}
                config={config}
                options={options}
                selected={selected}
                loading={loading}
                unavailableText={unavailableText}
                money={money}
                regionName={regionName}
                hasSavingsPlan={hasSavingsPlan}
                showSpot={spotActive && Boolean(spotRows && spotRows.length > 0)}
                onSelect={(armSkuName) => onChange({ armSkuName })}
              />
            )
          }
        </Field>
        <Field label="Instances">
          <NumberField value={config.instances} onCommit={(instances) => onChange({ instances })} min={0} max={1_000_000} integer suffix="VMs" />
        </Field>
        <HoursField
          value={config.hoursPerMonth}
          onCommit={(hoursPerMonth) => onChange({ hoursPerMonth })}
          defaultHours={defaultHours}
          hint={hoursHint}
        />
        <Field label="Savings options" hint={commitmentHint}>
          {loading ? (
            <SelectorSkeleton label="Loading commitment prices…" />
          ) : (
            <RichSelect
              value={config.commitment}
              onValueChange={(commitment) => onChange({ commitment })}
              options={commitmentOptions}
              contentClassName="min-w-[22rem]"
              triggerAside={<SavingsChip fraction={current.savings} text={formatSavings(current.savings)} />}
            />
          )}
        </Field>
        {isRi ? (
          <Field label="Reservation payment" hint={paymentHint}>
            <Segmented
              value={config.riPayment}
              onValueChange={(riPayment) => onChange({ riPayment })}
              options={[
                { value: "monthly", label: "Monthly" },
                { value: "upfront", label: "Upfront" },
              ]}
            />
          </Field>
        ) : null}
      </FieldGrid>

      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CollapsibleTrigger
          className="group flex items-center gap-1 rounded-sm text-[13px] font-semibold text-foreground hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid"
          aria-label={`Advanced options${config.spot ? " (Spot on)" : ""}`}
        >
          <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
          Advanced
          {config.spot ? (
            <span className={cn("ml-1.5 rounded-sm px-1.5 py-px text-[11px] font-semibold", spotActive ? "bg-primary/12 text-primary" : "bg-muted text-muted-foreground")}>
              Spot{spotActive ? "" : " (ignored)"}
            </span>
          ) : null}
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-3">
          <div className="flex items-start gap-3 rounded-md border bg-muted/30 px-3 py-2.5">
            <Switch
              id={`${item.id}-spot`}
              checked={config.spot}
              disabled={config.commitment !== "payg" && !config.spot}
              onCheckedChange={(spot) => onChange({ spot })}
              aria-describedby={`${item.id}-spot-hint`}
              className="mt-0.5"
            />
            <div className="min-w-0 space-y-1">
              <label htmlFor={`${item.id}-spot`} className="text-[13px] font-semibold">
                Spot pricing
              </label>
              <p id={`${item.id}-spot-hint`} className="text-xs leading-5 text-muted-foreground">
                Spot VMs run on spare Azure capacity at a deep discount, but Azure can evict them at any time (30-second notice)
                when it needs the capacity back. Use only for interruptible workloads such as batch, CI/CD or dev/test; no SLA.
                {config.commitment !== "payg" ? (
                  <span className="block text-warning">
                    {config.spot
                      ? `Spot applies to pay as you go only; it is ignored with ${COMMITMENT_TEXT[config.commitment]}.`
                      : "Available with pay as you go only."}
                  </span>
                ) : null}
              </p>
              {spotActive ? (
                <p className="text-xs" aria-live="polite">
                  {spotLoading ? (
                    <span className="text-muted-foreground">Loading Spot prices…</span>
                  ) : !spotRef ? (
                    <span className="text-warning">No Spot prices in {regionName} in this snapshot.</span>
                  ) : spotPrice !== undefined ? (
                    <>
                      Spot <PriceText usd={spotPrice} money={money} unit per="/hour" className="font-semibold" />
                      {paygRate ? (
                        <>
                          {" "}
                          <SavingsChip fraction={1 - spotPrice / paygRate} text={formatSavings(1 - spotPrice / paygRate)} className="ml-1" /> vs pay as you go
                        </>
                      ) : null}
                    </>
                  ) : selected ? (
                    <span className="text-warning">No Spot price for {skuLabel} ({config.os === "windows" ? "Windows" : "Linux"}) in {regionName}.</span>
                  ) : null}
                </p>
              ) : null}
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </FormRoot>
  );
}
