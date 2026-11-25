// Virtual Machines: PAYG (Linux / Windows / Windows + AHB), reservations 1Y/3Y, savings plans 1Y/3Y, Spot.
import { HOURS_PER_MONTH, vmConfigSchema } from "../model.ts";
import type { CommitmentId, VmConfig } from "../model.ts";
import type { ItemMessage, Line, PricingContext, PricingModule, ServiceInfo, ShardRef } from "../types.ts";
import { SERVICE_MATCHERS, resolveServiceName, serviceByName, serviceHasRegion } from "../serviceMatch.ts";
import { type VmSkuPrices, hourlyUsd, resolveVmSku, vmSkuLabel } from "../vmCatalog.ts";
import { finalize, fmtNum, incomplete, makeLine, nounFor, regionLabel, rowsFor, unavailable } from "./result.ts";

export const VM_OS_LABELS: Readonly<Record<VmConfig["os"], string>> = {
  linux: "Linux",
  windows: "Windows",
  "windows-ahb": "Windows (AHB)",
};

export const COMMITMENT_LABELS: Readonly<Record<CommitmentId, string>> = {
  payg: "PAYG",
  ri1y: "RI 1Y",
  ri3y: "RI 3Y",
  sp1y: "SP 1Y",
  sp3y: "SP 3Y",
};

const TERM_MONTHS: Readonly<Record<CommitmentId, number>> = { payg: 0, ri1y: 12, ri3y: 36, sp1y: 12, sp3y: 36 };

function vmServiceName(services: readonly ServiceInfo[]): string | null {
  return resolveServiceName(services, SERVICE_MATCHERS.vm);
}

function windowsLicenseLine(prices: VmSkuPrices, hoursQty: number, where: string): Line | string {
  const { windows, linux, label } = prices;
  if (!windows) {
    return `The pay-as-you-go Windows price of ${label} is not available in ${where}; the Windows Server license cannot be priced.`;
  }
  if (!linux) {
    return `The pay-as-you-go Linux price of ${label} is not available in ${where}; the Windows Server license cannot be derived.`;
  }
  let rate = hourlyUsd(windows) - hourlyUsd(linux);
  const notes = ["Windows hourly rate minus Linux hourly rate, billed pay-as-you-go."];
  if (rate < 0) {
    rate = 0;
    notes.push("The Windows rate is below the Linux rate in the price list; license priced at 0.");
  }
  return makeLine({
    id: "license",
    meterId: windows.meterId,
    label: "Windows Server license",
    detail: windows.productName,
    unit: nounFor(hoursQty, "hour"),
    quantity: hoursQty,
    unitPriceUsd: rate,
    kind: "license",
    commitment: "payg",
    notes,
    effectiveStartDate: windows.effectiveStartDate,
  });
}

function ahbLine(hoursQty: number): Line {
  return makeLine({
    id: "license-ahb",
    label: "Windows Server license covered by Azure Hybrid Benefit",
    unit: nounFor(hoursQty, "hour"),
    quantity: hoursQty,
    unitPriceUsd: 0,
    kind: "license",
    commitment: "payg",
    notes: ["Requires eligible Windows Server licenses with Software Assurance or subscriptions."],
  });
}

