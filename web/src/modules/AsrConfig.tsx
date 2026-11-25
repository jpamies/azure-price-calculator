// Azure Site Recovery configuration: replication scenario (radio cards with the per-instance
// price) and protected instances, plus what is not included.
import { useMemo } from "react";
import { CircleCheck, Info } from "lucide-react";
import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import type { AsrConfig as AsrConfigValues } from "@/domain/model";
import { HOURS_PER_MONTH } from "@/domain/model";
import { asrModule } from "@/domain/pricing";
import { findAsrRows } from "@/domain/pricing/asr";
import { monthlyFactor } from "@/domain/units";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { ModuleConfigProps } from "./types";
import { PriceText, ShardsError } from "./shared/data";
import { isLoading, rowsOf } from "./shared/rows";
import { Field, FieldGrid, FormRoot, Note } from "./shared/Field";
import { NumberField } from "./shared/NumberField";

const SCENARIOS: readonly { value: AsrConfigValues["scenario"]; title: string; description: string }[] = [
  { value: "azure-to-azure", title: "Azure → Azure", description: "Azure VMs replicated to another Azure region." },
  { value: "onprem-to-azure", title: "On-premises → Azure", description: "Hyper-V, VMware or physical servers replicated to Azure." },
  { value: "onprem-to-onprem", title: "On-premises → secondary site", description: "Hyper-V or VMware replicated to a customer-owned site." },
];

export function AsrConfig({ item, onChange, catalog, shards, money, regionName }: ModuleConfigProps<"asr">) {
  const config = item.config;
  const refs = useMemo(() => asrModule.shards(config, item.region, catalog.services), [config, item.region, catalog.services]);
  const rows = rowsOf(shards, refs[0]);
  const loading = isLoading(shards, rows);
  const prices = useMemo(() => {
    const out = {} as Record<AsrConfigValues["scenario"], number | undefined>;
    for (const s of SCENARIOS) {
      const tiers = rows ? findAsrRows(rows, s.value) : [];
      out[s.value] = tiers.length > 0 ? tiers[0].retailPrice * monthlyFactor(tiers[0].unitOfMeasure, HOURS_PER_MONTH) : undefined;
    }
    return out;
  }, [rows]);
  const groupLabelId = `${item.id}-asr-scenario`;

  return (
    <FormRoot data-module="asr">
      <ShardsError shards={shards} regionName={regionName} />
      <div className="flex flex-col gap-1.5">
        <div id={groupLabelId} className="text-[13px] leading-5 font-semibold">
          Scenario
        </div>
        <RadioGroupPrimitive.Root
          value={config.scenario}
          onValueChange={(v) => onChange({ scenario: v as AsrConfigValues["scenario"] })}
          aria-labelledby={groupLabelId}
          orientation="horizontal"
          loop
          className="grid grid-cols-1 gap-2 @2xl:grid-cols-3"
        >
          {SCENARIOS.map((s) => {
            const price = prices[s.value];
            const checked = config.scenario === s.value;
            return (
              <RadioGroupPrimitive.Item
                key={s.value}
                value={s.value}
                data-scenario={s.value}
                className={cn(
                  "group relative flex min-w-0 flex-col items-start gap-1 rounded-lg border bg-card px-3 py-2.5 text-left transition-colors outline-none",
                  "hover:border-primary/60 hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid",
                  "data-[state=checked]:border-primary data-[state=checked]:bg-accent/60 data-[state=checked]:shadow-[inset_0_0_0_1px_var(--primary)]",
                )}
              >
                <span className="flex w-full items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{s.title}</span>
                  {checked ? (
                    <CircleCheck aria-hidden="true" className="size-4 shrink-0 text-primary" />
                  ) : (
                    <span aria-hidden="true" className="size-4 shrink-0 rounded-full border border-control-border" />
                  )}
                </span>
                <span className="text-xs leading-4 text-muted-foreground">{s.description}</span>
                <span className="mt-auto pt-0.5 text-xs">
                  {loading ? (
                    <Skeleton className="h-4 w-28 bg-muted" />
                  ) : price !== undefined ? (
                    <>
                      <PriceText usd={price} money={money} className="font-semibold" />
                      <span className="text-muted-foreground"> per instance/month</span>
                    </>
                  ) : rows && item.region ? (
                    <span className="text-destructive">Not available in {regionName}</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </span>
              </RadioGroupPrimitive.Item>
            );
          })}
        </RadioGroupPrimitive.Root>
      </div>
      <FieldGrid>
        <Field label="Protected instances" hint="VMs or servers replicated.">
          <NumberField value={config.instances} onCommit={(instances) => onChange({ instances })} min={0} max={1_000_000} integer suffix="instances" />
        </Field>
      </FieldGrid>
      <Note icon={<Info />}>
        <p>
          Prices the replication only. Target compute, storage (replicated disks, cache storage) and egress are <strong>not included</strong>:
          add Virtual Machines and Managed Disks items for the DR side.
        </p>
        <p>The first 31 days of protection for each instance are free (not deducted here).</p>
      </Note>
    </FormRoot>
  );
}
