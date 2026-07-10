# AI Video Studio Architecture — current-state map & target architecture

> Phase 1 of the refactor effort. This document is a **living map** for both humans and AI coding agents: read it to know "which file do I go to if I want to change X", where responsibility boundaries lie, and which parts must absolutely not be touched.
> Document chain: architecture.md (current state) → [refactor-plan.md](refactor-plan.md) (steps R1..Rn) → [refactor-report.md](refactor-report.md) (results).

---

## 1. System overview

AI Video Studio is a macOS app that generates videos automatically: enter a topic → generate script (LLM) → voiceover + subtitles → build per-scene motion graphics → render → concat + mix → QC. There is no build step and no FE framework.

- **Stack**: Pure Node.js 22 ESM. `express` (REST) + `ws` (realtime progress) + `better-sqlite3` (persistence) + `puppeteer-core` (render HTML→frame) + `ffmpeg`/`ffprobe` (media) + `whisper-cli` (subtitles). The FE is vanilla ESM in `public/js/`.
- **Entry**: `src/server.js` → mounts REST (`api/routes.js`) + WebSocket hub + static SPA.
- **Scale**: ~131 files, ~15.7k lines (src ~8.6k). Line-count details in §8.
- **Pipeline (step codes used throughout the codebase)**: `B2` script → `B34` TTS+SRT → `B5` visuals → `B6` scene render → `B7` concat/mix → `B8` QC gate.

Two visual modes run in parallel; this is the crux of the entire architecture:
- **animation mode** — the planner picks 1 prebuilt motion-graphics template for each scene (`src/animation/`).
- **hyperframe mode** — the LLM writes its own `{css, html, script}` GSAP for each scene, validates it via a real render (`src/hyperframe/`), then **re-renders using the animation mode engine itself**.

---

## 2. Current layer diagram (actual, not idealized)

```
                         ┌──────────────┐
  Browser SPA  ────────► │  server.js   │  entry: express + ws + static
  (public/js)  ◄──ws───► └──────┬───────┘
                                │
                        ┌───────▼─────────┐
                        │  api/routes.js  │  464 lines — 1 giant mountRoutes fn,
                        │  (FAT ROUTER)   │  mixed with business logic (voice preview, batch,
                        └───────┬─────────┘  srt export, file-serving guard)
                                │
                    ┌───────────▼───────────┐
                    │  pipeline/queue.js     │  thin facade (active Map) — OK
                    └───────────┬───────────┘
                                │
                ┌───────────────▼────────────────┐
                │     pipeline/runner.js          │  723 lines — GOD FILE
                │  runPipeline · finalize ·       │  mixes: orchestration + per-stage
                │  renderOnly · regenOne ·        │  logic + retry/self-heal + metadata
                │  brandGenImpl + 8 helper        │  + brand-gen
                └──┬───────┬────────┬─────────┬───┘
                   │       │        │         │
        ┌──────────▼─┐ ┌───▼────┐ ┌─▼──────┐ ┌▼─────────────┐
        │ providers/ │ │pipeline│ │animation│ │ hyperframe/  │
        │ llm tts    │ │/stages │ │/ (engine│ │ (LLM codegen)│
        │ subtitle   │ │direction│ │+templates)◄══╗ (LOOP)    │
        │ imagegen   │ │qc render│ │         │══►║           │
        │ fetchlink  │ │srt      │ │         │   ║           │
        └──────┬─────┘ │visuals  │ └────┬────┘   ╚═══════════╝
               │       └────┬────┘      │
        ┌──────▼────────────▼───────────▼──────────────┐
        │  infra: db/  media/(ffmpeg,puppeteer,whisper,say)  ws/hub  │
        │         config/paths  core/config  util/*  subtitles/presets │
        └───────────────────────────────────────────────────────────┘
```

### What's already right (keep the spirit when refactoring)
- `pipeline/queue.js` — an exemplary thin facade (in-flight `Map`, a single entry point). A pattern to replicate.
- `core/config.js` — clean config layering (channel → preset → request; AI settings by section) + secret masking at every egress. A genuine "single source of truth".
- `config/paths.js` — resolves binaries/dirs in the order ENV → vendor → app bundle → PATH, with graceful null. Clear.
- `server.js` — a compact entry, with boot-recovery for zombie projects; doesn't die on a stray async error.
- The voice provider layer (`providers/voice/*`) — one file per provider behind one interface (`index.js`). This is the model for the other providers.

