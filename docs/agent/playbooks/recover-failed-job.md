# Playbook: recover a failed run

**Goal.** Get a stuck or failed video moving again, or decide it needs a person.

1. **Read the state.** `GET /api/projects/:id?scenes=0` — `status` and `error`.
   `GET /api/projects/:id/jobs` — what the ledger says about the attempts.
2. **Read the diagnosis.** `GET /api/projects/:id/diagnostics`: dependency status, masked config,
   the QC report, recent usage, and the last error **with its class**:
   - `transient` / `rate-limit` → resume once: `POST /api/projects/:id/resume`.
   - `config` (bad key, no voice, script audit) → a person must fix it. Report and stop.
   - `resource` (missing ffmpeg or Chrome, disk full) → report and stop; this is the machine.
3. **One resume, not a loop.** The engine already auto-resumed once for retryable errors. If your
   resume also ends in `error`, stop and report — a third attempt spends money to learn nothing.
4. **Stuck at `running` with no events?** Check `GET /api/events?after=<id>&project=<id>` for the last
   line and `GET /api/ops/status` for the queue. A process that died leaves the job requeued at boot.
5. **Held, not broken.** `scenes` and `review` are gates: answer them (see
   [produce one video](produce-one-video.md)), do not resume past them blindly.

## Report like this

Project id · status · error class and message · what you tried · what a person needs to do.
