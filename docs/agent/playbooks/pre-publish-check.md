# Playbook: pre-publish check

**Goal.** Decide whether a finished video may go out, without a person watching it.

1. `GET /api/projects/:id/verdict` — one call; it already reads the script audit, the typeset scan,
   the artifact scan, the join's integrity report and the cost.
2. Read `publishable`. If `true`, publish at the privacy the user asked for and stop here.
3. If `false`, read `reasons[]` and act on the **codes**:

| Code | Meaning | Action |
|---|---|---|
| `project.not_done` | the run has not finished | wait; do not publish |
| `video.missing` | no file where the row says | re-render (`POST /projects/:id/render`) or report |
| `video.no-audio` / `video.no-video` | the join lost a stream | re-render; report if it repeats |
| `video.duration` | the file is not as long as the voice | re-render the scenes, then the join |
| `scenes.stale_or_wrong_language` | a clip no longer matches its design | `POST /projects/:id/render { mode: 'all' }` |
| `script.audit` (blocker) | the narration breaks the channel's contract | do not publish; report the failing clauses |
| `video.vision_score` | a model looked at the frames and scored below the bar | report with `checks.video.vision.issues` |
| `scenes.typeset_risk` (warning) | text may overflow somewhere | mention it; not a reason to hold |

4. Never pass `force: true` to get past a refusal. It exists for the user.
5. If you re-render, wait for `done` and ask for a **fresh** verdict — an old one describes an old file.

## Optional: a model's eyes

If the channel turned it on, `GET /api/projects/:id/verdict?vision=1` also asks a multimodal model
to look at a contact sheet of frames. It costs a call, so ask for it once per video, not per poll.
