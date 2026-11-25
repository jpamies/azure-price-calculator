// DEV-ONLY harness for the module configuration forms (web/modules-preview.html). Not shipped:
// Vite builds index.html only. Renders every form with a local in-memory item, real catalog/shard
// data, the computed result and its lines. URL params: module, region, currency, theme, width.
import { StrictMode, useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "@/index.css";
import type { Catalog } from "@/data/catalog";
import { regionName as regionNameOf } from "@/data/catalog";
import { useCatalog, useShards } from "@/data/hooks";
import { configShape, newItem } from "@/domain/factory";
import { settingsSchema, type Item, type ModuleId, type Settings } from "@/domain/model";
import { listCurrencies, resolveCurrency } from "@/domain/money";
import { computeItem, getModule, moduleList, shardsForItem, summarizeItem } from "@/domain/pricing";
import type { PricingContext } from "@/domain/types";
import { moneyFormatter, type MoneyFormatter } from "@/lib/format";
import { ModuleConfig } from "../registry";

const params = new URLSearchParams(window.location.search);
const MODULE_IDS = moduleList.map((m) => m.id);

function mergeConfig(item: Item, patch: Record<string, unknown>): Item {
  // Same semantics as store/useStore.ts updateItem: valid keys are merged, invalid ones ignored.
  const shape = configShape(item.moduleId);
  const next: Record<string, unknown> = { ...item.config };
  for (const [key, value] of Object.entries(patch)) {
    const parsed = shape[key]?.safeParse(value);
    if (parsed?.success) next[key] = parsed.data;
    else console.warn(`[preview] Ignored invalid ${item.moduleId} config value for "${key}":`, value);
  }
  return { ...item, config: next } as Item;
}

function PreviewCard({ moduleId, region, catalog, money, settings }: { moduleId: ModuleId; region: string; catalog: Catalog; money: MoneyFormatter; settings: Settings }) {
  const [base, setBase] = useState<Item>(() => newItem(moduleId, { region, settings }) as Item);
  const item = useMemo(() => ({ ...base, region }) as Item, [base, region]);
  const mod = getModule(moduleId);
  const refs = useMemo(() => shardsForItem(item, catalog.services), [item, catalog.services]);
  const shards = useShards(refs);
  const regionName = regionNameOf(catalog, region);
  const result = useMemo(() => {
    if (shards.status !== "ready") return undefined;
    const ctx: PricingContext = {
      region,
      regionName,
      shards: shards.data,
      services: catalog.services,
      vmSpecs: catalog.vmSpecs,
      hasSavingsPlan: catalog.manifest.hasSavingsPlan,
    };
    return computeItem(item, ctx);
  }, [shards, item, region, regionName, catalog]);
  const onChange = useCallback((patch: object) => setBase((prev) => mergeConfig(prev, patch as Record<string, unknown>)), []);

  return (
    <section data-testid={`card-${moduleId}`} className="rounded-lg border bg-card text-card-foreground shadow-sm">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b px-4 py-2.5">
        <h2 className="text-sm font-semibold">{mod.title}</h2>
        <span className="text-xs text-muted-foreground">{summarizeItem(item)}</span>
      </header>
      <div className="px-4 py-4">
        <ModuleConfig
          item={item}
          onChange={onChange as never}
          catalog={catalog}
          shards={shards}
          result={result}
          money={money}
          regionName={regionName}
          settings={settings}
        />
      </div>
      <div className="border-t px-4 py-3 text-xs">
        <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>
            status: <b data-testid={`status-${moduleId}`}>{result?.status ?? shards.status}</b>
          </span>
          <span>
            monthly: <b data-testid={`monthly-${moduleId}`}>{result ? money.format(result.monthlyUsd) : "…"}</b>
          </span>
          <span>
            upfront: <b data-testid={`upfront-${moduleId}`}>{result ? money.format(result.upfrontUsd) : "…"}</b>
          </span>
          <span>
            amortized/month: <b data-testid={`total-${moduleId}`}>{result ? money.format(result.amortizedMonthlyUsd) : "…"}</b>
          </span>
        </div>
        {result?.messages.length ? (
          <ul className="mb-2 list-disc pl-5" data-testid={`messages-${moduleId}`}>
            {result.messages.map((m, i) => (
              <li key={i} className={m.level === "error" ? "text-destructive" : m.level === "warning" ? "text-warning" : "text-muted-foreground"}>
                [{m.level}] {m.text}
              </li>
            ))}
          </ul>
        ) : null}
        {result?.lines.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem]" data-testid={`lines-${moduleId}`}>
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1 pr-2">Line</th>
                  <th className="py-1 pr-2 text-right">Qty</th>
                  <th className="py-1 pr-2">Unit</th>
                  <th className="py-1 pr-2 text-right">Unit price</th>
                  <th className="py-1 pr-2 text-right">Monthly</th>
                  <th className="py-1 text-right">Upfront</th>
                </tr>
              </thead>
              <tbody>
                {result.lines.map((l) => (
                  <tr key={l.id} className="border-t align-top">
                    <td className="py-1 pr-2">
                      {l.label}
                      {l.detail ? <div className="text-muted-foreground">{l.detail}</div> : null}
                    </td>
                    <td className="py-1 pr-2 text-right tabular-nums">{l.quantity.toLocaleString("en-US", { maximumFractionDigits: 4 })}</td>
                    <td className="py-1 pr-2">{l.unit}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{money.unit(l.unitPriceUsd)}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{money.format(l.monthlyUsd)}</td>
                    <td className="py-1 text-right tabular-nums">{money.format(l.upfrontUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <details className="mt-2">
          <summary className="cursor-pointer text-muted-foreground">config</summary>
          <pre data-testid={`config-${moduleId}`} className="mt-1 overflow-x-auto rounded bg-muted p-2 text-[11px]">
            {JSON.stringify(item.config, null, 2)}
          </pre>
        </details>
      </div>
    </section>
  );
}

function Preview() {
  const { status, catalog, error, retry } = useCatalog();
  const [region, setRegion] = useState(params.get("region") ?? "westeurope");
  const [currency, setCurrency] = useState(params.get("currency") ?? "USD");
  const [dark, setDark] = useState(params.get("theme") === "dark");
  const [width, setWidth] = useState(params.get("width") ?? "auto");
  const only = params.get("module") as ModuleId | null;
  const settings = useMemo(() => settingsSchema.parse({}), []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  if (status !== "ready" || !catalog) {
    return (
      <main className="p-6 text-sm">
        {status === "error" ? (
          <p className="text-destructive">
            Catalog error: {error}{" "}
            <button type="button" className="underline" onClick={retry}>
              Retry
            </button>
          </p>
        ) : (
          "Loading catalog…"
        )}
      </main>
    );
  }
  const cat = params.get("nospecs") === "1" ? { ...catalog, vmSpecs: {} } : catalog;
  const cur = resolveCurrency(currency, catalog.fx);
  const money = moneyFormatter(cur, catalog.fx);
  const modules = only && MODULE_IDS.includes(only) ? [only] : MODULE_IDS;
  const select = "h-8 rounded-md border border-control-border bg-background px-2 text-sm";

  return (
    <main className="min-h-dvh bg-background p-3 text-foreground sm:p-6">
      <div className="mx-auto mb-4 flex max-w-5xl flex-wrap items-center gap-3 text-sm">
        <h1 className="mr-auto text-base font-semibold">Module forms preview</h1>
        <label className="flex items-center gap-1.5">
          Region
          <select data-testid="region" className={select} value={region} onChange={(e) => setRegion(e.target.value)}>
            <option value="">(none)</option>
            {catalog.regions.map((r) => (
              <option key={r.key} value={r.key}>
                {r.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          Currency
          <select data-testid="currency" className={select} value={cur} onChange={(e) => setCurrency(e.target.value)}>
            {listCurrencies(catalog.fx).map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          Width
          <select data-testid="width" className={select} value={width} onChange={(e) => setWidth(e.target.value)}>
            {["auto", "360", "520", "680", "880"].map((w) => (
              <option key={w}>{w}</option>
            ))}
          </select>
        </label>
        <button type="button" data-testid="theme" className={select} onClick={() => setDark((d) => !d)}>
          {dark ? "Light" : "Dark"}
        </button>
      </div>
      <div className="mx-auto flex flex-col gap-5" style={{ maxWidth: width === "auto" ? 1024 : Number(width) }}>
        {modules.map((id) => (
          <PreviewCard key={id} moduleId={id} region={region} catalog={cat} money={money} settings={settings} />
        ))}
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);
