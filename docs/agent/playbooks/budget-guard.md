# Playbook: stay inside the budget

**Goal.** Unattended production that cannot run up a bill nobody agreed to.

1. **Know the caps.** `GET /api/settings` → `budget`:
   `perVideoUsd`, `perChannelDayUsd`, `perChannelDayVideos`, `hardStop`.
   With `hardStop: false` the engine *downgrades* at a cap (LLM off, free voice) and keeps going;
   with `hardStop: true` it refuses.
2. **Price before you spend.** `POST /api/estimate-cost { videoDuration, config }` for the next
   video; `GET /api/usage` for what has gone already.
3. **Handle `budget_exceeded` as an answer.** 402 on start, or a `config`-class pipeline error. Do
   not retry it, do not lower quality to sneak under it: stop and tell the owner.
4. **Watch the platform too.** `publish_quota_exhausted` means YouTube's daily units are gone
   (1,600 per upload of 10,000), not that publishing is broken. Try tomorrow.
5. **Batches are where it goes wrong.** Before `POST /api/batch`, multiply the estimate by the number
   of topics and compare with the daily cap. A batch that dies halfway has still spent what it spent.
6. **When in doubt, pause.** `POST /api/ops/pause { reason }` stops new work without killing what is
   running, and survives a restart. `POST /api/ops/resume` when the owner has decided.
