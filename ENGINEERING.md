# Engineering notes

Records that outlive the code they describe: the behaviours a refactor must not break, the layout
conventions behind the source tree, and the design decisions that were considered and declined.
Start with [`README.md`](README.md) and [`CONTRIBUTING.md`](CONTRIBUTING.md); come here before
changing anything listed below.

- [Protected behaviours](#protected-behaviours)
- [Source layout conventions](#source-layout-conventions)
- [Server mode and the agent kit](#server-mode-and-the-agent-kit)
- [Decision records](#decision-records)

---

## Protected behaviours

Each entry below exists because something once went wrong in a real run. Code may be **moved** —
update the location here when you do — but changing the logic, constants or ordering of a protected
behaviour is a regression. `tests/protected-behaviors.test.js` carries one named test per entry,
and the `tests/p<NN>-*.test.js` files pin the larger ones in detail.

Paths are relative to `src/` unless they start with `public/`, `scripts/` or `tests/`.

### LLM transport and the script engine

| ID | Guarantee | Location |
|---|---|---|
| P1 | `chatOnce` floors `max_tokens` at 16 000 — reasoning models spend tokens on hidden thinking before any visible output. | `providers/llm/transport.js` |
| P2 | `chatJson` sets `response_format: json_object` on the first attempt only; some OpenAI-compatible gateways return malformed output when it is repeated. | `providers/llm/json.js` |
| P3 | A 429 is recognised before the dead-key check, with backoff 8 s → 20 s → 45 s for four rounds. | `providers/llm/transport.js` |
| P4 | Too-few-scenes guard: at least 70 % of the planned count (single call) or 60 % (per chapter). | `providers/llm/generate.js` |
| P5 | `LANG_WPS` (vi 4.4, …) sizes a script from measured reading speed. | `i18n/languages.js` (`wps` column), re-exported by `providers/llm/budget.js` |
| P18 | Scenes-JSON contract. Every exit from the master engine — LLM output and pasted JSON alike — runs `repairScenesSpec` while defects remain, and drops `META_LEAK`, `NOT_SPEAKABLE` and `EMPTY` voices, so a CTA note or a hashtag line never reaches TTS. The canonical export carries only `thumbnail{title,prompt}` and `scenes[{stt,voice,visual,assets}]`, with `stt` continuous from 1. A pasted detailed script (≥ `SCRIPT_MODE_MIN_WORDS`) is never trimmed toward a duration target. | `content/master-script/{repair,shape}.js` · `pipeline/stages/{script,budget}.js` |
| P19 | The codegen prompt embeds the scene's complete narration and visual brief, untrimmed, so the generated page can follow what is spoken. | `hyperframe/prompt/build.js` |
| P25 | No fallback in codegen. The primary model gets ten attempts, then `generateSceneSpec` throws. B5 strips `modelFallback`, never substitutes a template, marks failed scenes `error` and fails the stage with the scene list; resume retries only those scenes. | `hyperframe/codegen.js` · `pipeline/stages/{visuals,render}.js` |
| P33 | CTA discipline: one soft CTA near 30 % of the video and one closing CTA in the final scene(s), never a farewell before the closing zone. Enforced three ways — per-span CTA plans plus a pinned outline for batched scripts; the `cta-audit` detector wired into scoring and the editorial pass; and a deterministic floor (`enforceCtaFloor`, `ctaStripFloor`) that strips mid-video farewells in every input mode. | `content/cta-audit.js` · `content/master-script/{shape,generate}.js` · `content/scorer.js` · `pipeline/stages/editorial.js` · `scripts/cta-audit.mjs` |

### Scene generation

| ID | Guarantee | Location |
|---|---|---|
| P8 | B5 skips a `chapter-break` scene that already has props (keeping its anchor SFX). A successful codegen sets `video_path: null` so resume re-renders the clip; take activation and repurpose do the same. | `pipeline/stages/visuals.js` · `db/repositories/takes.js` · `pipeline/repurpose.js` |
| P11 | Beat timing: `MIN_GAP = 1.2`, `HOLD_MAX = 2.6`, `LEAD = 0.12`; punctuation-only beats are filtered out. | `hyperframe/beats.js` · `i18n/stopwords.js` |
| P22 | Image-full substitution runs after lint and never ships a broken reference: `{{asset:NAME}}` resolves to a data URI, and an unresolved placeholder is stripped (an `<img>` carrying one is removed whole). | `hyperframe/codegen.js` · `db/migrate.js` (id 4) |
| P23 | Edit-by-prompt passes the same gates as fresh codegen (normalize → lint → syntax → render validation). A failing edit persists nothing; a passing one snapshots a take before and after and clears `video_path`. | `api/services/edit-scene.js` |
| P24 | Overlay mode removes every stage dressing from page and template so the key colour stays clean; captions stay; `backdrop-filter` is a lint error. The composite keys the clip over a footage slice offset by the scene's start on the final timeline. | `animation/harness/page.js` · `animation/templates/hyperframe.js` · `hyperframe/{lint,validate}.js` · `media/ffmpeg/footage.js` |
| P31 | Every video is unique. The output is the script's scenes and nothing else — no synthetic intro or outro, so clip count equals scene count. `sceneSeed` mixes a project-id hash into the seed and `motionSignature` takes a per-project salt: the same scene index differs across videos and stays deterministic within one. | `pipeline/stages/finalize.js` · `animation/index.js` · `hyperframe/signatures.js` · `util/util.js` |
| P35 | Density follows the scene's role (hook, proof and payoff run rich; a CTA runs minimal). The art director anchors choreography to the spoken beats, the beat budget scales with duration (`clamp(round(dur / 2.5), 5, 10)`), and single-scene regeneration has full parity with the batch lane. | `hyperframe/{prompt,beats,codegen}.js` · `pipeline/{direction,regen}.js` · `styleguide/presets.js` |
| P36 | One visual mode: HyperFrame. `src/animation/` is the shared GSAP render engine; `kinetic-statement` remains the universal fallback template; a stored `visualMode` of `animation` or `image` is migrated to `hyperframe` (migration id 5). | `core/config.js` · `db/migrate.js` (id 5) · `animation/` · `pipeline/stages/{visuals,render}.js` |
| P37 | The codegen prompt carries a concrete `ANIMATION SPEC` and a `TIMELINE SKELETON` with one authored line per real beat. Harness set-dressing and the deterministic fixers (`normalizeSpec`, `__fitText`, `__deoverlap`, `__safeZone`, `__margins`) stay as the readability floor. | `hyperframe/{prompt,codegen,beats,signatures}.js` |
| P38 | Per-ratio layout thresholds (padding, text, hero and card bounds, safe centre, `LOWER_THIRD_Y`) and distribution rules are emitted into the prompt. The backdrop style rotates per scene — deterministic by index and per-video salt, never repeating consecutively — while palette and fonts stay locked. Final QC checks stream and duration integrity only. | `hyperframe/prompt/layout.js` · `animation/backdrop.js` · `animation/templates/hyperframe.js` · `pipeline/qc.js` |
| P39 | Raw GSAP contract. The full `gsap` API is allowed except a standalone `gsap.to/from/fromTo` (it lands on the paused global timeline), real-time calls (`ticker`, `delayedCall`, `globalTimeline`, `context`, `matchMedia`) and `gsap.utils.random`. Validation is advisory: `defects` is the structural floor (script threw, blank render) and is the only thing that triggers a re-ask; geometry findings are warnings. Codegen `maxTokens` is 24 000; clips encode at `crf 18 -preset medium -profile high -level 4.0`. | `hyperframe/{lint,validate,codegen}.js` · `animation/renderer.js` · `pipeline/render.js` · `media/ffmpeg.js` |
| P41 | Even layout. A nine-zone budget — at least 7 of 9 zones used, all four corners anchored, every row and column holding at least two, middle-centre at most one — measured on the settled frame. The few-shot sample demonstrates it, layout thresholds are maxima rather than targets, and the caption band is not a no-go zone. The validator's 3×3 ink map warns on three or more dead zones or one zone above 34 %. | `hyperframe/prompt.js` · `hyperframe/validate.js` · `styleguide/guide.js` |

### Audio, subtitles and fonts

| ID | Guarantee | Location |
|---|---|---|
| P7 | An explicit `ttsOverride.provider` beats `langVoices`; voice-lock retries three times with the same voice; the Edge fallback picks `nearestCachedVoice`. | `providers/tts.js` |
| P9 | Loudness: each scene gets a measured linear loudnorm (`normalizeVoice`); the finished file is mastered to −16 LUFS in two passes; the concat graph carries no loudnorm. Breath pad by language (vi 650 ms, en 400 ms). | `media/ffmpeg.js` · `media/master.js` · `pipeline/stages/tts.js` · `util/lang.js` |
| P20 | LLM subtitle correction applies to the whisper lane only. A reply must keep the block count and every timestamp (± 10 ms) or it is discarded; karaoke words are redistributed only inside cues whose text changed. | `subtitles/llm-correct.js` · `providers/subtitle.js` |
| P21 | A sound-design plan resolves against the real library only. Volumes clamp (BGM 0.14–0.28 pre-duck, SFX 0.3–1.0), SFX sit at least 1 s apart at roughly one per 5 s, and an unusable plan returns `null` so the deterministic ambient bed ships instead. | `audio/sound-design.js` · `pipeline/finalize/sound.js` |
| P29 | Subtitle presentation (plain or karaoke; sentence or N-word chunks) is rebuilt from the canonical word timestamps by `rechunkCues`; beats and QC read the raw data; sentence cues wrap to at most two lines. | `subtitles/chunk.js` · `animation/index.js` · `animation/harness/runtime-core.js` |
| P30 | The chosen subtitle font always wins. It is stored as a bare family name, every page force-loads its faces and reports `fontMiss`, and the renderer warns on any miss — never a silent substitute. | `subtitles/presets.js` · `animation/{renderer,index}.js` · `animation/harness/{page,runtime-seek}.js` |

### Render, quality checks and branding

| ID | Guarantee | Location |
|---|---|---|
| P6 | `probeStreams` strips ffprobe's trailing CSV comma before reading stream types; a join with a missing stream or a wildly wrong duration fails the run. | `pipeline/qc.js` · `pipeline/finalize/qc.js` |
| P10 | Self-heal: render retry → template swap (non-HyperFrame scenes only, see P25) → deferred sequential render. One automatic resume, and only for retryable error classes. | `pipeline/runner.js` · `pipeline/stages/render.js` · `core/errors.js` |
| P12 | Determinism QA: `PSNR_OK = 70`; `FROZEN_TAIL` when `tlDur < dur − 0.4`; `SUBTITLE_COLLISION` at `cy > 0.82 H`. | `scripts/{determinism,hf-qa}.mjs` · `hyperframe/validate.js` |
| P26 | The logo stamp is WYSIWYG. `logoRect` (centre and width fractions → integer pixels) is the only placement formula; the Brand Kit preview mirrors it in CSS and the concat step passes its literal integers, so preview equals render. The stamp is drawn on the assembled programme, so moving it never invalidates a clip. | `media/logo-overlay.js` · `pipeline/render.js` · `pipeline/stages/finalize.js` |
| P27 | Brand asset generation. Both prompt texts are pinned byte-for-byte by tests, with one deliberate edit (a true-alpha transparent background). The selected image-edit provider gets ten attempts with no fallback; every accepted PNG passes `verifyTransparentBg`; files are named `character <name> <emotion>.png`. | `api/services/brand-gen.js` · `providers/imagegen.js` · `media/ffmpeg.js` |
| P28 | Watermark: one piecewise perimeter path drives both the preview (`perimeterPos`) and ffmpeg (`perimeterExpr`). Switched off, the concat graph is byte-identical to a build without the feature; text always goes through `textfile=`. | `media/watermark.js` · `pipeline/render.js` |

### Edit video and product capabilities

| ID | Guarantee | Location |
|---|---|---|
| P40 | Creative libraries (three.js, p5.js, …) are vendored and injected only when a scene references them, each driven by `window.__onSeek` so a layer is a pure function of time; Chrome runs with software WebGL. Brand assets are cast in one call against the real catalogue (at most two per scene). Supertonic is a managed local TTS server with a deep synthesis health check. AI thumbnails are sanitized static fragments re-shelled with vendored fonts, falling back to the deterministic thumbnail. Edit-video runs transcribe → segment → the normal visuals, render and finalize stages, keeping the original soundtrack. | `animation/{libs,harness}.js` · `media/{puppeteer,tts-server,whisper}.js` · `pipeline/{brand-assets,thumbnail-codegen,edit-video}.js` |
| P40+ | Facebook Page publishing (Reels for vertical video, a feed video otherwise; anything not explicitly published now is scheduled). `normalizeAssets` accepts all three asset shapes; the brand catalogue unions database rows with files on disk; keyless image search goes through Openverse one phrase at a time; key pools rotate only on credit or auth refusals; metadata is written from the narration. | `publish/facebook.js` · `pipeline/brand-assets.js` · `providers/{imagesearch,tts}.js` · `pipeline/stages/metadata.js` |
| P42 | Route-level capabilities: copy assets by path (skipping files gone from disk); restart as a **new** project, never an in-place wipe; per-platform AI captions; logo presets validated against the allowed roots; brand-folder rename and delete (the file count is echoed back before a delete); per-scene SRT; standalone transcription; the Facebook Page registry; `/llm/test`; an explicit, never automatic, install of the local voice engine; thumbnail edit-by-instruction (a reply under 40 % of the original length is rejected). | `api/routers/*.js` · `publish/facebook.js` · `pipeline/thumbnail-codegen.js` |
| P43 | Client capabilities: a pickable transition style (`auto` keeps the default plan byte-for-byte); drag and drop routed by file type; any subtitle colour; a publish composer that shows the exact post text; reframe bias for footage (`center` builds the same filter string as before). | `pipeline/render/transitions.js` · `media/ffmpeg.js` · `public/js/features/{dragdrop,scene-studio,settings,voicepicker}.js` · `public/js/ui/dialog.js` |
| P44 | Footage processing. Silence removal is decided by the pure `silenceKeepRanges` and applied in one `filter_complex` pass, picture and sound from one range list, **before** transcription so timings are right by construction. Auto-zoom uses `zoompan` at the real output size, starts or ends at exactly 1.0, and touches the footage chain only. Both are off by default. | `media/ffmpeg.js` · `pipeline/edit-video.js` · `public/js/views/editvideo.js` |

### Runs, jobs and safety

| ID | Guarantee | Location |
|---|---|---|
| P13 | Boot recovery: a zombie `running` project becomes `paused`; orphaned running jobs are requeued (two attempts, then a terminal error); the review hold has its own `review` status so it is never mistaken for a crash. | `db/repositories/{projects,jobs}.js` |
| P14 | Secrets are masked at every egress, and `applyMaskedUpdate` round-trips `••` without overwriting stored keys. | `util/secrets.js` · `core/config.js` |
| P15 | `/api/file` serves only paths inside `data/` or a registered channel root. | `api/routers/files-media.js` · `api/services/file-access.js` |
| P16 | Assistant proposals never start a paid pipeline: suggestions persist data and plans create slots. The only way from a suggestion to a run is an explicit `acceptSuggestion`. | `api/services/{topic-autopilot,assistant}.js` |
| P17 | The scene gate never spends. With `config.sceneGate` the run holds at the distinct `scenes` status; only `POST /projects/:id/approve-scenes` writes `scenes_approved_at`; TTS resume-skip requires a real `audio_path`. | `pipeline/runner.js` · `api/routers/pipeline.js` · `pipeline/scheduler.js` |
| P32 | Per-run journal. Every user-visible pipeline event is a `journal_events` row written only through `jlog()` and attributed to its job through the run context. Messages are stored in the catalogue's source language and translated for display. Retention keeps the last 10 runs per project (hard cap 20 000 rows) and cascades with the project. | `db/repositories/journal.js` · `pipeline/journal.js` · `util/log.js` · `public/js/features/{journal,tasks}.js` |
| P34 | Assistant flow: the researched topic always feeds the script stage, and a picked title travels as `config.titleOverride`; a duration target applies only with an explicit pick; pre-create cost estimates come from the pricing table and this installation's own history; suggestions use the channel's language; a failed slot promotion returns the idea to the pool. | `api/services/{assistant,topic-autopilot,batch}.js` · `api/routers/pipeline.js` · `pipeline/scheduler.js` |
| P45 | Agent access. Tokens are enforced only in server mode or when agent access is switched on — and then for every caller; the app's own window authenticates through a launcher nonce exchanged for a session cookie. Tokens are minted only at the machine (the CLI, or the app window over loopback; refused outright in server mode), stored as SHA-256 and compared in constant time. Scopes come from one table and unmatched writes need `admin`. Every creation path resolves an explicit channel, and every refusal carries a machine-readable `code`. | `core/runtime-mode.js` · `api/middleware/auth.js` · `api/scopes.js` · `api/channel-scope.js` · `core/api-codes.js` · `db/repositories/api-tokens.js` · `api/routers/tokens.js` |

---

## Source layout conventions

- **400 lines per module, 120 per function.** A module that outgrows the limit becomes a directory
  of the same name behind a facade at the old path (`providers/llm.js` re-exports
  `providers/llm/*`), so imports and test anchors keep working. `tests/code-health.test.js`
  enforces the limits, bans `console.*` outside the logger and requires every test to run on a
  hermetic database; its allowlists may only shrink.
- **One router per domain.** `api/routes.js` mounts the routers under `api/routers/` in a fixed
  order; shared helpers live in `api/helpers.js`; the full route table is pinned by
  `tests/api-routes.test.js` against `tests/fixtures/route-table.json`.
- **The interface is assembled, not monolithic.** `public/index.html` is a shell of
  `<!--#include-->` markers expanded at boot from `public/partials/`; the stylesheet is twelve
  per-area sheets joined by the release build.
- **Tests follow code that moves.** `tests/_source.mjs` maps a split file onto its parts
  (`RELOCATED`) so a test that asserts on source text keeps matching after a refactor.
- **Constants are asserted by value.** Per-language reading speed, the breath pad and beat timing
  live in `i18n/languages.js`, `util/lang.js` and `hyperframe/beats.js`, and their tests check the
  numbers rather than a source line.

## Server mode and the agent kit

`AVS_MODE=server` is a second deployment shape for the same code, not a second application. It
enables bearer tokens, explicit channels, machine-readable error codes, a durable event cursor, a
pre-publish verdict and an operational stop valve. The desktop app runs the same code with all of
it inert, which is why only the tests that boot HTTP had to know about it.

`packages/avs-kit` is the client an agent installs: an MCP server, a CLI and a small SDK with no
runtime dependencies. The server payload (`scripts/build-linux.mjs`, `Dockerfile`) reuses the
macOS build chain — bundle → V8 bytecode → AES-GCM → a launcher that holds the key — and the image
compiles its own bytecode, the one property a cross-compiled build cannot prove about itself.

---

## Decision records

### DR-1 · A remote codegen service — not planned

**Status:** declined; the seam is kept.

**Context.** Scene codegen is driven by a large prompt (`hyperframe/prompt/`) that runs in-process
and talks to whichever LLM endpoint the user configured.

**Option considered.** Move prompt construction behind an HTTP service
(`POST /api/v1/doctrine/scene-spec`, `POST /api/v1/doctrine/script`) so clients send scene data
and receive a spec.

**Decision.** Not built. It would cost the app its offline guarantee for content generation and
put an uptime dependency in front of every render, while the prompts would still be visible to
whoever holds the LLM key.

**Consequence.** `hyperframe/doctrine.js` defines a session interface with one implementation
(`local`). A remote implementation would replace that module and nothing else;
`tests/doctrine-seam.test.js` pins the local implementation to the exact conversation the re-ask
loop expects.
