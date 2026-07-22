# AI Video Studio Architecture — current-state map & target architecture

> A **living map** for both humans and AI coding agents: read it to know "which file do I go to if I want to change X", where responsibility boundaries lie, and which parts must absolutely not be touched.

---

## 1. System overview

AI Video Studio is a macOS app that generates videos automatically: enter a topic → generate script (LLM) → voiceover + subtitles → build per-scene motion graphics → render → concat + mix → QC. There is no build step and no FE framework.

- **Stack**: Pure Node.js 22 ESM. `express` (REST) + `ws` (realtime progress, replay buffer + heartbeat) + `better-sqlite3` (persistence, versioned migrations) + `puppeteer-core` (render HTML→frame) + `ffmpeg`/`ffprobe` (media) + `whisper-cli` (subtitles, forced alignment). The FE is vanilla ESM in `public/js/`.
- **Entry**: `src/server.js` → cost-meter subscribe → zombie/job recovery → scheduler start → REST (`api/routes.js`) + WebSocket hub + static SPA.
- **Pipeline (step codes used throughout the codebase)**: `B2` script → `b2.5` editorial gate → `b2.75` duration fit (`stages/budget.js`: total narration ≈ `config.videoDuration` ±12%; skipped for `durationMode:'auto'`, pasted JSON, and master-engine detailed scripts ≥`SCRIPT_MODE_MIN_WORDS`) → *(estimated timing seed, `pipeline/estimate.js`)* → `B5` visuals → *(scene gate, opt-in `config.sceneGate` — P17)* → `B34` TTS+SRT (overwrites estimated duration/srt with real) → `B6` scene render (hyperframe time-warp: `props.plannedDur`→`S.tplScale` ratio, upgraded to the beat-anchored piecewise map `S.tplWarp` built by `animation/timewarp.js` — each baked beat is pinned to the real spoken word, per-word AV sync) → *(review gate)* → `B7` concat/mix + master → `B8` QC gate → metadata → `B9` publish (opt-in). Scenes-first: visuals exist before any TTS credit is spent. `config.durationMode:'auto'` keeps a pasted detailed script verbatim (`verbatimScript` in `providers/llm.js`) and lets duration follow the content.
- **B2 = the MASTER SCRIPT ENGINE** (`src/content/master-script.js`, default `config.scriptEngine:'master'`, `'legacy'` = old `generateScript`). ONE master prompt turns (topic | detailed owner script | pasted scenes JSON | fetched article URL) into the canonical factory-format scenes JSON `{thumbnail{title,prompt}, scenes[{stt,voice,visual,assets}]}` — per-scene `visual` is the full 8-bracket brief (`[ENVIRONMENT]…[MOOD]`), so `pipeline/direction.js` (marker `[MAIN FOCUS]`) skips those scenes and codegen consumes them directly. Modes: `topic` = plan-then-write (throughline→spine→scenes) + value architecture; `script` (≥80 words) = LIGHT POLISH (keep ≥90% wording + all ideas in order, fix broken sentences, smooth joins, add missing CTAs; enforced by the `POLISH_FLOOR` gate); `json` = zero-LLM import; `source` (URL input: B2 `fetchLink`s the article and hands it over as research material) = REWRITE-NEVER-COPY — topic doctrine grounded in the article's facts, never the polish path (an article's words are not the owner's). `validateScenesJson` gates: `META_LEAK` (CTA notes/hashtags/thumbnail prompts as narration — the real factory-file defect), `NOT_SPEAKABLE`, `BRACKETS` (≥5/8 incl `[MAIN FOCUS]`), `MONOTONY` (near-duplicate focus → visuals stripped for the direction pass), `COUNT`, `WORD_BUDGET` (topic + source); defects drive ONE re-ask, then `repairScenesSpec` drops/strips deterministically (P18). >30 target scenes → batches of 25 with rolling context; 'script' mode hands each span its word-balanced share of the source (`sourceSlicer` — shared cut points, so no sentence is ever dropped or repeated at a boundary), and any span whose reply looks truncated (invalid JSON / far fewer scenes than asked) SPLITS in two smaller calls (`generateSpan`, floor `MIN_SPLIT`) instead of failing the run. B2 writes the canonical `scenes.json` artifact into the project dir and stores `thumbnail` in `project.metadata` (finalize prefers its short title for the thumb); `GET /projects/:id/scenes-json` re-exports from DB rows on demand.
- **Orchestration**: REST enqueues durable jobs (`jobs` table) → `pipeline/scheduler.js` single-tick loop claims per-kind lanes → executors (`runPipeline`/`renderOnly`); `pipeline/governor.js` counting semaphores bound Chrome+ffmpeg across ALL concurrent runs; the content calendar promotes due slots on the same tick.

