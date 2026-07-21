# Audit Prompt & Upgrade Plan — Processing Journal · Video Assistant · Script Quality · Visual Quality

**Status:** work order (not yet executed) · **Date:** 2026-07-21
**Scope:** (A) rebuild "Nhật ký xử lý" into a per-run, persistent, Vietnamese, audit-grade journal; (B) audit + upgrade "Trợ lý tạo video", with script CONTENT quality as the absolute first priority (deep, coherent, CTA-disciplined — no mid-video farewells), and only then the visual layer (dense, dialogue-matched premium layouts).
**How to use:** Part 1 is a copy-paste-ready audit prompt for a fresh session. Part 2 is the evidence base already verified on 2026-07-21 (an executor may spot-check instead of re-discovering). Parts 3–5 are the implementation plan, in execution order.

House rules that bind every phase (from `docs/architecture.md` §7 and standing owner orders):
- Protected registry P1–P31 must not regress; new work registers as P32+ with tests.
- NO-FALLBACK contract: primary model, bounded retries, loud failure — never a silent model/template substitution.
- Reference app (`/Applications/AI VIDEO Tool.app`) and its data are READ-ONLY.
- Code/comments/docs/commits in English; user-facing UI strings in Vietnamese.
- Owner style: code first, test once at the end of a phase; avoid mid-stream partial testing.
- Never push without explicit owner approval.

---

## Part 1 — The audit prompt (copy-paste ready)

```text
ROLE
You are a principal engineer auditing "AI Video Studio", a local macOS app that auto-generates
YouTube videos, at /Volumes/ExtremeSSD/Working/toannvs/ai-video-generation (Node22 ESM backend in
src/, vanilla-JS frontend in public/, SQLite at data/studio.sqlite). The reference quality bar is
/Applications/AI VIDEO Tool.app (READ-ONLY — never modify it or its data). You are READ-ONLY for
this audit: do not edit, create, or delete any repo file. Every claim needs evidence: a file:line
reference, a command output, or a DB row. Deliver findings in English; if you also report in chat,
report in Vietnamese.

METHOD
1) Static pass: map each scope below with exact file:line references.
2) Dynamic pass: run the listed measurements against real data (data/studio.sqlite, project dirs,
   and — read-only — the reference app's ~/Library/Application Support/VideoPipeline sessions).
   SAFETY: NEVER start or restart the app server against the real data dir — server boot runs the
   scheduler tick, which resumes stranded jobs and promotes due calendar slots (real LLM/TTS spend,
   new projects). Any check that needs a live server runs in a sandbox: copy data/studio.sqlite into
   a scratch dir and launch with AVS_DATA_DIR=<scratch>. SQL reads against the real DB are fine.
   Before concluding anything about pending work, check:
   sqlite3 data/studio.sqlite "SELECT COUNT(*) FROM jobs WHERE status IN ('queued','running');"
3) Deliverable: one gap matrix per scope. Each row: id, severity (P0 broken promise / P1 hurts
   every video / P2 hurts some flows / P3 polish), evidence, one-line proposed fix. End with a
   10-line executive summary ranked by user impact.

SCOPE 1 — PROCESSING JOURNAL ("Nhật ký xử lý")
Questions:
- Where does every user-visible pipeline event originate (op/step/retry/log emitters), and which of
  them reach the journal panel vs the one-line ticker vs nowhere? Start at src/pipeline/progress.js,
  src/util/log.js, src/ws/hub.js, public/js/views/progress.js, public/js/views/studio.js.
- Is anything persisted? Prove what a page reload loses, what a server restart loses, and what an
  old/done project can still show. Check for any events/log table in src/db/connection.js.
- Can two runs of the same project be told apart in the UI? Does any event carry a job/run id?
- What language are the journal lines actually in?
Measurements:
- In the SANDBOX data dir (see SAFETY above): kill and restart the server mid-idle; reopen a
  finished project; describe what the journal panel shows (expected today: empty).
- grep -n "hub.toProject\|hub.broadcast" -r src | count WS event types with no frontend consumer.

SCOPE 2 — VIDEO ASSISTANT ("Trợ lý tạo video" / autopilot)
Questions:
- Map the full flow: suggest → review sheet → accept/schedule → project creation → pipeline start.
  Start at public/js/features/autopilot.js, assistant-sheet.js, assistant-history.js,
  src/api/services/topic-autopilot.js, assistant.js, batch.js, src/pipeline/scheduler.js.
- Which quality-relevant config knobs does the sheet expose vs silently inherit? Compare against
  gatherConfig() in public/js/views/config.js.
- Is there any script preview/approval moment before money is spent on TTS/render?
- Trace config.assistantBrief into the script prompt (src/providers/llm.js) — is the chosen angle
  actually honored? Is the clickbait title vs the researched topic conflated?
- Hunt state bugs: the durationMode override block in assistant-sheet.js (~line 135), suggestion
  restoration when a scheduled slot fails to promote (src/pipeline/scheduler.js promoteDueSlots),
  the discarded projectId after accept.
- Also trace the series flow (POST /topics/series) and plan-week (POST /calendar/plan): what config
  do bulk-scheduled episodes actually get — can the user override anything per episode?
Measurements:
- Accept one suggestion with every override left "(giữ nguyên)" and diff the created project's
  config row against the channel default (expect: durationMode clobbered to 'target').

SCOPE 3 — SCRIPT QUALITY & CTA DISCIPLINE (the owner's #1 priority)
Questions:
- Map B2: src/pipeline/stages/script.js → src/content/master-script.js (modes, batching >30 scenes,
  the master prompt, validator/repair), b2.5 src/pipeline/stages/editorial.js + src/content/scorer.js,
  b2.75 src/pipeline/stages/budget.js.
- For batched (>30-scene) videos: what stops batch N (non-final) from writing its own closing CTA
  or a farewell? What pins the throughline/spine across batches? (Expected today: nothing.)
- Does ANY validator/scorer detect a farewell before the final scene, or CTA density/clustering?
- Do 'json'-import and 'script'-polish modes get the same CTA discipline?
Measurements (the core evidence — run all):
- Our data: sqlite3 data/studio.sqlite "SELECT p.id, COUNT(s.id) FROM projects p JOIN scenes s ON
  s.project_id=p.id GROUP BY p.id ORDER BY 2 DESC LIMIT 5;" then for the largest:
  sqlite3 data/studio.sqlite "SELECT idx, substr(voice_text,1,90) FROM scenes WHERE project_id='<ID>'
  ORDER BY idx;" and mark every scene matching the CTA/farewell lexicon:
  (đăng ký|subscribe|nhấn chuông|bấm chuông|like|chia sẻ|bình luận|comment|hẹn gặp lại|tạm biệt|
   cảm ơn.*(xem|theo dõi|đồng hành)). Report: CTA scene positions, clusters at 25-scene boundaries,
  any farewell before the last scene.
- Reference data (read-only): same lexicon over 2–3 of
  ~/Library/Application Support/VideoPipeline/sessions/*/script.json.
- Verdict: is our per-batch CTA duplication better/worse than the reference, and exactly which
  prompt lines cause it (quote them)?

SCOPE 4 — VISUAL QUALITY LEVERS (audit only; upgrades come AFTER script quality lands)
Questions:
- Map the codegen chain: src/hyperframe/prompt.js (density note, caption reserve, beat timeline),
  codegen.js (attempt ladder, normalize, lint, renderValidate, quality tiers), signatures.js,
  src/pipeline/direction.js (art-director pass) and src/hyperframe/validate.js gates.
- Which "premium" doctrines are prompt-only (unenforced) vs gated by renderValidate? Specifically:
  hero 8–20 parts vs the heroParts floor, contrast 4.5:1 promise vs the actual gate, on-screen
  text matching the narration (positive check or only negative language-leak gates?).
- Is density adaptable per scene (by role/energy), or one project-wide prose note?
- Does the single-scene regen path (src/pipeline/regen.js) keep parity with batch codegen
  (captionsOn/consistent/overlay/imageFull/diversitySalt, qtier persistence, no-fallback)?
- Does B8 QC (src/pipeline/qc.js) catch WHITE/blank frames or only black?
Measurements:
- Pick 3 rendered projects, read qc_report.json + scene props.qtier: how many premium vs
  repaired/imperfect/unverified? Do 'unverified' scenes correlate with regen usage?

Deliver the four gap matrices + executive summary. Do not fix anything during the audit.
```

