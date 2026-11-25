# Platform API (for UI developers)

Platform core of the SPA: factories, money, totals, assumptions, share links, exports, data
loading, React hooks and the store. Pricing modules live in `web/src/domain/pricing/` and are not
covered here. Every amount handled by the platform is **USD**; convert only for display.

Files under `src/domain/` and `src/store/migrations.ts` are pure TypeScript (no DOM, no React) and
run under `node --test`. `src/data/*` and `src/store/useStore.ts` are browser code.

## Quick start (editor page)

```tsx
const { status, catalog, error, retry } = useCatalog();
const estimate = useEstimate(id);
const { results, loading, errors } = useEstimateResults(estimate, catalog, {
  shardsFor: (item, services) => moduleOf(item).shards(item.config, item.region, services),
  compute: (item, ctx) => moduleOf(item).compute(item.config, ctx),
  regionName: (key) => regionName(catalog, key),
});
const currency = resolveCurrency(estimate?.currency, catalog?.fx);       // unknown → "USD"
const totals = estimate && estimateTotals(estimate, results, serviceTitleOf);
formatMoney(convertUsd(totals.monthlyUsd, currency, catalog?.fx), currency); // "€1,234.50"
```

`serviceTitleOf(item)` (written by the UI) returns the service title of an item: the module title
(`"Virtual Machines"`), or `config.serviceName` for generic items. It is the `titleOf` used by
totals and exports.

## `domain/factory.ts`

| Export | Notes |
|---|---|
| `newId()` | UUID v4; `crypto.randomUUID` with a `getRandomValues`/`Math.random` fallback (non-secure contexts). |
| `nowIso()` | `new Date().toISOString()`. |
| `newEstimate(settings, name?)` | Empty estimate; currency = `settings.defaultCurrency`; default name `"Untitled estimate"`. |
| `newItem(moduleId, { region, settings, name?, config? })` | Config = schema defaults, `hoursPerMonth` = `settings.hoursPerMonth` where the schema has it, then `config` overrides (invalid override values fall back to defaults). Default names in `DEFAULT_ITEM_NAMES`. |
| `duplicateEstimate(e)` / `duplicateItem(i)` | Deep copies with fresh ids and a `" (copy)"` suffix. |
| `sanitizeEstimate(raw, { freshIds?, now?, onWarning? })` | Lenient `estimateSchema` parse: fills ids/timestamps, repairs invalid fields with defaults, drops items with an unknown module (reported via `onWarning`). Throws only when `raw` is not an object. |
| `sanitizeItem`, `sanitizeSettings`, `salvageObject` | Same lenient parsing for one item / settings / any zod object shape. |
| `itemDisplayName(item)` | `item.name` or the module default name. |
| `CONFIG_SCHEMAS`, `configDefaults(moduleId)`, `DEFAULT_ITEM_NAMES`, `normalizeCurrencyCode` | Helpers. |

## `domain/money.ts`

| Export | Notes |
|---|---|
| `currencyRate(fx, cur)` | Units of `cur` per USD. USD → 1 (even with `fx` undefined). **Unknown currency → `null`** (never throws). |
| `convertUsd(usd, cur, fx)` | `usd × rate`; unknown currency → `NaN` (rendered `"—"`). Call `resolveCurrency` first. |
| `resolveCurrency(cur, fx)` | `cur` if known, else `"USD"`. |
| `formatMoney(amount, cur, { unitPrice?, compact? })` | `Intl.NumberFormat("en-US")`. Amounts: currency decimals (2; JPY/KRW 0). Unit prices (table columns): below 0.01 up to 4 significant digits (`$0.0068`); 0.01–10 fixed 4 decimals (`$0.2150`, `$1.5000`; JPY/KRW 2: `¥3.37`); ≥ 10 currency decimals (`$135.17`, `¥1,235`). Non-finite → `"—"`. |
| `formatNumber(n, opts?)` | `"1,234.5"`; up to 2 decimals (3 significant digits below 0.01). |
| `listCurrencies(fx)` | `["USD", …alphabetical]`. |
| `currencyFractionDigits`, `currencyDisplayName`, `FX_DISCLAIMER` | `FX_DISCLAIMER` must be shown next to non-USD amounts. |

## `domain/totals.ts`

`estimateTotals(estimate, results, titleOf)` →
`{ monthlyUsd, upfrontUsd, amortizedMonthlyUsd, annualUsd (= monthly × 12 + upfront), pendingItems, incompleteItems, unavailableItems, byService, byCategory, byCommitment }`.

* `pendingItems` = items without a result yet; `incompleteItems` / `unavailableItems` by status.
  Each is `{ id, title }` (title = item name or `titleOf(item)`).
* Breakdown entries `{ key, label, monthlyUsd, upfrontUsd, amortizedMonthlyUsd }`, sorted by
  amortized monthly desc (then monthly, upfront, label). Totals/byService use item-level amounts;
  byCategory/byCommitment use lines.
