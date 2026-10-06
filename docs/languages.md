# Languages

Videos and interface in the same 13 languages:
`vi` `en` `fr` `de` `es` `pt-BR` `hi` `ja` `ko` `zh` `th` `id` `ru`.

**`src/i18n/languages.js` is the single table** — one row per language carrying script, word and
sentence boundaries, measured speaking rate, breath pad, line-height floor, number locale,
connectors, metadata labels and narration register. `tests/i18n-contract.test.js` fails if any
consumer drifts from it.

- `resolveLang(config, scenes)` is the one answer to "what language is this video"; detection is
  only for `auto`, and reports its own confidence.
- Chinese, Japanese and Thai are segmented with `Intl.Segmenter` (the vendored Node is full-ICU) for
  word counts, subtitles, line breaking and beat extraction alike.
- Per-script typography: Devanagari 1.8 line-height, Thai 1.7, Vietnamese 1.35; `letter-spacing` and
  `text-transform` withheld from scripts that have neither case nor separable letters.
- Font stacks gain the script's system families (macOS and Windows names) ahead of the generic
  keyword, and the loud-font probe checks them.

**Interface catalogues** are static JSON in `public/locales/` — about 2,200 interface strings and
570 manual strings per language, fetched at boot. The markup carries Vietnamese as the default, so a missing
key or a failed fetch degrades to Vietnamese rather than blank. Changing language writes the setting
and reloads. Server strings, HTTP errors, toasts and dialogs are translated where they are drawn,
keyed by their own text, so no call site changed.

Translation is machine-made behind blocking checks (`scripts/build-locales.mjs`,
`scripts/lib/locale-check.mjs`): placeholder parity, markdown markers, per-key length ceiling, no
stale keys, no echoed source, no Vietnamese left inside a non-Latin translation. `--fix`
re-translates what the checker rejected.

**Dub** (`pipeline/dub.js`) reuses the art direction verbatim and rewrites narration to a word budget
computed from both languages' speaking rates; on-screen text is rebuilt in the new language.
**Subtitle export** (`?lang=xx&format=vtt`) freezes the timings and re-renders nothing.

---