---

## Part 2 — Evidence base (verified 2026-07-21, four parallel deep-dives)

An executor can trust these anchors and spot-check rather than re-derive. Line numbers drift as the
repo moves — treat them as strong hints, re-grep before editing.

### 2.1 Journal today — rich narration is ephemeral, journal panel is English, nothing persists

- The panel `📋 Nhật ký xử lý` ([index.html:180-183](../public/index.html), renderer
  [progress.js:56-60](../public/js/views/progress.js)) is fed ONLY by WS `log` events
  ([studio.js:331](../public/js/views/studio.js)) — i.e. `logger.*` calls that happen to carry
  `{projectId}` ([log.js:7-14](../src/util/log.js)), which are **mostly English**. Max-height 170px,
  300-line DOM cap, no filter/search/export, content bleeds across project switches.
- The rich Vietnamese narration — every `op()` line ('🎬 Cảnh 12/40 · 42%', '🩹 tự thử lại…') —
  overwrites a single ticker `#curOp` and is never journaled ([progress.js:8,54](../src/pipeline/progress.js));
  on WS replay all but the last `op` are deliberately dropped ([studio.js:315-316](../public/js/views/studio.js)).
- **Zero persistence**: no events table in the schema ([connection.js:17-231](../src/db/connection.js));
  the only replay is the in-memory hub buffer — 200 events × 12 projects, FIFO
  ([hub.js:9-10,59-70](../src/ws/hub.js)). Server restart ⇒ journal gone; a done project shows a blank panel.
- **Runs exist in the DB but not in the journal**: durable `jobs` ledger with timestamps/attempts
  ([connection.js:167-180](../src/db/connection.js), scheduler sole writer; jobs.id is a TEXT
  `'job_…'` string). The scheduler's `job` WS broadcast does carry `job.id` but has no FE consumer
  and is not in the per-project replay buffer; the per-project `op`/`step`/`log`/`retry` events carry
  no job id — so journal-relevant events can't be attributed to a run and no stage durations exist.
- Provider-layer events (TTS failover, whisper fallback, imagegen retries — the "why did quality drop"
  answers) log WITHOUT projectId → console-only, invisible: [retry.js:23](../src/util/retry.js),
  providers/subtitle.js, providers/tts.js:116, providers/imagegen.js:198, animation/renderer.js.
- Free building blocks already emitted with **no FE consumer**: `usage` (live cost), `job`,
  `batch-done`, `published`, `review` WS events.

### 2.2 Assistant today — solid machinery, no script gate, several real bugs

- Entry `🛰 Trợ lý` ([index.html:82](../public/index.html)), modal `#autopilotModal` (:648-714), three
  tabs (Gợi ý / Lịch sử / Lịch sản xuất). Not a chat: one niche field → 8 scored suggestions
  (prompt verbatim at [topic-autopilot.js:32-43](../src/api/services/topic-autopilot.js)) → review
  sheet ([assistant-sheet.js:55-155](../public/js/features/assistant-sheet.js)) → accept starts a
  durable pipeline job via `startBatch` ([assistant.js:17-24](../src/api/services/assistant.js),
  [batch.js:15-49](../src/api/services/batch.js)). Config layering:
  `NEW_PROJECT_DEFAULTS → channel.config → default preset → request` ([core/config.js:47-49](../src/core/config.js)).
