# Refactor report — AI Video Studio

> Phase 5. Branch `refactor/architecture-v2`. Document chain: [architecture.md](architecture.md) → [refactor-plan.md](refactor-plan.md) → this report.
> Overarching principle: **100% behavior-preserving** — no changes to REST/WS/schema/format; old projects can still resume.

## 1. Step table

| Step | Content | Status | Verify |
|---|---|---|---|
| R1 | Remove dead code (unused imports `estimateSpeechSeconds`/`projectDir`, dead `sleep`/`clamp`/`estimateSpeechSeconds` in util, demote `export run`), delete `test-beats.mjs` + `test_overshoot_logic.js` + `.DS_Store` | ✅ done | node --check, import-smoke 13/0, tpl-smoke 21/0 |
| R2 | Merge duplicated helpers | ⏭️ skipped (assessment: `escapeHtml`/`clamp`/`PALETTES` are **not true copies** — merging would change behavior or produce an immature abstraction) |
| R3 | magic number → named constant | 🔀 folded into module splitting (named local constants introduced during splitting; avoids risky threshold sweeps) |
| R4 | Extract script domain out of `llm.js` | ⏳ deferred (llm.js is 382 < the 400 ceiling; prioritize files over the ceiling) |
| R5 | **Extract a shared `styleguide/` → break the `animation↔hyperframe` cycle** | ✅ done | cycle broken ✓, import-smoke 10/0, hf-qa render 0 defect, guide/preset byte-identical |
| R6 | **Split `db/index.js` (452) → connection + 5 repositories** | ✅ done | DB smoke on the real DB (8 projects + 42-scene read OK), server boot, 4 endpoints |
| R7 | **Thin routes — pull business logic out to `api/services/`** (464→392) | ✅ done | node --check, batch→400, preview→400, file→403, /voices OK |
| R8 | Extract helpers out of runner.js → `stop.js` + `progress.js` + `helpers.js` (723→665) | ✅ done | node --check, tpl-smoke 21/0, queue import OK |
| R9 | **Dissect runner.js → orchestrator + `stages/{script,tts,visuals,render,finalize,metadata}.js`** (665→68) | ✅ done | node --check, import-smoke, boot; e2e ↓ |
| R10 | Extract `renderOnly`/`regenOne`/`brandGenImpl` → `render-only.js`/`regen.js`/`brandgen.js` | ✅ done | queue re-export intact |
| R11 | Frontend dead code + naming | 📋 remaining (low risk — not a backend file) |

## 2. Before/after metrics

| Metric | Before | After |
|---|---|---|
| `src/` files | 72 | 101 (finer-grained modules, single responsibility) |
| Files over the 400-line ceiling | 3 (runner 723, routes 464, db 452) | **0** ✅ |
| Dependency cycles | 1 (animation↔hyperframe) | **0** |
| Dead code/files | 2 files + ~7 dead exports/imports | 0 |
| Largest backend file | runner.js 723 | routes.js 392 |
| runner.js | 723 (god: orchestration+stage+heal+metadata+brandgen) | 68 (orchestrator) + stages ≤168 |
| db/index.js | 452 (schema+8 domains+seed) | 31 (barrel) + repos ≤125 |
| routes.js | 464 (one giant function) | 392 (thin) + services |

## 3. Verification results (verify gate)

