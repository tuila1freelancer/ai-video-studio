# Ultra Loop Worklog

Persistent state of the autonomous upgrade loop. Re-read at the start of every iteration;
update immediately when anything is discovered — this file is the loop's only memory.

## State
- Current-Branch: feat/ultra-loop
- PR-URL: (opening after first push)
- Item-Counter: 7
- Sandbox: AVS_DATA_DIR=<scratchpad>/avs-loop, server managed per iteration

## In-Progress
- M2 Visual-HTML quality gates: add text-vs-text overlap + low-contrast detectors to
  renderValidate (src/hyperframe/validate.js), extend the HARD_DEFECT regex in
  src/hyperframe/codegen.js with the new phrases (re-ask, not just lastGood fallback),
  polish src/hyperframe/prompt.js for balanced layout. Then batch qaSpec on ≥10 sample
  specs. Cap: ≤3 re-asks/scene. P11/P12 guards must stay green.

## Backlog
- M1 acceptance run, then M2 → M3 → M4 (see loop prompt)
- M1 Scene Studio (unified per-scene preview/edit panel) — see loop prompt for spec
- M2 Visual HTML quality (text-overlap + contrast detectors, HARD_DEFECT extension, prompt polish)
- M3 Brand fonts (per-channel/per-video selection, font upload kind, subtitleFont consistency)
- M4 Endless premium/perf axis (alternate feature ↔ performance; measure before/after)

## Blocked
(none)

## Done
- M0.1 Upload flows audit — all endpoints exercised with real multipart files on the sandbox
  server: /library/brand|bgm|sfx OK, /upload OK, /channels/:id/brand-logo OK; real-UI paths
  verified in the browser (library grid + studio asset chips both showed the uploaded file).
  BUG FIXED: POST /library/:kind with an unknown kind (e.g. 'font') crashed with a raw 500
  stack trace (join(undefined) — DIRS has no such key); now refuses with a clean 400 and
  unlinks the multer temp files (src/api/routes.js).
- M0.2 Full UI click-through (home/studio/library/brandgen/editvideo/tutorials + settings,
  assistant, brandkit modals): 0 console errors, server log clean.
- M0.3 Free-path pipeline e2e on sandbox: animation mode + edge TTS project ran b2→b7,
  status done, real 1080x1920 7.1s mp4 produced (1 scene — expected: offline splitter got a
  one-sentence topic). No pipeline errors in server log.
- M0.4 Brand-logo upload through the real brandkit modal (#brandLogoFile): file lands and
  the preview renders back through /api/file. M0 milestone COMPLETE.
- M1.1 Scene Studio v1 shipped: unified per-scene panel (🎬 button on scene cards) with
  live iframe preview (same buildSceneHtml page the renderer uses — WYSIWYG by
  construction), dialogue tab (PUT voice_text + regen-voice), visual-brief tab
  (PUT visual_prompt + regen-html), DIRECT HTML tab backed by the new props.__custom
  override lane (applied after buildTemplate in src/animation/index.js — captions/brand/
  progress chrome stays system-managed) with new endpoints GET /scenes/:id/template-source
  and POST /scenes/:id/custom-html (snapshot take → apply/reset → poster refresh), takes
  tab with one-click rollback, ⌘/Ctrl+Enter apply, inline busy/error states everywhere.
  Verified end-to-end on sandbox: template-source 516-char hero-title source; custom html
  applied → anim-html page carries the edit → 2 visual takes recorded → reset restores
  template; UI screenshot shows panel with live preview + 4 tabs + loaded takes.
- M1.2 Fingerprint acceptance + RACE BUG FIX. Proof on a 3-scene sandbox project: edited
  scene 1's dialogue → regen voice → render mode 'scenes' [scene1] → scene 1 got a NEW
  clip (5.9s, new narration), scenes 0/2 clip paths + mtimes byte-identical (untouched).
  BUG FIXED on the way: POST /scenes/:id/regen-voice|regen-html were fire-and-forget, so
  the UI's "done" state lied and an immediate per-scene render raced the in-flight regen
  (render finished first, then regen re-nulled video_path — scene stuck looking stale).
  Routes now await regenOne and return the fresh scene row (src/api/routes.js).
- M1.3 Editor syntax highlight + M1 SIGN-OFF. Dependency-free highlighter: transparent
  textarea over a <pre> underlay, single-pass alternation regex (tags/attrs/strings/
  comments — injected spans can never be re-matched), scroll-synced, 74 spans on the
  sample scene, colors verified by screenshot. Undo/redo = native textarea history,
  documented in the editor tooltip (⌘Z/⇧⌘Z/⌘↵). M1 acceptance complete: fingerprint
  proof (M1.2), preview==render by construction (same buildSceneHtml), takes+rollback,
  inline busy/error states, no blocking operations.

## Metrics
(none yet)

## Noise-Allowlist
(none yet)
