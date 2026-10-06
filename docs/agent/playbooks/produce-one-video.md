# Playbook: produce one video

**Goal.** A topic becomes a finished video, published or left for the user to look at.

**Before you start.** A channel id. A token with `read` and `produce` (plus `publish` if you will
upload). `GET /api/health` returns `ok` and `ops.state === 'running'`.

## Sequence

1. **Price it.** `POST /api/estimate-cost { videoDuration, config }`. Compare with `GET /api/usage`
   and the channel's caps. If a hard cap is already reached the next step answers `402
   budget_exceeded` — that is the answer, not a problem to route around.
2. **Create it.** `POST /api/projects { topic, channelId, clientRef }`. Use a `clientRef` you can
   reproduce (`daily-2026-09-23-my-channel`), so a retry cannot make a second video.
   MCP: `avs_video_create { topic, channelId, clientRef, start: true, wait: true }`.
3. **Start it.** `POST /api/projects/:id/start`.
4. **Follow it.** Poll `GET /api/projects/:id?scenes=0` for the status; read
   `GET /api/events?after=<id>&project=<id>&wait=20` for what is happening in between.
5. **Answer the gates, if the channel uses them.**
   - `status: scenes` → look at the scenes, then `POST /api/projects/:id/approve-scenes`. This is
     what lets the voice be paid for; do not approve a storyboard you have not read.
   - `status: review` → the rough cut needs approving before the join; `POST .../resume` after.
6. **Judge it.** `status: done` → `GET /api/projects/:id/verdict`. `publishable: false` means stop
   and report `reasons[]`; a `warning` is worth mentioning, not worth stopping for.
7. **Publish, or leave it.** `POST /api/projects/:id/publish { privacy: 'private' }` unless the
   user's policy says otherwise. The channel policy may clamp the privacy, cap the day or refuse
   outside its hours — each with its own code.
8. **Report.** Project id, status, verdict score, cost (`verdict.cost.estCost`), and the URL if you
   published.

## When it goes wrong

- `status: error` → `GET /api/projects/:id/diagnostics` for deps, config (masked), QC and the last
  error with its classification. A `config` or `resource` class will not fix itself: report it.
- `status: paused` after a crash → `POST /api/projects/:id/resume` once. If it pauses again, stop.
- No progress for a long time → check `GET /api/ops/status`: the queue may be paused or draining.

## Done when

The project is `done`, the verdict has no blockers, and either the video is published or the user
has been told where it is (`video_path`, downloadable through `GET /api/file?path=…`).