function computeVm(config: VmConfig, ctx: PricingContext) {
  if (!ctx.region) return incomplete("Choose a region.");
  const sku = config.armSkuName.trim();
  if (!sku) return incomplete("Choose a VM size.");

  const serviceName = vmServiceName(ctx.services) ?? "Virtual Machines";
  const useSpot = config.spot && config.commitment === "payg";
  const main = rowsFor(ctx, { serviceName, regionKey: ctx.region });
  const spotRows = useSpot ? rowsFor(ctx, { serviceName, regionKey: ctx.region, spot: true }) : [];
  const prices = resolveVmSku(main, sku, spotRows);
  const name = prices.label;
  const where = regionLabel(ctx);
  const hours = config.hoursPerMonth;
  const n = config.instances;
  const hoursQty = hours * n;
  const os = config.os;
  const messages: ItemMessage[] = [];
  const assumptions: string[] = ["VM prices exclude disks, networking and backup (add them as separate items)."];
  if (config.spot && config.commitment !== "payg") {
    messages.push({ level: "info", text: "Spot applies to pay-as-you-go only; it is ignored with a reservation or savings plan." });
  }
  if (prices.rowCount === 0 && !(useSpot && (prices.spotLinux || prices.spotWindows))) {
    return unavailable(`${name} is not available in ${where}.`, messages);
  }

  const lines: Line[] = [];

  // Spot: one compute line from the OS-specific Spot rate (AHB → Linux Spot).
  if (useSpot) {
    const windowsSpot = os === "windows";
    const row = windowsSpot ? prices.spotWindows : prices.spotLinux;
    if (!row) {
      return unavailable(`The Spot price of ${name} (${windowsSpot ? "Windows" : "Linux"}) is not available in ${where}.`, messages);
    }
    const notes = ["Spot capacity can be evicted at any time; the Spot rate changes frequently."];
    if (os === "windows-ahb") notes.push("Windows Server license covered by Azure Hybrid Benefit (Linux Spot rate).");
    lines.push(
      makeLine({
        id: "compute",
        meterId: row.meterId,
        label: `${name} Spot (${windowsSpot ? "Windows" : "Linux"})`,
        detail: row.productName,
        unit: nounFor(hoursQty, "hour"),
        quantity: hoursQty,
        unitPriceUsd: hourlyUsd(row),
        kind: "compute",
        commitment: "payg",
        notes,
        effectiveStartDate: row.effectiveStartDate,
      }),
    );
    return finalize(lines, messages, assumptions);
  }

  const commitment = config.commitment;
  if (commitment === "payg") {
    if (os === "windows" && prices.windows && !prices.linux) {
      // A SKU without a Linux PAYG row: the Windows rate still gives the right total.
      lines.push(
        makeLine({
          id: "compute",
          meterId: prices.windows.meterId,
          label: `${name} compute + Windows license`,
          detail: prices.windows.productName,
          unit: nounFor(hoursQty, "hour"),
          quantity: hoursQty,
          unitPriceUsd: hourlyUsd(prices.windows),
          kind: "compute",
          commitment: "payg",
          notes: ["Linux price missing: compute and Windows license shown as one line."],
          effectiveStartDate: prices.windows.effectiveStartDate,
        }),
      );
      messages.push({
        level: "warning",
        text: `The Linux price of ${name} is missing in ${where}; compute and Windows license are shown as one line.`,
      });
      return finalize(lines, messages, assumptions);
    }
    if (!prices.linux) {
      const why = os === "windows-ahb" ? " (needed for Azure Hybrid Benefit)" : "";
      return unavailable(
        os === "windows" && !prices.windows
          ? `The pay-as-you-go price of ${name} (Windows) is not available in ${where}.`
          : `The pay-as-you-go Linux price of ${name} is not available in ${where}${why}.`,
        messages,
      );
    }
    lines.push(
      makeLine({
        id: "compute",
        meterId: prices.linux.meterId,
        label: os === "linux" ? `${name} compute (Linux)` : `${name} compute`,
        detail: prices.linux.productName,
        unit: nounFor(hoursQty, "hour"),
        quantity: hoursQty,
        unitPriceUsd: hourlyUsd(prices.linux),
        kind: "compute",
        commitment: "payg",
        effectiveStartDate: prices.linux.effectiveStartDate,
      }),
    );
  } else if (commitment === "ri1y" || commitment === "ri3y") {
    const months = TERM_MONTHS[commitment];
    const row = commitment === "ri1y" ? prices.ri1y : prices.ri3y;
    if (!row) return unavailable(`A ${months / 12}-year reservation for ${name} is not available in ${where}.`, messages);
    const total = row.retailPrice;
    const upfront = config.riPayment === "upfront";
    const notes = [
      upfront
        ? `Term total paid upfront; amortized over ${months} months.`
        : `Term total paid monthly over ${months} months.`,
    ];
    if (hours !== HOURS_PER_MONTH) notes.push("Reservations are billed for every hour of the term, regardless of hours per month.");
    lines.push(
      makeLine({
        id: "compute",
        meterId: row.meterId,
        label: `${name} compute (${COMMITMENT_LABELS[commitment]})`,
        detail: `${row.productName} · ${row.reservationTerm} reservation`,
        unit: nounFor(n, "instance"),
        quantity: n,
        unitPriceUsd: total,
        monthlyUsd: upfront ? 0 : (total * n) / months,
        upfrontUsd: upfront ? total * n : 0,
        amortizedMonthlyUsd: (total * n) / months,
        kind: "compute",
        commitment,
        termMonths: months,
        notes,
        effectiveStartDate: row.effectiveStartDate,
      }),
    );
    if (hours !== HOURS_PER_MONTH) assumptions.push("Reservations are billed for every hour of the term, regardless of hours per month.");
  } else {
    const months = TERM_MONTHS[commitment];
    const row = commitment === "sp1y" ? prices.sp1y : prices.sp3y;
    if (!row) {
      return unavailable(
        ctx.hasSavingsPlan
          ? `A ${months / 12}-year savings plan price for ${name} is not available in ${where}.`
          : "Savings plan prices are not included in this price snapshot.",
        messages,
      );
    }
    lines.push(
      makeLine({
        id: "compute",
        meterId: row.meterId,
        label: `${name} compute (${COMMITMENT_LABELS[commitment]})`,
        detail: `${row.productName} · ${row.reservationTerm} savings plan`,
        unit: nounFor(hoursQty, "hour"),
        quantity: hoursQty,
        unitPriceUsd: hourlyUsd(row),
        kind: "compute",
        commitment,
        termMonths: months,
        notes: ["Savings plan hourly rate for compute."],
        effectiveStartDate: row.effectiveStartDate,
      }),
    );
  }

  if (os === "windows") {
    const license = windowsLicenseLine(prices, hoursQty, where);
    if (typeof license === "string") return unavailable(license, messages);
    lines.push(license);
    assumptions.push("Windows Server license priced pay-as-you-go as the Windows rate minus the Linux rate.");
  } else if (os === "windows-ahb") {
    lines.push(ahbLine(hoursQty));
  }
  return finalize(lines, messages, assumptions);
}