- The brief's angle IS honored: `MANDATORY angle for this video:` injected at [llm.js:329](../src/providers/llm.js).
- **Confirmed bug**: [assistant-sheet.js:135](../public/js/features/assistant-sheet.js) — missing
  braces make `config.durationMode = 'target'` unconditional, clobbering inherited `durationMode:'auto'`
  on every accept/schedule/edit.
- **Confirmed bug**: promote-failure path cancels the slot WITHOUT restoring the suggestion
  ([scheduler.js:105](../src/pipeline/scheduler.js)) — manual delete does restore ([routes.js:402-406](../src/api/routes.js)).
- No script preview/approval: the sheet never exposes `sceneGate`/`requireReview` (both exist in the
  manual panel, [config.js:86-87](../public/js/views/config.js); gate implemented at
  [runner.js:48-60](../src/pipeline/runner.js)); the one review moment happens before any script exists.
- `projectId` returned by accept is discarded (no navigation, [assistant-sheet.js:293-294](../public/js/features/assistant-sheet.js));
  no cost estimate at commit; voice list and suggestion prompt hard-code Vietnamese
  ([assistant-sheet.js:33](../public/js/features/assistant-sheet.js), [topic-autopilot.js:37](../src/api/services/topic-autopilot.js));
  choosing an LLM clickbait title REPLACES the researched topic fed to B2 ([assistant.js:19-21](../src/api/services/assistant.js));
  series bulk-schedule and plan-week apply one config with no per-episode overrides.

### 2.3 Script/CTA today — the core defect, measured on real data

- Master engine ([master-script.js](../src/content/master-script.js)): plan-then-write head with
  throughline/spine/VALUE ARCHITECTURE (stronger than the reference app, which has none of it), CTA
  rule "ONE soft CTA at 25-40% + closing CTA". **But** >30-scene videos generate in batches of 25
  (`BATCH_TRIGGER=30`, `BATCH_SIZE=25`), and EVERY batch reuses the FULL head — including the
  closing-CTA instruction — with only a batch note appended ([:460-466](../src/content/master-script.js))
  that bans re-OPENING but never bans CLOSING. The throughline/spine are re-planned per batch
  (batch 2+ invents its own arc; cross-batch context = last-3-voices tail, 90 chars each).
- **Measured result (our app, project pmru7hr6t0214f064, 200 scenes, topic mode)**: subscribe-CTA at
  the tail of every batch — scenes 25, 50, 75, 100, 125, 150, 174-175, 198-200 — PLUS a per-batch
  "soft CTA" at 7, 35, 56, 82, 107, 137, 158, 185 (~16 CTA scenes), PLUS a full farewell
  "Hẹn gặp lại các bạn trong các video tiếp theo" at scene **175/200**. Short videos (≤30 scenes,
  single call) are clean. The legacy two-stage path (persistent outline + ONE ctaMid slot + ONE
  closing slot, [llm.js:449-500](../src/providers/llm.js)) produced correct discipline
  (project pmrndxxgm6838d718: exactly one mid CTA at 64/131 + closing at 131) — the master engine
  dropped outline-first pinning for long videos.
- Reference app has it WORSE (8 full goodbye blocks in a 200-scene session; its prompt has zero CTA
  discipline — bundle anchors in Part 2 of the audit) — but the owner's bar is better than both.
- **No detector anywhere**: `scorer.js` (9 defect types) has zero CTA/farewell checks; `META_LEAK`
  catches note-format leaks only, not spoken "Hẹn gặp lại"; 'json' imports pass through verbatim.
- 'script' polish mode compounds it: every batch slice is told to ADD a soft + closing CTA
  ([:310-314](../src/content/master-script.js)) with no cross-batch CTA ledger.

### 2.4 Visual levers today — premium doctrines exist; the gaps are per-scene adaptation + positive checks