---

## 3. THE TWO BIGGEST ARCHITECTURAL PROBLEMS

### 3.1 God file `pipeline/runner.js` (723 lines) — ✅ DISSECTED (R8–R10)
> Post-refactor update: `runner.js` is now **68 lines** (a pure orchestrator). Each stage B2→B8 lives in `pipeline/stages/{script,tts,visuals,render,finalize,metadata}.js` (all ≤168 lines), taking `ctx` from `pipeline/context.js`; the stop signal is in `pipeline/stop.js`, WS events + progress in `pipeline/progress.js`, helpers in `pipeline/helpers.js`; `renderOnly`/`regenOne`/`brandGenImpl` are split out into `pipeline/{render-only,regen,brandgen}.js`. The table below is the OLD layout (kept for reference).

A single file (the old version) carried everything: pipeline orchestration, detailed per-stage logic (B2→B8), the 3-tier retry/self-heal policy, metadata + chapter generation, and even offline brand-gen. Consequence: hard to read, hard to test each stage, hard for an AI agent to fix one step without reading the whole file.

Inside, these blocks were immediately separable:
| Block | Lines | Where it should go |
|---|---|---|
| helpers: `mapPool`, `step/op/retryHook`, `progressPlan`, `visualOpts`, `resolveOutputDir` | 34–90 | `pipeline/progress.js` + `pipeline/util.js` |
| B2 script | 107–129 | `pipeline/stages/script.js` |
| B34 TTS+SRT (`ttsOne` + voice-lock heal) | 131–181 | `pipeline/stages/tts.js` |
| B5 visuals (animation + hyperframe + image) | 183–284 | `pipeline/stages/visuals.js` |
| B6 render + self-heal + verify | 286–374 | `pipeline/stages/render.js` + `pipeline/heal.js` |
| B7 finalize + B8 QC gate | 435–580 | `pipeline/stages/concat.js` + `pipeline/stages/qc-gate.js` |
| metadata + chapters | 381–403 | `pipeline/stages/metadata.js` |
| `renderOnly`, `regenOne`, `brandGenImpl` | 583–723 | `pipeline/render-only.js`, `pipeline/regen.js`, `pipeline/brandgen.js` |

The remaining `runPipeline` should be just an orchestrator of ~80 lines: call stages, emit WS events, catch errors + auto-resume.

### 3.2 Dependency loop `animation/` ↔ `hyperframe/`
This is the worst tangle. The two directories import each other **bidirectionally**:

```
animation/index.js  ──imports──►  hyperframe/styleguide.js   (themeFromGuide, resolveGuide)
hyperframe/styleguide.js ──imports──► animation/templates/hyperframe.js (HF_DEFAULT_GUIDE, normalizeGuide)
hyperframe/prompt.js     ──imports──► animation/templates/hyperframe.js (SAMPLE_SPEC)
hyperframe/validate.js   ──imports──► animation/{templates, harness, templates/hyperframe}
hyperframe/codegen.js    ──imports──► animation/{templates, themes}
hyperframe/icons.js      ──imports──► animation/templates/_shared.js (IC)
```

Root cause: **the file `animation/templates/hyperframe.js` (255 lines) is misplaced.** Its contents (`normalizeGuide`, `HF_DEFAULT_GUIDE`, `SAMPLE_SPEC`, the renderer for the "hyperframe" template) are *hyperframe/style-guide* concepts, yet they sit under `animation/templates/`. Conversely, `themeFromGuide`/`resolveGuide` (theme concepts) sit in `hyperframe/styleguide.js` but are consumed by `animation/index.js`.

**Target boundary (finalized) — extract one shared module, break the loop:**

