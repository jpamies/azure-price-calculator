# Azure service icons

`azure/` holds a subset of Microsoft's official **Azure Architecture Icons**. The app uses them to
show which Azure service each line of an estimate refers to (`<ServiceIcon>` in
`web/src/components/ServiceIcon.tsx`, key resolution in `web/src/catalog/icon-map.ts`).

> **Unofficial tool.** Azure Price Calculator is a community project. It is not affiliated with,
> endorsed or sponsored by Microsoft. The icons are Microsoft's property; they are **not** covered
> by this repository's license.

## Where the icons come from

- Source: [Azure icons – Azure Architecture Center (Microsoft Learn)](https://learn.microsoft.com/azure/architecture/icons/),
  "Download SVG icons". The download is a ZIP at
  `https://arch-center.azureedge.net/icons/Azure_Public_Service_Icons_V<N>.zip`; `<N>` changes with
  every release, and so do the numeric prefixes of the file names (`10021-icon-service-Virtual-Machine.svg`).
- `scripts/sync_icons.py` finds the current ZIP link on that page (falling back to a pinned URL),
  downloads it and, for every key in its `ICONS` table, copies the first SVG whose name matches one
  of the key's name patterns to `azure/<key>.svg`.
- Files are copied **byte-for-byte**: no cropping, recoloring, optimisation or any other change.
- `azure/index.json` records the provenance:
  `{"source": "<zip url>", "version": "V<N>", "syncedAt": "<ISO date>", "icons": {"<key>": "<original file name>"}}`.
  The app only uses the keys listed there.

## Updating the icons

```bash
python3 scripts/sync_icons.py                          # discover, download and copy the current set
python3 scripts/sync_icons.py --zip-file path/to/Azure_Public_Service_Icons_V<N>.zip   # offline
python3 scripts/sync_icons.py --zip-url https://arch-center.azureedge.net/icons/Azure_Public_Service_Icons_V<N>.zip
python3 scripts/sync_icons.py --list --zip-file path/to/zip   # print every icon name in the set
python3 -m unittest scripts/test_sync_icons.py               # tests (offline)
```

The script prints each key as `found` or `MISSING`. A missing icon is not an error (exit code 0):
the app draws a neutral tile with a generic glyph instead (`FALLBACK_STYLE` in `icon-map.ts`). The
exit code is non-zero only when the ZIP cannot be downloaded or read, or contains none of the
expected icons; `azure/` is then left untouched.

To add or fix an icon: look the name up with `--list`, add or adjust the key's patterns in `ICONS`
(name without the numeric prefix, e.g. `Virtual-Machine`), add the same key to `ICON_KEYS` in
`icon-map.ts` and map service names to it, then re-run the script and commit `azure/`.

**CI:** the build workflow runs `python3 scripts/sync_icons.py --if-missing` as a best-effort step
before building the site. It does nothing when the committed `azure/index.json` already lists icons
(the repo ships an empty placeholder so the app never requests a missing file), and a failed
download never fails the build: the site then simply shows the fallback tiles.

## Terms of use

From the "Icon terms" of the [Azure icons page](https://learn.microsoft.com/azure/architecture/icons/):
Microsoft permits the use of these icons in architectural diagrams, training materials, or
documentation. You may copy, distribute and display the icons only for that permitted use unless
Microsoft grants explicit permission; Microsoft reserves all other rights. The page's guidelines add:

- Use an icon to illustrate the Azure product it represents, as it appears within Azure, ideally
  with the product name next to it.
- Don't crop, flip, rotate, distort or otherwise change an icon's shape (this project also does
  not recolor or re-encode them).
- Don't use Microsoft product icons to represent your own product or service.

This project only uses each icon next to the name of the Azure service it represents in a cost
estimate. If you fork, redistribute or reuse the icons elsewhere, check the current terms on the
page above yourself.