There is a SINGLE visual mode (P36 — the animation-template mode and the image/Ken-Burns mode were removed):
- **hyperframe mode** — the LLM writes its own `{css, html, script}` GSAP for each scene, validates it via a real render (`src/hyperframe/`), then renders it through the shared GSAP engine in `src/animation/` (harness / renderer / gsap / branding / fonts). `src/animation/` is now PURELY that shared render engine: `buildTemplate` keeps `kinetic-statement` as the universal fallback (a legacy scene whose stored template no longer exists still renders) plus `chapter-break`; the 20-template library + heuristic planner are gone (only `headline()` survives in `planner.js`).

---

## 2. Current layer diagram (actual, post-refactor)

```
                         ┌──────────────┐
  Browser SPA  ────────► │  server.js   │  entry: express + ws + static + boot recovery
  (public/js)  ◄──ws───► └──────┬───────┘  + scheduler start
                                │
                        ┌───────▼─────────┐
                        │  api/routes.js  │  REST (934 lines — regrown with the v3 feature
                        │  + api/services │  surface; the routes/-by-domain split of §5 is
                        └───────┬─────────┘  the one open refactor). services/ = assistant ·
                                │            autopilot · batch · voice-* · file-access
                    ┌───────────▼────────────┐
                    │ pipeline/queue.js       │  thin facade → durable jobs table →
                    │ scheduler.js · governor │  single-tick scheduler; governor semaphores
                    └───────────┬────────────┘  bound Chrome+ffmpeg across ALL runs
                                │
                ┌───────────────▼────────────────┐
                │  pipeline/runner.js (127 lines) │  pure orchestrator: stages + WS events +
                │  → stages/{script,editorial,    │  auto-resume; render-only/regen/
                │     budget,visuals,tts,render,  │  repurpose split into their own entries
                │     finalize,metadata,publish}  │
                └──┬───────┬───────────┬──────────┘
                   │       │           │
        ┌──────────▼─┐ ┌───▼────────┐ ┌▼─────────────────────────┐
        │ providers/ │ │ content/   │ │  styleguide/  (shared)   │
        │ llm tts    │ │ master-    │ │  guide schema · presets  │
        │ subtitle   │ │ script ·   │ └───▲──────────────▲───────┘
        │ imagegen   │ │ scorer     │     │              │
        │ trends     │ └────────────┘ ┌───┴──────┐  ┌────┴───────┐
        │ fetchlink  │                │animation/│◄─│ hyperframe/│  one-way:
        └──────┬─────┘                │ engine + │  │ LLM codegen│  hyperframe uses the
               │                      │ templates│  │ + validate │  engine, never back
        ┌──────▼──────────────────────┴──────────┴──┴────────────┴─┐
        │  infra: db/(connection·migrate·repositories)  media/(ffmpeg,master,align,puppeteer,whisper,say) │
        │         ws/hub  config/paths  core/(config·budget·metering·errors)  util/*  subtitles/presets  publish/ │
        └───────────────────────────────────────────────────────────┘
```

### What's already right (keep the spirit when refactoring)
- `pipeline/queue.js` — an exemplary thin facade (in-flight `Map`, a single entry point). A pattern to replicate.
- `core/config.js` — clean config layering (channel → preset → request; AI settings by section) + secret masking at every egress. A genuine "single source of truth".
- `config/paths.js` — resolves binaries/dirs in the order ENV → vendor → app bundle → PATH, with graceful null. Clear.
- `server.js` — a compact entry, with boot-recovery for zombie projects; doesn't die on a stray async error.
- The voice provider layer (`providers/voice/*`) — one file per provider behind one interface (`index.js`). This is the model for the other providers.

