<div align="center">

# AI Video Studio

**A desktop studio that turns one line of text into a finished, narrated, motion-graphics video.**

`v1.0.0` · Node 22 · macOS (native) + Windows · 825 tests · 13 narration languages · 13 interface languages

</div>

---

Type a topic. Get an MP4 — script, per-scene animated graphics, neural narration, karaoke
subtitles, music, thumbnail and platform metadata — with nothing else to press.

That sentence is the product, and the rest of this document is what it costs to make it true.
The app is a **Node 22 backend** driving **headless Chrome** and **FFmpeg**, with a native shell
(WKWebView on macOS, Electron on Windows) around a dependency-free ES-module frontend. It runs
**fully offline** once its models are local, and degrades — loudly and on purpose — rather than
shipping something quietly worse.

```
  input ──► B2 script ──► b2.5 editorial ──► b2.75 duration fit ──► timing estimate
                                                                          │
      ┌───────────────────────────────────────────────────────────────────┘
      ▼
  B5 scenes ──► ⟨scene gate⟩ ──► B3+4 voice + subtitles ──► B6 render ──► ⟨review gate⟩
                                                                          │
      ┌───────────────────────────────────────────────────────────────────┘
      ▼
  B7 concat + mix ──► B8 QC ──► metadata ──► B9 publish ──────────────────► MP4
```

Two things in that line are the whole design. **Scenes are built before the voice**, so the
storyboard can be reviewed before a single TTS credit is spent. And the two ⟨gates⟩ are optional
holds, not failures — the run stops at its own status and waits for you.

## Contents

