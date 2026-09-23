# Operating AI Video Studio from an agent

This is the contract between the engine and whatever drives it — an agent, a cron line, a script.
It is deliberately small: the engine owns every decision about how a video is made, and an agent
owns which videos get made, when, and whether they are good enough to publish.

Start here, then read the playbook for the job you are doing.

- Machine-readable contract: `GET /api/openapi.json` (or [`openapi.json`](openapi.json) in this folder)
- Tools: `packages/avs-kit` — an MCP server (`avs-mcp`), a CLI (`avs`) and an SDK, all dependency-free
- Playbooks: [produce one video](playbooks/produce-one-video.md) ·
  [plan a week](playbooks/weekly-plan.md) · [pre-publish check](playbooks/pre-publish-check.md) ·
  [recover a failed run](playbooks/recover-failed-job.md) ·
  [several channels](playbooks/multi-channel-ops.md) · [stay inside the budget](playbooks/budget-guard.md)

## The five things to know

**1. Authenticate, and say which channel.** In server mode every call carries
`Authorization: Bearer avs_…` (mint one on the machine: `npm run token -- create --name claude
--scopes read,produce,publish`). Scopes are `read`, `produce`, `publish`, `admin`; `admin` covers
settings, licence and channel writes and is not something a producing agent needs.

An installation can produce for several channels. The "active channel" is what the app's own window
happens to be showing — it is **not** your channel. Name yours on every call that creates something:
`channelId` in the body, `?channel=` in the query, or `X-AVS-Channel`. A token can be bound to
channels, and then it cannot reach another one even by asking.

**2. Never send a create twice by accident.** Pass `clientRef` (your own reference, unique per
channel) on `POST /projects`, and an `Idempotency-Key` header on anything else that spends. A retry
after a timeout then returns the first answer instead of making — and paying for — a second video.

**3. Branch on `code`, never on prose.** Every refusal is `{ code, error, message }`. The words are
the owner's language and may change; the code will not. Add `?lang=en` if you want the words in
English for a log.

**4. Read the feed, do not guess.** `GET /api/events?after=<id>` returns everything that happened
after an event id, from durable rows — an agent that was away for an hour misses nothing. The first
call without a cursor returns the current head, so you subscribe rather than replay history. A
WebSocket at `/ws` carries the same events live if you would rather hold a connection.

**5. Ask for the verdict before publishing.** `GET /api/projects/:id/verdict` reads the script audit,
the typeset scan, the artifact scan, the join's integrity report and the cost meter, and answers
`publishable: true|false` with the reasons. Publishing without reading it is how a broken video ends
up on a channel at three in the morning.

## The life of a video

```
draft ──start──▶ running ──┬─▶ scenes   (gate: config.sceneGate — approve-scenes to continue)
                           ├─▶ review   (gate: config.requireReview — approve the rough cut)
                           ├─▶ paused   (stopped by you, or by a crash the engine recovered from)
                           ├─▶ error    (see project.error and the diagnostics endpoint)
                           └─▶ done     (video_path is on disk; ask for the verdict)
```

Both gates are **opt-in**. A channel that leaves them off runs to `done` with nobody in the loop —
which is the point of unattended operation, and the reason the verdict exists.

`scenes` and `review` are holds, not failures: the run is waiting for a decision. Resume with
`POST /projects/:id/approve-scenes` (the scene gate — this is what allows the voice to be paid for)
or `POST /projects/:id/resume`.

## Error codes worth handling

| Code | What it means | What to do |
|---|---|---|
| `token_required` / `scope_denied` | no token, or not enough scope | fix the configuration; do not retry |
| `channel_denied` / `channel_not_found` | that channel is not yours, or does not exist | list channels; fix the id |
| `not_found` | no such project, scene or slot | stop; it is not coming back |
| `gate_not_at_scenes` | approve-scenes on a run that is not holding | read the status first |
| `budget_exceeded` | a hard cap was reached | stop spending; tell the owner |
| `verdict_failed` | the video did not pass its own checks | read `reasons[]`; fix or leave it unpublished |
| `publish_daily_cap` / `publish_outside_window` | the channel's own policy | try again later |
| `publish_quota_exhausted` | the platform's daily API units are gone | try tomorrow |
| `publish_not_connected` | no OAuth for that platform | a person must connect it once |
| `idempotency_key_reused` | that key was used on a different route | use a fresh key |
| `rate_limited`, `internal`, `unavailable` | temporary | back off and retry |

## Rules an agent should keep

- **Do not force.** `force: true` on publish skips the verdict. It exists for the owner, not for you.
- **Check the budget before a batch.** `GET /api/usage`, and `POST /api/estimate-cost` for what the
  next one would cost.
- **Do not change provider settings.** Keys, models and voices belong to the owner (`admin` scope).
- **Pause rather than fight.** If something is wrong across several videos, `POST /api/ops/pause`
  with a reason and say so — that stops the queue without losing what is running.
- **Say who you are.** Every job and journal line records the token that asked; that is how the owner
  tells your work from theirs.