- **G1 (static)** after every step: `node --check` + import-smoke + `tpl-smoke` (21 templates) — **all green**.
- **G2 (server)** after R6/R7: clean boot, `/api/{health,projects,channels,styles,hyperframe/presets,voices}` returns correctly; guard `/file`→403 outside the allowlist; `/batch`,`/voices/preview` validate→400.
- **R5 render**: `hf-qa.mjs` renders `SAMPLE_SPEC` headless → 0 defect / 0 warning (the styleguide→renderer→HTML-page chain intact).
- **Byte-identity**: `diff` confirms `HF_PRESETS` + the `generateStyleGuide` prompt + all SQL/schema are identical to the original.
- **G3 (e2e) after R5+R6+R7**: `test-drive.mjs … edge` → **PASS ✅** — the B2→B8 pipeline produces a video with **4/4 HyperFrame AI-directed scenes, 0 fallback**, clean QC, 46.9s/9.36MB.
- **G3 (e2e) after R9 (runner dissection)**: the new pipeline runs correctly through every extracted stage (B2 script.js → B34 tts.js → B5 visuals.js: 4/4 scenes codegen → B6 render.js). A fresh run hit the **harness's 20-minute time ceiling** when the LLM codegen was slow (B5 took 582s) → stopped mid-B6 (NOT a pipeline failure). **Verify completed via resume**: `resume.mjs pmrehssz5f1e71e37` → recover zombie (P13) → skip B2/B34/B5 → render the 2 missing scenes (render.js) → **B7+B8 finalize.js (concat+mix+QC) → done**, video 48s/9.0MB, narration coverage ≥92% → **PASS ✅**. Proves the orchestrator + all stages + finalize + resume preserve behavior.
- **G4 (resume-compat)**: (a) DB smoke reads 8 old projects (including the 42-scene project with `status=done`) OK; (b) `buildContext` builds ctx from an old project OK; (c) the real resume above runs end-to-end through the new code — old data intact.

## 4. NEW locations of the protected behaviors (P1–P15)

All logic preserved; the moved items:
- **P1–P5** (LLM: floor 16k, json-mode-attempt-1, 429-before-dead-key, minScenes, LANG_WPS) — **remain in `providers/llm.js`** (untouched).
- **P6** (QC) — `pipeline/qc.js` + the repair cycle **moved** into `pipeline/stages/finalize.js` (recursive `_qcAttempt`, identical logic).
- **P7/P9** (voice-lock, loudnorm/pad) — `providers/tts.js`, `media/ffmpeg.js`; the heal loop + `padMsFor` **moved** into `pipeline/stages/tts.js`.
- **P8** (skip chapter-break, `video_path:null`) — **moved** into `pipeline/stages/visuals.js` (every line preserved).
- **P10** (multi-tier render self-heal, auto-resume) — render heal **moved** into `pipeline/stages/render.js`; auto-resume (`_auto<1`) in `pipeline/runner.js` (orchestrator); stop signal in `pipeline/stop.js`.
- **P11/P12** (beats, PSNR/frozen-tail) — remain in `hyperframe/beats.js`, `validate.js`, scripts.
- **P13** (recover zombie) — **moved** `db/index.js` → `db/repositories/projects.js` (`recoverZombieProjects`, identical logic).
- **P14** (mask secret) — remain in `util/secrets.js` + `core/config.js`; `writeChannelJson` moved to `db/repositories/channels.js`.
- **P15** (file allowlist) — **moved** `routes.js` → `api/services/file-access.js` (`inAllowedRoots`, identical logic).
- Guide schema/preset/theme (not a P but sensitive) — **moved** from `animation/templates/hyperframe.js` + `hyperframe/styleguide.js` → `styleguide/` (byte-identical).

## 5. Deliberately NOT done & why

- **R2 (merge helpers)**: the "duplicates" the survey agent flagged are not true copies — merging `escapeHtml` (4 vs 5 characters), `clamp` (3 vs 4 parameters), `PALETTES` vs `THEMES` (`0x` array vs `#` object) would **change behavior** or yield an immature abstraction. Chose the safe option.
- **R4 (extract llm domain)**: `llm.js` is 382 < the hard ceiling; left as is (already organized into clear sections). `domain/script.js` can be extracted later if desired.
- **R11 (frontend)**: `public/js/` is browser code, not backend; low risk but hard to verify automatically (no build/test). Left for a separate session with manual preview.

## 6. Proposed next steps (in order)
1. **R11**: clean up `public/js/` (pull the `?path=` parse repeated in 4 places into `api.js`, extract HyperFrame/subtitle state out of the 400-line `views/config.js`) — verify with preview.
2. **R4**: extract `domain/script.js` out of `llm.js` (offlineScript + prompt builders) if you want a leaner llm.js.
3. Finish JSDoc on the remaining old public exports (runner/stages already have it); add a "moved X→Y" table to `docs/architecture.md` per the new paths.
4. Consider adding automated tests for the pipeline (now that each stage is split, unit-testing each step is easier).