- Prompt doctrines are strong (five masters, BEAT PROTOCOL from real word timings, hero 8–20 parts,
  TYPE doctrine, INSTANT-FAIL list — [prompt.js:14-76](../src/hyperframe/prompt.js)) and renderValidate
  ([validate.js:208-408](../src/hyperframe/validate.js)) gates emptiness, sparseness, caption-band
  intrusion, language leaks, contrast (floor 2.2:1 vs the 4.5:1 promise), heroParts ≥6 (vs 8–20
  doctrine), beat adherence (any movement counts — not the beat's actual words).
- `density` is ONE project-wide prose note ([prompt.js:78-82,144](../src/hyperframe/prompt.js)) — no
  per-scene adaptation by role/energy; beat count hard-capped at 5 regardless of scene length
  ([beats.js:104](../src/hyperframe/beats.js)).
- Art director never sees the beats (only a 360-char narration slice, [direction.js:54](../src/pipeline/direction.js)).
- One static exemplar `SAMPLE_SPEC` for every scene/signature/layout ([guide.js:136-210](../src/styleguide/guide.js));
  `guide.fontSizes/effects/ambient` prompt blocks are wired but populated by no preset.
- **Regen parity holes** ([regen.js:68-77](../src/pipeline/regen.js)): single-scene regen drops
  captionsOn/consistent/overlay/imageFull/diversitySalt, silently falls back to heuristic templates
  (contradicts the no-fallback contract), and persists no `qtier` (reads back as 'premium' — false green).
- B8 QC detects BLACK frames only ([qc.js:80](../src/pipeline/qc.js)) — a refapp-class white-blank
  scene passes final QC whenever renderValidate was skipped.

---

## Part 3 — Plan A: "Nhật ký xử lý" — per-run, persistent, Vietnamese, audit-grade (register as P32)

Goal: for EVERY task — running or long finished — the user opens the project and reads a complete,
grouped, Vietnamese story of what happened: which run, which stage, which scene, what went wrong,
what self-healed, how long each stage took. Nothing user-relevant is ephemeral anymore.

### A1 — Structured journal core (backend)

**New table** (in `src/db/connection.js` + `src/db/migrate.js`):

```sql
CREATE TABLE IF NOT EXISTS journal_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT,                    -- NULL only for system-lane rows (e.g. a slot that failed
                                      -- to promote BEFORE a project existed)
  job_id     TEXT,                    -- jobs.id ('job_…' TEXT string); NULL for out-of-run events
  ts         INTEGER NOT NULL,        -- Date.now()
  level      TEXT NOT NULL DEFAULT 'info',  -- info | warn | error | success
  stage      TEXT,                    -- b2 | b2_5 | b2_75 | b34 | b5 | b6 | b7 | b8 | sys
  scene_idx  INTEGER,                 -- NULL when not scene-scoped
  kind       TEXT NOT NULL,           -- op | step | retry | log | status | done | error | usage
                                      --   | publish | enqueue | sys
  msg        TEXT NOT NULL,           -- Vietnamese, user-facing
  data       TEXT,                    -- JSON: {detail, attempt, durMs, model, cost, ...}
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_journal_proj_ts ON journal_events(project_id, ts);
CREATE INDEX IF NOT EXISTS idx_journal_job     ON journal_events(job_id);
```

Notes: `job_id` is TEXT because jobs.id is a TEXT `newId('job')` string — not an integer. The
`ON DELETE CASCADE` FK covers BOTH delete paths for free (`deleteProject` and `deleteAllProjects`;
`foreign_keys=ON` is already set and scenes use the same pattern). System-lane rows (`project_id
NULL`, kind `sys`) exist so scheduler/slot failures that happen before a project is created are
still auditable; they surface in the global tasks view (A3).

**New module `src/pipeline/journal.js`** — the single funnel:
- `jlog(projectId, { level, stage, sceneIdx, kind, msg, data })`: INSERT + `hub.toProject(projectId,
  { type:'journal', ...row })`. Synchronous better-sqlite3 insert is fine (same thread as the rest).
- Run scoping via the EXISTING AsyncLocalStorage run context (`src/util/run-context.js` — already
  wrapped around every entry point: `scheduler.execute`, the queue's non-durable fallback, regen).
  Add `jobId` to the context at `scheduler.execute` (one line); `jlog` reads it from ALS. Regen and
  interactive actions naturally carry `jobId = NULL` (correct: they are out-of-run), there is no
  clear-on-settle bookkeeping, and a regen racing a running job can never be mis-stamped with that
  job's id. Do NOT build a module-level projectId→jobId map — it would mis-attribute exactly those
  concurrent cases.
- Journal an `enqueue` event when a job is queued (batch/slot/assistant accept) — a task waiting in
  the queue must read as "⏳ đang chờ trong hàng đợi", not as an empty journal.
- Retention is RUN-AWARE, not a flat row cap: keep the most recent 10 runs of a project complete;
  when an 11th run starts, prune the oldest run's rows wholesale (plus a 20 000-rows/project hard
  safety cap). A flat "delete oldest 500" would silently eat the oldest run's story mid-history —
  the exact thing this phase exists to preserve. Row deletion on project delete is the FK cascade.

**Rewire the existing emitters — no call-site churn.** `src/pipeline/progress.js` is already the
funnel for `op`/`step`/`retry`; `src/util/log.js` for `log`. Change the funnels, not the ~90 call sites:
- `op(id, text)` → ticker WS (unchanged) **+ `jlog(kind:'op')`** — this alone journalizes the entire
  Vietnamese narration that today evaporates. COALESCE the high-frequency percent-progress family
  (`render.js:38` emits ~5 ops per scene at 25% steps): the ticker still gets every tick, the journal
  records only scene start/done/heal lines — otherwise a 200-scene run floods thousands of rows.
- `step(id, step, state, detail)` → badge WS (unchanged) **+ `jlog(kind:'step', data:{state, detail})`**.
  On `state:'done'`, compute `durMs` from the matching 'running' event (keep an in-memory
  `stageStart` map; fall back to DB lookup) → journal shows "📝 Kịch bản — hoàn tất sau 42s".
- `retryHook` → **+ `jlog(kind:'retry', level:'warn', data:{attempt})`**. Two `retry` emissions
  BYPASS this funnel and must be added explicitly: `runner.js:110` (pipeline auto-resume) and
  `stages/render.js:61` (scene render self-heal) call `hub.toProject({type:'retry'})` directly.
- `logger.*` with `{projectId}` → **+ `jlog(kind:'log', level)`** (in `log.js`, beside the existing WS fanout).
- `runner.js` done/error/status transitions → `jlog(kind:'done'|'error'|'status', level:'success'|'error')`,
  with the error `hint` in `data`. **Also `render-only.js`** — render jobs settle through its own
  done/error/status emissions (`render-only.js:93-101`), not runner.js; journal those too.
- `core/metering.js` usage event → `jlog(kind:'usage', data:{estCost, tokens})` (throttle: only on
  meaningful delta, e.g. cost step ≥ $0.01, to keep the journal readable).
- `stages/publish.js` published event → `jlog(kind:'publish', level:'success')`.

**Give invisible provider events a voice.** `withRetry` ([retry.js](../src/util/retry.js)) gains an
optional `meta: {projectId, stage, sceneIdx}` param; the pipeline call sites that already know the
project pass it, so provider retries surface as warn lines. TTS voice-fallback, whisper fallback and
imagegen retries reached through pipeline stages get `{projectId}` threaded (audit list in §2.1;
provider modules keep a no-projectId console path for non-pipeline callers).

**Vietnamese-first message policy.** The journal `msg` is ALWAYS Vietnamese. This is BIGGER than a
handful of lines: ~36 `logger.info/warn/error` calls carry `{projectId}` today, plus whole English
`onLog` streams routed through them — the master-script engine ("master-script: got 25/25 scenes,
2 defect(s)…", producer `master-script.js`, routed at `script.js:43`), editorial (`editorial.js:30,85,87`),
estimate/repurpose, render self-heal warns, finalize QC warns. Work item: `grep -n "logger\.\(info\|warn\|error\)"
-r src` filtered to projectId-carrying sites, enumerate ALL of them in the implementation commit, and
translate every user-facing one at source (examples: `script.js:68` → "Kịch bản: N cảnh (engine
master, chế độ …)", runner gate lines → "⏸ Chờ bạn duyệt kịch bản…", `visuals.js:81` → "Chỉ đạo hình
ảnh: 8/10 cảnh"). Console prints the same Vietnamese strings (the app is Vietnamese-first; English
stays in code/comments only). `logger.debug` (ffmpeg chatter) stays out of the journal. The A4 test
asserts per-family (grep-pin the known English patterns are gone), not a blanket no-ASCII rule.

### A2 — API

- `GET /api/projects/:id/journal?job=<jobs.id string|all>&level=<info|warn|error>&q=<text>&before=<ts>&limit=200`
  → `{ events, runs }` where `runs` = jobs-ledger rows for the project (id, kind, status,
  started/finished_at, durMs, attempts) so the UI can render the run picker from one call.
- `GET /api/tasks` → cross-project task feed for the global view (A3): jobs ledger (running/queued/
  recent, with project titles) + system-lane journal rows.
- WS: new `journal` event type (A1). The journal PANEL stops depending on replay — its history comes
  from REST. But KEEP the existing last-`op` replay consumption (`studio.js:315-316`): it is what
  restores the `#curOp` ticker after a mid-run reload; removing it would blank the ticker until the
  next live op. The hub replay buffer stays as-is for scene/status/ticker state.

### A3 — UI (Studio project view; replaces the 170px panel)

Layout (all labels Vietnamese):
- **Header row**: run picker `Lần chạy #3 · 14:02 21/07 · ✅ hoàn tất · 12p40s` (from `runs`; default =
  latest; `Tất cả` option) · level filter chips `Tất cả / ⚠ Cảnh báo / ⛔ Lỗi` · search box `Tìm trong
  nhật ký…` · `📋 Sao chép` + `⬇ Tải .txt` · expand toggle `⛶` (fullscreen modal, monospace).
- **Body**: grouped by stage, each group a collapsible section with icon, Vietnamese stage name and
  duration — `📝 Kịch bản (42s) ✓`, `🎙 Giọng đọc + phụ đề (3p10s) ✓`, `🎨 Dựng cảnh (6p02s)` … Inside:
  time-stamped lines `[14:02:11] 🎨 AI dựng cảnh 12/40`; scene-scoped lines get a clickable chip
  `Cảnh 12` that scrolls to/flashes the scene card; retries amber with attempt count; errors red with
  the hint line; `success` green. Default height ~320px, auto-scroll pinned to bottom, pause-on-hover
  (badge `⏸ đang giữ — bấm để theo dõi tiếp` when new lines arrive while held).
- **Past projects**: opening any project loads the journal via REST — a video finished last week shows
  its full story (this is the headline feature; today it shows nothing).
- Live run: `journal` WS events append into the active group; project switch clears the panel
  (fixes the current cross-project bleed).
- Keep `#curOp` ticker and the 5 step badges exactly as they are — they are the at-a-glance layer;
  the journal is the audit layer.
- **Global tasks view `🗂 Tác vụ`** (small, backed by `GET /api/tasks` — the jobs ledger the UI has
  never shown): every running/queued/recent task across ALL projects — batch (Hàng loạt) items,
  calendar-slot promotions, series episodes, assistant accepts — each row: project title, kind,
  status badge (`⏳ đang chờ · ▶ đang chạy · ✅ xong · ⛔ lỗi · 🚫 huỷ`), start/duration, attempts;
  click → opens that project's journal at that run. System-lane rows (slot failed to promote before
  a project existed) appear here too. Without this, the owner must already know WHICH project to
  open — "theo dõi từng tác vụ đã chạy và đang chạy" requires the cross-project list.