---

## 3. THE TWO BIGGEST ARCHITECTURAL PROBLEMS — both ✅ RESOLVED

> Kept as the record of *why* the current boundaries look the way they do. New problem to
> watch: `api/routes.js` has regrown to ~930 lines under the v3 feature surface — the
> routes/-by-domain split in §5 is the remaining open refactor.

### 3.1 God file `pipeline/runner.js` (was 723 lines) — ✅ DISSECTED (R8–R10)
`runner.js` is now a pure orchestrator (~130 lines: stages + WS events + bounded auto-resume).
Each stage lives in `pipeline/stages/{script,editorial,budget,visuals,tts,render,finalize,metadata,publish}.js`,
taking `ctx` from `pipeline/context.js`; the stop signal is in `pipeline/stop.js`, WS events +
progress in `pipeline/progress.js`, helpers in `pipeline/helpers.js`; `renderOnly`/`regenOne`/
`repurpose` are their own entries (`pipeline/{render-only,regen,repurpose}.js`); brand-asset generation lives in `api/services/brand-gen.js`.
The old version carried everything in one file — orchestration, per-stage logic, the retry/
self-heal policy, metadata generation, brand-gen — which made every fix a whole-file read.

### 3.2 Dependency loop `animation/` ↔ `hyperframe/` — ✅ BROKEN (R5, `styleguide/`)
The two directories used to import each other **bidirectionally** (guide/theme concepts were
stranded on the wrong sides: `normalizeGuide`/`HF_DEFAULT_GUIDE`/`SAMPLE_SPEC` sat under
`animation/templates/hyperframe.js`, while `themeFromGuide`/`resolveGuide` sat in
`hyperframe/styleguide.js` yet were consumed by `animation/index.js`).

**The boundary that fixed it — one shared module, no back-edges (this is the CURRENT state):**

```
                 ┌────────────────────────────┐
                 │  styleguide/  (shared)     │  guide schema · normalizeGuide ·
                 │  depends on neither side   │  resolveGuide · themeFromGuide ·
                 │                            │  HF_PRESETS · HF_DEFAULT_GUIDE · SAMPLE_SPEC
                 └───────▲───────────▲────────┘
                         │           │
         ┌───────────────┘           └───────────────┐
   ┌─────┴──────────┐                        ┌────────┴─────────┐
   │  animation/    │                        │  hyperframe/     │
   │  ENGINE render │◄──────depends on───────│  LLM CODEGEN     │
   │  (template lib,│   (buildTemplate,      │  (codegen,       │
   │  harness,      │    makeCtx, harness,   │   validate,      │
   │  renderer,     │    IC icons)           │   prompt, beats) │
   │  planner,themes│                        │                  │
   └────────────────┘                        └──────────────────┘
```

- **`styleguide/`** = the shared style/theme concept. Both sides `import` from it, and **neither side imports back up into it**. The loop disappears.
- **`animation/`** = the build + render engine (template library, harness, renderer, planner, branding, themes, gsap). It's the low-level "render library".
- **`hyperframe/`** = the "LLM writes GSAP" system (codegen, validate, prompt, beats, icons, lint). It **is allowed** to depend on `animation/` (it reuses the engine to render+validate) and on `styleguide/`. This is a valid one-way relationship.

The distinguishing principle to remember: *hyperframe produces a spec, animation turns the spec into pixels, styleguide decides what colors/typography/motifs the spec/pixels carry.*

---

## 4. Dead-code inventory — ✅ ALL EXECUTED (verified 2026-07-17)

Every item of the original sweep is gone from the tree: the redundant `estimateSpeechSeconds`
import, the duplicate `sleep` (only `util/retry.js` exports it now), the unused `clamp` export,
the redundant `projectDir` imports, the needless `export` on ffmpeg's `run`, the root debug
files `test-beats.mjs`/`test_overshoot_logic.js`, and stray `.DS_Store` (gitignored).

