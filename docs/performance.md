# Performance

How the interface boot is measured, and what it measured before and after the 2026-09 refactor.

## Measuring

```bash
npm run perf:boot                # Vietnamese interface, 3 runs, medians
npm run perf:boot -- --lang en   # a translated interface pays for its catalogue too
```

`scripts/perf/boot-audit.mjs` boots a throwaway server on a **snapshot** of the live database
(`VACUUM INTO` a temp dir, every queued job cancelled so nothing starts rendering, licence bypassed),
loads the UI in headless Chrome with the network log attached, and reports:

- requests and bytes on the wire, split by kind, plus the heaviest responses;
- `serial API hops` — the longest chain of API calls that each waited for the previous one;
- `boot-done` — `performance.mark('avs:boot-done')`, set by `main.js` when the shell is painted
  with real data; `idle-done` — after the idle-time catalogues (voices, presets, fonts) landed.

The database snapshot is the owner's real one (105 projects, 3,877 scenes at the time of writing),
so the numbers describe the app as it is actually used, not an empty install.

## Baseline — before the refactor (2026-09-17, commit `fe04e7f`)

| | vi | en |
|---|---|---|
| requests | 106 | 105 |
| bytes on wire (no compression) | 11,765 KB | 11,909 KB |
| serial API hops before first data | 10 | 10 |
| `boot-done` | 274 ms | 248 ms |
| `idle-done` | 1,781 ms | 2,355 ms |

By kind (vi): API 48 req / 10,732 KB · JS 39 req / 458 KB · fonts 14 req / 252 KB · HTML 246 KB ·
CSS 76 KB.

Where the bytes went: `GET /api/projects` alone is **1,952 KB** (every project's full `config` and
`metadata`, including six cover designs and the thumbnail HTML); the home gallery then pulls
**21 project thumbnails through `/api/file` at 450–580 KB each** (full 1280×720 renders, no
resizing, no lazy loading) — ~10 MB for a page that shows a dozen 300-px cards. The idle phase
adds eight `/api/fonts/:family/css` stylesheets carrying base64 font data (≈250 KB) so that the
subtitle font `<select>` can preview each family, and `/api/settings` is fetched three times and
`/api/brands` twice by modules that do not share state.