### A4 — Tests + docs (definition of done)

- `tests/journal.test.js`: insert/read roundtrip; run-aware retention (11th run prunes run 1
  wholesale, runs 2–11 stay complete; hard cap enforced); job_id attribution via the ALS run context
  (regen concurrent with a job stamps NULL, not the job's id); percent-op coalescing (ticker gets 5,
  journal gets start/done); system-lane rows with NULL project_id; FK cascade on project delete AND
  delete-all; enqueue event on job queue; step-duration computation; REST filters (job/level/q/before);
  Vietnamese-message assertion per translated family (grep-pin: `script.js` no longer emits
  `Script: N scenes`, etc.).
- Restart persistence: write events, reopen DB (new connection), events still served.
- Browser verification: run a small pipeline in the sandbox (AVS_DATA_DIR under scratchpad), reload
  mid-run (journal intact), restart server after done (journal intact), switch projects (no bleed).
- `docs/architecture.md` §7: register **P32 — persistent per-run Vietnamese journal** (+ §5b/§6 rows);
  README bullet.

Estimated size: ~2 focused days. No pipeline-behavior risk: emitters only gain a persistence branch.

---

## Part 4 — Plan B: Assistant + script depth + CTA discipline + visuals

Execution order inside Plan B is a hard constraint from the owner: **B1 (script content) first and
100% done, then B2 (assistant UX), then B3 (visuals)**.

