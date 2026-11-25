# Module configuration forms (`web/src/modules`)

One form per pricing module, rendered by the item card as
`configComponents[item.moduleId]` (or `<ModuleConfig {...props} />`) with `ModuleConfigProps`
(`types.ts`). Forms render **inputs and inline hints only**; the card owns the region selector,
result lines, messages and subtotal.

| File | Form |
|---|---|
| `VmConfig.tsx` | OS (segmented), VM size picker (dialog: search, filters, sortable columns, virtualized, ↑/↓/PageUp/PageDown/Enter/Esc), instances, hours (+reset), savings options with % vs PAYG, RI payment, Spot (Advanced) |
| `DisksConfig.tsx` | Type, redundancy (options without prices disabled), disks; P/E/S by tier or by size (→ tier); Premium SSD v2 / Ultra size + IOPS + MB/s with baseline hints and limits |
| `BackupConfig.tsx` | Workload, protected instances, average size with the fee band, storage as % or GB (resulting GB), redundancy |
| `AsrConfig.tsx` | Scenario radio cards with the per-instance price, instances, what is not included |
| `SqlLicenseConfig.tsx` | Edition, vCPUs per VM (min 4 billed), VMs, hours, Azure Hybrid Benefit |
| `GenericConfig.tsx` | Service combobox (by family, icons), global meters, meter picker (virtualized), quantity labelled by unit, hours for hourly meters, marginal tier table |

Shared pieces (`shared/`): `Field`/`FieldGrid`/`FormRoot` (labels above controls, ids and
`aria-describedby` wired, container-query grid: 1 column, 2 from 32rem, 3 from 48rem of the
form's own width), `NumberField` (free typing incl. `1,000`/`5k`, commits on blur/Enter, clamps,
↑/↓ step, Esc reverts), `Segmented` (Radix radio group), `RichSelect`, `VirtualList`
(fixed row height windowing), `HoursField`, `data.tsx` (skeleton, error alert with Retry,
`PriceText`), `rows.ts` (rows of a shard ref) and `logic.ts` (pure helpers).

* Data-driven selectors show skeletons while their shard loads; `shards.status === "error"`
  shows an alert with **Retry** (`shards.retry`).
* Every patch passed to `onChange` is valid for the config schema (numbers are clamped).

## Dev harness (not shipped)

`web/modules-preview.html` + `__preview__/main.tsx` render every form with an in-memory item,
real catalog/shards, `computeItem` totals and lines. Vite builds `index.html` only.

```
node node_modules/vite/bin/vite.js --port 4175 --strictPort
# http://localhost:4175/modules-preview.html?region=westeurope&currency=EUR&theme=dark&width=680&module=vm
# nospecs=1 drops vm-skus specs (SKUs without specs)
```

## Tests

`node --test src/modules/shared/logic.test.ts` (pure helpers; not matched by the
`tests/**/*.test.ts` glob of `npm test`).
