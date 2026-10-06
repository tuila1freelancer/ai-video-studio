# Architecture

How a video is produced, how the source tree is organised, and the rules the code enforces. For the
behaviours that must survive any refactor, see [`ENGINEERING.md`](../ENGINEERING.md).

Paths in this document are relative to `src/` unless stated otherwise.

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

## Source tree

About 280 backend modules and 66 frontend modules — no module over 400 lines (a ratchet in
`tests/code-health.test.js` keeps it that way). The frontend is native ES modules — no framework,
no runtime dependency — bundled only for release: 6 pages and 15 modals as `public/partials/`
assembled into one document at boot, twelve per-area stylesheets, and screens that load on first click.

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

### Where to change what

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
pin them are listed in [`ENGINEERING.md`](../ENGINEERING.md).

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

SQLite (WAL) at `data/studio.sqlite` — 25 tables and append-only migrations, each applied inside one
transaction with its version bump, with a checkpointed file backup kept for the last 10.

A durable `jobs` ledger survives restarts: one running job per project, one per batch, lanes capped
at `pipeline 2 · render 2`. A resource governor re-derives capacity from free RAM and load on every
acquire. At boot, orphaned projects become `paused` and orphaned jobs are requeued as continuations.
Stop is written to disk before memory, and long FFmpeg children get an `AbortSignal`.
