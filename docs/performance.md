# Performance

How the interface boot is measured, and what it measured before and after the 2026-09 refactor.

## Measuring

```bash
npm run perf:boot                # Vietnamese interface, dev tree, 3 runs, medians
npm run perf:boot -- --lang en   # a translated interface pays for its catalogue too
npm run perf:boot -- --dist      # the release payload: built into a temp dir, served by the same server
```

`scripts/perf/boot-audit.mjs` boots a throwaway server on a **snapshot** of the live database
(`VACUUM INTO` a temp dir, every queued job cancelled so nothing starts rendering),
loads the UI in headless Chrome with the network log attached, and reports:

- requests and bytes on the wire, split by kind, plus the heaviest responses;
- `serial API hops` — the longest chain of API calls that each waited for the previous one;
- `boot-done` — `performance.mark('avs:boot-done')`, set by `main.js` when the shell is painted
  with real data; `idle-done` — after the idle-time catalogues (voices, presets, fonts) landed;
- the heaviest responses (a file response names its file) and the slowest ones by wall time.

The database snapshot is the user's real one (105 projects, 3,877 scenes at the time of writing),
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

## After — 2026-09-17, branch `refactor/perf-code-quality`

Same database snapshot, same machine, same harness. The dev tree is what `npm start` serves; the
release payload is what the shipped app serves (`--dist`).

| | before (dev) | after, dev tree | after, release payload |
|---|---|---|---|
| requests | 106 | 105 | **58** |
| bytes on wire | 11,765 KB | 1,023 KB | **939 KB** |
| serial API hops | 10 | 5–7 | 5–7 |
| `boot-done` | 274 ms | 231 ms | **201 ms** |
| `idle-done` | 1,781 ms | **549 ms** | 745 ms |
| DOMContentLoaded | — | 154 ms | 115 ms |

English interface, release payload: 59 requests, 990 KB (one 52 KB catalogue more), `boot-done`
188 ms, `idle-done` 795 ms.

By kind (release, vi): API 33 req / 725 KB · fonts 4 req / 99 KB · JS 16 req / 69 KB · HTML 30 KB ·
CSS 2 req / 14 KB. Of the API bytes, 20 requests are the gallery's thumbnails, now 34–41 KB each
(`/api/thumb`, 320 px, cached per file+mtime) instead of 450–580 KB; `/api/boot` is one 60 KB reply
where six sequential calls used to be, and a project row in it carries the head of its topic, not
the whole pasted script.

What made the difference, in order of bytes: thumbnails downscaled server-side (−9.5 MB); the
project list without `config`/`metadata` (−1.9 MB); no font stylesheets at idle — only the
selected family's, when the subtitle panel needs it (−250 KB); gzip on every text response; one
`/api/boot` instead of six round trips; the six pages and fifteen modals that are not on screen at
boot loaded on first click (in the release payload: 16 preloaded files, 17 lazy chunks); the `say
-v ?` process that every `/api/voices` reply waited ~0.9 s on, serving a field nothing read.

Not in the numbers: every script and stylesheet in the release payload is named by its content
hash and served `immutable`, so a second launch of the same build fetches only the document
(revalidated by ETag) and the API. The harness always measures a cold cache.

Where the remaining bytes are: 20 thumbnails (~750 KB) are the page — the gallery shows them —
and the four Lexend subsets (99 KB) are the typeface. The next step, if one is ever needed, is
WebP thumbnails at ~60 % of the JPEG size.


## Agent-ops pass — 2026-09-23, branch `feat/agent-ops`

The server lane (tokens, explicit channels, error codes, the event cursor, the verdict) adds work to
every request in **server mode only**: in desktop mode `apiAuth` returns on its first line and the
rest is untouched. Measured back to back on the same machine and the same live database, because a
number from a different day is not a comparison:

| dev tree, vi | `origin/main` (`d2c255c`) | `feat/agent-ops` |
|---|---|---|
| requests | 86 | 87 |
| bytes on wire | 402 KB | 405 KB |
| serial API hops | 6 | 6 |
| `boot-done` | 965 ms | 929 ms |

The two are within this machine's noise — on the day of the measurement the same commit produced
`boot-done` anywhere between 457 ms and 965 ms, and the one extra request is the boot's own shape
varying between runs. The table exists to show the absence of a regression, not to set a record: the
2026-09-17 figures above were taken on a quiet machine and remain the reference numbers.