* Categories (`Line.kind`): Compute, Licenses, Storage, Backup, Disaster recovery, Networking, Other.
* Commitments: PAYG, Reserved 1Y/3Y, Savings plan 1Y/3Y, Spot. Lines without commitment are PAYG.
  **Spot convention** (Line has no spot commitment): a PAYG line is Spot when one of its `notes`
  starts with `"Spot"`, or it is a compute/license line of a VM item with `config.spot` and
  commitment `payg`, or it belongs to a generic item whose meter/SKU name contains Spot/Low Priority.
  Helpers: `lineCommitment(line, item)`, `isSpotLine`, `CATEGORY_LABELS`, `COMMITMENT_LABELS`.

## `domain/assumptions.ts`

`buildAssumptions({ estimate, results, pricesDate, currency, fxAsOf, fxRate?, hasSavingsPlan, sourceType })`
→ `string[]` of ready-to-paste sentences (sample-data warning for `sourceType === "fixture"`,
snapshot/source, FX, 730 h + deviating items, reservations, savings plan, Windows/AHB, SQL, Spot,
disks, backup footprint, ASR, deduplicated `ItemResult.assumptions`, then the three fixed
disclaimers in `ALWAYS_ASSUMPTIONS`). Pass the **resolved** display currency.

## `domain/share.ts`

Share links carry configuration only, never prices: `?s=1.<base64url(deflate-raw(JSON))>`.

| Export | Notes |
|---|---|
| `encodeShare(estimate, pricesDate?)` | `Promise<string>`. Config keys equal to defaults and default item names are omitted. Item notes/tags are not shared; estimate notes are. |
| `decodeShare(param)` | `Promise<{ estimate, pricesDate?, skippedItems }>`; fresh ids, schema defaults, `estimate.pricesDate` = sender's snapshot. Rejects with a user-facing `Error` on garbage / newer versions. |
| `buildShareUrl(href, encoded)` | Same path and other params, `s` replaced, hash dropped. |
| `readShareParam(href)` | `?s=` (also `#s=` / `#/route?s=`), or `null`. |
| `stripShareParam(href)` | For `history.replaceState` after the import dialog. |
| `shareUrlLevel(url)` | `"ok"` ≤ `SHARE_URL_WARN` (6000) < `"warn"` ≤ `SHARE_URL_MAX` (8000) < `"too-long"` → offer Export JSON. |
| `SHARE_PARAM` (`"s"`), `buildSharePayload`, `base64UrlEncode/Decode` | |

Warn users not to put customer data in names before sharing publicly (links are not encrypted).

## `domain/export/*`

All take `(estimate, results, opts)` with `ExportOptions = { currency, fx, titleOf, regionName?, summarize?, pricesDate?, assumptions? }`
(`summarize` = `PricingModule.summarize`, `assumptions` = `buildAssumptions(...)`). Unknown
currencies fall back to USD.

| Export | Result |
|---|---|
| `exportEstimateJson(estimate, { pricesDate, results?, titleOf? })` | `{ kind: "azcalc-estimate", v: 1, exportedAt, pricesDate, estimate, lines? }` (string). |
| `exportBackupJson({ estimates, settings })` | `{ kind: "azcalc-backup", v: 1, exportedAt, settings, estimates }` (string). |
| `parseImportJson(text)` | `{ estimates, settings?, source, warnings }` — accepts estimate files, backups, a bare estimate, an array or a raw `azcalc.v1` dump; fresh ids; throws user-facing errors. Show `warnings` (skipped items…). |
| `estimateToCsv(e, r, { …opts, bom? })` | RFC 4180, CRLF, header + one row per line (+ one row per unpriced item) + TOTAL. Pass `bom: true` for downloads (Excel). Formula-injection safe. |
| `estimateToMarkdown(e, r, opts)` | Heading, `Service \| Region \| Configuration \| Monthly \| Upfront` table, totals, assumptions. |
| `estimateToXlsx(e, r, opts)` | `Promise<Uint8Array>`; sheets Summary / Detail / Assumptions; no third-party library. MIME `XLSX_MIME`. |
| `createZip(entries, { compress?, date? })` | Generic ZIP writer (`deflateRaw`, `inflateRaw`, `crc32` also exported). |
| `downloadBlob(data, filename, mime)`, `copyText(text)`, `safeFileName(name)`, `MIME` | DOM helpers. `copyText` resolves `false` on failure. |

## `data/*` (browser)

* `catalog.ts`: `loadCatalog()` → `Catalog { manifest, services, regions, vmSpecs, fx, shards }` (cached
  in memory; failed loads are retried by the next call; VM specs/FX optional). `shards` is the
  per-shard map (`slug → regionKey → ShardEntry`) loaded from `manifest.paths.shards`
  (`<DATE>/index/shards.json`); legacy snapshots without it fall back to the inline
  `manifest.shards`. Always read `catalog.shards`, never `manifest.shards`. `loadManifest()`,
  `parseShardIndex()`, `clearCatalogCache()`, `hasNewerSnapshot(catalog)`, `dataUrl(path)`.
  Lookups take the catalog first: `serviceByName(catalog, name)`, `regionByKey(catalog, key)`,
  `regionName(catalog | undefined, key)` (falls back to the key), `slugFor(catalog, serviceName)`.
  `isStale(pricesDate, now?, days = 3)` / `snapshotAgeDays` for the "old prices" banner.
