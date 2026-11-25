// Azure Backup configuration: workload, protected instances, average size (fee band), backup
// storage as % of protected data or absolute GB, and vault storage redundancy.
import { useMemo } from "react";
import type { BackupConfig as BackupConfigValues } from "@/domain/model";
import { HOURS_PER_MONTH } from "@/domain/model";
import { backupModule } from "@/domain/pricing";
import { BACKUP_WORKLOAD_LABELS, findBackupStorageTiers, findProtectedInstanceRow } from "@/domain/pricing/backup";
import { monthlyFactor } from "@/domain/units";
import { cn } from "@/lib/utils";
import type { ModuleConfigProps } from "./types";
import { PriceText, ShardsError } from "./shared/data";
import { isLoading, rowsOf } from "./shared/rows";
import { Field, FieldGrid, FormRoot } from "./shared/Field";
import { backupBand, backupStorageGB, fmtInt } from "./shared/logic";
import { NumberField } from "./shared/NumberField";
import { Segmented } from "./shared/Segmented";

const REDUNDANCIES: readonly BackupConfigValues["redundancy"][] = ["LRS", "ZRS", "GRS", "RA-GRS"];

const REDUNDANCY_HINT: Readonly<Record<BackupConfigValues["redundancy"], string>> = {
  LRS: "Locally redundant: 3 copies in one datacenter.",
  ZRS: "Zone-redundant: 3 copies across availability zones.",
  GRS: "Geo-redundant: replicated to the paired region.",
  "RA-GRS": "GRS with Cross Region Restore (read access in the paired region).",
};

const BANDS = [
  { range: "≤ 50 GB", fee: "½ fee" },
  { range: "50–500 GB", fee: "1 fee" },
  { range: "> 500 GB", fee: "1 per 500 GB" },
] as const;