### B1 — Script quality core: deep, coherent, CTA-disciplined (register as P33)

The measured defect (Part 2.3): per-batch CTA duplication + no pinned arc + no detector. Five changes,
all in B2's lane (`src/content/master-script.js`, `src/content/scorer.js`, `src/pipeline/stages/editorial.js`):

**B1.1 — Pinned outline for batched videos (restore what legacy did right, inside the master engine).**
When `targetCount > BATCH_TRIGGER`:
1. ONE planning call before any batch: produce `{ throughline, spine, chapters:[{ from, to, goal,
   keyPoints[2-4], bridgeOut }] }` (chapters ≈ batch-aligned but content-driven; `bridgeOut` = the
   one-line idea that hands over to the next chapter). Validate: full 1..N coverage, monotone ranges;
   1 defect re-ask, then deterministic even-split repair. Reuse `chatJson` with the B2 model, no new
   model knob (no-fallback rules apply).
2. Every batch prompt then carries: the PINNED throughline + spine (verbatim, immutable), its
   chapter's goal/keyPoints/bridgeOut, and the rolling last-3-voices tail (kept). Batch 2+ no longer
   invents its own arc; seams get `bridgeOut` continuity instead of re-introductions. Chapter
   context is resolved per LIVE span inside `generateSpan` (truncation splits a batch into sub-spans
   that rebuild their notes — the mapping is span→chapters-overlapping-it, not a precomputed
   batch→chapter table).
3. ≤30-scene videos: unchanged single call (already clean — keep byte-stable behavior; the planning
   call must NOT run for them).

**B1.2 — CTA budget: designated scenes, prohibition everywhere else.**
Compute once per video: `softCtaStt = round(N * 0.3)` (clamped inside 25–40%), closing = the final
scene. Two implementation constraints discovered in review — both mandatory:
- **The closing-CTA instruction lives in THREE head sources, not one**: the spine clause "the final
  scene resolves that same gap, then one natural line to subscribe" (master-script.js:332), the CTA
  placement clause (:333), AND the structure-guide tail "… recap + CTA" / "payoff + CTA" injected as
  "Content arc:" (:47-51 via :326). For batched prompts, ALL THREE must become conditional — a
  middle batch whose appended note says "no CTA" while the head still says "final scene … subscribe"
  reproduces the exact failure mode B1 exists to kill. Single-call (≤30) prompts keep all three as-is.
- **The CTA plan must be computed per LIVE span inside `generateSpan`, not precomputed per batch**:
  a truncated batch SPLITS into two sub-spans that rebuild their notes (master-script.js:476-504),
  a span is accepted at ≥70% of requested scenes, and final assembly renumbers everything
  (`stt: i + 1`). Absolute designations drift. Phrase the note relative to the span — "this span
  contains the video's ONE soft-CTA scene (put it ~scene ${k} of this span)" — derived from the
  span's own [from..to] at call time.
Each span then gets exactly one of:
- Batch containing `softCtaStt`:
  `CTA PLAN: scene ${softCtaStt} carries this video's ONE soft CTA — a single natural spoken sentence
  (save/share/follow) tied to the content. No other scene in this batch may contain any CTA.`
- Final batch:
  `CTA PLAN: the video ends in this batch. The final scene resolves the opening gap, then ONE natural
  closing line (subscribe). No other CTA in this batch.`
- Every other batch:
  `CTA PLAN: this batch carries NO call-to-action of any kind — no subscribe/like/share/bell, no
  thanks-for-watching, no goodbye, no "hẹn gặp lại". The video CONTINUES after scene ${to}: do NOT
  conclude or wrap up; end the batch mid-flow on ${bridgeOut}.`
Single-call (≤30) videos keep the current one-head phrasing (already correct).
'script' polish mode: the ADD-a-CTA permission moves OUT of the shared head into the two designated
batches only; all other batches get the prohibition note. POLISH_FLOOR's "2 new scenes allowed"
becomes a per-VIDEO ledger (pass `ctaAlreadyAdded` count into subsequent batch calls).

**B1.3 — CTA/farewell detector + repair (the enforcement half — prompts alone are not a guarantee).**
New `src/content/cta-audit.js`:
- `classifyCta(voice)` → `{ cta: bool, farewell: bool, phrases[] }` using a VI+EN lexicon
  (đăng ký kênh, subscribe, nhấn/bấm chuông, like, chia sẻ, bình luận, comment, hẹn gặp lại,
  tạm biệt, "cảm ơn … (đã) (xem|theo dõi|đồng hành)", "video (sau|tiếp theo) nhé", see you next…),
  diacritic-folded, word-boundary-safe.
