// Generic meter: any meter of any service, priced as quantity × price adjusted by its unit.
import type { CommitmentId, GenericConfig } from "../model.ts";
import { genericConfigSchema } from "../model.ts";
import type { LineKind, PricingContext, PricingModule, ServiceInfo, ShardRef } from "../types.ts";
import { findMeterOption } from "../meters.ts";
import type { MeterOption } from "../meters.ts";
import { serviceByName, serviceHasRegion } from "../serviceMatch.ts";
import { freeAllowance, tieredCost } from "../tiered.ts";
import { billingUnitLabel, describeUnit, monthlyFactor, parseUnit, quantityLabel, termMonths } from "../units.ts";
import { finalize, fmtNum, incomplete, makeLine, nounFor, plural, regionLabel, rowsFor, unavailable } from "./result.ts";

/** "_global" when useGlobalRegion, else the item region ("" = not chosen). */
export function genericRegionKey(config: GenericConfig, region: string): string {
  return config.useGlobalRegion ? "_global" : region;
}

/** Line commitment of a meter: Consumption → payg; 1/3-year Reservation → ri1y/ri3y; SavingsPlans → sp1y/sp3y. */
export function meterCommitment(type: string, reservationTerm: string): CommitmentId | undefined {
  const t = type.toLowerCase();
  if (t === "consumption") return "payg";
  const months = termMonths(reservationTerm);
  if (t === "reservation") return months === 12 ? "ri1y" : months === 36 ? "ri3y" : undefined;
  if (t === "savingsplans") return months === 12 ? "sp1y" : months === 36 ? "sp3y" : undefined;
  return undefined;
}

function kindFor(services: readonly ServiceInfo[], serviceName: string): LineKind {
  const family = (serviceByName(services, serviceName)?.serviceFamily ?? "").toLowerCase();
  if (family === "compute") return "compute";
  if (family === "storage") return "storage";
  if (family === "networking") return "network";
  return "other";
}

/**
 * Monthly USD of `quantity` of a meter (Consumption/SavingsPlans): tieredCost(tiers,
 * quantity × monthlyFactor(unit, hoursPerMonth)). Reservations: total / term months × quantity.
 */
export function meterMonthlyUsd(option: MeterOption, quantity: number, hoursPerMonth: number): number | null {
  if (option.type.toLowerCase() === "reservation") {
    const months = termMonths(option.reservationTerm);
    if (!months || option.tiers.length === 0) return null;
    return (option.tiers[0].retailPrice * quantity) / months;
  }
  return tieredCost(option.tiers, quantity * monthlyFactor(option.unitOfMeasure, hoursPerMonth));
}