function num(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function BackupConfig({ item, onChange, catalog, shards, money, regionName }: ModuleConfigProps<"backup">) {
  const config = item.config;
  const refs = useMemo(() => backupModule.shards(config, item.region, catalog.services), [config, item.region, catalog.services]);
  const rows = rowsOf(shards, refs[0]);
  const loading = isLoading(shards, rows);

  const feeRow = rows ? findProtectedInstanceRow(rows, config.workload) : undefined;
  const feeUsd = feeRow ? feeRow.retailPrice * monthlyFactor(feeRow.unitOfMeasure, HOURS_PER_MONTH) : undefined;
  const band = backupBand(config.avgInstanceSizeGB);
  const storageGB = backupStorageGB(config);
  const protectedGB = config.instances * config.avgInstanceSizeGB;

  const storageRate = useMemo(() => {
    const out = {} as Record<BackupConfigValues["redundancy"], number | undefined>;
    for (const r of REDUNDANCIES) {
      const tiers = rows ? findBackupStorageTiers(rows, r) : [];
      out[r] = tiers.length > 0 ? tiers[0].retailPrice * monthlyFactor(tiers[0].unitOfMeasure, HOURS_PER_MONTH) : undefined;
    }
    return out;
  }, [rows]);
  const rate = storageRate[config.redundancy];
  const redundancyUnavailable = Boolean(rows) && !loading && rate === undefined;

  const workloadHint = loading ? (
    "Loading prices…"
  ) : feeUsd !== undefined ? (
    <>
      Protected-instance fee <PriceText usd={feeUsd} money={money} per="/month" className="text-foreground" /> (50–500 GB instance).
    </>
  ) : rows && item.region ? (
    <span className="text-destructive">No {BACKUP_WORKLOAD_LABELS[config.workload]} protected-instance price in {regionName}.</span>
  ) : undefined;

  const storageHint =
    config.storageMode === "percent" ? (
      <span data-testid="backup-storage-gb">
        = <span className="font-semibold text-foreground">{num(storageGB)} GB</span> ({fmtInt(config.instances)} × {num(config.avgInstanceSizeGB)} GB ×{" "}
        {num(config.storagePercent)}%)
      </span>
    ) : (
      <span data-testid="backup-storage-gb">
        {protectedGB > 0 ? `${num((storageGB / protectedGB) * 100)}% of ${num(protectedGB)} GB protected` : "Total backup storage"}
      </span>
    );

  return (
    <FormRoot data-module="backup">
      <ShardsError shards={shards} regionName={regionName} />
      <FieldGrid>
        <Field label="Workload" className="@lg:col-span-2" hint={workloadHint}>
          <Segmented
            value={config.workload}
            onValueChange={(workload) => onChange({ workload })}
            options={[
              { value: "azure-vm", label: "Azure VM" },
              { value: "sql-in-azure-vm", label: "SQL Server in Azure VM" },
            ]}
          />
        </Field>
        <Field label="Protected instances">
          <NumberField value={config.instances} onCommit={(instances) => onChange({ instances })} min={0} max={1_000_000} integer suffix="instances" />
        </Field>

        <Field label="Average instance size" hint="Protected data per instance; sets the fee band.">
          <NumberField
            value={config.avgInstanceSizeGB}
            onCommit={(avgInstanceSizeGB) => onChange({ avgInstanceSizeGB })}
            min={0}
            max={1_000_000}
            step={10}
            suffix="GB"
          />
        </Field>
        <div className="flex min-w-0 flex-col gap-1.5 @lg:col-span-1 @3xl:col-span-2">
          <div id={`${item.id}-bands`} className="flex min-h-5 items-end text-[13px] leading-5 font-semibold">
            Instance fee band
          </div>
          <div role="list" aria-labelledby={`${item.id}-bands`} className="grid h-8 grid-cols-3 gap-1">
            {BANDS.map((b, i) => {
              const activeBand = i === band.index;
              return (
                <div
                  key={b.range}
                  role="listitem"
                  title={i === 2 ? "One protected-instance fee per started 500 GB" : undefined}
                  aria-current={activeBand || undefined}
                  className={cn(
                    "flex min-w-0 flex-col justify-center rounded-md border px-2 text-[11px] leading-3.5",
                    activeBand ? "border-primary bg-accent text-accent-foreground" : "border-border text-muted-foreground",
                  )}
                >
                  <span className={cn("truncate", activeBand && "font-semibold")}>{b.range}</span>
                  <span className="truncate">{b.fee}</span>
                </div>
              );
            })}
          </div>
          <p className="text-xs leading-4 text-muted-foreground" data-testid="backup-fee">
            {num(config.avgInstanceSizeGB)} GB → {band.fees === 0.5 ? "½" : num(band.fees)} × fee
            {feeUsd !== undefined ? (
              <>
                {" "}
                = <PriceText usd={feeUsd * band.fees} money={money} per="/month" className="font-semibold text-foreground" /> per instance
              </>
            ) : null}
          </p>
        </div>

        <Field label="Backup storage estimate">
          <Segmented
            value={config.storageMode}
            onValueChange={(storageMode) => onChange({ storageMode })}
            options={[
              { value: "percent", label: "% of data", ariaLabel: "Percent of protected data" },
              { value: "gb", label: "Total GB", ariaLabel: "Absolute GB" },
            ]}
          />
        </Field>
        {config.storageMode === "percent" ? (
          <Field label="Storage (% of protected data)" hint={storageHint}>
            <NumberField value={config.storagePercent} onCommit={(storagePercent) => onChange({ storagePercent })} min={0} max={10_000} step={5} suffix="%" />
          </Field>
        ) : (
          <Field label="Backup storage" hint={storageHint}>
            <NumberField value={config.storageGB} onCommit={(storageGB) => onChange({ storageGB })} min={0} max={100_000_000} step={100} suffix="GB" />
          </Field>
        )}
        <Field
          label="Storage redundancy"
          hint={
            rate !== undefined ? (
              <>
                <PriceText usd={rate} money={money} unit per=" per GB/month" className="text-foreground" /> · {REDUNDANCY_HINT[config.redundancy]}
              </>
            ) : redundancyUnavailable ? undefined : (
              REDUNDANCY_HINT[config.redundancy]
            )
          }
          error={redundancyUnavailable ? `${config.redundancy} backup storage is not available in ${regionName}.` : undefined}
        >
          <Segmented
            value={config.redundancy}
            onValueChange={(redundancy) => onChange({ redundancy })}
            options={REDUNDANCIES.map((r) => ({
              value: r,
              label: r,
              title: REDUNDANCY_HINT[r],
              disabled: Boolean(rows) && !loading && storageRate[r] === undefined && r !== config.redundancy,
            }))}
          />
        </Field>
      </FieldGrid>
    </FormRoot>
  );
}