- `auditCtas(scenes)` → defects: `FAREWELL_MID` (farewell at idx < last), `CTA_EXCESS` (>2 CTA
  scenes), `CTA_CLUSTER` (≥2 CTA scenes within any 5-scene window that isn't the ending).
Wire into `scoreScript` (`src/content/scorer.js`) as first-class defect types so the EXISTING
editorial machinery repairs them — with two adaptations found in review:
- **Editorial's rewrite is hard-capped at 20 flagged scenes per round** (`editorial.js` `.slice(0, 20)`).
  On the measured 200-scene case, CTA flags (~16) + coherence flags (≤20) + density flags overflow it
  and overflow scenes silently never get rewritten. Fix: rewrite in CHUNKS of 20 with priority order
  farewell > CTA > coherence > value-density, until the flag list is drained (bounded: ≤3 chunks).
- **Editorial's rewrite prompt is a type-keyed instruction table** (`editorial.js:57-64`) — every new
  defect type (FAREWELL_MID, CTA_EXCESS, CTA_CLUSTER, idea-repeat, hook-weak, thin+) gets an explicit
  entry, e.g. FAREWELL_MID → "rewrite keeping the scene's informational content; REMOVE the
  farewell/CTA — the video continues after this scene". Neighbor-context preserved, temp 0.5.
Deterministic floor if the rewrite still trips the lexicon: strip the offending sentence(s) when the
scene keeps ≥1 informational sentence; a farewell-ONLY mid-video scene (no informational content) is
DROPPED — same precedent as P18's META_LEAK drop — with a loud journal warn.
Coverage: ALL input modes. Topic/source/script run detector + editorial rewrite. 'json' import is
zero-LLM by design, so at sanitize time only the deterministic lane runs: strip offending sentences,
drop farewell-only mid-video scenes — the factory's own 200-scene files with 8 goodbye blocks come
out clean via strip/drop alone (test pins this).

**B1.4 — Whole-video coherence read-through (batched videos only).**
After assembly + B1.3, ONE LLM pass over a compact digest (idx + first ~15 words per scene, +
throughline/spine): flags (a) batch-seam discontinuities, (b) idea-level repeats (same claim twice),
(c) unresolved arc (payoff missing / gap never closed). Returns `{ flaggedIdx: [...], reason }`
(bounded: ≤10% of scenes, else keep the worst 10%). Flagged scenes feed the same editorial rewrite.
Skip for ≤30-scene videos (single-call output is already one continuous talk).

**B1.5 — Value-density scorer additions (deterministic, cheap, feed the same rewrite lane).**
In `scorer.js`: `thin+` (scene with no concrete anchor: no number, no proper noun, no named example
AND <60% of the words budget) · `idea-repeat` (content-keyword-set Jaccard ≥0.6 between non-adjacent
scenes — catches paraphrased repeats the 5-gram check misses) · `hook-weak` (scene 1 contains a
greeting/self-intro pattern or zero concrete anchors). All flow into editorial's existing rewrite.

**B1 tests + measurement (definition of done):**
- `tests/cta-discipline.test.js`: lexicon unit tests (VI diacritics, EN); auditCtas on a synthetic
  200-scene fixture seeded with batch-tail CTAs + a scene-175 farewell → exact defect set; repair
  strips a farewell sentence deterministically and DROPS a farewell-only mid-video scene; 'json'
  import path runs the deterministic lane (factory 200-scene fixture comes out clean); batch-note text
  pinned (prohibition string present for middle batches, absent for ≤30-scene runs); pinned-outline
  threading (batch 2 prompt contains the batch-1 spine verbatim); prompt-source pin: the shared head
  no longer contains the closing-CTA instruction when batching.
- New `scripts/cta-audit.mjs <projectId|scenes.json>`: prints the CTA map (idx, phrase, position%) —
  run before/after on pmru7hr6t0214f064-class regenerations to prove: ≤2 CTA scenes, farewell only
  in the final scene, no cluster at 25-scene boundaries.
- One real 1200s/200-scene generation on the proxy strong model (`ag/gemini-pro-agent`, sandbox
  AVS_DATA_DIR): read the full script; verify seams read as one talk.
- Registry **P33 — CTA discipline + pinned-arc batching**; architecture §7 + README.

### B2 — Assistant upgrades: "xịn xò và hợp lý hơn" (register as P34)

Ranked; 1–6 are the substance, 7–9 opportunistic.
1. **Fix the `durationMode` clobber** ([assistant-sheet.js:135](../public/js/features/assistant-sheet.js)) —
   braces so `'target'` applies only when a duration override was actually chosen.
2. **Script approval gate in the sheet**: checkbox `🔍 Duyệt kịch bản trước khi dựng (dừng chờ bạn xem)`
   wired to `config.sceneGate` — default ON for `▶ Làm ngay` (owner is present), OFF for scheduled
   slots/series (unattended by design; label says so). This is the single biggest quality lever the
   assistant is missing: with B1's script quality push, the owner should SEE the script the assistant
   commissioned before TTS/render money is spent. Gate machinery already exists (runner.js:48-60).
3. **Land on the project after accept**: use the returned `projectId` to open the Studio project view
   (where the new P32 journal narrates progress). Toast stays.
4. **Cost preview in the sheet**: reuse the estimate machinery (`/projects/:id/voice-estimate` exists
   post-create; add a pre-create `POST /api/estimate-cost {duration, config}` — NOT `/api/estimate`,
   which already exists as the duration-estimate helper and must not be shadowed) → line
   `💸 Ước tính: ~12.000đ · 8 phút xử lý`.
5. **Language-aware assistant**: suggestion prompt "in Vietnamese" → "in the channel's language
   (${lang})" resolved like B2 does (`scriptLang`); voice dropdown filter `v.lang === 'vi'` →
   channel/config language with vi fallback. Aligns with the P2b multi-language work.
6. **Restore suggestion on promote failure** ([scheduler.js:105](../src/pipeline/scheduler.js)) —
   call the same `restoreSuggestionBySlot` the manual path uses, and journal it as a warn: to the
   project when one was created before the failure, else as a P32 system-lane row (promote can fail
   BEFORE `createProject` — there is no projectId at that point).
7. **Title ≠ topic**: accept flow sends the researched TOPIC to B2 and the chosen click title as
   `request.titleOverride` → project title/metadata (B2 keeps writing its own if no override). Today
   the clickbait title silently replaces the researched topic as script input.
8. **Per-episode overrides for series/plan-week**: reuse the existing quick-override block once per
   flow (apply-to-all), plus the already-present per-slot ⚙ for per-episode tweaks; series bulk
   schedule passes the sheet config instead of omitting config entirely.
9. **Honest status lines**: suggest note shows source counts (`AI + 3 nguồn xu hướng · 14 tín hiệu`,
   or `AI thuần — không lấy được xu hướng (offline)`); suggestion count selector 4/8/12; surfacing
   of expiring ideas (`⏳ sắp hết hạn` badge in pool/history).
Tests: sheet-override unit (durationMode untouched when "(giữ nguyên)"), promote-failure restore,
titleOverride threading, language resolution; UI smoke in browser. Registry **P34**.

### B3 — Visual quality: dense, dialogue-matched, premium (AFTER B1/B2; register as P35)

Ordered by leverage; each item independently shippable, tests alongside.
1. **Per-scene density adaptation**: map direction `[ROLE]` → density tier over the REAL role
   vocabulary (`HF_ROLES` = hook | problem | insight | step | proof | payoff | cta): hook/proof/payoff
   → `rich`; cta → `minimal`; problem/insight/step → the project baseline (default `balanced`).
   Thread a per-scene `density` through `visuals.js` → `generateSceneSpec` → `buildCodegenPrompt`.
   The project-level knob becomes the baseline, not the ceiling.
2. **Validation scales with density**: `rich` → heroParts floor 6→8, sparse union threshold
   0.44→0.55; `minimal` → relax the sparse gate. Closes the doctrine-vs-gate gap (8–20 parts promised,
   6 enforced).
3. **Positive dialogue-match gate**: renderValidate already collects every rendered text; require
   ≥60% of beat labels' content tokens (diacritic-folded, stopword-stripped) to appear on screen at
   or after their beat's t0 → defect `beat word "X" never appears on screen` → re-ask. This converts
   "text matches the narration" from a prompt wish into a gate.
4. **Art director sees the beats**: include each scene's beat list (label + t0 + kind) in the
   direction batch prompt; require `[CHOREOGRAPHY]` to anchor one verb per beat. Briefs stop being
   timing-blind.
5. **Beat cap scales with duration**: `max = clamp(round(duration/4), 2, 10)` (MIN_GAP=1.2s already
   prevents overcrowding); a 20s scene stops getting a 6s scene's event count.
6. **Contrast gate honesty**: settled headline-class text (≥5% short-side, opacity ≥0.85) floor
   2.2→3.5:1 (decor keeps 2.2; gradient/stroked exemptions stay).
7. **Regen parity + no-fallback** (quality-reporting leak, fix first among equals): regen passes
   captionsOn/consistent/overlay/imageFullAssets/diversitySalt, persists `qtier`, and FAILS LOUDLY
   instead of the silent heuristic fallback ([regen.js:74-76](../src/pipeline/regen.js)) — align with
   the batch contract.
8. **White-frame QC at B8**: alongside blackdetect, a signalstats mean-luma outlier pass keyed to
   `guide.palette.bg` luma (flags near-white AND near-flat frames on dark themes) → feeds the existing
   one-cycle repair. Kills the refapp white-scene bug class end-to-end.
9. **Exemplar bank**: 2–3 additional `SAMPLE_SPEC`-grade exemplars (instrument-HUD · split-compare ·
   kinetic-type), rotated by motion signature (deterministic: signature → exemplar), each tagged
   "study the shape, never copy the layout". Raises the floor most for mid-tier models.
10. **Populate `guide.fontSizes/effects/ambient`** for `tuila1-hud-cyber` + add them to
    `generateStyleGuide`'s schema — the prompt blocks are already wired and currently always empty.
11. **Balance gate (mild)**: PROBE bboxes → left/right visual-weight ratio; defect only when >75/25
    sustained across samples on `rich` scenes.
Acceptance: full suite green; parity harness re-score (`scripts/parity/*`) ≥ current baseline; one
sandbox render on `ag/gemini-pro-agent` with before/after frame grabs of the same script; registry
**P35** + docs.

---

## Part 5 — Execution order, verification, risks

**Order:** Plan A (journal) first — it is independent, low-risk, and every later phase benefits from
audit-grade logs while testing. Then B1 → B2 → B3 as mandated. Each phase: code → full test suite →
sandbox E2E where relevant → registry/docs → commit (local; push only on owner approval).

**Global verification protocol:**
- `npm test` green after every phase (baseline today: 214 tests).
- Sandbox renders only (`AVS_DATA_DIR` under the session scratchpad); real-LLM runs via the proxy
  (`ag/gemini-pro-agent` strong / `ag/gemini-3-flash-agent` cheap), enabled per data-dir in the DB
  `ai` setting.
- Script quality is proven by `scripts/cta-audit.mjs` before/after + one full long-video read-through;
  visual quality by the parity harness re-score + frame grabs.
- Journal is proven by the restart test: finish a run, restart the server, reopen the project — the
  full Vietnamese story must still be there.

**Risks & mitigations:**
- Journal insert volume (per-scene ops on 200-scene videos): bounded by percent-op coalescing, the
  usage-event throttle, and run-aware retention (last 10 runs complete + hard cap); better-sqlite3
  sync inserts are microseconds — no measurable pipeline cost.
- B1 prompt changes can shift short-video output: gated — planning call + CTA-plan notes activate
  ONLY above BATCH_TRIGGER; ≤30-scene prompts stay byte-identical (pin with a test).
- CTA lexicon false positives (a legitimate "đăng ký khóa học" in content): detector requires
  channel-CTA context words (kênh/video/chuông/subscribe) near the verb for `cta`, farewell patterns
  are position-aware; repair preserves informational sentences and only strips the offending ones.
- Editorial rewrite budget on 200-scene videos: flagged scenes are bounded (≤10% coherence + CTA
  scenes) and drained in priority-ordered chunks of 20 (≤3 chunks); deterministic strip/drop as the floor.
- Regen no-fallback (B3.7) changes failure behavior from silent-degrade to loud error: matches the
  standing owner contract; the journal (P32) makes the failure visible and actionable.

**Registry additions on completion:** P32 journal · P33 CTA discipline + pinned-arc batching ·
P34 assistant upgrades · P35 per-scene density + dialogue-match gates.
