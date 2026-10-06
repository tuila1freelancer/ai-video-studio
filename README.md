# AI Video Studio

Turn one line of text into a finished, narrated, motion-graphics video.

Node 22 backend · headless Chrome + FFmpeg · native shell on macOS, Electron on Windows ·
runs offline · v1.0.0

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

Scenes are built before the voice, so the storyboard is reviewable before any TTS credit is spent.
The two gates are optional holds: the run stops at its own status and waits.

**[Quick start](#quick-start)** · [What it does](#what-it-does) · [Pipeline](#pipeline) ·
[Architecture](#architecture) · [Languages](#languages) · [Providers](#providers) ·
[Configuration](#configuration) · [Development](#development) · [Build](#build-and-release) ·
[Operations](#operations) · [Limits](#limits)

---

## Quick start

```bash
npm install
npm start        # prints AVS_READY <url>; also written to data/server.url
npm run dev      # node --watch
npm test         # 122 files, 909 tests, no network
```

No key, no account, no sign-in: a fresh clone runs. API keys are optional and go in AI Setting —
without them the app still renders, using the offline script path and the system voice.

Without a terminal: double-click `run.command` (macOS) or `run-windows.bat` (Windows).

### Requirements

| | Needed for | If missing |
|---|---|---|
| Node ≥ 20 (22 in practice) | everything | nothing runs |
| ffmpeg + ffprobe | render, concat, probing | no video |
| Chrome / Chromium | scene rendering, thumbnails, caption measurement | no video; scene validation skips rather than blocks |
| whisper-cli + `ggml-*.bin` | word-accurate subtitles | timing falls back to `estimate` |
| `/usr/bin/say` | offline TTS | that provider is unavailable (macOS only) |
| `pip install supertonic` | local neural TTS | that provider is unavailable |

`GET /api/health` reports which of these resolved. Lookup order is `AVS_*` env override → system
PATH → `vendor/` → app bundle; system comes first because the vendored FFmpeg is x86_64 and runs
under Rosetta on Apple Silicon.

---

## What it does

### Input

One box, four shapes, detected on read (`src/util/util.js`, `src/content/master-script.js`):

| Input | Mode | Behaviour |
|---|---|---|
| a sentence | topic | the AI plans and writes the whole video |
| ≥ 80 words | detailed script | light polish only — ≥ 90 % of the wording kept, order preserved, duration follows the content |
| `{…}` / `[…]` | scenes JSON | validated import, zero LLM calls |
| a URL | article | fetched as research for a new script, never copied |

An article outranks the word count. All four converge on one artifact —
`{ thumbnail{title,prompt}, scenes[{stt, voice, visual, assets}] }` — written to `scenes.json` per
project, where each `visual` is an eight-bracket motion-graphics brief the renderer consumes
directly.

### Output

One MP4, plus subtitle tracks in any of 13 languages (no re-render), a thumbnail with up to three
A/B compositions, six platform cover sizes, per-platform SEO metadata with YouTube chapters, a QC
report, and a per-run processing journal.

The video itself carries: per-scene motion graphics art-directed against the narration word by word;
one locked neural voice, loudness-normalised per scene; karaoke captions showing the exact script
words, timed by forced alignment; background music sidechain-ducked under the voice; role-driven
transitions; and a final master at −16 LUFS / −1.5 dBTP.

---

## Pipeline

`src/pipeline/runner.js` sequences; each stage is its own module.

| # | Stage | File | Produces | Disable with |
|---|---|---|---|---|
| 1 | B2 · script | `stages/script.js` | scenes, title, `scenes.json` | — |
| 2 | b2.5 · editorial | `stages/editorial.js` | rewrites only flagged scenes | `editorial: false` |
| 3 | b2.75 · duration fit | `stages/budget.js` | one tighten or enrich pass, ±12 % | `budgetFit: false` |
| 4 | timing estimate | `estimate.js` | estimated duration + word cues | — |
| 5 | B5 · scenes | `stages/visuals.js` | per-scene `{css, html, script}` | — |
| — | scene gate | runner | holds at status `scenes` | `sceneGate: true` enables |
| 6 | B3+4 · voice + subtitles | `stages/tts.js` | audio, `srt_json`, real durations | `enableVoice: false` |
| 7 | B6 · render | `stages/render.js` | one MP4 per scene | — |
| — | review gate | runner | holds at status `review` | `requireReview: true` enables |
| 8 | B7 · concat + mix | `stages/finalize.js` | the joined, mastered video | `autoConcat: false` |
| 9 | B8 · QC | `stages/finalize.js` | `qc_report.json`, warnings only | `qcGate: false` |
| 10 | metadata | `stages/metadata.js` | titles, tags, ≤ 14 chapters | `generateMetadata: false` |
| 11 | B9 · publish | `stages/publish.js` | upload, private by default | `autoPublish: true` enables |

Progress weights: `b2 8 · b5 25 · b34 32 · b6 25 · b7 10`.

**Gates.** The scene gate shows the exact TTS cost before release. The review gate takes an
approve/reject per scene. The QC gate writes a report and never withholds a video. A per-video USD
cap downgrades the run to the free lanes instead of failing it.

**Failures** are classified by code, not wording (`src/core/errors.js`): `transient` and
`rate-limit` earn one automatic resume; `config` and `resource` surface immediately with an
actionable hint. Below that: per-step retries, key and model rotation, a timbre-preserving TTS
fallback chain, and a post-render pass that re-renders any clip whose audio and video disagree.

---

## Architecture

288 backend modules, 66 frontend modules — no module over 400 lines (a ratchet in
`tests/code-health.test.js` keeps it that way). The frontend is native ES modules — no framework,
no runtime dependency — bundled only for release: 6 pages and 15 modals as `public/partials/`
assembled into one document at boot, 12 per-area stylesheets, and screens that load on first click.

| Directory | Owns | Start here |
|---|---|---|
| `pipeline/` | orchestration, 9 stages, queue, governor, resume, concat | `runner.js`, `stages/`, `finalize/`, `render/`, `fingerprint.js` |
| `hyperframe/` | scene codegen: prompt, conversation, lint, render validation | `prompt/`, `codegen.js`, `validate.js`, `beats.js` |
| `animation/` | the scene page, the deterministic runtime, the frame loop | `harness/`, `renderer.js`, `templates/` |
| `content/` | the script engine and deterministic script quality | `master-script/`, `scorer.js`, `cta-audit.js` |
| `providers/` | every external service | `llm/`, `tts.js`, `voice/`, `fetchlink/` |
| `media/` | FFmpeg, Chrome, mastering, overlays, ASR | `ffmpeg/`, `puppeteer.js`, `master.js`, `whisper.js` |
| `subtitles/` | cue timing, styling, the burned ASS file | `presets.js`, `ass.js`, `timeline.js`, `chunk.js` |
| `styleguide/` | the visual-identity contract shared by animation and codegen | `guide.js`, `presets.js`, `script-fonts.js` |
| `i18n/` | the language table and everything derived from it | `languages.js`, `segment.js`, `t.js` |
| `db/` | SQLite handle, DDL, migrations, repositories | `connection.js`, `migrate.js`, `repositories/` |
| `api/` | 185 REST routes, one router per domain, the agent contract | `routes.js` (mount order), `routers/`, `services/`, `spec/`, `scopes.js` |
| `ops/` | the stop valve, outbound webhooks, the first token | `state.js`, `webhooks.js`, `bootstrap-token.js` |
| `fonts/` | which typeface exists, and which file libass gets | `registry.js`, `files.js`, `coverage.js` |
| `core/` | config layering, cost, error taxonomy, budget | `config.js`, `pricing.js`, `errors.js` |
| `publish/` | per-platform upload + the limits table | `youtube.js`, `facebook.js`, `platforms.js` |
| `config/` `util/` `ws/` `audio/` | paths, primitives, live progress, sound design | `paths.js`, `util.js`, `html-include.js`, `hub.js`, `sound-design.js` |

A module that grew past 400 lines was split into a directory of the same name with a facade at the
old path (`providers/llm.js` re-exports `providers/llm/*`), so every import and every test anchor
kept working; `tests/_source.mjs` maps each old path onto its parts for the tests that assert on
source text. `public/js` follows the same rule: `views/config/`, `views/studio/`,
`features/settings/`, `features/brandkit/`.

### Want to change X? Go to file Y

| Want to change | Go to |
|---|---|
| the script engine (modes, gates, batching, the master prompt) | `content/master-script.js` · routing in `pipeline/stages/script.js` |
| the offline / no-LLM script path | `providers/llm/script.js` — `offlineScript`, `twoStageScript`, `verbatimScript` |
| the LLM retry / backoff / multi-key chain | `providers/llm/transport.js` — `chat`, `chatOnce`; `llm/json.js` — `chatJson` |
| the scene codegen prompt | `hyperframe/prompt/` (`system`, `blocks`, `layout`, `animation`, `build`) |
| a REST route | `api/routers/<domain>.js`; a new router is one `mount()` line in `api/routes.js`, plus a line in `tests/fixtures/route-table.json` |
| what a token may do | `api/scopes.js` — a rule per group, unmatched writes need `admin` |
| which channel a request works in | `api/channel-scope.js` — body `channelId`, `?channel=`, `X-AVS-Channel`, then the token's |
| what an agent is told this API is | `api/spec/operations.js` → `GET /api/openapi.json` (`npm run openapi` writes it to `docs/agent/`) |
| whether a video may be published | `api/services/verdict.js` + `publish/policy.js` |
| the tools an agent sees | `packages/avs-kit/src/mcp-tools.js` — descriptions are the interface |
| an HTTP error or a request-body limit | `api/http.js` (`wrap`, `errorHandler`) · body limits in `server.js` |
| scene validation rules and thresholds | `hyperframe/validate.js` |
| what an animation lands on, and when | `hyperframe/beats.js` |
| **add a TTS provider** | `providers/voice/<name>.js` + one line in `voice/index.js`, then a rate in `core/pricing.js` |
| **anything per-language** (reading speed, breath pad, connectors, line-height floor, number locale, word and sentence boundaries) | **`i18n/languages.js`** — `tests/i18n-contract.test.js` fails if a consumer drifts from it |
| how a language's words are counted or its lines broken | `i18n/segment.js` |
| what a voice says for `85 %`, `16:9`, `15/3/2025` | `i18n/tts-rules.js` |
| narration the app writes itself (chapter cards, the offline CTA) | `i18n/script-phrases.js` |
| a string in the interface | edit the page or modal under `public/partials/`, then `i18n-extract.mjs --write` + `build-locales.mjs` |
| a page or modal's markup | `public/partials/<page-x|modal-x>.html` — included by `public/index.html`, assembled at boot |
| the look of one area | `public/css/<area>.css` — linked in cascade order, joined into one file by the release build |
| the in-app manual | `public/guide/sections.json`, then `i18n-extract-guide.mjs` + `build-locales.mjs --guide` |
| what the first paint fetches | `GET /api/boot` (`api/routes.js`) and `public/js/main.js`; measure with `npm run perf:boot` |
| a server message, a toast or a dialog | write it in Vietnamese; `i18n-extract-server.mjs` / `i18n-extract-ui-msgs.mjs` key it by its own text |
| how a failure is classified | `failed('<code>', …)` from `core/errors.js` — never the wording |
| subtitle look, timing or the burn | `subtitles/presets.js` · `subtitles/chunk.js` · `subtitles/ass.js` |
| a video rendering in the wrong font for its script | `styleguide/script-fonts.js` · `subtitles/presets.js` `perLangDefaults` · `scripts/build-fonts.mjs` |
| transitions between scenes | `pipeline/render/transitions.js` — `planTransitions` |
| the audio mix, ducking or mastering | `pipeline/render/encode.js` · `pipeline/finalize/sound.js` · `media/master.js` |
| dub a finished video into another language | `pipeline/dub.js` |
| export a subtitle track in another language | `subtitles/translate.js` · `GET /projects/:id/srt?lang=xx&format=vtt` |
| cost rates or the budget guardrail | `core/pricing.js` · `core/budget.js` · `core/spend-guard.js` (hard stops) |
| the release pipeline | `scripts/release.mjs` · `shell/build-app.sh` (macOS) · `scripts/build-windows.mjs` · `scripts/build-linux.mjs` + `Dockerfile` (server) |

### Invariants

Four rules the code enforces mechanically. Each is explained where it is implemented; the tests that
pin them are listed in [`ENGINEERING.md`](ENGINEERING.md).

- **No fallback in codegen.** Ten corrective attempts on the primary model, then the run fails and
  names the scenes. No fallback model, no template substitution. Only a structural failure re-asks —
  layout findings are advisory, and a wrong on-screen language re-asks at most three times.
  → `hyperframe/codegen.js`, `pipeline/stages/visuals.js`
- **A frame is a pure function of time.** Scenes are paused GSAP timelines seeked by `__seek(t)`;
  Chrome screenshots each frame into an FFmpeg pipe, so memory is flat at any length.
  → `animation/harness/runtime-seek.js`, verified by `scripts/determinism.mjs`
- **Nothing is rebuilt that has not changed.** A content hash per artifact means editing one scene
  re-records and re-renders only that scene; a second hash picks one of four concat tiers
  (`skip` / `audio` / `copy` / `encode`). API keys are excluded from both.
  → `pipeline/fingerprint.js`, `pipeline/concat-plan.js`
- **Nothing costs money without a click.** Assistant proposals, calendar slots and dubs create data
  only. → `pipeline/dub.js`, `api/services/topic-autopilot.js`

### Storage and durability

SQLite (WAL) at `data/studio.sqlite` — 22 tables, 6 append-only migrations, each applied inside one
transaction with its version bump, with a checkpointed file backup kept for the last 10.

A durable `jobs` ledger survives restarts: one running job per project, one per batch, lanes capped
at `pipeline 2 · render 2`. A resource governor re-derives capacity from free RAM and load on every
acquire. At boot, orphaned projects become `paused` and orphaned jobs are requeued as continuations.
Stop is written to disk before memory, and long FFmpeg children get an `AbortSignal`.

---

## Languages

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

**Interface catalogues** are static JSON in `public/locales/` — 13 files of 906 keys plus 13 manual
files of 435 strings, fetched at boot. The markup carries Vietnamese as the default, so a missing
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

## Providers

Every provider is optional. With none configured the app still produces a video, using the offline
script writer and the keyless voice.

### LLM

One protocol for all — `POST {baseUrl}/chat/completions` with a bearer key. Presets are data
(`providers/llm-presets.js`).

| Preset | Tier | Script + codegen | Also serves |
|---|---|---|---|
| Google Gemini | free | ✅ | image, TTS |
| OpenRouter | free | ✅ | — |
| Groq | free | — | TTS |
| Together AI | cheap | — | image, TTS |
| OpenAI | premium | — | image, TTS |
| Custom | — | ✅ | any OpenAI-compatible endpoint; `localhost` needs no key |

Only Gemini-serving presets get the script/codegen lane: that setting drives both, and scene quality
is dominated by that model family.

Runtime: multiple keys per provider with automatic rotation, four attempts per key per model with
`8 s / 20 s / 45 s` backoff, a wall-clock ceiling, and a deterministic offline writer as the floor.

### Voice — 10 providers

| | Free | Network | Notable |
|---|---|---|---|
| Edge Neural | ✅ | ✅ | keyless, ~400 voices, the default |
| macOS `say` | ✅ | — | fully offline |
| Supertonic | ✅ | — | neural, local server |
| Azure Speech | | ✅ | ~150 locales; `mstts:express-as` styles carry the per-scene mood |
| Google Cloud TTS | | ✅ | strongest for Hindi, Thai, Indonesian |
| Amazon Polly | | ✅ | speech marks give real word timestamps — no transcription pass |
| ElevenLabs | | ✅ | premium multilingual, also returns word timing |
| OpenAI TTS | | ✅ | shares the LLM preset list |
| Vbee · LarVoice | | ✅ | Vietnamese specialists |

The chosen voice is locked: three retries on the same voice before the chain may switch, then a
timbre-preserving fallback, then one more attempt at the primary at the end of the stage.
Implausibly long or short audio counts as a failed attempt.

### Others

Image editing (OpenAI-compatible `/images/edits`) · image search (Tavily → keyless Openverse →
offline gradients) · ASR (local whisper.cpp) · trends (Google Trends and Google News in the
channel's own market, plus RSS packs) · article fetching with an optional AI refinement pass.

### Cost

Every LLM and TTS call is metered per video and streamed live (`provider_usage`, `GET /api/usage`).
Rates live in `core/pricing.js` — 44 model prefixes plus per-1k-character TTS rates. Cost is shown
before it is spent in four places: the scene gate, the change-plan table, the pending-changes bar
and the assistant's pre-create sheet.

---

## Configuration

Five groups in the Studio config column. Settings merge **app defaults → channel → preset → video**,
skipping only `undefined`.

| Group | Contents |
|---|---|
| Format & quality | visual style, motion density, creative direction, per-video codegen model, consistent scenes, image-full, brand-asset casting, overlay mode, fps, resolution, language, aspect, duration mode and lengths |
| Channel brand | Brand Kit (name badge, logo stamp, drifting watermark), brand display font |
| Subtitles | 30 controls — preset, mode, chunking, type, colour, outline, shadow, glow, box, position, motion — with a live preview through the real burn path |
| Voice & music | voice picker, BGM, automatic music, AI sound design, silent mode |
| Advanced | transitions and style, metadata and SEO style, auto-concat, review gate, scene gate, TTS and render concurrency, project assets |

Channel presets save and restore the whole panel; switching channel resets it to that channel's own
defaults.

---

## Development

```bash
npm test              # 126 files, 950 tests, hermetic, 120 s per-test timeout
npm run lint          # ESLint 9 flat config — errors block CI, warnings are a to-do list
npm run test:smoke    # every template built in 16:9 and 9:16, GSAP compiled
npm run test:e2e      # boot, make a real short video, verify the MP4
npm run perf:boot     # what the first paint costs, measured (see docs/performance.md)
```

Two tests guard the shape of the tree rather than a behaviour: `tests/code-health.test.js` (no
module over 400 lines, no `console.*` outside the logger, no duplicated helpers, every test on a
hermetic database) and the route-table test in `tests/api-routes.test.js` (178 routes, pinned).

| Harness | Checks |
|---|---|
| `scripts/determinism.mjs` | the same scene rendered twice is byte-identical |
| `scripts/hf-qa.mjs` | a rendered scene meets its visual and timeline invariants |
| `scripts/parity/` | an 8-item checklist scored against the reference app, plus a blind A/B builder |
| `scripts/e2e-resume.mjs` | an interrupted project resumes to a valid MP4 |
| `scripts/cta-audit.mjs` | a script's CTA map; non-zero exit on a discipline defect |
| `scripts/audit-release.mjs` | the built `.app` contains no readable source |

CI (`.github/workflows/ci.yml`) runs on every push to `main` and every PR: three jobs — `lint`,
`test` (Ubuntu, Node 22, FFmpeg, coverage summary in the log) and a reporting-only `npm audit`.
Network providers and the Chrome render smoke are local-only.

Regression tests are named after the behaviour they protect — see
[`ENGINEERING.md`](ENGINEERING.md).

---

## Build and release

```bash
npm run shell:build          # dev .app pointing at this checkout
npm run shell:build:dist     # release .app — bundled, bytecode-compiled, encrypted
npm run win:build            # Windows NSIS installer
npm run release -- --version 1.1.0
```

`scripts/release.mjs` runs: bump the version → build the `.app` → move the sourcemap out of the
payload → `audit-release.mjs` → codesign → zip with checksum → notarise and staple. The artefact
lands in `dist/`; there is nothing to sign in to and nothing to upload it to.

The macOS release contains no readable source: `src/server.js` is bundled by esbuild, compiled to V8
cached data, AES-256-GCM encrypted, and loaded by `loader.cjs`, which verifies the V8 build, the
flags and a SHA-256 before V8 sees the bytes and refuses rather than falling back. The key is
generated per build and passed over stdin. Windows ships the same chain: the payload is encrypted
bytecode in `resources/app-payload`, and the key lives inside a compiled Go launcher
(`shell/win-launcher`) that hands it to the vendored `node.exe` over stdin — Electron never sees it.
Both bundles also carry `packages/avs-kit` as readable source, which is the point of it.

The interface ships as `js/main-[hash].js` plus `js/chunks/*-[hash].js` (code-split, so lazy
screens stay lazy), one minified `css/app-[hash].css`, and the document assembled from its partials
with preload hints for the entry's static graph. Every hashed file is served `immutable`; the
document is revalidated by ETag. `AVS_PUBLIC_DIR` points the dev server at a built payload.

Supporting scripts: `fetch-node.mjs` (checksum-verified runtime) · `build-fonts.mjs` (font pipelines
under a byte budget) · `build-libs.mjs` · `build-whisper-model.mjs` · `build-icon.mjs` ·
`build-frontend.mjs` · `build-locales.mjs` and four `i18n-extract-*` tools.

---

## Operations

| | Location |
|---|---|
| Database | `data/studio.sqlite` (WAL), backups in `data/backups/` |
| Projects | `data/projects/<id>/{audio,srt,html,render,assets,output}` |
| Library | `data/library/{brand,bgm,sfx,fonts}` |
| Release data dir | `~/Library/Application Support/AI Video Studio` |
| Per-run journal | the in-app journal panel, and the `journal_events` table |
| All jobs | the Tasks view — every queued, running and recent job |

Diagnosis starts in the journal: grouped by stage with measured durations, scene-linked lines,
retries and errors, searchable and exportable. A red dependency chip means FFmpeg or Chrome is
missing. A run sitting at `scenes` or `review` is a gate, not a crash. Why a video did not update is
answered by the concat tier printed in the log. A project produced in the wrong language can be
repaired with `scripts/repair-language.mjs`.

### Running it for agents

The app is a desktop app by default and changes nothing about that. There are two ways to let an
agent in, and the first one needs no terminal at all.

**From the installed app.** AI Setting → **Agent (MCP)** → turn it on → mint a token. From that
moment every API call needs one, loopback included; the app's own window keeps working because the
launcher hands it a session of its own. The panel prints the exact `claude mcp add` line for that
machine — the bundled Node, the bundled kit — and the caps beside it are what stops a bad loop
spending all night. Both bundles ship `packages/avs-kit`, and the kit finds the running app by
reading `server.url` from its data directory, so nothing pins a port that changes every launch.

**As a server.** `AVS_MODE=server` opens the other shape: tokens are required from boot, there is no
window to authenticate, and tokens are minted on the machine — the HTTP route refuses outright.

```bash
npm run token -- create --name claude --scopes read,produce,publish   # mint one per agent
AVS_MODE=server AVS_HOST=127.0.0.1 npm start                          # 0.0.0.0 only behind Tailscale
claude mcp add avs -- node packages/avs-kit/bin/avs-mcp.mjs --token avs_…
```

Either way an agent gets the same thing: an explicit channel on every creation, machine-readable
error codes, a durable event cursor, a publish verdict, spending caps and a stop valve.

- The contract an agent reads: [`docs/agent/README.md`](docs/agent/README.md) and
  `GET /api/openapi.json` · the playbooks are in `docs/agent/playbooks/`.
- The kit (MCP server, `avs` CLI, SDK — no dependencies): [`packages/avs-kit`](packages/avs-kit/README.md).
- Deploying it, on a Mac or in a container: [`docs/deploy/README.md`](docs/deploy/README.md).
- Shipping a build: [`docs/release/checklist.md`](docs/release/checklist.md) — and note that the
  Windows installer has not yet been run on Windows.

---

## Limits

- **No right-to-left support.** Karaoke captions render one `<span>` per word, which breaks Arabic
  letter joining; this needs the caption renderer redesigned.
- **276 interpolated server strings and 41 toasts remain Vietnamese.** They are assembled at runtime
  and appear in the journal and logs, not in the interface chrome.
- **The Windows build has no code protection** — readable source inside an asar.
- **Prompts are visible to whoever owns the LLM key**, which is the customer. Accepted trade; see
  [`ENGINEERING.md`](ENGINEERING.md).
- **Scene codegen costs one LLM call per scene.** Past ~40 scenes that dominates the cost of a video.
- **No open-source licence file.** The repository ships none; third-party obligations are in
  [`NOTICE.md`](NOTICE.md).

---

[`ENGINEERING.md`](ENGINEERING.md) — protected behaviours and decision records ·
[`NOTICE.md`](NOTICE.md) — third-party attribution