* `shards.ts`: `loadShard(catalog, ref)` → rows of all parts; missing service/region/spot, or the
  main shard of a Spot-only region (`parts: 0`) → `[]`;
  in-memory + IndexedDB caches; errors carry the HTTP status. `peekShard`, `shardError`,
  `clearShardErrors`, `clearShardCache`.
* `idb.ts`: `idbGet/idbSet/idbDelete/idbDeleteMany/idbKeys/idbClear` — never reject; no-ops without IndexedDB.
* `columnar.ts`: `decodeShard({ cols, rows })` → `PriceRow[]` (reads by column name; validates `cols`).

## `data/hooks.ts`

| Hook | Notes |
|---|---|
| `useCatalog()` | `{ status: "loading" \| "ready" \| "error", catalog?, error?, retry }`. One shared load for all components; `preloadCatalog()` can start it in `main.tsx`. |
| `useShards(refs)` | `{ status, data: Record<refKey, PriceRow[]>, error?, retry }`. Stable for equal ref sets (array identity does not matter). Missing shards resolve to `[]`. |
| `useEstimateResults(estimate, catalog, { shardsFor, compute, regionName })` | `{ results, loading, errors, retry }`. Loads all needed shards (deduplicated), computes per item, memoized per item object: editing one item recomputes only that item. `options` may be inline (read through a ref). `results[id]` is undefined while loading or when `errors[id]` is set. |
| `useMediaQuery(query)` | `boolean`. |

## `store/useStore.ts`

`useStore` (zustand v5 + persist, key `"azcalc.v1"`, version `SCHEMA_VERSION`, writes debounced
500 ms and flushed on `pagehide` / tab hidden; other tabs' saves are reloaded via the `storage` event).

Actions (`useStore.getState().action(...)` or `useStore((s) => s.action)`):
`createEstimate(name?) → id`, `importEstimates(list) → ids`, `updateEstimate(id, { name?, currency?, notes? })`,
`duplicateEstimate(id) → id?`, `deleteEstimate(id)`, `addItem(estimateId, moduleId, { region?, name?, config? }?) → itemId?`,
`updateItem(estimateId, itemId, { name?, region?, collapsed?, notes?, config? })`, `removeItem`,
`duplicateItem → id?`, `moveItem(estimateId, itemId, toIndex)`, `setAllCollapsed(estimateId, collapsed)`,
`setCachedTotals(estimateId, totals | undefined)`, `updateSettings(patch)`, `replaceAll(state)`, `clearAll()`.

Quirks:

* New/duplicated/imported estimates are inserted **first**; duplicated items right after the original.
* `addItem` region defaults to `settings.lastRegion ?? settings.defaultRegion`; `updateItem` with a
  new region updates `settings.lastRegion`. Returns `undefined` for unknown estimate ids.
* `updateItem.config` is shallow-merged; keys with invalid values are ignored (console.warn), so a
  controlled input may briefly show a value the store did not accept.
* Mutations bump `estimate.updatedAt` — except collapse/expand (`collapsed`-only patches,
  `setAllCollapsed`), which are view state, and `setCachedTotals`.
* `estimate.cachedTotals` (`{ monthlyUsd, upfrontUsd, amortizedMonthlyUsd, pricesDate, computedAt }`, USD)
  is a display cache for the estimates list, written by the editor (`useCacheTotals`) whenever every
  item is priced. Never a price source and never shared. Treat it as stale when
  `computedAt < updatedAt` or `pricesDate` differs from the current snapshot. `setCachedTotals` is a
  no-op when the amounts/snapshot are unchanged and the cache is newer than the last edit.
* `notes: ""` removes the notes. `currency` is upper-cased.
* `replaceAll` validates/repairs (use it to restore a backup); `clearAll` also resets settings.
* Persisted data is validated on every load (`migratePersistedState`); invalid items are dropped
  with a console warning; corrupted JSON is kept under `azcalc.v1.corrupt-<timestamp>`.

Selectors: `useEstimates()`, `useEstimate(id)`, `useSettings()`.
Save indicator: `const { status, error } = useSaveStatus();` (`"saved" | "saving" | "error"`;
`error` is a user-facing message, e.g. storage full). `flushSave()` forces a write.

## `store/migrations.ts`

`migratePersistedState(persisted, fromVersion, { warn? })` → `PersistedState`: runs step
migrations (`MIGRATIONS[n]` turns vN into vN+1) and validates with schema defaults. Pure.
To add a schema version: bump `SCHEMA_VERSION` in `model.ts`, add the step, add a test.