export const vmModule: PricingModule<VmConfig> = {
  id: "vm",
  title: "Virtual Machines",
  description: "Linux and Windows VMs with pay-as-you-go, reservations, savings plans and Spot pricing.",
  category: "Compute",
  iconKey: "virtual-machines",
  configSchema: vmConfigSchema,
  defaultConfig(settings) {
    return vmConfigSchema.parse({ hoursPerMonth: settings.hoursPerMonth });
  },
  shards(config, region, services): ShardRef[] {
    if (!region) return [];
    const serviceName = vmServiceName(services);
    if (!serviceName) return [];
    const svc = serviceByName(services, serviceName);
    if (!serviceHasRegion(svc, region)) return [];
    const refs: ShardRef[] = [{ serviceName, regionKey: region }];
    if (config.spot && config.commitment === "payg" && (!svc || svc.hasSpot)) {
      refs.push({ serviceName, regionKey: region, spot: true });
    }
    return refs;
  },
  compute: computeVm,
  summarize(config) {
    const name = config.armSkuName.trim() ? vmSkuLabel(config.armSkuName) : "VM (no size)";
    const spot = config.spot && config.commitment === "payg";
    let commitment: string = spot ? "Spot" : COMMITMENT_LABELS[config.commitment];
    if ((config.commitment === "ri1y" || config.commitment === "ri3y") && config.riPayment === "upfront") {
      commitment += " upfront";
    }
    const parts = [`${fmtNum(config.instances)} × ${name}`, VM_OS_LABELS[config.os], commitment];
    if (config.hoursPerMonth !== HOURS_PER_MONTH) parts.push(`${fmtNum(config.hoursPerMonth)} h/month`);
    return parts.join(" · ");
  },
};