```
                 ┌────────────────────────────┐
                 │  styleguide/  (NEW, shared)│  guide schema · normalizeGuide ·
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

## 4. Dead-code inventory (verified via grep — safe to delete/downgrade)

| Item | Location | Evidence | Action |
|---|---|---|---|
| redundant `estimateSpeechSeconds` import | `providers/llm.js:4` | appears only on the import line itself, called in 0 places | remove from the import list |
| duplicate `sleep` | `util/util.js:10` | every importer (`runner.js`, `larvoice.js`) takes it from `util/retry.js`; 0 places import `sleep` from `util.js` | delete the copy in util.js, keep the one in retry.js |
| `clamp` export | `util/util.js:12` | 0 importers; `animation/branding.js` has its own 4-argument `clamp` | remove the export (or consolidate branding to use the shared one — decided in the plan) |
| redundant `projectDir` import | `api/routes.js:7`, `pipeline/runner.js:7` | only `DB.projectDirFor` is used; `projectDir` is never called | remove from the import |
| redundant `export` on `run` | `media/ffmpeg.js:5` | used only internally (lines 16, 20); 0 external importers | downgrade `export function run` → `function run` |
| dead files | `test-beats.mjs`, `test_overshoot_logic.js` (root) | 0 importers, not in npm scripts; debug/tuning artifacts | delete (if you want to preserve the decision, move to `docs/explorations/`) |
| `.DS_Store` | scattered | macOS junk files | delete + already in `.gitignore` |

**Checked and NOT dead (don't delete by mistake):** `closeBrowser` (`media/puppeteer.js`) — used by `scripts/{hf-qa,build-icon,determinism}.mjs`; the survey agent only scanned `src/` so it reported it wrongly.

Duplicates to consolidate (not dead, but dirty): `PALETTES` (`imagesearch.js`) vs `THEMES` (`visuals.js`) — same color-pair structure; `escapeHtml` (harness.js defines its own even though `util.js` already exports it); `clamp` (branding.js vs util.js). Gather them into `util/`/`config/constants.js`.

---

## 5. Target architecture by layer (each decision + 1 rationale)

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
    render-only.js · regen.js · brandgen.js
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
- **`styleguide/` separated** — as in §3.2, this is the key to making the two visual systems stop overlapping without renaming an entire directory (reduces import churn, safe for resume-compat).
- **`domain/` pure** — `offlineScript`, `twoStageScript` prompt-building, `LANG_WPS`, `srt`, `beats`, `lang` don't touch I/O → split them out so they're unit-testable and quick for an AI to read.
- **`db/repositories/`** — `db/index.js` at 452 lines lumps together schema + 8 domain queries + seed + side-effects-at-import; split schema/migration from per-domain queries, keeping the SQL schema unchanged (mandatory, resume-compat).

> Scope note: renaming a large directory (`animation/`→…) creates huge import churn and resume-compat risk. The plan will prioritize **splitting files & creating new modules** over mass renaming; the original folders can keep their names — what matters is that the responsibility boundaries and dependency direction are exactly as above.

---

## 6. "Want to change X → go to file Y" table (will be updated to the new structure after refactor)

| Want to do | Currently go to file |
|---|---|
| Add a new TTS provider | `providers/voice/<name>.js` + register in `providers/voice/index.js` |
| Change the LLM retry/backoff/multi-key chain | `providers/llm.js` (`chat`, `chatOnce`) |
| Change how the offline script is split / the script-generation prompt | `providers/llm.js` (`offlineScript`, `generateScript`, `twoStageScript`) |
| Add an animation template | create `animation/templates/<name>.js` + register in `animation/templates/index.js` |
| Change the HyperFrame codegen prompt | `hyperframe/prompt.js` |
| Change HyperFrame scene validation rules (timid/overshoot…) | `hyperframe/validate.js` |
| Add a style preset (color/motif/HUD) | `hyperframe/styleguide.js` (`HF_PRESETS`) |
| Change QC thresholds (black/silence/tolerance) | `pipeline/qc.js` + the call site in `runner.js` `finalize` |
| Add/change a REST endpoint | `api/routes.js` |
| Change the DB schema / add a column | `db/index.js` (the `db.exec` block + migrations) |
| Change pipeline orchestration (B2..B8 order, auto-resume) | `pipeline/runner.js` `runPipeline` |
| Change loudnorm / pad / SFX / ambient | `media/ffmpeg.js` |
| Change the config layer (channel/preset/request) | `core/config.js` |
| Change binary path / runtime directory | `config/paths.js` |
| Change the video-export config UI | `public/js/views/config.js` |
| Change the realtime progress display | `public/js/views/progress.js` + `ws/hub.js` |

---

## 7. "PROTECTED BEHAVIOR" registry (movable; DELETE/SIMPLIFY = broken)

Distilled from `docs/upgrade-report.md` + code survey. The refactor is allowed to **relocate**, but forbidden to change logic/constants/ordering.

| # | Behavior | Current location |
|---|---|---|
| P1 | `chatOnce` floors `max_tokens = 16000` (reasoning models burn tokens on hidden thinking) | `providers/llm.js:57` |
| P2 | `chatJson` enables `response_format:json_object` only on the first attempt (the gemini proxy returns garbage otherwise) | `providers/llm.js:121,124` |
| P3 | Catch **429/rate-limit BEFORE dead-key**, backoff [8s,20s,45s]×4 | `providers/llm.js:26,38–42` |
| P4 | `minScenes ≥70%` (single) / `≥60%` (per-chapter) to guard against the model returning too few scenes | `providers/llm.js:281,331` |
| P5 | `LANG_WPS` (vi 4.4…) — word count based on real reading speed | `providers/llm.js:217` |
| P6 | `qc.probeStreams` strips the trailing comma from ffprobe csv; `pix_th=0.04`; `tailAllowance`; defect mapping prioritizes exact-containment | `pipeline/qc.js` |
| P7 | TTS: an explicit `ttsOverride.provider` beats `langVoices`; voice-lock retries 3× with the same voice | `providers/tts.js` |
| P8 | B5 hyperframe **skips a `chapter-break` scene with props** (keeps the anchor SFX); on successful codegen it sets `video_path:null` (so resume re-renders) | `pipeline/runner.js:244,247,257` |
| P9 | loudnorm EBU R128 per-scene + `apad` by language (vi 650ms/en 400ms) | `media/ffmpeg.js:normalizeVoice`, `runner.js:146` |
| P10 | Multi-tier self-heal: render retry → swap `kinetic-statement` template → deferred sequential → QC repair (guard `_qcAttempt<1`); auto-resume once (`_auto<1`) | `pipeline/runner.js:319–372,415–422,549–560` |
| P11 | beats: `MIN_GAP=1.2 HOLD_MAX=2.6 LEAD=0.12`; filter out punctuation-only beats | `hyperframe/beats.js:61–63,137` |
| P12 | QA/determinism `PSNR_OK=70`; `FROZEN_TAIL` when `tlDur<dur-0.4`; `SUBTITLE_COLLISION cy>0.82H` | `scripts/{determinism,hf-qa}.mjs`, `hyperframe/validate.js` |
| P13 | recover zombie 'running'→'paused' at boot | `db/index.js:214` |
| P14 | mask secrets at every egress + `applyMaskedUpdate` round-trips `••` | `util/secrets.js`, `core/config.js` |
| P15 | `/api/file` path allowlist (data/ + channel roots + app bundle read-only) | `api/routes.js:426` |

Golden rule when refactoring: if a regex/constant/guard looks "redundant" → grep `docs/` + this table before touching it.

---

## 8. Appendix — line counts of large files (baseline before refactor)

| Lines (before) | File | After refactor |
|---|---|---|
| 723 | `pipeline/runner.js` | **68** (orchestrator) + `stages/*` ≤168 + entries (R8–R10) ✅ |
| 464 | `api/routes.js` | **392** + `api/services/*` (R7) ✅ |
| 452 | `db/index.js` | **31** (barrel) + `db/repositories/*` ≤125 (R6) ✅ |
| 400 | `public/js/views/config.js` | 400 — FE, not yet touched (R11 remaining) |
| 382 | `providers/llm.js` | 382 — under the cap, left as-is |
| 255 | `animation/templates/hyperframe.js` | **157** — only the renderer remains; guide moved to `styleguide/` (R5) ✅ |
| 253 | `animation/harness.js` | 253 — engine, OK |

**Result: 0 backend files >400 lines** (goal achieved). The remaining `public/js/views/config.js` (400, exactly at the threshold) belongs to R11.
