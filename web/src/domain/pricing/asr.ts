// Azure Site Recovery: per protected instance per month.
import { HOURS_PER_MONTH, asrConfigSchema } from "../model.ts";
import type { AsrConfig } from "../model.ts";
import type { PriceRow, PricingContext, PricingModule, ShardRef } from "../types.ts";
import { effectiveTiers, isType, preferShortestProduct, todayIso } from "../effective.ts";
import { SERVICE_MATCHERS, resolveServiceName, serviceByName, serviceHasRegion } from "../serviceMatch.ts";
import { tieredCost } from "../tiered.ts";
import { monthlyFactor } from "../units.ts";
import { finalize, incomplete, makeLine, nounFor, plural, regionLabel, rowsFor, unavailable } from "./result.ts";

export const ASR_SCENARIO_LABELS: Readonly<Record<AsrConfig["scenario"], string>> = {
  "azure-to-azure": "Azure → Azure",
  "onprem-to-azure": "On-premises → Azure",
  "onprem-to-onprem": "On-premises → customer-owned site",
};

interface AsrMeterSpec {
  exact: string;
  re: RegExp;
  exclude?: RegExp;
}
const TO_AZURE: AsrMeterSpec = { exact: "vm replicated to azure", re: /replicated to azure/i, exclude: /customer/i };
const TO_CUSTOMER: AsrMeterSpec = { exact: "vm replicated to customer owned sites", re: /customer[\s-]*owned|replicated to customer/i };

/** Effective tier rows of the replication meter for a scenario ([] = not found). */
export function findAsrRows(rows: readonly PriceRow[], scenario: AsrConfig["scenario"], today: string = todayIso()): PriceRow[] {
  const spec = scenario === "onprem-to-onprem" ? TO_CUSTOMER : TO_AZURE;
  const consumption = rows.filter((r) => isType(r, "Consumption"));
  const exact = consumption.filter((r) => r.meterName.trim().toLowerCase() === spec.exact);
  const pool =
    exact.length > 0 ? exact : consumption.filter((r) => spec.re.test(r.meterName) && !spec.exclude?.test(r.meterName));
  if (pool.length === 0) return [];
  const product = preferShortestProduct(pool);
  const meterName = product[0].meterName;
  return effectiveTiers(
    product.filter((r) => r.meterName === meterName),
    today,
  );
}

function computeAsr(config: AsrConfig, ctx: PricingContext) {
  if (!ctx.region) return incomplete("Choose a region.");
  const serviceName = resolveServiceName(ctx.services, SERVICE_MATCHERS.asr) ?? "Azure Site Recovery";
  const rows = rowsFor(ctx, { serviceName, regionKey: ctx.region });
  const scenario = ASR_SCENARIO_LABELS[config.scenario];
  const tiers = findAsrRows(rows, config.scenario);
  if (tiers.length === 0) return unavailable(`Site Recovery (${scenario}) is not available in ${regionLabel(ctx)}.`);
  const base = tiers[0];
  const factor = monthlyFactor(base.unitOfMeasure, HOURS_PER_MONTH);
  const monthly = tieredCost(tiers, config.instances * factor);
  const tiered = tiers.length > 1 || base.tierMinimumUnits > 0;
  const line = makeLine({
    id: "replication",
    meterId: base.meterId,
    label: `Site Recovery (${scenario})`,
    detail: base.meterName,
    unit: nounFor(config.instances, "instance"),
    quantity: config.instances,
    unitPriceUsd: tiered ? (config.instances > 0 ? monthly / config.instances : base.retailPrice * factor) : base.retailPrice * factor,
    monthlyUsd: monthly,
    kind: "dr",
    notes: ["The first 31 days of protection per instance are free (not deducted)."],
    effectiveStartDate: base.effectiveStartDate,
  });
  const assumptions = [
    "Site Recovery: the first 31 days of protection per instance are free; the monthly price shown is the steady state.",
  ];
  return finalize([line], [], assumptions);
}

export const asrModule: PricingModule<AsrConfig> = {
  id: "asr",
  title: "Azure Site Recovery",
  description: "Disaster recovery replication of VMs to Azure or to a secondary site, priced per protected instance.",
  category: "Management and Governance",
  iconKey: "site-recovery",
  configSchema: asrConfigSchema,
  defaultConfig() {
    return asrConfigSchema.parse({});
  },
  shards(_config, region, services): ShardRef[] {
    if (!region) return [];
    const serviceName = resolveServiceName(services, SERVICE_MATCHERS.asr);
    if (!serviceName || !serviceHasRegion(serviceByName(services, serviceName), region)) return [];
    return [{ serviceName, regionKey: region }];
  },
  compute: computeAsr,
  summarize(config) {
    return `${plural(config.instances, "instance")} · ${ASR_SCENARIO_LABELS[config.scenario]}`;
  },
};
