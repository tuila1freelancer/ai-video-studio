# Refactor plan — AI Video Studio

> Phase 2. Based on [architecture.md](architecture.md). Execute sequentially R1→R12, **lowest risk first**. Each step = 1 Conventional Commits commit + must pass the verify gate before moving to the next step. If a step breaks: fix at most 3 times; if still not resolved → `git revert` and record the reason in [refactor-report.md](refactor-report.md).

## Invariants (restated from architecture.md §7)
- **100% behavior-preserving**: do not change REST endpoint/shape, WS message, DB schema, config/video format. Old projects in `data/` must still be resumable.
- **8 groups + P1–P15 protected behaviors**: move only; changing logic/constants/ordering is forbidden.
- Environment: `export PATH="/opt/homebrew/opt/node@22/bin:$PATH"` before any node command.

## Coding standard applied to every new/modified file
- File ≤ **300 lines** (target), **400 lines** (hard cap — exceeding it requires a documented reason in the report).
- 1 module = 1 responsibility. No side effects at import time (except `server.js` and the `db/index.js` connection).
- Every public export has JSDoc `@param`/`@returns`.
- Files `kebab-case`, functions `camelCase`, constants `UPPER_SNAKE`.
- Error messages carry context (`projectId`, `scene idx`).
- No magic numbers scattered around → consolidate them into `config/constants.js` with meaningful names.
- Deleting any file/export must come with **grep proof** that no one imports it anymore.

## Verify gate (defined once, referenced at each step)
- **G1 (light)**: `node --check` on changed files + import-smoke for each entry (`node -e "await import('./src/...')"`); `node scripts/tpl-smoke.mjs`.
- **G2 (server)**: boot the server, `GET /api/projects` returns JSON; for DB/routes steps: also call a few related endpoints.
- **G3 (e2e)**: `node scripts/test-drive.mjs 'Chủ đề test refactor' 45 '9:16' 1800000 edge` → PASS + `qc_report.json` ok. **tts=edge is mandatory** (LarVoice is paid).
- **G4 (resume-compat)**: open an old project in the DB via API/`scripts/resume.mjs`, confirm it reads scenes + status without error.

---

## The steps

### PHASE A — Cleanup (LOW risk)

**R1 — Remove dead code & junk files.** *(risk: low · ~40 lines removed · G1)*
- Drop the import of `estimateSpeechSeconds` (`providers/llm.js:4`) and `projectDir` (`api/routes.js:7`, `pipeline/runner.js:7`).
- Remove the duplicate `sleep` in `util/util.js:10` (keep the `util/retry.js` version); remove the `clamp` export (`util/util.js:12`).
- Downgrade `export function run`→`function run` (`media/ffmpeg.js:5`).
- Delete `test-beats.mjs`, `test_overshoot_logic.js`, and every `.DS_Store` (already grepped 0 importers — architecture.md §4).
- Verify: G1. (Note: `test-beats.mjs` imports `extractBeats` — nothing imports it back, so it is safe.)

**R2 — Consolidate duplicated helpers/constants. → EVALUATED, SKIPPED (not real duplication).**
On close inspection, the "duplicates" flagged by the survey agent turned out to be DIFFERENT functions; merging them would change behavior (violating the mandate) or would be a premature abstraction:
- `escapeHtml`: the `harness.js` version escapes 4 characters (`& < > "`), the `util.js` version escapes 5 (adds `'`→`&#39;`). They differ; harness sits on a sensitive render path → leave as is.
- `clamp`: the `branding.js` one is a **4-parameter function with a default** `(v,lo,hi,dflt)`, used only in branding, and is already a clean local const → hoisting it into util would be a premature abstraction.
- `PALETTES` (`imagesearch.js`, an array `['0x..','0x..']`) vs `THEMES` (`visuals.js`, an object `{a:'#..',b:'#..',…}`) — **different structures**, not the same data.
Conclusion: there is no genuine duplicate that can be merged safely. Drop R2; the following steps keep their numbers.

### PHASE B — Pure layer & config (LOW–MEDIUM risk)

**R3 — magic number → named constant. → FOLDED INTO R9.**
The tuned constants (`padMs`, `pix_th=0.04`, `PSNR=70`) are single-site values with a comment explaining "why" RIGHT at the call site — pulling them into a central file separates the "why" from the "what", reduces clarity, and touches render/QC thresholds (unnecessary risk). Instead, when splitting modules (R9) we will declare local named constants (e.g. `PAD_MS` in `stages/tts.js`). This meets the "no magic number" standard without a risky sweep step.

**R4 — Extract the script domain out of `providers/llm.js`. → DEFERRED (under the 400 cap).**
`llm.js` is 382 lines, under the hard cap; its section-based organization is already fairly clear. Prioritize context for files that EXCEED the cap (runner 723, routes 464, db 452) and cutting the cycle. Do R4 if there is budget left after R10.

### PHASE C — Cut the visual cycle (MEDIUM risk — architectural crux)

**R5 — Create a shared `src/styleguide/`, cutting the animation↔hyperframe cycle.** *(risk: medium · ~260 lines moved · G1+G3)*
- Move into `styleguide/`:
  - from `animation/templates/hyperframe.js`: `normalizeGuide`, `HF_DEFAULT_GUIDE`, `SAMPLE_SPEC`;
  - from `hyperframe/styleguide.js`: `themeFromGuide`, `resolveGuide`, `HF_PRESETS`, `generateStyleGuide`.
