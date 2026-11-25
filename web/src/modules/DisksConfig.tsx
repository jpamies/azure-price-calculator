// Managed Disks configuration: type, redundancy, count; P/E/S by tier or by size; Premium SSD v2 /
// Ultra by size + IOPS + MB/s with included baseline and per-disk limits.
import { useMemo } from "react";
import { Info } from "lucide-react";
import type { DisksConfig as DisksConfigValues, DiskType } from "@/domain/model";
import { disksModule } from "@/domain/pricing";
import {
  DISK_TYPE_LABELS,
  PREMIUM_V2_FREE_IOPS,
  PREMIUM_V2_FREE_MBPS,
  diskRedundancies,
  diskTierOptions,
  diskTierPrefix,
  provisionedDiskRows,
  ultraBillableSizeGiB,
  type DiskTierOption,
} from "@/domain/diskCatalog";
import { pickPreferredRow } from "@/domain/effective";
import { HOURS_PER_MONTH } from "@/domain/model";
import { pickTierForSize, tierSizeGB } from "@/domain/tiers";
import { monthlyFactor } from "@/domain/units";
import type { ModuleConfigProps } from "./types";
import { PriceText, SelectorSkeleton, ShardsError } from "./shared/data";
import { isLoading, rowsOf } from "./shared/rows";
import { Field, FieldGrid, FormRoot, Note } from "./shared/Field";
import {
  PREMIUM_V2_LIMITS,
  TIERED_DISK_MAX_GIB,
  ULTRA_LIMITS,
  diskTypeChangePatch,
  equivalentTier,
  fmtInt,
  formatGiB,
  premiumV2MaxIops,
  premiumV2MaxMbps,
  provisionedDiskWarnings,
  tierPerformance,
  ultraMaxIops,
  ultraMaxMbps,
} from "./shared/logic";
import { NumberField } from "./shared/NumberField";
import { RichSelect, type RichOption } from "./shared/RichSelect";
import { Segmented } from "./shared/Segmented";

const TYPE_INFO: Readonly<Record<DiskType, { description: string; maxIops: string }>> = {
  "standard-hdd": { description: "Backup, non-critical and infrequently accessed workloads", maxIops: "≤ 2,000 IOPS" },
  "standard-ssd": { description: "Web servers, lightly used apps, dev/test", maxIops: "≤ 6,000 IOPS" },
  "premium-ssd": { description: "Production workloads that need low latency", maxIops: "≤ 20,000 IOPS" },
  "premium-ssd-v2": { description: "Sub-ms latency; size, IOPS and MB/s set independently (data disks)", maxIops: "≤ 80,000 IOPS" },
  ultra: { description: "Top-tier databases, SAP HANA, transaction-heavy (data disks)", maxIops: "≤ 400,000 IOPS" },
};

const DISK_TYPES: readonly DiskType[] = ["standard-hdd", "standard-ssd", "premium-ssd", "premium-ssd-v2", "ultra"];

const REDUNDANCY_HINT = {
  LRS: "Locally redundant: 3 copies in one datacenter.",
  ZRS: "Zone-redundant: 3 copies across availability zones.",
} as const;

function TierLabel({ tier, sizeGB }: { tier: string; sizeGB: number | null }) {
  return (
    <span>
      <span className="font-semibold">{tier}</span>
      {sizeGB !== null ? <span className="text-muted-foreground"> · {formatGiB(sizeGB)}</span> : null}
    </span>
  );
}

