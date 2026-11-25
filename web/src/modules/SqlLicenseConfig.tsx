// SQL Server license (on VMs): edition, vCPUs per VM (min 4 billed), VMs, hours, Azure Hybrid Benefit.
import { useMemo } from "react";
import { Info } from "lucide-react";
import type { SqlLicenseConfig as SqlLicenseConfigValues } from "@/domain/model";
import { sqlLicenseModule } from "@/domain/pricing";
import { SQL_EDITION_LABELS, SQL_MIN_VCPUS, resolveSqlLicense, sqlLicenseServiceNames, type SqlLicenseResolution } from "@/domain/pricing/sqlLicense";
import { refKey } from "@/domain/types";
import { parseUnit } from "@/domain/units";
import { Switch } from "@/components/ui/switch";
import type { ModuleConfigProps } from "./types";
import { PriceText, ShardsError } from "./shared/data";
import { Field, FieldGrid, FormRoot, Note } from "./shared/Field";
import { HoursField } from "./shared/HoursField";
import { NumberField } from "./shared/NumberField";
import { Segmented } from "./shared/Segmented";

const EDITIONS: readonly SqlLicenseConfigValues["edition"][] = ["standard", "enterprise", "web"];

const EDITION_HINT: Readonly<Record<SqlLicenseConfigValues["edition"], string>> = {
  standard: "Core database features for departmental and mid-size workloads.",
  enterprise: "Mission-critical features, unlimited virtualization and performance.",
  web: "Only for public, Internet-accessible web workloads (SPLA terms).",
};

export function SqlLicenseConfig({ item, onChange, catalog, shards, money, regionName, settings }: ModuleConfigProps<"sqlLicense">) {
  const config = item.config;
  const services = catalog.services;
  const refs = useMemo(() => sqlLicenseModule.shards(config, item.region, services), [config, item.region, services]);
  const pending = refs.some((r) => shards.data[refKey(r)] === undefined);
  const loading = pending && shards.status !== "error";
  const billable = Math.max(SQL_MIN_VCPUS, Math.ceil(config.vCPUs));

  // Same resolution as pricing/sqlLicense.ts: region rows first, then the global price list.
  const resolution = useMemo((): SqlLicenseResolution | null => {
    if (pending) return null;
    const rows = (serviceName: string, regionKey: string) => shards.data[refKey({ serviceName, regionKey })] ?? [];
    for (const serviceName of sqlLicenseServiceNames(services)) {
      const res =
        (item.region && item.region !== "_global" ? resolveSqlLicense(rows(serviceName, item.region), config.edition, config.vCPUs) : null) ??
        resolveSqlLicense(rows(serviceName, "_global"), config.edition, config.vCPUs);
      if (res) return res;
    }
    return null;
  }, [pending, shards.data, services, item.region, config.edition, config.vCPUs]);

  const perVmHour = (() => {
    if (!resolution) return undefined;
    const row = resolution.meter.row;
    const unit = parseUnit(row.unitOfMeasure);
    if (unit.per !== "hour" && row.unitOfMeasure.trim() !== "") return undefined;
    return (row.retailPrice / unit.packSize) * resolution.scale;
  })();

  const priceHint = loading ? (
    "Loading prices…"
  ) : perVmHour !== undefined ? (
    <span data-testid="sql-price-hint">
      {config.ahb ? "Covered by AHB (license-included price " : ""}
      <PriceText usd={perVmHour} money={money} unit per="/hour" className={config.ahb ? "" : "font-medium text-foreground"} />
      {" · "}
      <PriceText usd={perVmHour * config.hoursPerMonth} money={money} per="/month" className={config.ahb ? "" : "font-medium text-foreground"} /> per VM
      {config.ahb ? ")" : ""}
    </span>
  ) : item.region ? (
    <span className="text-destructive">No SQL Server {SQL_EDITION_LABELS[config.edition]} license price in {regionName} or in the global list.</span>
  ) : undefined;

  return (
    <FormRoot data-module="sqlLicense">
      <ShardsError shards={shards} regionName={regionName} />
      <FieldGrid>
        <Field label="Edition" hint={EDITION_HINT[config.edition]}>
          <Segmented
            value={config.edition}
            onValueChange={(edition) => onChange({ edition })}
            options={EDITIONS.map((e) => ({ value: e, label: SQL_EDITION_LABELS[e] }))}
          />
        </Field>
        <Field
          label="vCPUs per VM"
          hint={config.vCPUs < SQL_MIN_VCPUS ? undefined : "Billed per vCPU, minimum 4 per VM."}
          warning={config.vCPUs < SQL_MIN_VCPUS ? `Billed as ${billable} vCPUs (minimum 4 per VM).` : undefined}
        >
          <NumberField value={config.vCPUs} onCommit={(vCPUs) => onChange({ vCPUs })} min={1} max={1024} integer suffix="vCPU" />
        </Field>
        <Field label="Virtual machines">
          <NumberField value={config.vms} onCommit={(vms) => onChange({ vms })} min={0} max={1_000_000} integer suffix="VMs" />
        </Field>
        <HoursField value={config.hoursPerMonth} onCommit={(hoursPerMonth) => onChange({ hoursPerMonth })} defaultHours={settings.hoursPerMonth} />
        <Field label="Azure Hybrid Benefit" className="@3xl:col-span-2" hint={priceHint}>
          {(fieldProps) => (
            <div className="flex h-8 items-center gap-2.5">
              <Switch id={fieldProps.id} aria-describedby={fieldProps["aria-describedby"]} checked={config.ahb} onCheckedChange={(ahb) => onChange({ ahb })} />
              <span className="text-[13px] text-foreground/90">
                {config.ahb ? "On: existing SQL Server licenses with Software Assurance; license billed at 0" : "Off: license-included pricing"}
              </span>
            </div>
          )}
        </Field>
      </FieldGrid>
      <Note icon={<Info />}>
        <p>License only: add a Virtual Machines item (Linux or Windows) for the compute. Billed per vCPU-hour with a 4-vCPU minimum per VM.</p>
      </Note>
    </FormRoot>
  );
}