- `animation/templates/hyperframe.js` keeps only the **"hyperframe" template renderer** (the buildTemplate case), importing the guide from `styleguide/`.
- Update every importer (already grepped): `animation/index.js`, `hyperframe/{prompt,codegen,validate,styleguide,icons}.js`, `pipeline/{runner,visuals}.js`, `api/routes.js`, `scripts/{tpl-smoke,determinism,hf-qa}.mjs`.
- Result: `styleguide/` imports nobody upward; `hyperframe/`→`animation/`+`styleguide/` is one-directional; the cycle disappears.
- Verify: G1 (import-smoke must have no circular warnings) + **G3** + `node scripts/hf-qa.mjs`.

### PHASE D — Persistence (MEDIUM risk)

**R6 — Split `db/index.js` into connection + repositories.** *(risk: medium · ~450 lines reorganized · G1+G2+G4)*
- `db/index.js`: keep the connection, `db.exec` schema, migrations, seed, and **re-export everything** so that `import * as DB from '../db/index.js'` is unchanged (preserving every call site).
- `db/repositories/`: `projects.js`, `scenes.js`, `channels.js`, `presets.js`, `styles.js`, `library.js`, `voices.js`, `settings.js`. Prepared statements grouped by domain.
- **Do not change a single character of SQL/schema** (resume-compat). Keep P13 (recover zombie).
- Verify: G1 + G2 (`/api/projects`, `/api/channels`) + **G4**.

### PHASE E — API (MEDIUM risk)

**R7 — Split `api/routes.js` into domain routers + services.** *(risk: medium · ~464 lines reorganized · G1+G2)*
- `api/index.js`: `mountRoutes` only wires the routers together.
- `api/routes/`: `projects.js`, `channels.js`, `scenes.js`, `voices.js`, `styles.js`, `library.js`, `media.js` (file-serving + edit-cut), `hyperframe.js`, `misc.js` (health/settings/estimate).
- `api/services/`: business logic pulled out of the routes — `voice-preview.js`, `batch.js`, `srt-export.js`, `file-guard.js` (allowlist P15). Routes only validate→call service→JSON.
- Keep the path, method, shape, and error codes intact. Keep P14/P15.
- Verify: G1 + G2 (hit ≥1 endpoint per router: projects, channels, voices, styles, library, file, hyperframe/presets).

### PHASE F — Pipeline runner (HIGH risk — do last, heaviest verify)

**R8 — Extract orchestration helpers out of `runner.js`.** *(risk: medium · ~90 lines · G1+G3)*
- `pipeline/progress.js`: `progressPlan`, `step`, `op`, `retryHook`.
- `pipeline/util.js`: `mapPool`, `resolveOutputDir`, `visualOpts`, `styleNameOf`, `subtitleStyleFrom`.
- `runner.js` imports them back. No behavior change.
- Verify: G1 + G3.

**R9 — Split stages B2..B8 into `pipeline/stages/*`.** *(risk: HIGH · ~400 lines split · G1+G3)*
- `stages/script.js` (B2), `stages/tts.js` (B34 + `ttsOne` + voice-lock heal P7/P9), `stages/visuals.js` (B5 animation/hyperframe/image, keep P8), `stages/render.js` (B6), `stages/concat.js` (B7 finalize), `stages/qc-gate.js` (B8, keep P6/P10 repair), `stages/metadata.js`.
- `runner.js` → `pipeline/orchestrator.js`: a thin `runPipeline` that calls the stages in order + emits WS + catches errors/auto-resume (P10 `_auto<1`).
- **Preserve every self-heal & guard branch.** This is the most fragile step.
- Verify: G1 + **G3 mandatory** + diff `qc_report.json` against the baseline.

**R10 — Extract `renderOnly`/`regenOne`/`brandGenImpl` + `heal.js`.** *(risk: high · ~180 lines · G1+G3+G4)*
- `pipeline/render-only.js`, `pipeline/regen.js`, `pipeline/brandgen.js`, `pipeline/heal.js` (consolidating `renderHealed`, voice-lock heal, auto-resume policy).
- `pipeline/index.js` (formerly `queue.js`) updates its imports.
- Verify: G1 + G3 + **G4** (resume + regen one scene of an old project).

### PHASE G — Frontend (LOW risk — dead code + naming ONLY, NO redesign)

**R11 — Clean up `public/js/` + consolidate path extraction.** *(risk: low · ~60 lines · G2 + page load)*
- Pull the `?path=` parse function (repeated in 4 places) into `public/js/api.js`.
- Split HyperFrame/subtitle state out of `views/config.js` (400 lines) into `features/` if it yields a clear reduction; remove dead code and make naming consistent. Do NOT change UI behavior, do NOT change the interface.
- Verify: G2 + load the SPA (preview), check for no console errors, try creating one project.

### PHASE H — Documentation & JSDoc (LOW risk)

**R12 — JSDoc public exports + update README + architecture.md.** *(risk: low · final G3)*
- JSDoc every public export still missing one (prioritize the newly split modules).
- `README.md` matches the new structure; `architecture.md` updates the diagram + the "to change X→Y" table to the new paths.
- Verify: **full gate G1+G2+G3+G4**.

---

## Ordering & condensed rationale
1. **A, B** first because they are low risk and clean the ground so later steps are easier to read.
2. **C** (cut the cycle) before D/E/F because it unties the dependency knot, letting later steps import cleanly.
3. **D, E** (DB, API) are medium and relatively independent of the pipeline.
4. **F** (dissecting the runner) is the highest risk → do it last once the ground is solid, with heavy e2e verification.
5. **G, H** close it out: FE + documentation.

## Estimate
- ~12 commits, net **reduction** in total lines (removing dead code + consolidating duplicates) despite adding files (finer splits).
- Files >400 lines after refactor: target **0**.
- Every PHASE F step runs G3 (~e2e, a few minutes on the edge voice) — the most time-consuming but mandatory.