- [Quick start](#quick-start)
- [What it makes](#what-it-makes)
- [How a video is made](#how-a-video-is-made)
- [Architecture](#architecture)
- [Languages](#languages)
- [Providers and cost](#providers-and-cost)
- [Configuration](#configuration)
- [Quality](#quality)
- [Build and release](#build-and-release)
- [Operating it](#operating-it)
- [Known limits](#known-limits)
- [Protected behaviors](#protected-behaviors)
- [Appendix A — Decision record: the doctrine service](#appendix-a--decision-record-the-doctrine-service)
- [Appendix B — HyperFrames attribution (Apache-2.0)](#appendix-b--hyperframes-attribution-apache-20)

---

## Quick start

```bash
npm install
npm start                 # http://127.0.0.1:8123
```

or, without a terminal: double-click **`run.command`** (macOS) / **`run-windows.bat`** (Windows).
Both start the same server and open it in your browser.

```bash
npm run dev               # node --watch
npm test                  # 99 files, 825 tests, no network
```

### What has to be installed

| | Needed for | Missing ⇒ |
|---|---|---|
| **Node ≥ 20** (22 in practice) | everything | nothing runs. CI, esbuild and the shipped runtime are all 22.22.1 |
| **ffmpeg + ffprobe** | render, concat, probing | effectively mandatory |
| **Chrome / Chromium** | scene rendering, thumbnails, caption measuring | no video — but scene *validation* degrades to a skip rather than blocking |
| whisper-cli + a `ggml-*.bin` | word-accurate subtitles | subtitle timing falls back to `estimate` |
| `/usr/bin/say` | offline TTS | macOS only; the provider reports itself unavailable elsewhere |
| `pip install supertonic` | local neural TTS | that one provider is offline |

`GET /api/health` answers with exactly this, resolved:

```json
{ "ok": true, "version": "1.0.0",
  "deps": { "ffmpeg": true, "ffprobe": true, "say": true, "whisper": true, "chrome": true } }
```

Binaries are looked up in a fixed order — `AVS_*` environment override → the system PATH →
`vendor/` → the app bundle. System **first** is deliberate: the vendored FFmpeg is an x86_64 static
build and runs 4–7× slower under Rosetta on Apple Silicon.

---

## What it makes

### Four ways in, one canonical form out

The input box takes all four; the engine decides which by reading it
(`src/util/util.js` `detectInputType`, `src/content/master-script.js`):

| You paste | Detected as | What happens |
|---|---|---|
| A sentence | **topic** | plan → throughline → spine → scenes. The AI writes the whole video |
| ≥ 80 words | **detailed script** | **light polish only** — ≥ 90 % of your wording kept, ideas kept in order; duration follows the content, never the other way round |
| `{…}` / `[…]` | **scenes JSON** | validated and repaired import. **Zero LLM calls** |
| A URL | **article** | fetched, then used as *research* for a new script in the channel's voice — rewritten, never copied |

A fetched article outranks the word count: a long article is material for a new script, not an
owner's script to polish. That is why fetched text lands in its own panel and never back in the
topic box.

Every path converges on one canonical artifact —
`{ thumbnail{title,prompt}, scenes[{stt, voice, visual, assets}] }` — where each scene's `visual`
is a full eight-bracket motion-graphics brief (`[ENVIRONMENT] … [MOOD]`) that the renderer consumes
directly. It is written to `scenes.json` per project and re-exportable at any time.

### What comes out

A single MP4, plus: an SRT/VTT track (in any of 13 languages, with no re-render), a thumbnail with
up to three A/B compositions, six platform cover sizes, per-platform SEO metadata with YouTube
chapters, a QC report, and an audit-grade processing journal for the run.

### The parts a video is made of

- **Scene graphics** — the AI art-directs **every scene individually, following the narration word
  by word**: keywords, figures and icons appear exactly when the voice says them. Six locked visual
  styles, or describe a look and have one designed. ~130 offline icons, 25+ effects, real `three.js`
  and `p5.js` layers when a scene reaches for them.
- **Voice** — 10 TTS providers, one locked voice per video, per-scene EBU R128 normalization, a
  breath pad sized per language.
- **Subtitles** — karaoke captions showing the **exact script words**, timed by forced alignment
  (whisper donates timestamps only) or by the provider's own word marks. Thirty typographic controls.
- **Sound** — automatic BGM that ducks under the voice by sidechain compression, chapter-transition
  whooshes, and the whole programme mastered to **−16 LUFS / −1.5 dBTP**.
- **Motion between scenes** — velocity-matched cuts and dips planned from each scene's narrative
  role, with at most one hero transition per video.

---

## How a video is made

`src/pipeline/runner.js` sequences and nothing else — every stage is its own module handed the
shared context from `src/pipeline/context.js`.

| # | Stage | File | Produces | Can be turned off |
|---|---|---|---|---|
| 1 | **B2 · script** | `stages/script.js` | scenes, title, `scenes.json` | — |
| 2 | b2.5 · editorial gate | `stages/editorial.js` | rewrites only the scenes a free deterministic pass flagged | `editorial: false` |
| 3 | b2.75 · duration fit | `stages/budget.js` | one bounded tighten or enrich pass, ±12 % | `budgetFit: false` |
| 4 | timing estimate | `estimate.js` | estimated duration + word cues per scene | — |
| 5 | **B5 · scenes** | `stages/visuals.js` | per-scene `{css, html, script}` GSAP spec | — |
| — | *scene gate* | runner | holds at status `scenes` | `sceneGate: true` to enable |
| 6 | **B3+4 · voice + subtitles** | `stages/tts.js` | audio, `srt_json`, real durations | `enableVoice: false` (silent mode) |
| 7 | **B6 · render** | `stages/render.js` | one MP4 per scene + a preview frame | — |
| — | *review gate* | runner | holds at status `review` | `requireReview: true` to enable |
| 8 | **B7 · concat + mix** | `stages/finalize.js` | the joined, mastered video | `autoConcat: false` |
| 9 | **B8 · QC** | `stages/finalize.js` | `qc_report.json` — reports, never blocks | `qcGate: false` |
| 10 | metadata | `stages/metadata.js` | titles, tags, ≤ 14 YouTube chapters | `generateMetadata: false` |
| 11 | **B9 · publish** | `stages/publish.js` | upload, **private by default** | `autoPublish: true` to enable |

Progress is weighted `b2 8 · b5 25 · b34 32 · b6 25 · b7 10` (`public/js/views/progress.js`), with the
intra-phase fraction taken from real scene counts.

### Scenes before voice, on purpose

Visuals are designed against an **estimated** timeline, then time-warped onto the real voice at
render. Two things follow. The owner can look at the whole storyboard before a single TTS credit is
spent — that is what the scene gate is for. And when the real narration comes in faster or slower
than estimated, the scene does not drift: the harness maps authored time to real time per spoken
word (`S.tplWarp`), or by a flat ratio when there is no word map.

### The four gates

- **Scene gate** — holds after B5 at a distinct `scenes` status, showing the exact TTS cost
  (characters, credits or USD) before you release it. Money is only spent by an explicit click.
- **Review gate** — holds before the join; approve or reject each scene in the rough-cut player.
- **QC gate (B8)** — checks stream presence and duration drift on the assembled file and writes
  `qc_report.json`. **Warnings only** — it never withholds a finished video.
- **Budget guardrail** — an optional per-video USD cap. On reaching it the run *downgrades* to the
  free lanes (offline script, `edge` voice) rather than failing.

### When something goes wrong

Failures are classified by a stable code, not by their wording (`src/core/errors.js`):
`transient` and `rate-limit` earn exactly **one** automatic resume after 8 s; `config` and `resource`
surface immediately with an actionable hint, because retrying a missing API key eight seconds later
cannot help. Beneath that sit per-step retries, key and model rotation, a timbre-preserving TTS
fallback chain, and a post-render verify pass that re-renders any clip whose audio and video do not
match.

The one thing the app will not do is quietly ship something worse — see
[the no-fallback contract](#the-no-fallback-contract).

---

## Architecture

### Layers

| Directory | Owns | Start here |
|---|---|---|
| `pipeline/` | orchestration, the 9 stages, queue, governor, resume, concat | `runner.js`, `stages/`, `render.js`, `fingerprint.js` |
| `hyperframe/` | scene codegen: prompt, conversation, lint, render-validation | `prompt.js`, `codegen.js`, `validate.js`, `beats.js` |
| `animation/` | the scene page, the deterministic runtime, the frame loop | `harness.js`, `renderer.js`, `templates/` |
| `content/` | the Master Script Engine and deterministic script quality | `master-script.js`, `scorer.js`, `cta-audit.js` |
| `providers/` | every external service, each degrading gracefully | `llm.js`, `tts.js`, `voice/`, `subtitle.js` |
| `media/` | FFmpeg, Chrome, mastering, overlays, ASR | `ffmpeg.js`, `puppeteer.js`, `master.js`, `whisper.js` |
| `subtitles/` | cue timing, styling, the burned ASS file | `presets.js`, `ass.js`, `timeline.js`, `chunk.js` |
| `styleguide/` | the visual-identity contract shared by animation and codegen | `guide.js`, `presets.js`, `script-fonts.js` |
| `i18n/` | the language table and everything derived from it | `languages.js`, `segment.js`, `t.js` |
| `db/` | SQLite handle, DDL, migrations, repositories | `connection.js`, `migrate.js`, `repositories/` |
| `api/` | the whole REST surface (173 routes, one file) | `routes.js`, `services/` |
| `fonts/` | which typeface actually exists, and which file libass gets | `registry.js`, `files.js`, `coverage.js` |
| `license/` | offline verdict, activation, refresh, the API gate | `state.js`, `index.js`, `gate.js` |
| `core/` | config layering, cost, error taxonomy, budget | `config.js`, `pricing.js`, `errors.js` |
| `publish/` | per-platform upload + the platform limits table | `youtube.js`, `facebook.js`, `platforms.js` |
| `config/` · `util/` · `ws/` · `audio/` | paths, primitives, live progress, sound design | `paths.js`, `lang.js`, `hub.js`, `sound-design.js` |

The frontend is 39 native ES modules under `public/js/{ui,views,features}` — no framework, no
runtime dependency, bundled only for release. 6 pages, 15 modals plus the full-screen rough-cut
player, 8,218 lines.

### Want to change X? Go to file Y

| Want to change | Go to |
|---|---|
| the script engine (modes, gates, batching, the master prompt) | `content/master-script.js` (+ routing in `pipeline/stages/script.js`) |
| the offline / no-LLM script path | `providers/llm.js` (`offlineScript`, `twoStageScript`, `verbatimScript`) |
| the LLM retry / backoff / multi-key chain | `providers/llm.js` (`chat`, `chatOnce`, `chatJson`) |
| the scene codegen prompt | `hyperframe/prompt.js` — never slice the narration or brief it embeds (P19) |
| scene validation rules and thresholds | `hyperframe/validate.js` |
| what an animation lands on, and when | `hyperframe/beats.js` |
| **add a TTS provider** | `providers/voice/<name>.js` + one line in `voice/index.js`; the provider declares its own `ext` and which config fields are credentials, so the only other edit is a rate in `core/pricing.js` |
| **anything per-language** (reading speed, breath pad, connectors, line-height floor, number locale, word and sentence boundaries) | **`i18n/languages.js` — the one table.** `tests/i18n-contract.test.js` fails if a consumer drifts from it |
| how a language's words are counted or its lines broken | `i18n/segment.js` (`words`, `sentences`, `layoutTokens`, `wordJoiner`) |
| what a voice says for `85 %`, `16:9`, `15/3/2025` | `i18n/tts-rules.js`, one row per language |
| narration the app writes itself (chapter cards, the offline CTA) | `i18n/script-phrases.js` |
| a string in the **interface** | edit `public/index.html` (it carries Vietnamese as the default), then `node scripts/i18n-extract.mjs --write` and `node scripts/build-locales.mjs` |
| the in-app manual | edit `SECTIONS` in `public/js/views/guide.js`, then `i18n-extract-guide.mjs` + `build-locales.mjs --guide` |
| a **server** message the owner sees | just write it in Vietnamese — `i18n-extract-server.mjs --write` keys it by its own text and `routes.js` translates `error`/`message`/`hint` on the way out |
| a toast or a dialog | same: write it, then `i18n-extract-ui-msgs.mjs --write` |
| how a failure is classified | throw `failed('<code>', '…')` from `core/errors.js`. **Never** rely on the wording — that was the old design and it made every message untranslatable |
| subtitle look, timing or the burn | `subtitles/presets.js` (style), `subtitles/chunk.js` (cues), `subtitles/ass.js` (the file) |
| a video rendering in the wrong font for its script | `styleguide/script-fonts.js` (video) · `subtitles/presets.js` `perLangDefaults` (burn) · `scripts/build-fonts.mjs` `UI_SUBSETS` (shell) |
| transitions between scenes | `pipeline/render.js` (`planTransitions`) |
| the audio mix, ducking or mastering | `pipeline/render.js` (mix graph) · `media/master.js` (−16 LUFS) |
| **dub a finished video** into another language | `pipeline/dub.js` |
| **export a subtitle track** in another language | `subtitles/translate.js` · `GET /projects/:id/srt?lang=xx&format=vtt` |
| cost rates or the budget guardrail | `core/pricing.js` · `core/budget.js` |
| what the licence blocks | `license/gate.js` · `license/state.js` |
| the release pipeline | `scripts/release.mjs` · `shell/build-app.sh` |

### The no-fallback contract

Scene codegen runs on the **primary model only**. Up to **10 corrective attempts** per scene, with
the validation defects fed back each round — then the run **fails loudly**, naming the exact scenes.
No fallback model, no heuristic-template substitution. It is enforced in three places at once: the
fallback model is *deleted from the config object* before the call, the attempt loop throws when
exhausted, and the render-stage template swap is explicitly skipped for these scenes. Resume retries
only the scenes that failed.

The reasoning is in the code: a quiet mediocre scene ships and nobody notices; a loud failure gets
fixed.

Validation itself is deliberately tiered. Only a **structural** failure re-asks the model — the
script threw, or the scene renders blank. Every layout finding (overflow, overlap, caption
collision, centre-clump) is an advisory warning. Wrong on-screen language re-asks at most **three**
times and then ships with a warning, because on one 95-scene video the alternative was 22 blocked
scenes.

### Data

SQLite (`better-sqlite3`, WAL, foreign keys on) at `data/studio.sqlite` — **22 tables**, 13 indexes.
New tables are born as `CREATE TABLE IF NOT EXISTS` in `db/connection.js`; every column change is a
numbered migration in `db/migrate.js` (**6** so far, append-only).

Each migration runs **inside one transaction together with its version bump**, so a crash mid-migration
rolls back cleanly and can never leave a half-migrated schema at a bumped version. Before applying
anything pending, the DB is checkpointed and copied to `data/backups/` (latest 10 kept).

The tables worth knowing: `projects` · `scenes` · `channels` · `jobs` (the durable ledger) ·
`scene_takes` (every regen is rollback-able) · `renders` (every export, with its config snapshot) ·
`journal_events` (the per-run audit journal) · `provider_usage` (per-call metering) ·
`voices_cache` · `channel_memory` (the Show Bible and the anti-repeat ledger).

### Durability

- **Job queue** — persisted in `jobs`. `claimNextJob` is a single SQL transaction enforcing three
  invariants at once: one running job per project, one per batch, priority then FIFO. Lanes are
  capped at `pipeline 2 · render 2`. Ticks are self-rescheduling `setTimeout`s, so they can never
  overlap.
- **Resource governor** — counting semaphores shared by every concurrent run, above the per-project
  knobs. Capacity is re-derived on each acquire from free RAM and load average, and can only ever
  *shrink* below its base, never grow past it. In-flight permits are never revoked.
- **Crash recovery** — at boot, orphaned `running` projects become `paused`, pending stops are
  re-armed, and orphaned jobs are requeued in a deliberate order: a requested stop outranks
  recovery, a job that died twice becomes a terminal error, everything else is requeued. A requeued
  job is always treated as a *continuation*, so artifacts already on disk are not rebuilt.
- **Stop** — cooperative and durable. The disk flag is written *before* the in-memory one, because
  the case this exists for is the app dying between the two. Long child processes (the concat encode,
  the master remux) get an `AbortSignal`, since checkpoints sit between steps and cannot interrupt a
  15-minute FFmpeg run.
- **Content-hash resume** — `scenes.fp` holds a fingerprint per artifact. Edit one scene's script and
  only *that* scene re-records and re-renders. A `NULL` fingerprint means "trust the artifact", so
  upgrading never triggers a mass re-synthesis. API keys and base URLs are deliberately **excluded**
  from the hash: rotating a key must not re-voice a video.
- **Concat-level resume** — a second fingerprint split into a video half and an audio half, yielding
  four tiers: `skip` (reuse the file), `audio` (`-c:v copy`), `copy` (stream-copy concat), `encode`.
  Every tier announces itself in the log, because a silent shortcut is how "why didn't my video
  update?" bugs are born.

### Determinism

A scene is a **paused GSAP timeline**; a frame is a pure function of time. `window.__seek(t)` maps
real time to authored time, sets every animation's `currentTime`, redraws the background, caption
and progress layers, then runs any `three.js` / `p5.js` layer's `__onSeek` hook last. Headless Chrome
screenshots each frame into an FFmpeg pipe — flat memory at any video length.

`scripts/determinism.mjs` loads the same scene twice and compares SHA-256 of frames at identical
timestamps. Page-side code always travels as a **string, never a function**: a release runs from V8
bytecode against a blank placeholder source, so `fn.toString()` would return whitespace.

Per-scene encode is `libx264 -preset medium -crf 18 -profile:v high -level 4.0 -pix_fmt yuv420p`,
audio `aac 160k 44.1 kHz stereo`, at 30 fps by default and 1080p / 2K / 4K rungs. Rendering happens at
the **physical** resolution while codegen and validation stay in the **logical** canvas, so a scene
designed once looks identical at every rung.

---

## Languages

The app makes videos in **13 languages** and shows its own interface in the same 13.

`vi` · `en` · `fr` · `de` · `es` · `pt-BR` · `hi` · `ja` · `ko` · `zh` · `th` · `id` · `ru`

**One table answers every per-language question.** `src/i18n/languages.js` holds one row per
language carrying its script, how its words and sentences are found, its measured speaking rate,
breath pad, line-height floor, number locale, forward connectors, production-metadata labels and
narration register. Seven places used to answer "which languages are supported" and none of them
agreed — 13, 13, 11, 10, 9, 6, 3. `tests/i18n-contract.test.js` now fails if any consumer drifts.

What that buys, concretely:

- **The declaration wins.** `resolveLang(config, scenes)` is the single answer to "what language is
  this video", threaded to the voice, the pad, the text normalizer, the subtitle engine and the
  codegen prompt. Detection is only for `auto`, and it reports whether it is *sure* — so a correct
  French headline is never re-asked as a wrong-language defect.
- **Chinese, Japanese and Thai are counted properly.** They write no spaces, so `Intl.Segmenter`
  (the vendored Node is full-ICU) finds their words for the script-mode floor, the near-duplicate
  gate, sentence subtitles, caption line-breaking and beat extraction alike.
- **Each script gets the typography it needs** — Devanagari matras get line-height 1.8, Thai tone
  stacks 1.7, Vietnamese stacked marks 1.35; `letter-spacing` and `text-transform` are withheld from
  scripts that have no case or build letters out of clusters.
- **A face that can actually draw it.** Nothing outside Latin and Vietnamese is bundled, so the
  guide's font stacks gain the script's system families (macOS *and* Windows names) before the
  generic keyword, and the loud-font probe checks that third face too.

### The interface

Catalogues are **static JSON** under `public/locales/` — 13 interface files (906 keys each) and 13
manual files (435 strings each), fetched at boot. The markup carries Vietnamese as the **default**,
so a missing key, a failed fetch or an untranslated language degrades to a Vietnamese interface
rather than an empty one, and the app still boots with no network.

Changing the language writes the setting and reloads. A live swap would need three page hooks, two
boot-time label patches and every open modal's renderer to be idempotent — none of which they are —
for an action taken about once.

Server strings, HTTP error bodies, toasts and dialogs are translated **where they are drawn**, keyed
by their own Vietnamese text (the gettext model), so none of the ~230 toast calls, 45 dialogs or 58
error responses needed editing.

Translation is machine-made behind blocking checks (`scripts/build-locales.mjs` +
`scripts/lib/locale-check.mjs`): placeholder parity, markdown markers, a per-key length ceiling
calibrated against nine real catalogues, no stale keys, no echoed source, and no Vietnamese left
inside a non-Latin translation. `--fix` re-translates exactly what the checker rejected.

### One video, many markets

- **`🌍 Dub`** — the art direction travels verbatim (each scene's brief is already English), the
  narration is re-written to a word budget computed from *both* languages' measured speaking rates,
  and the on-screen text is rebuilt in the new language against the same brief. Same design, new
  language. Creating a dub spends nothing; starting it stays an explicit click.
- **`?lang=xx&format=vtt`** — a subtitle track in any of the 13 languages with the timings frozen
  (same count, same start, same end, asserted after the model replies). No frame is re-rendered.

---

## Providers and cost

Every provider is optional and every one degrades. The app works with none of them configured — it
just works less well, and says so.

### LLM

One protocol for all: `POST {baseUrl}/chat/completions` with a bearer key. Providers are pure data
(`providers/llm-presets.js`), so adding one is a table row.

| Preset | Tier | Script + codegen | Notes |
|---|---|---|---|
| **Google Gemini** | free | ✅ | no card; also serves the image and TTS lanes |
| **OpenRouter** | free | ✅ | no card |
| Groq | free | — | TTS lane only |
| Together AI | cheap | — | image + TTS lanes |
| OpenAI | premium | — | image + TTS lanes |
| ✏️ Custom | — | ✅ | any OpenAI-compatible endpoint; `localhost` needs no key |

Only presets that serve **Gemini** get the script/codegen lane, because scene codegen is measured to
be dominated by that model family and the two settings are shared. Everything else stays in the
catalogue for the lanes it is genuinely good at.

Runtime: multiple keys per provider (a key that hits its quota is skipped), a 4-attempt ladder per
key per model with `8 s / 20 s / 45 s` backoff, a wall-clock ceiling, and an offline deterministic
script writer when nothing is reachable.

### Voice — 10 providers

| | Free | Network | Why you would pick it |
|---|---|---|---|
| **Edge Neural** | ✅ | ✅ | keyless, ~400 voices, the default |
| **macOS `say`** | ✅ | — | fully offline, macOS only |
| **Supertonic** | ✅ | — | neural, runs on your own machine |
| **Azure Speech** | | ✅ | ~150 locales; `mstts:express-as` styles — the first provider that can use the per-scene mood the pipeline already computes |
| **Google Cloud TTS** | | ✅ | strongest for Hindi, Thai, Indonesian |
| **Amazon Polly** | | ✅ | **real word timestamps** via speech marks — captions timed by the engine that spoke them, no transcription pass |
| **ElevenLabs** | | ✅ | premium multilingual; also returns word timing |
| **OpenAI TTS** | | ✅ | shares the LLM preset list |
| **Vbee** · **LarVoice** | | ✅ | Vietnamese specialists (LarVoice bills opaque credits) |

The chosen voice is **locked**: a failure retries the same voice three times before the chain may
switch, the fallback picks the cached voice closest in language and gender, and any scene that ended
on a fallback is retried once on the primary at the end. Implausibly long or short audio is treated
as a failed attempt, never accepted.

### Everything else

Image editing (OpenAI-compatible `/images/edits`) · image search (Tavily → keyless Openverse →
offline gradients, each degradation reported) · ASR (local whisper.cpp) · trends (Google Trends +
Google News in the channel's own market, plus curated RSS packs) · article fetching (structural
extraction with an optional AI refinement pass that never blocks).

### Cost

Every LLM and TTS call is metered per video and streamed live (`provider_usage`,
`GET /api/usage`). Rates live in `core/pricing.js` (`PRICING_VERSION 2026-08`): 44 model prefixes
plus per-1k-character TTS rates. Free providers meter as zero. An optional **per-video USD cap**
downgrades the run to the free lanes rather than failing it.

Cost is disclosed in four places before it is spent: the scene gate's TTS estimate, the change-plan
table, the sticky pending-changes bar, and the assistant's pre-create sheet. **Nothing that costs
money starts without an explicit click.**

---

## Configuration

Five collapsible groups in the Studio's config column, each a summary card that opens into a modal.
Settings merge in a fixed order — **app defaults → channel → preset → this video** — and only
`undefined` is skipped, which is why "auto" values must be emitted as `undefined` and defaults like
`durationMode` must always be explicit.

| Group | What is in it |
|---|---|
| 🎞 **Format & quality** | visual style, motion density, creative direction, per-video codegen model, consistent-scenes, image-full, brand-asset casting, overlay mode · fps, resolution rung, language, aspect, duration mode, video and scene length |
| 🏷 **Channel brand** | Brand Kit (name badge, logo stamp, drifting watermark), brand display font |
| 💬 **Subtitles** | 30 controls: preset, mode, chunking, type, color, outline, shadow, glow, box, position, motion — with a live preview through the real burn path |
| 🎙 **Voice & music** | voice picker, BGM, automatic music, AI sound design, silent mode |
| ⚙ **Advanced** | transitions and style, metadata and SEO style, auto-concat, review gate, scene gate, TTS and render concurrency, project assets |

Channel presets save and restore the whole panel; switching channel resets it to that channel's own
defaults, so one channel's fonts can never leak into another's.

---

## Quality

```bash
npm test              # 99 files, 825 tests, hermetic — no network, no Chrome
npm run test:smoke    # every template built in 16:9 and 9:16, GSAP compiled
npm run test:e2e      # boot, make a real short video, verify the MP4
```

Beyond the unit suite:

| Harness | What it proves |
|---|---|
| `scripts/determinism.mjs` | the same scene rendered twice is byte-identical |
| `scripts/hf-qa.mjs` | a rendered scene meets its visual and timeline invariants |
| `scripts/parity/` | a live 8-item checklist scored against the reference app, plus a blind A/B builder |
| `scripts/e2e-resume.mjs` | an interrupted project resumes and still produces a valid MP4 |
| `scripts/cta-audit.mjs` | a script's CTA map; exits non-zero on a discipline defect |
| `scripts/audit-release.mjs` | reads the built `.app` like a curious customer and fails if anything is readable |

**CI** (`.github/workflows/ci.yml`) runs on every push to `main` and every PR: Ubuntu, Node 22,
FFmpeg installed, `npm ci`, `npm test`. Scope is deliberate — network providers and the Chrome render
smoke are local-only, because a CI job that needs an API key is a CI job that goes red for reasons
nobody can fix.

Regression tests are **named after the behavior they protect**, not the file they live in. See
[Protected behaviors](#protected-behaviors).

---

## Build and release

```bash
npm run shell:build          # dev .app pointing at this checkout
npm run shell:build:dist     # release .app — bundled, bytecode-compiled, encrypted
npm run win:build            # Windows NSIS installer
npm run release -- --version 1.1.0 --notes-file NOTES.md
```

`scripts/release.mjs` is the whole thing, in order:

1. Fetch the store's public key and **bake** it (with the store URL and client key) into
   `src/license/config.js` — registering the restore handler *immediately*, so it can never reach a
   commit.
2. Bump the version · 3. Build the `.app` · 4. Move the sourcemap out of the payload and out of git.
5. **`audit-release.mjs`** — the release refuses to ship readable code.
6. `codesign` · 7. `ditto` to a zip, sha256 + size · 8. optional notarise + staple + re-zip.
9. Upload and publish the version to the store · 10. `finally` restore the baked file.

### What ships

The macOS release contains **no readable source**. `src/server.js` is bundled by esbuild into one
CJS file, compiled to V8 cached data, optionally AES-256-GCM encrypted, and loaded by a small
`loader.cjs` that verifies the V8 build, the flags and a SHA-256 **before** V8 sees the bytes — and
refuses rather than falling back. The decryption key is generated fresh per build, compiled into the
launcher, and handed to the backend **over stdin** (not argv, not env — `ps` prints those). The
payload is scrubbed of maps, type definitions, tests, dotfiles and every non-licence markdown file.

Windows is honest about being different: it ships `src/**` inside an asar with no bytecode step.

### Supporting scripts

`fetch-node.mjs` (checksum-verified portable runtime) · `build-fonts.mjs` (scene + UI font pipelines
under a hard byte budget) · `build-libs.mjs` (three.js, p5, GSAP plugins, each with a size floor so a
CDN error page is never vendored) · `build-whisper-model.mjs` · `build-icon.mjs` ·
`build-frontend.mjs` (39 ES modules → one minified file) · `build-locales.mjs` + four `i18n-extract-*`
tools · `journal.mjs` (writes the daily production log and commits it).

---

## Operating it

| | Where |
|---|---|
| Database | `data/studio.sqlite` (WAL) · backups in `data/backups/` |
| Projects | `data/projects/<id>/{audio,srt,html,render,assets,output}` |
| Library | `data/library/{brand,bgm,sfx,fonts}` |
| Release data dir | `~/Library/Application Support/AI Video Studio` |
| Per-run journal | the **Nhật ký xử lý** panel, and `journal_events` — survives reloads and restarts |
| All jobs | the **🗂 Tasks** view: every queued, running and recent job across all projects |
| Daily log | `JOURNAL.md`, written by `scripts/journal.mjs` on a launchd schedule |

**Troubleshooting starts in the journal.** It is grouped by stage with measured durations,
scene-linked lines, retries and errors highlighted, searchable and exportable — a video finished last
week still tells its whole story.

Common answers: a red dependency chip in the top bar means FFmpeg or Chrome is missing; a run stuck
at `scenes` or `review` is a gate waiting for you, not a crash; "why didn't my video update?" is
answered by the concat tier printed in the log; and a project that came out in the wrong language has
a repair lane (`scripts/repair-language.mjs`).

---

## Known limits

Stated plainly, because a README that only lists strengths is marketing.

- **Right-to-left scripts (Arabic, Hebrew, Persian) are not supported.** Karaoke captions render one
  `<span>` per word, and isolated spans break Arabic letter joining — this needs the caption renderer
  redesigned, not a `direction: rtl`. The fonts are already in the catalogue for when it is done.
- **276 interpolated server strings and 41 toasts are still Vietnamese.** They are built at runtime
  so they cannot be keyed by their own text; they appear in the processing journal and logs, not in
  the interface chrome. The count is printed by the extractors rather than rounded away.
- **The Windows build has no code protection** — it ships readable source inside an asar. Only the
  macOS release is bundled and bytecode-compiled.
- **Prompts are visible to whoever owns the LLM key.** Since the customer brings their own key, the
  doctrine appears in their provider dashboard. This is an accepted trade, not an oversight — see
  [Appendix A](#appendix-a--decision-record-the-doctrine-service).
- **Scene codegen costs one LLM call per scene.** Past ~40 scenes that is the dominant cost of a
  video, and the UI says so before you start.
- **No LICENSE file.** This is a commercial product with a licence gate; the source is not offered
  under an open-source licence. Third-party obligations are honoured in
  [Appendix B](#appendix-b--hyperframes-attribution-apache-20).

---

## Protected behaviors

Hard-won fixes, each proven by a real failure. A refactor may **relocate** any of them — update the
anchor here when you do — but changing their logic, constants or ordering is a regression, and
`tests/protected-behaviors.test.js` carries one named test per entry.

The rule these encode: **when a behavior exists because something once went wrong, the reason
belongs next to it.** That is why the table below is long and why the code it points at is full of
measurements rather than adjectives.

Entries marked **+v3** were extended, not replaced, when the durable-infrastructure work landed;
the original guarantee still holds and the addition sits beside it.

| # | Behavior | Where it lives |
|---|---|---|
| P1 | `chatOnce` floors `max_tokens = 16000` (reasoning models burn tokens on hidden thinking) | `providers/llm.js:57` |
| P2 | `chatJson` enables `response_format:json_object` only on the first attempt (the gemini proxy returns garbage otherwise) | `providers/llm.js:121,124` |
| P3 | Catch **429/rate-limit BEFORE dead-key**, backoff [8s,20s,45s]×4 | `providers/llm.js:26,38–42` |
| P4 | `minScenes ≥70%` (single) / `≥60%` (per-chapter) to guard against the model returning too few scenes | `providers/llm.js:281,331` |
| P5 | `LANG_WPS` (vi 4.4…) — word count based on real reading speed | `i18n/languages.js` (`wps` column) · re-exported from `providers/llm.js` |
| P6 | `qc.probeStreams` strips the trailing comma from ffprobe csv; `pix_th=0.04`; `tailAllowance`; defect mapping prioritizes exact-containment; **+v3:** `qcSceneClip` `expectVoice` flags near-silent narrated clips (mean < −50dB) | `pipeline/qc.js` |
| P7 | TTS: an explicit `ttsOverride.provider` beats `langVoices`; voice-lock retries 3× with the same voice; **+v3:** the edge fallback lane picks `nearestCachedVoice` (timbre-preserving) | `providers/tts.js` |
| P8 | B5 hyperframe **skips a `chapter-break` scene with props** (keeps the anchor SFX); on successful codegen it sets `video_path:null` (so resume re-renders) — take activation & repurpose do the same | `pipeline/stages/visuals.js` · `db/repositories/takes.js` · `pipeline/repurpose.js` |
| P9 | −16 LUFS semantics + `apad` by language (vi 650ms/en 400ms). **v3 relocation:** per-scene = measured LINEAR loudnorm (`normalizeVoice`); the −16 authority for the finished file = `media/master.js` two-pass master; the concat graph carries NO loudnorm (ducking + limiter only) | `media/ffmpeg.js` · `media/master.js` · `stages/tts.js` |
| P10 | Multi-tier self-heal: render retry → swap `kinetic-statement` template → deferred sequential → QC repair (guard `_qcAttempt<1`); auto-resume once (`_auto<1`) — **v3:** only for retryable error classes (`core/errors.js`); deterministic config/resource errors surface immediately (never fewer resumes than before) | `pipeline/runner.js` · `stages/render.js` · `stages/finalize.js` |
| P11 | beats: `MIN_GAP=1.2 HOLD_MAX=2.6 LEAD=0.12`; filter out punctuation-only beats | `hyperframe/beats.js:147–149` · stopwords in `i18n/stopwords.js` |
| P12 | QA/determinism `PSNR_OK=70`; `FROZEN_TAIL` when `tlDur<dur-0.4`; `SUBTITLE_COLLISION cy>0.82H` | `scripts/{determinism,hf-qa}.mjs`, `hyperframe/validate.js` |
| P13 | recover zombie 'running'→'paused' at boot; **+v3 superset:** orphaned running JOBS requeue (`requeueZombieJobs`, attempts≥2 → terminal error); the clean review hold uses a DISTINCT `'review'` status so it is never mistaken for a crash | `db/repositories/projects.js` · `db/repositories/jobs.js` |
| P14 | mask secrets at every egress + `applyMaskedUpdate` round-trips `••` | `util/secrets.js`, `core/config.js` |
| P15 | `/api/file` path allowlist (data/ + channel roots + app bundle read-only) | `api/routes.js:426` |
| P16 | Assistant proposals never auto-start a paid pipeline: `suggestTopics`/`buildSeries` persist DATA only; `planWeek` + recurrences create SLOTS only; the sole path from a suggestion to a running pipeline is `acceptSuggestion` behind an explicit owner click (slot promotion stays the owner-scheduled semantic) | `api/services/topic-autopilot.js` · `api/services/assistant.js` |
| P17 | Scene gate never auto-spends: with `config.sceneGate` the run holds after B5 at the DISTINCT `'scenes'` status via a clean return (mirrors the review hold — never `'paused'`/error path, so P13/P10 stay inert); the ONLY writer of `projects.scenes_approved_at` is the explicit owner route `POST /projects/:id/approve-scenes`; TTS resume-skip requires a real `audio_path`, so estimated timing (`pipeline/estimate.js`) can never suppress synthesis; scheduler settles a `'scenes'` hold as job `done` | `pipeline/runner.js` · `api/routes.js` · `pipeline/scheduler.js` |
| P18 | Master scenes-JSON contract: every path out of the master engine (LLM chunks AND pasted-JSON imports) runs `repairScenesSpec` when defects remain, and the repair DROPS `META_LEAK`/`NOT_SPEAKABLE`/`EMPTY` voices — a CTA-note/hashtag/thumbnail-prompt line can never reach TTS; the canonical export (`scenesJsonFromRows`, artifact + `GET /projects/:id/scenes-json`) carries ONLY `thumbnail{title,prompt}` + `scenes[{stt,voice,visual,assets}]` (no `duration`, stt continuous from 1); a pasted DETAILED script (≥`SCRIPT_MODE_MIN_WORDS`) is the owner's words — `stages/budget.js` never trims it toward a duration target | `content/master-script.js` · `pipeline/stages/script.js` · `pipeline/stages/budget.js` |
| P19 | HyperFrame codegen prompt carries the scene's COMPLETE narration + visual brief VERBATIM: `buildCodegenPrompt` embeds `scene.voice_text` and `scene.visual_prompt` untrimmed (the whole chain B2 → DB rows → B5/regen passes full rows, and prompt.js — the last hop — never slices either field), so the generated HTML can actually follow what is spoken | `hyperframe/prompt.js` |
| P20 | LLM SRT-correction contract: only the whisper-transcription lane may be corrected; a reply must keep the EXACT block count and every timestamp (±10 ms) or it is DISCARDED and the original cues ship; karaoke words are redistributed only inside cues whose text changed; offline = clean no-op | `subtitles/llm-correct.js` · `providers/subtitle.js` |
| P21 | Sound-design plan sanitizer: BGM/SFX resolve against the REAL library only, volumes clamp (BGM 0.06–0.18 pre-duck, SFX 0.3–1.0), no two SFX within 1 s, event count capped ~1/5 s; an unusable plan returns null and the deterministic ambient-bed + chapter-whoosh path ships byte-identical (concat BGM pre-duck stays 0.22 when no plan) | `audio/sound-design.js` · `stages/finalize.js` · `pipeline/render.js` |
| P22 | Image-full media substitution happens AFTER lint and never ships a broken reference: `{{asset:NAME}}` resolves to hero-sized data URIs, unresolved placeholders are stripped (an `<img>` with one is removed whole); scene-asset names persist on rows and ride the canonical export's `assets` field (shape unchanged) | `hyperframe/codegen.js` · `db/migrate.js` (id 4) · `content/master-script.js` |
| P23 | Edit-by-prompt passes the SAME gates as fresh codegen (normalize → lint → syntax → renderValidate); a violating edit persists NOTHING (spec, clip and takes untouched); a clean edit snapshots a take before and after and clears `video_path` so the clip re-renders | `api/services/edit-scene.js` |
| P24 | Overlay mode strips every stage dressing from page AND template (particles/grid/vignette/grain/watermark/progress/motif/deco/beat-pulse) so the key color stays clean; captions stay; `backdrop-filter` is a lint ERROR in overlay specs; renderValidate adds the center-coverage gate (solid paint ≤40% of the center window) and drops stage-density checks that contradict overlay; composite = `colorkey key:0.3:0.2` over a footage slice offset by the scene's final-timeline start | `animation/harness.js` · `animation/templates/hyperframe.js` · `hyperframe/{lint,validate}.js` · `media/ffmpeg.js` |
| P25 | NO-FALLBACK codegen contract (owner order 2026-07-17): HyperFrame codegen uses the PRIMARY model only — `generateSceneSpec` defaults to 10 attempts and THROWS when exhausted; B5 strips `modelFallback` from the codegen `ai`, never swaps in a fallback model or a heuristic template, marks failed scenes `error` and fails the stage with the exact scene list (resume retries only those). P10's render-crash template swap now applies to NON-hyperframe fallback scenes only (a `kinetic-statement`/`chapter-break`/legacy-template row) — a hyperframe scene retries as-is (immediate + deferred sequential) and, failing that, the run fails loudly | `hyperframe/codegen.js` · `pipeline/stages/visuals.js` · `pipeline/stages/render.js` |
| P26 | Logo-stamp WYSIWYG contract (owner order 2026-07-17 revised: the stamp is the ONLY logo lane — smart/per-scene logo placement was removed as impractical): `logoRect` (center+width FRACTIONS → integer pixels) is the ONLY placement formula — the Brand Kit preview mirrors it in CSS percentages (corner presets = 2.5%-of-min-dim gap, plus free drag) and `concatScenes` passes its literal integers to scale/overlay (no runtime expressions), so preview = render by construction (pinned by a raw-frame pixel probe); applies in EVERY visual mode. `resolveBrandKit` exposes badge/stickers only, never a logo; legacy smart/always configs (no `finalOverlay` key) auto-migrate their logo geometry onto the stamp in finalize, and legacy `{size, position}` `config.logo` shapes keep the old ffmpeg branch | `media/logo-overlay.js` · `pipeline/render.js` · `pipeline/stages/finalize.js` · `animation/branding.js` |
| P27 | Brand-gen fidelity (owner order 2026-07-17): emotion-list + character-image prompts are byte-verbatim reference-app copies with EXACTLY one edit — the background sentence hardened to mandatory true-alpha transparency; generation runs the settings-selected images/edits provider+model ×10 with NO fallback then fails loudly naming both; every accepted PNG passes `verifyTransparentBg` (alpha pix_fmt + ≥3 clear 8×8 corners) and a failed gate consumes an attempt with the hardening re-ask line; filenames keep the reference scheme `character <name> <emotion>.png`; provider keys mutate server-side only (masked-array round-trip would clobber them) | `api/services/brand-gen.js` · `providers/imagegen.js` (editImage) · `media/ffmpeg.js` (verifyTransparentBg) |
| P28 | Copyright-watermark contract: ONE piecewise perimeter path — `perimeterPos` (fractions) drives the Brand Kit preview ghost and `perimeterExpr` emits the SAME path as pure t-based ffmpeg expressions (overlay vars `W/H/w/h`, drawtext vars `w/h/tw/th` — never mixed); toggle off ⇒ the concat graph is byte-identical to before the feature (no-op); text lane always goes through `textfile=` (no drawtext escaping), fonts only from the vendored Vietnamese-safe TTF set; deterministic (no wall clock, no randomness) | `media/watermark.js` · `pipeline/render.js` · `pipeline/stages/finalize.js` |
| P29 | Subtitle display contract: plain/karaoke mode and sentence/N-word chunking are PRESENTATION-layer rebuilds — `rechunkCues` reconstructs display cues strictly from the canonical srt_json WORD TIMESTAMPS (every cue starts on its first word's real start, ends on its last word's real end; auto = pass-through by reference; word-less estimate-era cues untouched), beats/QC keep reading the raw srt_json; plain mode never emits the karaoke word sweep (the harness skips fut/act/past); sentence cues wrap to max 2 lines (height-fit) instead of shrinking to fit 1. (The libass ASS-burn caption path was removed with the image mode — P36; captions now render only as harness DOM.) | `subtitles/chunk.js` · `animation/{index,harness}.js` · `subtitles/presets.js` |
| P30 | Font fidelity contract: `subtitleFont` is stored/consumed as a BARE FAMILY (`familyName` strips legacy CSS stacks) and the owner's pick ALWAYS wins — harness captions get `'<family>', -apple-system, sans-serif` (before this fix the pick only reached the ASS path), libass gets the plain family name; the brand display font keeps flowing via `brandFontStack`→guide; every page force-loads all declared faces then probes `document.fonts.check` for the picked subtitle + brand families and returns `fontMiss` from `__init` — the renderer WARNS on any miss (never a silent substitute) | `subtitles/presets.js` · `animation/{harness,renderer,index}.js` |
| P31 | Every-video-unique contract (owner order 2026-07-18, reference-app parity): the final video is the SCRIPT's scenes and nothing else — no synthetic intro/outro cards, ever (the master script's closing-CTA scene, codegen'd like any scene, IS the ending; reference sessions: clip count == scene count). Per-project diversity: `sceneSeed` XORs a project-id hash into the scene seed (no project id → legacy `idx+1`, byte-identical) and `motionSignature` takes a per-project salt so same-index scenes rotate onto different signatures across videos; determinism per project is preserved (same project+idx → same seed forever) | `pipeline/stages/finalize.js` · `animation/index.js` (`sceneSeed`) · `hyperframe/signatures.js` · `util/util.js` (`hash32`) |
| P32 | Persistent per-run Vietnamese journal (owner order 2026-07-21): every user-visible pipeline event is a `journal_events` row (kind op/step/retry/log/status/done/error/usage/publish/enqueue/sys) written ONLY via `jlog()` — the story of a run survives page reloads AND server restarts, and a finished project's journal loads over REST forever. Run attribution rides the existing ALS run context (`scheduler.execute` stamps `jobId`; regen/interactive work is NULL by design — never mis-stamped). Journal `msg` is ALWAYS Vietnamese (English emitter strings translated at source, pinned by test); `op()` percent-progress ticks stay ticker-only (coalescing); provider warn/error inside a run auto-attach the project via ALS. Retention is RUN-aware (last 10 runs complete + 20k hard cap — never a flat oldest-rows prune) and rows FK-cascade with the project. UI: run picker + stage groups with measured durations + scene chips + level filter/search/copy/download/expand, plus the cross-project "🗂 Tác vụ" view (jobs ledger + system lane, incl. slot-promote failures with no project) | `db/repositories/journal.js` · `pipeline/journal.js` · `pipeline/progress.js` · `util/log.js` · `pipeline/scheduler.js` · `public/js/features/{journal,tasks}.js` |
| P33 | CTA discipline + pinned-arc batching (owner order 2026-07-21; measured disease: batched videos wrote a subscribe block at EVERY 25-scene boundary + a farewell at scene 175/200 — ~16 CTA scenes; the reference app is worse, 7 mid farewells + 21 CTA scenes/200). Contract: ONE soft CTA near 30% + ONE closing CTA in the final scene(s), and NEVER a farewell before the closing zone. Enforced at three layers: (1) PROMPTS — every partial span (batch or adaptive split) gets an explicit per-span CTA PLAN (`ctaPlanFor`/`batchNoteFor`, span-relative, recomputed per live span) while ALL THREE whole-video CTA head sources are neutralized (`partial = !!batchNote`); the ≤30-scene single-call head stays byte-identical (test-pinned); batched topic/source videos also get a PINNED OUTLINE (`generateOutline`: throughline/spine/chapters with bridgeOut, `normalizeChapters` exact-coverage) restated to every batch so batch 2+ never re-plans the arc ('script' mode keeps the owner's arc). (2) DETECTOR — `cta-audit.js` lexicon (VI folded + EN, context-gated verbs) + `auditCtas` budget (FAREWELL_MID/CTA_EXCESS/CTA_CLUSTER; closing zone = last 2 scenes on ≥8-scene videos) wired into `scoreScript` (+ new value checks: idea-repeat, hook-weak, anchorless) and the b2.5 editorial rewrite, which drains flags in priority-ordered chunks of 20 (≤3) with a type-keyed instruction table, plus a whole-video coherence read-through (seam/repeat/arc) for >30-scene videos. (3) FLOOR — deterministic `enforceCtaFloor` in the engine strips mid-video farewell sentences and DROPS farewell-only scenes in EVERY input mode incl. zero-LLM json imports (P18 precedent), and editorial's `ctaStripFloor` cuts leftovers after the rewrite. Measured by `scripts/cta-audit.mjs` | `content/cta-audit.js` · `content/master-script.js` · `content/scorer.js` · `pipeline/stages/editorial.js` · `scripts/cta-audit.mjs` |
| P34 | Assistant upgrades (owner order 2026-07-21): the RESEARCHED topic always feeds B2 — a picked click-title travels as `config.titleOverride` (project title + beats the engine's own title in the script stage), never replacing the script input; the sheet's `durationMode='target'` clobber is fixed (braced — applies ONLY with an explicit duration pick); the sheet exposes a script-approval gate checkbox (`config.sceneGate`, default ON for "Làm ngay", OFF for scheduled) + an honest pre-create cost line (`POST /api/estimate-cost`: TTS chars priced by the pricing table, LLM extrapolated from this installation's own per-scene history — never a fabricated number); accept lands the owner ON the new project (journal narrates from second one); suggestions speak the CHANNEL's language (`channel.config.language`, voices filtered to match); a failed slot promotion restores the suggestion to the pool (same as manual delete) + journals to the P32 system lane; series bulk-scheduling passes a reviewed config (one sheet applied to every episode); suggest note reports REAL trend-signal counts, count selector 4/8/12, expiring ideas show a countdown badge | `api/services/{assistant,topic-autopilot,batch}.js` · `api/routes.js` (`/estimate-cost`) · `pipeline/scheduler.js` · `pipeline/stages/script.js` · `public/js/features/{assistant-sheet,autopilot}.js` |
| P35 | Visual quality levers (owner order 2026-07-21 — "bố cục dày đặc phù hợp với lời thoại từng cảnh"): per-scene density follows the direction pass's `[ROLE]` (`densityForScene`: hook/proof/payoff → rich, cta → minimal, else the project knob) and the validation FLOORS SCALE WITH IT (rich → heroParts ≥8 + sparse union ≥0.55, minimal breathes legally); a POSITIVE dialogue-match gate (beat labels' folded tokens must appear on screen at/after their t0 — >40% missing across ≥3 labeled beats re-asks) so on-screen text SPEAKS the narration instead of decorating it; headline-class text (≥5% short side) is contrast-gated at 3.5:1 (decor keeps 2.2); the art director sees each scene's SPOKEN ANCHORS (beat labels + times) and must anchor `[CHOREOGRAPHY]` verbs to them; the beat budget scales UP with duration (`max = clamp(round(dur/2.5), 5, 10)` — short scenes keep the historic cap of 5 exactly); single-scene REGEN has full parity with the batch lane (captions/consistent/overlay/imageFull/diversitySalt threaded, `qtier` persisted, `modelFallback` stripped, the silent heuristic fallback REMOVED per the no-fallback contract); B8 QC detects WHITE/blank stretches via `negate,blackdetect` (the reference app's blank-scene bug class — dark themes can never false-positive); the `tuila1-hud-cyber` preset populates the wired-but-empty `effects`/`ambient` prompt blocks. Deferred (tracked, not registered): exemplar bank per signature, geometric balance gate, `fontSizes` ladder | `hyperframe/{prompt,beats,codegen,validate}.js` · `pipeline/{direction,regen,qc}.js` · `pipeline/stages/visuals.js` · `styleguide/presets.js` |
| P36 | Single visual mode — HyperFrame only (owner order 2026-07-22): the `animation` (20-template motion-graphics library + heuristic/LLM planner) and `image` (Pollinations text-to-image + Ken-Burns posters + libass subtitle burn) modes were removed. `src/animation/` is now PURELY the shared GSAP render engine HyperFrame reuses; `buildTemplate` keeps `kinetic-statement` as the universal fallback (a scene whose stored template no longer exists still renders) + `chapter-break`, and `headline()` (trimmed `planner.js`) survives as the P10 swap's text source; `themes.js` stays as a hyperframe-codegen validation dependency (`getTheme`). Every dispatch site is single-mode and a stored `visualMode` of `'animation'`/`'image'` is coerced to `'hyperframe'` (migration id 5 across all 5 config-bearing tables), so a stray value can never route; the scriptwriter is always the motion-graphics brief; FPS/resolution relocated out of the removed `#animOpts`; consumption-site fallbacks read `` or ` 'hyperframe'` | `core/config.js` · `db/migrate.js` (id 5) · `animation/{index,templates/index,planner,themes}.js` · `pipeline/stages/{visuals,render}.js` · `pipeline/{regen,render-only,repurpose,fingerprint}.js` · `providers/llm.js` · `public/{index.html,js/views/config.js}` |
| P37 | Reference-parity codegen (owner order 2026-07-22, "make the HTML look like the reference app"): `buildCodegenPrompt` injects a concrete `ANIMATION SPEC` (`animationSpecBlock`: exact `FX.camPush`/`FX.beat`/`FX.parallax`/`FX.pulseGlow`/`FX.beamSweep`/`FX.impact` values derived from `cinematicDirection` + `motionSignature`) and a `TIMELINE SKELETON` (`timelineSkeletonBlock`: a t=0-nearly-empty line + one authored `FX.beat` line per REAL beat + a climax-to-DUR line) — expressed ONLY in the `tl.*`/`FX.*` vocabulary, NEVER raw `gsap.*` (mirrors the reference app's raw-timeline spec into OUR linted vocabulary; every emitted call is lint-clean, test-pinned). The harness set-dressing (motif/deco/vignette/grain/beam/beat-pulse) + the deterministic fixers (`normalizeSpec`, `__fitText`/`__deoverlap`/`__safeZone`/`__margins`, contrast-repair) are KEPT as the premium/readability floor. The HARD readability gates (off-screen/caption-band/contrast/clip/occlusion/wrong-language/text-over-text/fragment/junk/empty/runtime + primary-type-flat) still block/re-ask every attempt; the CALIBER gates (sparse / hero-density / dialogue-match / beat-adherence) are relaxed to a `softDefects` lane that re-asks ONLY in the first 3 attempts and never blocks shipping (thresholds widened: sparse rich union 0.55→0.50, hero-density a RICH-only `<4` nudge, dialogue-match `>0.6` missing across ≥4 labels) — so a scene that cleared every readability gate is not homogenized toward one dense look. (Deferred, tracked-not-registered: the TTS-first reorder + time-warp removal — author on the real audio DUR — behind `config.hyperframe.ttsFirst`, since it trades the scene gate's pre-spend RENDERED preview for a script+brief review.) | `hyperframe/{prompt,validate,codegen}.js` · `hyperframe/{beats,signatures}.js` |
| P38 | Reference-parity LAYOUT + diverse backgrounds + QC trim (owner order 2026-07-25, "bố cục phải cân đối, rải đều; đa dạng background; bỏ QC cảnh lỗi thừa thải"). **Layout:** `viewportBlock` now emits the reference app's FULL hard-threshold set (`SIDE/TOP/BOTTOM_PADDING, TEXT_MAX_W, TEXT_BLOCK_MAX_H, HERO_MAX_W, SUBJECT_MAX_H, CARD_MIN/MAX_W, SAFE_CENTER_W/H, SPLIT_GAP, LOWER_THIRD_Y=round(H*.807)`) and MANDATES using them directly in code; a new `ratioRulesBlock` ships per-ratio distribution rules (16:9 "spread horizontally, never center-clump" / 9:16 "stack in reading order" / 1:1 symmetric / 4:5 top-heavy); the `CODEGEN_SYSTEM` composition rule distributes weight across a 3×3 grid with explicit-bounds containers; `renderValidate` gains a center-clump DISTRIBUTION defect (a wide frame whose readable elements all bunch on the center axis, span <22% width + union <50%, re-asks to spread). **QC trim (supersedes the P35 white-frame QC + the P37 caliber `softDefects` lane + quality tiers):** the render gate now emits ONLY not-broken (runtime error / blank render) + layout (off-screen / caption-band / text overlap / clip / occlusion / overlay-center / distribution) + cheap content (junk / wrong-language); the CALIBER gates (sparse / hero-density / beat-adherence / dialogue-match), the flat-primary-type check, the low-contrast gate + auto-contrast repair, and the mid-scene/ending liveness checks are REMOVED; codegen drops the contrast-repair loop + `qtier`; `qc.js` drops the per-frame black/white/silence pixel scan + `summarizeVisualTiers` + loudness probe, keeping cheap stream/duration integrity; `finalize` drops the QC repair cycle + tier surfacing. Safe because the fence parser + lint + harness-owned dark backdrop already prevent blank scenes at the source. **Backgrounds:** `motifLayer` gains six styles (spotlight/aurora/rays/dotmatrix/blueprint/gradient-wash) beside mesh/grid/bokeh; `animation/backdrop.js` rotates the backdrop STYLE per scene — deterministic by (idx + per-video salt), consecutive scenes never repeat, cta/outro → calm spotlight — while palette + fonts stay LOCKED for one identity; `hyperframe.build()` reads `props.backdrop` (falls back to `guide.motif`), set by `visuals.js`/`regen.js` when `config.hyperframe.backgroundVariety` (default on). | `hyperframe/{prompt,validate,codegen}.js` · `pipeline/qc.js` · `pipeline/stages/{finalize,render,visuals}.js` · `pipeline/regen.js` · `animation/backdrop.js` · `animation/templates/hyperframe.js` · `styleguide/{guide,generate}.js` · `core/config.js` |
| P39 | Raw-GSAP REFERENCE PORT (owner order 2026-07-29, "audit kỹ code/công nghệ/prompt của app tham khảo rồi làm lại y hệt để video ra giống hệt"). Three-agent audit found the render RUNTIME already matches the reference (both = Puppeteer headless, 30fps deterministic frame-seek of a `paused` GSAP timeline, JPEG q92 → x264, xfade/concat, same per-ratio resolutions); the real deltas were the codegen contract, thresholds, model and encode. **Contract (raw GSAP):** `lint.js` no longer bans the full `gsap.*` API — `gsap.set` / `gsap.timeline` / `gsap.utils` / eases are allowed (the reference's own vocabulary); only a STANDALONE `gsap.to/from/fromTo` (lands on the paused global timeline → frozen), the real-time/env calls (`gsap.ticker/delayedCall/globalTimeline/context/matchMedia`) and `gsap.utils.random` stay hard-banned. FX.* is now OPTIONAL sugar, not required; `prompt.js` teaches "author a RAW GSAP TIMELINE on tl" + ≥5 animating elements (reference Rich-Animation). **Advisory validation (supersedes the P38 hard render-gate):** `renderValidate` returns `{ok, defects, warnings}` where `defects` = the STRUCTURAL FLOOR only (script threw / renders blank) and every geometry finding (off-screen / caption-band / overlap / clip / occlusion / distribution / wrong-language / junk) is an advisory WARNING; `codegen.js` re-asks ONLY on lint/syntax errors + structural defects, ships the first structurally-sound spec, and drops the `HARD_DEFECT` classifier + `lastGood` lane (no-fallback loud fail unchanged). The layout/quality lint guards (`repeat:-1`, display/layout tweens, gBCR-in-callback, Math.random, ALLCAPS telemetry) demote from errors to warnings. Safe because the fence parser + syntax check + the structural floor still block the actual blank-scene bug. **Thresholds:** `viewportBlock` swaps P38's formulas for the reference's HARDCODED INTEGER TABLES per ratio (16:9 `SIDE 90/…`, 9:16 `SIDE 70 / BOTTOM 130 / SUBJECT_MAX_H 990`, 1:1, 4:5) — byte-exact at the reference resolutions, proportionally scaled for any other canvas. **Model + tokens:** `config.hyperframe.model` now defaults to the owner's stable strong proxy model `ag/gemini-pro-agent` (memory: parity-harness-p0) for new projects; codegen `maxTokens` 6500→24000. **Shell + encode:** the stage gradient matches the reference cinematic key (`radial-gradient(ellipse at 50% 30%, bg2, bg, #05050a)`); per-scene, master and colorkey encodes go to `crf 18 -preset medium -profile high -level 4.0` (was crf20/veryfast). RETAINED as harness-side bonuses invisible to the port: time-warp beat-sync, deterministic frame render, caption karaoke, P38 backdrop rotation. | `hyperframe/{lint,validate,codegen,prompt}.js` · `animation/{harness,renderer}.js` · `pipeline/render.js` · `media/ffmpeg.js` · `core/config.js` · `providers/llm.js` |
| P40 | Reference FEATURE parity — the capabilities beyond the scene renderer (owner order 2026-08-02, "copy hoàn toàn mọi tính năng của app tham khảo… app hiện tại là 1 bản nâng cấp"). Five lanes, each an audit finding against `/Applications/AI VIDEO Tool.app` (READ ONLY). **A — creative runtime libraries:** the reference lets its codegen model add up to 4 CDN `<script>` imports (three.js/p5.js/tsParticles/countUp/ScrollTrigger) and rewrites them to a local cache at render time; `scripts/build-libs.mjs` vendors the same set into `vendor/libs`, `animation/libs.js` detects which a spec actually references (`detectLibs`) and the harness injects ONLY those, so a text-only scene keeps its old page weight. Determinism is preserved by a single public hook — `window.__onSeek(fn)`, called from `__seek` with (sceneTime, authoredTime) — so a THREE/p5 layer is a pure function of t under out-of-order scrubbing; only scrubbable libs are advertised (`advertisedLibs`), the rAF-driven ones stay vendored (an import must never 404) but silent; lint carves `window.__onSeek` out of the harness-internals ban and warns when a library layer registers no hook. Chrome gains software WebGL (`--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`) — verified byte-identical on non-WebGL pages, and without it a `WebGLRenderer` throws and takes the whole scene script down; **the reference app cannot render three.js at all** (it ships `--disable-gpu --disable-software-rasterizer`). **B — brand-asset casting:** the reference keyword-matches its `brand-specificities/<brand>/` folder per scene; `pipeline/brand-assets.js` casts the whole video in ONE call with the REAL catalog (same shape as the sound-design lane), `sanitizeCast` drops hallucinated filenames + caps 2/scene, picks persist to `scenes.assets`, and `sceneMediaResolver` is the single resolver for the batch AND regen lanes. A mascot cutout keeps its alpha (`heroMediaUri({alpha:true})` → PNG; JPEG would paste a black rectangle) and `imageFullBlock` briefs it as a CO-STAR (no crop/box/object-fit, left-or-right third, 40–55% frame height) instead of a cropped centre hero. Knob `config.brandAssets` = `'auto'` (Default folder) · `'<folder>'` · `'none'`. **C — Supertonic TTS:** a self-hosted local voice (`pip install supertonic`, POST `/v1/tts`), 10 voices × 9 languages, speed/steps clamped; `media/tts-server.js` owns liveness + a DEEP synth check (an HTTP-alive-but-broken zombie is worse than a dead port) + spawn/stop, routes `/tts/server/{status,start,stop}`, killed on app shutdown; the façade writes `.wav` for it and passes `detectLang`. The reference's CapCut provider is deliberately NOT ported — it forges device fingerprints against a private endpoint. **D — AI thumbnail:** the model authors a static HTML FRAGMENT which we re-shell in our own page (vendored fonts, locked palette, exact canvas/safe area); `sanitizeThumbFragment` strips script/iframe/handlers/@import/@keyframes/`animation:`/external URLs — a thumbnail is ONE static paint; three composition briefs drive the A/B variants; an unusable reply or no LLM silently falls back to the deterministic `buildThumbnail` (opt out with `config.thumbnailAi=false`). **E — edit video:** `pipeline/edit-video.js` puts graphics on the owner's OWN footage — transcribe → `segmentTranscript` (segments TILE the source, silent head+tail included, so cumulative offset IS the source moment) → the ordinary `runVisuals`/`runRender`/`finalize`; routed from inside `runPipeline` on `config.editVideo` so stop/resume/job-ledger/error-taxonomy apply unchanged, and a resumed run skips transcription. `compositeColorkey` gains `exact` + `audioFrom:'footage'` (slice at the scene's own moment, keep the ORIGINAL soundtrack); no TTS is spent and `autoBgm`/`soundDesign` are forced off. `whisper.transcribeWords` gains `granularity:'segment'` (forcing one word per segment costs decoding accuracy, which only matters when the transcript IS the content), `repairTranscript` fixes ASR spelling/diacritics in one call and is rejected wholesale if the line count changes, and `paths.js` now prefers the LARGEST whisper model present (`scripts/build-whisper-model.mjs` installs large-v3-turbo — measured: ggml-small "FAMO TANG NANG SUK V A I" vs large-v3-turbo the correct Vietnamese sentence). | `animation/{libs,harness}.js` · `media/{puppeteer,tts-server,whisper,ffmpeg}.js` · `pipeline/{brand-assets,thumbnail-codegen,edit-video,runner,regen}.js` · `pipeline/stages/{visuals,finalize}.js` · `providers/voice/supertonic.js` · `providers/tts.js` · `hyperframe/{prompt,lint,codegen}.js` · `util/asset-uri.js` · `config/paths.js` · `scripts/build-{libs,whisper-model}.mjs` |
| P40+ | Reference FEATURE parity, round 2 — the gaps a 36-agent audit of the reference bundle CONFIRMED against this repo (each claim was adversarially verified before being accepted; 18 of 31 were refuted and dropped). **Publish:** `publish/facebook.js` joins the registry beside YouTube — a pasted Page token verified against the Page, 9:16/4:5 → REEL (start → bytes to rupload → finish), else a feed video; Graph's own message is surfaced; a failed first comment never fails the post; staging parity means anything but an explicit "công khai ngay" is SCHEDULED ~15 min out. Both publishers take `scheduledAt` in unix seconds (YouTube → `status.publishAt`, only honoured on a private video). AI Setting gains a **Đăng video** section — the publish routes existed but nothing in the UI ever called them — and the ledger is finally rendered under the final-video toolbar. **Assets (two real defects):** `config.assets` carries three shapes (bare path / `/api/file?path=` URL / `{name,path}`) but the resolver filtered on `a.name && a.path`, so an uploaded asset NEVER rendered → `normalizeAssets()` accepts all three and a scene may name an asset by stored name or bare filename; `brandCatalog` read only the DB, so art dropped into the brand folder in Finder was invisible to casting → catalog + `/library/brand` + `/brands` union DB rows with disk. `POST /media/download` brings a remote image/video local (content-type checked) because a scene must be offline. Library gains a brand-folder picker (uploads land in the folder being browsed), audio audition, and `PATCH /library/:id` rename (display name only — a path reference can never break). **Image search** now works with NO key via Openverse (commercial+modification licences), trying keyword phrases ONE at a time — concatenating four made a 20-word query that matched nothing — with gradients demoted to the genuinely-offline last resort. **Thumbnail:** `GET /projects/:id/thumbnail` + `POST …/regen` (re-design, or re-render hand-edited `{html}` via `renderThumbnailFragment`), design markup persisted in `metadata.thumbnail.html`, and the designer may place the owner's pictures through the same `{{asset:NAME}}` contract. **Voice:** `keyPool()` rotates a newline/comma-separated key list on a credit/auth refusal ONLY (a bad voice id must not burn every key); Edge gains rate/pitch/volume via SSML prosody (zero = unchanged, so no-knob output is byte-identical); `config.enableVoice:false` is a music-only cut (silence + estimated cue timing, no TTS credit). **Metadata:** generated from the NARRATION, not the title alone, and named SEO styles are rows in the shared `styles` table (the panel sends the resolved prompt, so deleting a style can't break a queued run). NOT ported: the reference's CapCut voice (forged device fingerprints against a private endpoint). | `publish/{facebook,youtube,index}.js` · `pipeline/{brand-assets,thumbnail-codegen}.js` · `pipeline/stages/{finalize,metadata,tts,script}.js` · `providers/{tts,imagesearch,llm}.js` · `providers/voice/edge.js` · `db/repositories/catalogs.js` · `api/routes.js` · `public/js/{views/{studio,library,config,editvideo},features/settings,api,state}.js` |
| P41 | EVEN LAYOUT (owner order 2026-08-02: "bố cục HTML tạo ra phải có bố cục và nội dung ĐỀU NHAU, không cần quan tâm đến phụ đề ghi đè"). **Measured first**, not guessed: 16 stored scenes rendered and mapped onto a 3×3 ink grid (fair share 0.111) gave top-left 0.068 / top-right 0.065 against dead-centre 0.192 — the failure is lopsidedness, not emptiness. **Cause found in the prompt itself, twice:** (a) the few-shot `SAMPLE_SPEC` the model imitates put six anchors in three zones and left 6/9 cells empty — it was teaching the measured imbalance, so its slots are now spread across six zones plus a bottom-centre tick scale; (b) `viewportBlock` called a centred 39.5% box "the primary usable stage" while the block ended with "THE THRESHOLDS WIN" — an obedient model was being TOLD to centre everything, so those numbers are now **MAXIMA AND MARGINS** ("misread a maximum as a target"). **Doctrine:** master rule #2 became a countable ZONE BUDGET — nine NAMED zones (TL..BR) binned by the very `left%/top%` the model types on a `.hf-slot`, anchor bands as ranges, and four laws (≥7 of 9 zones · all four corners ≥1 · every row and column ≥2 · MC ≤1), measured on the SETTLED frame (last beat→DUR, since the beat protocol opens bare). Guarded against its own failure modes, each caught in a real render: it "NEVER ASKS FOR MORE ELEMENTS" (satisfied by MOVING, with six named relocations + "plugging a hole with confetti is a WORSE failure than the hole") so it cannot lose to the density/whitespace rules; corner anchors may not be fake telemetry (`SYS.REQ.01`, `[TARGET: TABLE]` — the first regen filled every corner with exactly that); the quota "NEVER WEAKENS THE HERO"; and "NEVER A TIC-TAC-TOE LATTICE" (the first regen snapped every scene to 15/50/85 × 15/50/85). `.hf-mid` orbs + ghost glyph become ballast for the thinnest zones (free area, zero DOM). Each `ratioRulesBlock` branch carries its own quota + ONE worked map with the arithmetic spelled out. Subtitle avoidance no longer squeezes the frame: the caption band is no longer a no-go zone, edit-video reserves nothing. **Validator:** a 3×3 ink map where a zone is DEAD only when nothing is anchored in it AND it carries almost no ink (a corner kicker is little ink but not a hole); ≥3 dead zones or one zone >34% warns — ADVISORY, per P39. **Verified by regeneration** on the shipping model: 9/9 → 7-8/9 distinct zones used and all four corners anchored in every scene, staggered coordinates, telemetry gone. Honest caveat: corner anchors are small by nature, so the AREA-weighted centre share stays ~0.24 — placement is even, ink mass still leans centre, and the frames read a little lighter than the densest reference-caliber ones. | `hyperframe/prompt.js` · `hyperframe/validate.js` · `styleguide/guide.js` |
| P42 | Route-level PARITY PROOF + the last four gaps (goal check, 2026-08-03). Diffed the reference app's 121 `/api/*` routes against ours: most differences are naming or granularity (its `/tts/edge/voices` + `/larvoice/voices` + `/elevenlabs/voices` are our ONE unified `/voices` catalog; its `/projects/:id/scenes/:stt/regen` is our `/scenes/:id/regen-html`; its `/tts/supertonic/start`, `stop`, `health` are our `/tts/server/*`; a "session" there is a "project" here), so a name diff is not a capability diff. Four capabilities genuinely had no counterpart and are now implemented on OUR architecture: **copy-assets-from** (shares by PATH, skips files gone from disk, never double-adds), **restart** (same topic+config, work discarded — as a NEW project, never an in-place wipe, so a finished video cannot be destroyed by one click), **AI publish caption** (a YouTube description is the wrong shape for a Facebook post: written from the narration, hook-first, saved per platform under `metadata.captions[platform]` and preferred over `description` at publish time), and **logo presets** (a named {file + placement} pair in the shared `styles` table, kind `'logo'`, path validated against the allowed roots — applying one restores WHERE the logo sat). All four wired into the existing UI. NOT ported: the reference's `/x/scrape-tweet` (X blocks scraping and requires auth; `/fetch-link` already handles a public URL) and `/tts/capcut/*` (forged device fingerprints against a private endpoint). Second sweep after the full 121-route map came back (86 have · 3 n/a · 18 claimed missing, 0 of which survived refutation once implemented): **brand folders** can be renamed/deleted (name stripped of separators and `..`, resolved path must stay under `DIRS.brand`, `Default` refused, and a delete reports its file count and 409s until the caller echoes it back); **per-scene SRT** (`/projects/:id/scenes-srt`) keeps each scene on its own zero, beside the timeline-shifted whole-project export; **standalone transcription** (`/edit-video/transcribe`) reads a file's words without creating a project; **Facebook Pages became a REGISTRY** — list/select/remove with a per-Page token, `/check` via Graph `debug_token` (treating `expires_at 0` as NEVER), `/extend` via the documented `fb_exchange_token` long-lived exchange re-deriving the Page token, plus `/publish/published-ids` to badge what already went out; **logo-preset apply** restores file AND placement into the active channel's brand kit; `PATCH /styles/:id` renames a saved style; `/llm/test` validates a custom OpenAI-compatible endpoint for 8 tokens (the `••` masked round-trip keeps the saved key); `/tts/server/install` runs pip for the local voice engine as an EXPLICIT button, never automatic, returning the real output. Final verdict from the full map: **107 routes · 86 have · 3 n/a · 18 claimed missing, of which exactly ONE survived adversarial refutation** — thumbnail EDIT-BY-INSTRUCTION, now `POST /projects/:id/thumbnail/edit-html` (`editThumbnailFragment` sends the CURRENT design plus the instruction under an "you are editing, not designing" system message; a reply under 40% of the original length is treated as a failed edit and the old thumbnail is kept). One refutation also exposed a genuinely DEAD control on our side: the Dưới/Giữa/Trên subtitle select never reached the render because `bottomPct` read only `marginV`, which the panel always sends as 0.12 — `POSITION_BOTTOM_PCT` now decides, with `'bot'`/absent deliberately left at the harness default so no finished video shifts when re-rendered and only the two settings that never worked start working. | `api/routes.js` · `publish/facebook.js` · `pipeline/thumbnail-codegen.js` · `subtitles/presets.js` · `db/repositories/{catalogs,publishes}.js` · `public/js/{views/studio,features/settings}.js` · `public/index.html` |
| P43 | UI-SURFACE parity (goal check, 2026-08-03). The P42 route diff could only see the server, so all **406 user-visible controls** were extracted from the reference app's own `index.html` and checked separately (its 26 client feature modules named alongside). Verdict: **88 have · 2 n/a · 19 claimed missing**, of which the SaaS half (login, session expiry, banned account, license expiry, voice-payment, publish-payment) is `n/a` by design — this is the owner's own local tool with his own keys — and CapCut stays refused. Real gaps closed: **transition STYLE is pickable** (`planTransitions({style})`: `'auto'` keeps the role doctrine byte-for-byte and remains the default, `'varied'` rotates deterministically so the same video always cuts the same way, `'none'` is hard cuts, plus eleven named xfade looks each verified against the vendored ffmpeg build because the string goes straight into `xfade=transition=`; an unknown value falls back to the doctrine); **drag & drop** anywhere on the window, routed by WHAT THE FILE IS (image→project assets · video→the Sửa video source · audio→BGM/SFX · font→font library), unsupported files reported rather than swallowed, drag DEPTH counted so the overlay does not flicker across child elements; **any subtitle color** (the nine swatches were the whole palette); and four capabilities that had shipped as ROUTES with nothing in the UI ever calling them — **"Sửa HTML với AI"** per scene (`/scenes/:id/edit-html`), the **Facebook Page registry** (list/select/remove + per-Page token health, with `neverExpires` shown as such rather than as expired), **deleting a named SEO style**, and **renaming/deleting a brand folder** (the dialog states the file count it is about to destroy and echoes it back, and a 409 from a stale count is reported instead of swallowed — `api.del` THROWS on non-2xx). Refuted: the voice-picker claims — our single `/voices` catalog already covers every provider with per-provider chips, preview and favourites. Final verdict from the full UI map: **152 controls judged · 111 have · 4 n/a · 37 claimed missing → 6 survived refutation**, all six now closed. Three shared ONE root cause I had wrongly dismissed the turn before: the picker's chip row was built from all SEVEN registered providers while `getVoiceCatalog` loaded only FOUR, so ElevenLabs / OpenAI / Supertonic each rendered a live-looking chip and an EMPTY list (measured `{edge:322, say:74, vbee:10, larvoice:105}` and 0 for the rest — including Supertonic, added in P40-C, whose roster is a local list needing no key). `catalogProviders()` now decides by cost — a local/keyless engine is always listed, a keyed cloud provider joins once its key exists — and the picker greys out what it cannot show and says why. The other three: publishing opens a **composer** (the exact post text, editable, AI-written on request, plus a title and a schedule — quick picks and a datetime, with "tối nay 20h" rolling to tomorrow once tonight has passed) and typed text outranks the stored caption at publish time; and **reframe bias** — the single `crop=w:h` in `compositeColorkey` was ffmpeg's dead-centre default, which cuts a person standing off to one side out of shot. `detectSubjectX` (one cropdetect probe) + `reframeOffsetX` give auto/left/centre/right, the scale factor mirrors `force_original_aspect_ratio=increase` so the offset is right, and `'center'` does not even build a different filter string — every existing render stays byte-identical. | `pipeline/render.js` · `pipeline/stages/finalize.js` · `api/services/voice-catalog.js` · `media/ffmpeg.js` · `animation/index.js` · `pipeline/edit-video.js` · `public/js/features/{dragdrop,scene-studio,settings,voicepicker}.js` · `public/js/views/{config,library,studio,editvideo}.js` · `public/js/ui/dialog.js` · `public/index.html` |
| P44 | ENGINE-SURFACE parity (goal check, 2026-08-03). Routes (P42) and UI controls (P43) both map what the owner can *ask for*; neither can see a step the reference runs AUTOMATICALLY inside its pipeline. The third axis extracted the reference bundle's **150 exported functions** and checked each against ours. Two genuine gaps, both operating on the owner's own footage in the edit-video lane, both now ported — **and both reference implementations carried a bug we did not copy**. (1) **Silence removal** (`detectSilence`/`removeSilence`): `detectSilence()` reads ffmpeg `silencedetect`; the whole cut decision lives in the PURE `silenceKeepRanges()`, so it is tested without ffmpeg. A gap is never cut flush — `padMs` of its head and tail stay in and at least `keepMs` of every gap survives, so speech never starts on a hard splice, and a gap too short to be worth a splice (`MIN_CUT`) is skipped whole. The cut runs as ONE `filter_complex` pass (`trim`/`atrim` → `concat`) rather than the reference's write-N-clips-then-concat-demux: no generation loss, no temp files, and picture and sound are trimmed from the SAME range list so they cannot drift (measured 12.00s → 7.22s on a clip with a 4.99s gap, streams within one AAC frame). **The order is the fix**: the reference removes silence AFTER splitting scenes from the transcript, so every scene then reads the shortened footage at its OLD timestamp and drifts — here the cut happens BEFORE transcription and the project is repointed (`editVideo.source` + `overlay.source`, persisted so a resume reuses the cut file), making the timings right by construction. Also clamped: the reference's `max(end-pad, start+keep)` runs PAST a gap shorter than `keep` and eats the first syllable of the next sentence. (2) **Auto zoom** (`applyAutoZoom`/`applySceneZoom`): `zoomFilter()` builds a `zoompan` ramp that starts or ends at exactly 1.0 so two neighbouring scenes never jump in scale, alternating direction per scene index with a rotating focus point, intensity clamped at both ends. Framed at the caller's REAL output size — the reference hardcodes `s=1920x1080` and squashes every vertical video it touches — and folded into the existing composite pass instead of costing a second full re-encode. Spliced into the `[0:v]` footage chain ONLY: measured across a scene, the footage grows 200×120 → 227×137 while the keyed graphics stay at exactly `{60,40,200,30}` in every frame. Both switches are OFF unless asked for, so an untouched project renders exactly as before. | `media/ffmpeg.js` (`detectSilence` · `silenceKeepRanges` · `removeSilence` · `zoomFilter` · `zoomFocus` · `compositeColorkey({zoom})`) · `pipeline/edit-video.js` · `animation/index.js` · `public/js/views/editvideo.js` · `public/index.html` |

Anchors touched by the internationalisation work were re-pointed rather than dropped: the
per-language reading speed and the breath pad now live in `i18n/languages.js` and
`util/lang.js` `padMsFor()`, and the beat stopword lists in `i18n/stopwords.js`. Every constant they
protect — `vi 4.4`, `650 ms / 400 ms`, `MIN_GAP 1.2`, `HOLD_MAX 2.6`, `LEAD 0.12` — is unchanged and
asserted by value rather than by source line, so the next relocation cannot break them silently.

---

## Appendix A — Decision record: the doctrine service

> **Owner's decision, 2026-08-19: not built.** The requirement was "don't leak the source", and the
> release achieves it — the shipped bundle contains no readable code. That the prompts appear in the
> customer's own LLM dashboard is a **consciously accepted risk**, not unfinished work.

Kept because the reasoning is still sound and because the condition for reversing it is a specific
fact rather than a feeling: **if the business model changes to credits or a subscription** — the
owner paying for the LLM — the main obstacle disappears and this becomes worth building. While
customers bring their own keys, leave it closed.

**What it would be.** The ~181 KB of scriptwriting and render doctrine is the actual product. Moving
it behind an API (`POST /api/v1/doctrine/scene-spec`, `/doctrine/script`) would keep it off the
customer's machine entirely. The obstacles are three: the app would lose its offline guarantee for
content generation, the owner would carry the LLM cost and the uptime risk, and prompts would still
be visible to whoever holds the key — which, today, is the customer.

**The seam already exists.** `src/hyperframe/doctrine.js` defines one interface with two
implementations: `local` (today) and `remote` (specified here, deliberately unwritten). It costs
nothing at runtime and it is the right boundary regardless — the re-ask loop has no business knowing
what a prompt looks like. `tests/doctrine-seam.test.js` keeps it honest.

Not reopened without the business-model change above.

---

## Appendix B — HyperFrames attribution (Apache-2.0)

> **This section is a licence obligation, not documentation.** Parts of the render doctrine are
> adapted from [heygen-com/hyperframes](https://github.com/heygen-com/hyperframes), Apache License
> 2.0, which requires the attribution notice to travel with the work. **Do not delete it.** If this
> file is ever split, this section moves with the code it covers.

Source: <https://github.com/heygen-com/hyperframes> (Apache License 2.0). Upstream paths cited below
refer to that repository, not this one. What is adapted is **craft knowledge** — rules, doctrine and
checks — never the upstream engine.

**Why it maps.** HyperFrames renders the same way this app does: a paused, seekable GSAP timeline
where a frame is a pure function of time, captured by headless Chrome and muxed by FFmpeg. Their 4K
path supersamples via `devicePixelRatio`; ours uses a logical canvas plus body zoom — equivalent
architectures.

**What was adapted**

| Upstream | Adapted into |
|---|---|
| `skills/faceless-explainer/references/motion-language.md` | the motion doctrine in the codegen prompt: a motion **verb** per element, entry → reveal → hold → exit, no decorative movement |
| `skills/faceless-explainer/references/cut-catalog.md` | the cut and transition vocabulary behind `planTransitions` |
| `skills/hyperframes-creative/references/beat-direction.md` | beat-anchored choreography — one keyword enters on its word, holds, exits before the next |
| `skills/hyperframes-animation/blueprints-index.md` | the 15 time-coded shot templates tied to narrative roles, adopted as `HF_LAYOUTS` in `src/pipeline/direction.js` |
| `packages/lint/src/rules/` | the static lint rules in `src/hyperframe/lint.js` |
| `packages/cli/src/utils/layoutAudit.ts` | the runtime layout audit in `src/hyperframe/validate.js` |
| `packages/core/src/text/fitTextFontSize.ts` | the text-fitting pass in `src/animation/harness.js` |

**Blueprints** (`skills/hyperframes-animation/blueprints-index.md`) — 15 time-coded shot templates,
each tied to narrative roles (Hook, Problem, Product_Intro, Key_Feature, Benefits, Social_Proof,
CTA, Brand_Outro). The ones adopted as layouts, and referenced by name from
`src/pipeline/direction.js`:

- **`kinetic-type-beats`** — the words *are* the motion (token swaps, statement builds); the
  workhorse, covering six roles.
- **`ticker-takeover`** — typed lead-in and a cycling accent word, then the hero crashes in and
  physically shoves the text aside (hook / outro).
- **`overwhelm-surround`** — overwhelm by accumulation; elements close in from every side
  (problem and pain scenes).
- **`spatial-pan-stations`** — labelled stations on one oversized canvas, traversed by a single
  virtual camera (timelines, processes, long videos).
- **`titlecard-reveal`** — the calm breather: one restrained move, then a still hold. *"Low motion
  is the payload, not a deficiency."*

**Determinism rules restated in our codegen prompt** — no wall-clock time, no `setTimeout` or
`requestAnimationFrame`, no event listeners, no network; everything on the paused root timeline, so
that frame = f(time) holds under out-of-order seeking. These are enforced mechanically by
`src/hyperframe/lint.js` rather than requested in prose.

---

<div align="center">

**AI Video Studio** · 183 backend modules · 39 frontend modules · 34,042 lines · 99 test files · 825 tests

*Everything the project knows is in this file. There is no `docs/` directory, on purpose.*

</div>