function computeGeneric(config: GenericConfig, ctx: PricingContext) {
  if (!config.serviceName.trim()) return incomplete("Choose a service.");
  const regionKey = genericRegionKey(config, ctx.region);
  if (!regionKey) return incomplete("Choose a region.");
  if (!config.meterId.trim()) return incomplete("Choose a meter.");

  const svc = serviceByName(ctx.services, config.serviceName);
  const serviceName = svc?.serviceName ?? config.serviceName;
  const where = config.useGlobalRegion ? "the global (no region) price list" : regionLabel(ctx);
  const display = config.meterName || config.skuName || config.meterId;
  if (ctx.services.length > 0 && !svc) {
    return unavailable(`The service "${config.serviceName}" is not in the current price snapshot.`);
  }
  const option = findMeterOption(rowsFor(ctx, { serviceName, regionKey }), config);
  if (!option) return unavailable(`The meter "${display}" (${serviceName}) is not available in ${where}.`);

  const label = option.meterName || option.skuName || display;
  const detail = [option.productName, option.skuName].filter(Boolean).join(" · ");
  const kind = kindFor(ctx.services, serviceName);
  const commitment = meterCommitment(option.type, option.reservationTerm);
  const qty = config.quantity;

  if (option.type.toLowerCase() === "reservation") {
    const months = termMonths(option.reservationTerm);
    if (!months) return unavailable(`Unknown reservation term "${option.reservationTerm}" for "${label}".`);
    const total = option.tiers[0].retailPrice;
    const line = makeLine({
      id: option.meterId,
      meterId: option.meterId,
      label,
      detail: `${detail} · ${option.reservationTerm} reservation`,
      unit: nounFor(qty, "reservation"),
      quantity: qty,
      unitPriceUsd: total,
      monthlyUsd: (total * qty) / months,
      amortizedMonthlyUsd: (total * qty) / months,
      kind,
      commitment,
      termMonths: months,
      notes: [`Term total spread monthly over ${plural(months, "month")}.`],
      effectiveStartDate: option.effectiveStartDate,
    });
    return finalize(
      [line],
      [],
      [`${label}: reservation priced as the ${option.reservationTerm} term total spread over ${plural(months, "month")}.`],
    );
  }

  const unit = parseUnit(option.unitOfMeasure);
  const billable = qty * monthlyFactor(unit, config.hoursPerMonth);
  const monthly = tieredCost(option.tiers, billable);
  const free = freeAllowance(option.tiers);
  const tiered = option.tiers.length > 1 || free > 0;
  const notes: string[] = [];
  if (option.tiers.length > 1) notes.push(`Tiered pricing (${option.tiers.length} tiers) applied marginally; unit price shown is the average.`);
  if (free > 0) notes.push(`First ${fmtNum(free)} ${billingUnitLabel(unit, free)} per month ${free === 1 ? "is" : "are"} free.`);
  if (!unit.recognized) notes.push(`Unit "${option.unitOfMeasure}" not recognized; priced as quantity × price.`);
  const line = makeLine({
    id: option.meterId,
    meterId: option.meterId,
    label,
    detail,
    unit: billingUnitLabel(unit, billable),
    quantity: billable,
    unitPriceUsd: tiered ? (billable > 0 ? monthly / billable : option.tiers[0].retailPrice) : option.tiers[0].retailPrice,
    monthlyUsd: monthly,
    kind,
    commitment,
    termMonths: commitment === "sp1y" ? 12 : commitment === "sp3y" ? 36 : undefined,
    notes,
    effectiveStartDate: option.effectiveStartDate,
  });
  const usage = unit.timeBased
    ? `${fmtNum(qty)} ${quantityLabel(unit, qty)} × ${plural(config.hoursPerMonth, "hour")} per month`
    : `${fmtNum(qty)} ${quantityLabel(unit, qty)}`;
  return finalize([line], [], [`${label} (${serviceName}): ${usage}, priced ${describeUnit(unit)}.`]);
}

export const genericModule: PricingModule<GenericConfig> = {
  id: "generic",
  title: "Any service (meter)",
  description: "Price any meter of any Azure service from the Retail Prices catalog: quantity × unit price.",
  category: "Other",
  iconKey: "generic",
  configSchema: genericConfigSchema,
  defaultConfig(settings) {
    return genericConfigSchema.parse({ hoursPerMonth: settings.hoursPerMonth });
  },
  shards(config, region, services): ShardRef[] {
    if (!config.serviceName.trim()) return [];
    const regionKey = genericRegionKey(config, region);
    if (!regionKey) return [];
    const svc = serviceByName(services, config.serviceName);
    if (services.length > 0 && !svc) return [];
    if (!serviceHasRegion(svc, regionKey)) return [];
    return [{ serviceName: svc?.serviceName ?? config.serviceName, regionKey }];
  },
  compute: computeGeneric,
  summarize(config) {
    if (!config.serviceName.trim()) return "No service selected";
    if (!config.meterId.trim()) return `${config.serviceName} · no meter selected`;
    const name = config.meterName || config.skuName || config.meterId;
    const parts = [name];
    if (config.type.toLowerCase() === "reservation") {
      parts.push(`${fmtNum(config.quantity)} × ${config.reservationTerm} reservation`);
    } else {
      parts.push(`${fmtNum(config.quantity)} ${quantityLabel(config.unitOfMeasure, config.quantity)}`);
      if (config.type.toLowerCase() === "savingsplans") parts.push(`savings plan ${config.reservationTerm}`);
    }
    return parts.join(" · ");
  },
};