**Checked and NOT dead (don't delete by mistake):** `closeBrowser` (`media/puppeteer.js`) — used by `scripts/{hf-qa,build-icon,determinism}.mjs`; a survey that only scans `src/` will report it wrongly.

Duplicates still tolerated (not dead, but dirty — consolidate opportunistically, never in a rush): `PALETTES` (`providers/imagesearch.js`) vs `THEMES` (`pipeline/visuals.js`) — same color-pair structure; `escapeHtml` (`animation/harness.js` defines its own even though `util/util.js` exports one); `clamp` (`animation/branding.js` has a 4-argument variant).

---

## 5. Target architecture by layer (each decision + 1 rationale)

> Status 2026-07-17: achieved everywhere except two spots — `api/routes.js` never got its
> routes/-by-domain split (and has regrown, see §8), and the pure-`domain/` extraction was
> superseded: the pure logic went to `content/` (master-script, scorer) + `hyperframe/beats.js`
> instead of a new top-level folder. The tree below is kept as the reference target.

```
src/
  server.js                 # entry (nearly unchanged)
  api/
    index.js                # mountRoutes: only wires up the sub-routers
    routes/                 # thin routers by domain — ONLY validate→call service→return JSON
      projects · channels · scenes · voices · styles · library · media · hyperframe
    services/               # business logic pulled out of routes (voice-preview, batch, srt-export, file-guard)
  pipeline/
    index.js                # facade (the old queue.js)
    orchestrator.js         # thin runPipeline: call stages, emit WS, auto-resume
    stages/                 # 1 file/stage: script tts visuals render concat qc metadata
    heal.js                 # retry/self-heal policy (renderHealed, voice-lock, auto-resume)
    progress.js             # progressPlan, step/op/retryHook, chapter helpers
    render-only.js · regen.js
  providers/                # every provider behind one contract; retry/multi-key in EXACTLY 1 place (llm client)
    llm/  tts + voice/*  image(imagegen,imagesearch)  subtitle  fetchlink
  styleguide/               # NEW: shared guide/theme — breaks the animation↔hyperframe loop (§3.2)
  animation/                # render engine: templates/*, harness, renderer, planner, branding, themes, gsap
  hyperframe/               # LLM codegen: codegen, validate, prompt, beats, icons, lint
  domain/                   # PURE logic, no I/O: script(offline+prompt), srt, lang, word-budget
  db/
    index.js                # connection + schema + migrations
    repositories/           # queries by domain: projects scenes channels presets styles library voices settings
  infra/  (or keep media/ + ws/)  media/(ffmpeg,puppeteer,say,whisper)  ws/hub
  config/                   # paths · config-layering · secrets · constants(magic numbers)
```

Rationale for each layer:
- **`api/routes/` split by domain** — routes.js is currently 464 lines in one function; split so each domain is ≤120 lines, making endpoints easy to find and easy to add. Business logic (batch, voice-preview, file-guard) goes down into `services/` so routes are pure I/O.
- **`pipeline/stages/` 1 file/stage** — each step B2..B8 is testable/fixable independently; the orchestrator only coordinates. This is the highest-risk target, done last.
- **`providers/` behind one contract** — retry/backoff/multi-key currently lives in `llm.js`; gather every provider into the same mold so resilience logic isn't scattered.
- **`styleguide/` separated** — as in §3.2, this is what lets the hyperframe codegen and the shared render engine both depend on the guide schema without a dependency cycle (reduces import churn, safe for resume-compat).
- **`domain/` pure** — `offlineScript`, `twoStageScript` prompt-building, `LANG_WPS`, `srt`, `beats`, `lang` don't touch I/O → split them out so they're unit-testable and quick for an AI to read.
- **`db/repositories/`** — `db/index.js` at 452 lines lumps together schema + 8 domain queries + seed + side-effects-at-import; split schema/migration from per-domain queries, keeping the SQL schema unchanged (mandatory, resume-compat).

> Scope note: renaming a large directory (`animation/`→…) creates huge import churn and resume-compat risk. The plan will prioritize **splitting files & creating new modules** over mass renaming; the original folders can keep their names — what matters is that the responsibility boundaries and dependency direction are exactly as above.

---

## 5b. Upgrade-v3 module map (what was added on top of the v2 refactor)

| Concern | Module(s) |
|---|---|
| Versioned migrations + auto-backup | `db/migrate.js` (PRAGMA user_version; backups in `data/backups/`) |
| Durable job queue / scheduler / governor | `db/repositories/jobs.js` · `pipeline/scheduler.js` · `pipeline/governor.js` (flag: `settings.queue.durable`) |
| Content-hash resume (edit-aware) | `pipeline/fingerprint.js` (+ `scenes.fp`; PUT /scenes/:id invalidation) |
| Cost meter + budget guardrail | `util/usage.js` → `core/metering.js` → `db/repositories/usage.js`; `core/pricing.js` · `core/budget.js` |
| Error taxonomy + diagnostics | `core/errors.js` · `pipeline/diagnostics.js` |
| Broadcast master (-16 LUFS authority) | `media/master.js` (concat graph now ducks BGM via sidechain, no in-graph loudnorm) |
| Forced-alignment subtitles | `media/align.js` + `providers/subtitle.js` engine `align` (default) + whisper `--prompt` |
| Image provider mesh + smart prompts | `providers/imagegen.js` (openai/recraft → pollinations failover, `buildImagePromptSmart`) |
| Beat-synced motion | `animation/templates/index.js` `accentTimes` + `ctx.accentTimes` + FX.accents/schedule |
| VN TTS normalization + prosody | `providers/tts-normalize.js` (speak-text only; captions keep the script) |
| Timbre-preserving voice fallback | `providers/tts.js` + `db/repositories/catalogs.js` `nearestCachedVoice` |
| Channel guide + Show Bible | `POST /channels/:id/style-guide` · `channel_memory` + `db/repositories/channels.js` |
| Rough-cut player / review gate / takes / subtitle studio / timeline | `public/js/views/player.js` · `db/repositories/{reviews,takes}.js` · `features/srt.js` · `media/waveform.js` |
| Editorial gate (b2.5) | `content/scorer.js` · `pipeline/stages/editorial.js` |
| SEO metadata 2.0 / thumbnails / outro promo | `providers/llm.js` `generateMetadata` · `pipeline/visuals.js` `buildThumbnailVariants` · `templates/cta-outro.js` |
| Repurpose (aspect reflow) | `pipeline/repurpose.js` |
| Publisher (B9, staging-first) | `src/publish/` · `pipeline/stages/publish.js` · `db/repositories/publishes.js` |
| Trend autopilot + calendar + dashboard | `providers/trends.js` (RSS/Atom + feed packs) · `api/services/topic-autopilot.js` · `db/repositories/calendar.js` · `features/autopilot.js` |
| Content assistant v2 (history + config sheet + series + plan-week) | `db/repositories/suggestions.js` · `api/services/assistant.js` · `features/{assistant-sheet,assistant-history}.js` |
| Master script engine (B2: one master prompt → canonical scenes JSON; modes topic/script/json/source, word-balanced source partition + adaptive span split for long scripts) | `content/master-script.js` (plan/prompt/validate/repair/batching + `sourceSlicer`/`generateSpan` + `scenesJsonFromRows`) · `pipeline/stages/script.js` (routing + fetchLink→source + artifact) · `GET /projects/:id/scenes-json` · toolbar export buttons in `views/studio.js` · fixture gate `tests/fixtures/rag-scenes.json` |
| Overlay mode (keyed scenes → colorkey composite onto owner footage) | `animation/harness.js` (`opts.overlay`) · `animation/templates/hyperframe.js` (`props.overlay`) · `hyperframe/prompt.js` `overlayBlock` · `media/ffmpeg.js` `compositeColorkey` · `animation/index.js` |
| LLM SRT correction (whisper lane, timestamp-pinned) | `subtitles/llm-correct.js` · `providers/subtitle.js` |
| LLM sound design (BGM pick + SFX by cue sheet, clamped) | `audio/sound-design.js` · `pipeline/stages/finalize.js` |
| Consistent-scenes / image-full mode blocks + scene assets | `hyperframe/codegen.js` (blocks + `applyAssetMedia`) · `util/asset-uri.js` · migration 4 (`scenes.assets`) |
| Edit scene by prompt (gated LLM edit + takes) | `api/services/edit-scene.js` · `POST /scenes/:id/edit-html` |
| Language expansion (12 langs, voice notes, script text rules) | `providers/llm.js` (`LANG_WPS/LANG_NAME`) · `content/master-script.js` (`LANG_VOICE_NOTES`) · `hyperframe/prompt.js` `scriptTextRule` |
| Visual-parity harness vs the reference app | `scripts/parity/{select,run,audit,blind,lib}.mjs` · `tests/fixtures/parity-manifest.json` · `docs/reference/gap-matrix.md` |
| Final-video logo stamp (WYSIWYG corner presets + drag/resize, all modes) | `media/logo-overlay.js` · `pipeline/render.js` (concat logo branch) · `pipeline/stages/finalize.js` · `public/js/features/brandkit.js` |
| Copyright watermark (slow perimeter drift, logo/name, on/off) | `media/watermark.js` · `pipeline/render.js` (concat watermark branch) · `pipeline/stages/finalize.js` |
| Subtitle display modes (karaoke/plain) + chunking (auto/sentence/N-word) | `subtitles/chunk.js` · `subtitles/presets.js` · `animation/harness.js` (cap runtime) |
| Brand Asset page (reference clone: emotions + images/edits ×10 no-fallback + alpha gate) | `api/services/brand-gen.js` · `providers/imagegen.js` `editImage` · `media/ffmpeg.js` `verifyTransparentBg` · `public/js/views/brandgen.js` |
| Persistent per-run journal ("Nhật ký xử lý") + global tasks view | `db/repositories/journal.js` (run-aware retention) · `pipeline/journal.js` (`jlog`, ALS jobId) · `pipeline/progress.js` (funnels) · `GET /projects/:id/journal` · `GET /tasks` · `public/js/features/{journal,tasks}.js` |
| CTA discipline + pinned-arc batching (1 soft CTA + closing only, no mid farewell) | `content/cta-audit.js` (lexicon/audit/strip) · `content/master-script.js` (`ctaPlanFor`/`generateOutline`/`enforceCtaFloor`, partial-span heads) · `content/scorer.js` (farewell/cta/idea-repeat/hook-weak/anchorless) · `pipeline/stages/editorial.js` (chunked rewrite + read-through + strip floor) · `scripts/cta-audit.mjs` |
| Tests + CI | `tests/` (named test per P1–P36) · `.github/workflows/ci.yml` · `npm test` |
| HyperFrames adoption (doctrine + gates) | `docs/reference/hyperframes-notes.md` (source map) · `hyperframe/lint.js` (static pre-render gate) · `hyperframe/validate.js` (persistence tiering, occlusion, beat adherence) · `animation/templates/_shared.js` (zoomThrough/jitter/targetZoom/dofBlur/streakIn/iconSpin, camPush `profile:'front'`) · `animation/harness.js` `__fitText` · `pipeline/direction.js` (roles + choreography verbs + blueprint layouts) · `pipeline/render.js` `planTransitions` (role-driven cuts/blends; `config.transitions` = smart mode, legacy uniform fade when no roles) · `GET /projects/:id/contact-sheet` |

## 6. "Want to change X → go to file Y" table (current structure)

| Want to do | Go to file |
|---|---|
| Change the master script engine (modes topic/script/json/source · gates · batching/adaptive split · master prompt) | `content/master-script.js` (+ routing/artifact in `pipeline/stages/script.js`) |
| Change the legacy/offline script path (`generateScript`, `offlineScript`, `twoStageScript`, `verbatimScript`) | `providers/llm.js` |
| Change the LLM retry/backoff/multi-key chain | `providers/llm.js` (`chat`, `chatOnce`, `chatJson`) |
| Add a new TTS provider | `providers/voice/<name>.js` + register in `providers/voice/index.js` |
| Add an animation template | create `animation/templates/<name>.js` + register in `animation/templates/index.js` |
| Change the HyperFrame codegen prompt | `hyperframe/prompt.js` (P19: never slice the narration/visual it embeds) |
| Change HyperFrame scene validation rules (timid/overshoot/fragments…) | `hyperframe/validate.js` |
| Change the art-director pass (roles/layouts/choreography) | `pipeline/direction.js` |
| Add a style preset (color/motif/HUD) | `styleguide/presets.js` (`HF_PRESETS`) |
| Change scene-boundary transitions | `pipeline/render.js` `planTransitions` |
| Change QC thresholds (black/silence/tolerance) | `pipeline/qc.js` + the call site in `pipeline/stages/finalize.js` |
| Change the editorial / duration-fit gates | `content/scorer.js` + `pipeline/stages/editorial.js` · `pipeline/stages/budget.js` |
| Add/change a REST endpoint | `api/routes.js` (business logic goes down into `api/services/`) |
| Change the DB schema / add a column | `db/connection.js` (schema) + `db/migrate.js` (versioned migration + backup) |
| Change pipeline orchestration (stage order, auto-resume) | `pipeline/runner.js` `runPipeline` (queueing: `pipeline/scheduler.js`) |
| Change loudnorm / pad / SFX / ambient / final master | `media/ffmpeg.js` · `media/master.js` |
| Change the config layer (channel/preset/request) | `core/config.js` |
| Change binary path / runtime directory | `config/paths.js` |
| Change the video-export config UI | `public/js/views/config.js` |
| Change the realtime progress display | `public/js/views/progress.js` + `ws/hub.js` |
| Change overlay-mode rules (key color, zones, composite) | `hyperframe/prompt.js` `overlayBlock` · `hyperframe/{lint,validate}.js` (overlay gates) · `media/ffmpeg.js` `compositeColorkey` |
| Change SRT-correction / sound-design prompts or clamps | `subtitles/llm-correct.js` · `audio/sound-design.js` |
| Change subtitle chunking / display modes | `subtitles/chunk.js` (P29) + UI in `public/js/views/config.js` |
| Change subtitle/brand font resolution or the loud-font probe | `subtitles/presets.js` (`familyName`, P30) · `animation/harness.js` (`fontChecks`) |
| Change the parity checklist / samples | `scripts/parity/audit.mjs` · `tests/fixtures/parity-manifest.json` (rebuild: `scripts/parity/select.mjs`) |
| Change the final-video logo stamp (geometry/UX) | `media/logo-overlay.js` (`logoRect` — P26 single source of truth) · `public/js/features/brandkit.js` |
| Change the copyright watermark (path/speed/opacity) | `media/watermark.js` (P28: one path for preview + ffmpeg) · `public/js/features/brandkit.js` |
| Change Brand Asset prompts / transparency gate / provider picker | `api/services/brand-gen.js` (P27: prompts verbatim) · `public/js/views/brandgen.js` |

---

## 7. "PROTECTED BEHAVIOR" registry (movable; DELETE/SIMPLIFY = broken)

Hard-won fixes proven by real testing. Refactors may **relocate** these, but must never change their logic/constants/ordering.

| # | Behavior | Current location |
|---|---|---|
| P1 | `chatOnce` floors `max_tokens = 16000` (reasoning models burn tokens on hidden thinking) | `providers/llm.js:57` |
| P2 | `chatJson` enables `response_format:json_object` only on the first attempt (the gemini proxy returns garbage otherwise) | `providers/llm.js:121,124` |
| P3 | Catch **429/rate-limit BEFORE dead-key**, backoff [8s,20s,45s]×4 | `providers/llm.js:26,38–42` |
| P4 | `minScenes ≥70%` (single) / `≥60%` (per-chapter) to guard against the model returning too few scenes | `providers/llm.js:281,331` |
| P5 | `LANG_WPS` (vi 4.4…) — word count based on real reading speed | `providers/llm.js:217` |
| P6 | `qc.probeStreams` strips the trailing comma from ffprobe csv; `pix_th=0.04`; `tailAllowance`; defect mapping prioritizes exact-containment; **+v3:** `qcSceneClip` `expectVoice` flags near-silent narrated clips (mean < −50dB) | `pipeline/qc.js` |
| P7 | TTS: an explicit `ttsOverride.provider` beats `langVoices`; voice-lock retries 3× with the same voice; **+v3:** the edge fallback lane picks `nearestCachedVoice` (timbre-preserving) | `providers/tts.js` |
| P8 | B5 hyperframe **skips a `chapter-break` scene with props** (keeps the anchor SFX); on successful codegen it sets `video_path:null` (so resume re-renders) — take activation & repurpose do the same | `pipeline/stages/visuals.js` · `db/repositories/takes.js` · `pipeline/repurpose.js` |
| P9 | −16 LUFS semantics + `apad` by language (vi 650ms/en 400ms). **v3 relocation:** per-scene = measured LINEAR loudnorm (`normalizeVoice`); the −16 authority for the finished file = `media/master.js` two-pass master; the concat graph carries NO loudnorm (ducking + limiter only) | `media/ffmpeg.js` · `media/master.js` · `stages/tts.js` |
| P10 | Multi-tier self-heal: render retry → swap `kinetic-statement` template → deferred sequential → QC repair (guard `_qcAttempt<1`); auto-resume once (`_auto<1`) — **v3:** only for retryable error classes (`core/errors.js`); deterministic config/resource errors surface immediately (never fewer resumes than before) | `pipeline/runner.js` · `stages/render.js` · `stages/finalize.js` |
| P11 | beats: `MIN_GAP=1.2 HOLD_MAX=2.6 LEAD=0.12`; filter out punctuation-only beats | `hyperframe/beats.js:61–63,137` |
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
| P36 | Single visual mode — HyperFrame only (owner order 2026-07-22): the `animation` (20-template motion-graphics library + heuristic/LLM planner) and `image` (Pollinations text-to-image + Ken-Burns posters + libass subtitle burn) modes were removed. `src/animation/` is now PURELY the shared GSAP render engine HyperFrame reuses; `buildTemplate` keeps `kinetic-statement` as the universal fallback (a scene whose stored template no longer exists still renders) + `chapter-break`, and `headline()` (trimmed `planner.js`) survives as the P10 swap's text source; `themes.js` stays as a hyperframe-codegen validation dependency (`getTheme`). Every dispatch site is single-mode and a stored `visualMode` of `'animation'`/`'image'` is coerced to `'hyperframe'` (migration id 5 across all 5 config-bearing tables), so a stray value can never route; the scriptwriter is always the motion-graphics brief; FPS/resolution relocated out of the removed `#animOpts`; consumption-site fallbacks read `\|\| 'hyperframe'` | `core/config.js` · `db/migrate.js` (id 5) · `animation/{index,templates/index,planner,themes}.js` · `pipeline/stages/{visuals,render}.js` · `pipeline/{regen,render-only,repurpose,fingerprint}.js` · `providers/llm.js` · `public/{index.html,js/views/config.js}` |

Golden rule when refactoring: if a regex/constant/guard looks "redundant" → grep `docs/` + this table before touching it.

---

## 8. Appendix — line counts of large files

| Pre-refactor | Post-refactor (R10) | Today (2026-07-17) | File | Note |
|---|---|---|---|---|
| 723 | 68 | 127 | `pipeline/runner.js` | still a pure orchestrator (publish stage + gates added) ✅ |
| 464 | 392 | **934** | `api/routes.js` | regrown under the v3 feature surface — the §5 routes/-by-domain split is the open refactor ⚠ |
| 452 | 31 | 38 | `db/index.js` | barrel; schema in `connection.js`, migrations in `migrate.js` ✅ |
| 400 | 400 | 463 | `public/js/views/config.js` | FE, grows with every new config knob (R11 still open) |
| 382 | 382 | 545 | `providers/llm.js` | legacy script paths + metadata; the default B2 path lives in `content/master-script.js` (~560) |
| 255 | 157 | 157 | `animation/templates/hyperframe.js` | only the renderer remains; guide moved to `styleguide/` ✅ |
| 253 | 253 | 454 | `animation/harness.js` | engine (time-warp, fit-text, ambient clock added) — OK |

The R10 goal "0 backend files >400 lines" was achieved and has since been traded away
deliberately in two places (`api/routes.js`, `providers/llm.js`) as v3 features landed faster
than splits; treat those two as the next refactor candidates, with the P-registry (§7) and
the named tests as the safety net.