export function DisksConfig({ item, onChange, catalog, shards, money, regionName }: ModuleConfigProps<"disks">) {
  const config = item.config;
  const refs = useMemo(() => disksModule.shards(config, item.region, catalog.services), [config, item.region, catalog.services]);
  const rows = rowsOf(shards, refs[0]);
  const loading = isLoading(shards, rows);
  const prefix = diskTierPrefix(config.diskType);
  const tiered = prefix !== null;
  const ultra = config.diskType === "ultra";
  const typeLabel = DISK_TYPE_LABELS[config.diskType];

  const tierOptions: DiskTierOption[] = rows && tiered ? diskTierOptions(rows, config.diskType, config.redundancy) : [];
  const availableTiers = tierOptions.map((o) => o.tier);
  const redundancies = rows ? diskRedundancies(rows, config.diskType) : null;
  const noData = Boolean(rows) && redundancies !== null && redundancies.length === 0;

  const changeType = (next: DiskType) => {
    if (next === config.diskType) return;
    const nextRedundancy = next === "standard-hdd" || next === "ultra" ? "LRS" : config.redundancy;
    const available = rows ? diskTierOptions(rows, next, nextRedundancy).map((o) => o.tier) : undefined;
    onChange(diskTypeChangePatch(config, next, diskTierPrefix, available));
  };

  const changeSizing = (mode: DisksConfigValues["sizingMode"]) => {
    if (mode === config.sizingMode || !prefix) return;
    if (mode === "size") onChange({ sizingMode: "size", sizeGB: tierSizeGB(config.tier) ?? config.sizeGB });
    else onChange({ sizingMode: "tier", tier: equivalentTier(prefix, Math.min(config.sizeGB, TIERED_DISK_MAX_GIB), availableTiers) });
  };

  const typeOptions: RichOption<DiskType>[] = DISK_TYPES.map((t) => ({
    value: t,
    label: DISK_TYPE_LABELS[t],
    textValue: DISK_TYPE_LABELS[t],
    description: TYPE_INFO[t].description,
    aside: <span className="text-muted-foreground">{TYPE_INFO[t].maxIops}</span>,
  }));

  const currentTier = config.tier.trim().toUpperCase();
  const tierChoice = tierOptions.find((o) => o.tier === currentTier);
  const tierSelectOptions: RichOption<string>[] = tierOptions.map((o) => ({
    value: o.tier,
    label: <TierLabel tier={o.tier} sizeGB={o.sizeGB} />,
    textValue: o.tier,
    description: tierPerformance(o.tier),
    aside: <PriceText usd={o.monthlyUsd} money={money} per="/mo" />,
  }));
  if (tiered && currentTier && !tierChoice) {
    const size = tierSizeGB(currentTier);
    const mapped = size !== null && prefix ? pickTierForSize(prefix, size, availableTiers) : null;
    tierSelectOptions.unshift({
      value: currentTier,
      label: <TierLabel tier={currentTier} sizeGB={size} />,
      textValue: currentTier,
      description: mapped && mapped !== currentTier ? `Not a ${typeLabel} ${config.redundancy} tier here; priced as ${mapped}` : `Not available in ${regionName}`,
      disabled: true,
    });
  }

  const sizeTier = tiered && config.sizingMode === "size" ? tierOptions.find((o) => o.tier === pickTierForSize(prefix ?? "P", config.sizeGB, availableTiers)) : undefined;
  const sizeHint = (() => {
    if (!tiered || config.sizingMode !== "size" || !rows) return undefined;
    if (!sizeTier) {
      return tierOptions.length === 0 ? undefined : `No ${typeLabel} tier of ${fmtInt(config.sizeGB)} GiB or more (largest ${formatGiB(tierOptions[tierOptions.length - 1].sizeGB)}).`;
    }
    return (
      <span data-testid="disk-size-tier">
        → <span className="font-semibold text-foreground">{sizeTier.tier}</span> ({formatGiB(sizeTier.sizeGB)}) ·{" "}
        <PriceText usd={sizeTier.monthlyUsd} money={money} per="/month" className="text-foreground" /> per disk
      </span>
    );
  })();

  // Premium SSD v2 / Ultra unit rates (per month) for the hints.
  const rates = useMemo(() => {
    if (tiered || !rows) return null;
    const pool = provisionedDiskRows(rows, config.diskType, config.redundancy);
    const perMonth = (re: RegExp) => {
      const row = pickPreferredRow(pool.filter((r) => re.test(r.meterName)));
      return row ? row.retailPrice * monthlyFactor(row.unitOfMeasure, HOURS_PER_MONTH) : undefined;
    };
    return { capacity: perMonth(/provisioned capacity/i), iops: perMonth(/provisioned iops/i), mbps: perMonth(/provisioned throughput/i) };
  }, [tiered, rows, config.diskType, config.redundancy]);

  const warnings = tiered ? [] : provisionedDiskWarnings(config);
  const warningFor = (field: "size" | "iops" | "mbps") => warnings.find((w) => w.field === field)?.text;

  const redundancyHint =
    redundancies && !redundancies.includes(config.redundancy)
      ? undefined
      : REDUNDANCY_HINT[config.redundancy];
  const redundancyError =
    redundancies && redundancies.length > 0 && !redundancies.includes(config.redundancy)
      ? `${typeLabel} ${config.redundancy} is not available in ${regionName}.`
      : undefined;

  return (
    <FormRoot data-module="disks">
      <ShardsError shards={shards} regionName={regionName} />
      <FieldGrid>
        <Field label="Disk type" hint={noData ? `No ${typeLabel} prices in ${regionName}.` : undefined}>
          <RichSelect value={config.diskType} onValueChange={changeType} options={typeOptions} contentClassName="min-w-[24rem]" />
        </Field>
        <Field label="Redundancy" hint={redundancyHint} error={redundancyError}>
          {loading ? (
            <SelectorSkeleton />
          ) : (
            <Segmented
              value={config.redundancy}
              onValueChange={(redundancy) => onChange({ redundancy })}
              options={(["LRS", "ZRS"] as const).map((r) => ({
                value: r,
                label: r,
                disabled: redundancies !== null && !redundancies.includes(r) && r !== config.redundancy,
                title: redundancies !== null && !redundancies.includes(r) ? `${r} is not available for ${typeLabel} in ${regionName}` : REDUNDANCY_HINT[r],
              }))}
            />
          )}
        </Field>
        <Field label="Disks">
          <NumberField value={config.disks} onCommit={(disks) => onChange({ disks })} min={0} max={1_000_000} integer suffix="disks" />
        </Field>

        {tiered ? (
          <>
            <Field label="Sizing">
              <Segmented
                value={config.sizingMode}
                onValueChange={changeSizing}
                options={[
                  { value: "tier", label: "By tier" },
                  { value: "size", label: "By size" },
                ]}
              />
            </Field>
            {config.sizingMode === "tier" ? (
              <Field
                label="Disk tier"
                className="@3xl:col-span-2"
                hint={tierChoice ? tierPerformance(tierChoice.tier) || undefined : undefined}
              >
                {loading ? (
                  <SelectorSkeleton label="Loading disk tiers…" />
                ) : (
                  <RichSelect
                    value={currentTier}
                    onValueChange={(tier) => onChange({ tier })}
                    options={tierSelectOptions}
                    placeholder={tierOptions.length === 0 ? `No ${typeLabel} ${config.redundancy} tiers in ${regionName || "this region"}` : "Choose a tier"}
                    disabled={tierSelectOptions.length === 0}
                    contentClassName="min-w-[22rem]"
                    triggerAside={tierChoice ? <PriceText usd={tierChoice.monthlyUsd} money={money} per="/mo" className="text-xs" /> : null}
                  />
                )}
              </Field>
            ) : (
              <Field label="Disk size" className="@3xl:col-span-2" hint={sizeHint}>
                <NumberField value={config.sizeGB} onCommit={(sizeGB) => onChange({ sizeGB })} min={1} max={TIERED_DISK_MAX_GIB} integer suffix="GiB" />
              </Field>
            )}
          </>
        ) : (
          <>
            <Field
              label="Disk size"
              warning={warningFor("size")}
              hint={
                ultra
                  ? ultraBillableSizeGiB(config.sizeGB) !== config.sizeGB
                    ? `Billed as ${fmtInt(ultraBillableSizeGiB(config.sizeGB))} GiB (per GiB, 4 GiB minimum).`
                    : `${fmtInt(ULTRA_LIMITS.minGiB)} GiB to 64 TiB.`
                  : "1 GiB increments, up to 64 TiB."
              }
            >
              <NumberField
                value={config.sizeGB}
                onCommit={(sizeGB) => onChange({ sizeGB })}
                min={1}
                max={ultra ? ULTRA_LIMITS.maxGiB : PREMIUM_V2_LIMITS.maxGiB}
                integer
                suffix="GiB"
              />
            </Field>
            <Field
              label="IOPS"
              warning={warningFor("iops")}
              hint={
                ultra
                  ? `Max ${fmtInt(ultraMaxIops(config.sizeGB))} for ${fmtInt(config.sizeGB)} GiB (min 100); all billed.`
                  : `${fmtInt(PREMIUM_V2_FREE_IOPS)} included free · max ${fmtInt(premiumV2MaxIops(config.sizeGB))} for this size.`
              }
            >
              <NumberField value={config.iops} onCommit={(iops) => onChange({ iops })} min={0} max={400_000} step={100} integer suffix="IOPS" />
            </Field>
            <Field
              label="Throughput"
              warning={warningFor("mbps")}
              hint={
                ultra
                  ? `Max ${fmtInt(ultraMaxMbps(config.iops))} MB/s for ${fmtInt(config.iops)} IOPS (min 1); all billed.`
                  : `${fmtInt(PREMIUM_V2_FREE_MBPS)} MB/s included free · max ${fmtInt(premiumV2MaxMbps(config.iops, config.sizeGB))} for these IOPS.`
              }
            >
              <NumberField
                value={config.throughputMBps}
                onCommit={(throughputMBps) => onChange({ throughputMBps })}
                min={0}
                max={10_000}
                step={10}
                integer
                suffix="MB/s"
              />
            </Field>
          </>
        )}
      </FieldGrid>

      {!tiered && rates ? (
        <p className="text-xs text-muted-foreground" data-testid="disk-rates">
          Monthly rates in {regionName}: <PriceText usd={rates.capacity} money={money} unit per=" per GiB" className="text-foreground" />
          {" · "}
          <PriceText usd={rates.iops} money={money} unit per=" per IOPS" className="text-foreground" />
          {" · "}
          <PriceText usd={rates.mbps} money={money} unit per=" per MB/s" className="text-foreground" />
          {ultra ? null : " (above the free baseline)"}
        </p>
      ) : null}

      <Note icon={<Info />}>
        {tiered ? (
          <p>
            Billed per disk at the tier price (sizes round up to the next tier).{" "}
            {config.diskType === "premium-ssd" ? "Bursting, performance plus and reservations" : "Transactions (disk operations), bursting and performance plus"} are not
            included.
          </p>
        ) : (
          <p>
            Capacity, IOPS and throughput are billed hourly (shown per month at 730 h).{" "}
            {ultra ? "The Ultra Disk VM reservation fee (Ultra-enabled VM without a disk) is not included." : "Premium SSD v2 includes 3,000 IOPS and 125 MB/s per disk at no cost."}
          </p>
        )}
      </Note>
    </FormRoot>
  );
}
