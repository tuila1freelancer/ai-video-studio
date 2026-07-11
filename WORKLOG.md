# Ultra Loop Worklog

Persistent state of the autonomous upgrade loop. Re-read at the start of every iteration;
update immediately when anything is discovered — this file is the loop's only memory.

## State
- Current-Branch: feat/ultra-loop
- PR-URL: (opening after first push)
- Item-Counter: 4
- Sandbox: AVS_DATA_DIR=<scratchpad>/avs-loop, server managed per iteration

## In-Progress
- M1 Scene Studio: analysis of scenes.js / player.js / regen.js / anim-html underway.
  Next step: design the unified panel, implement, verify on the sandbox project
  pmrg7imd7e1a8fef4 (has 1 rendered animation scene).

## Backlog
(see loop prompt M1-M4)
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

## Metrics
(none yet)

## Noise-Allowlist
(none yet)
