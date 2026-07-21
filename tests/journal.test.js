// P32 — persistent per-run Vietnamese journal ("Nhật ký xử lý").
// (a) Every user-visible pipeline event is a DB row: it survives reloads AND restarts.
// (b) Run attribution rides the ALS run context (scheduler stamps jobId) — out-of-run
//     work (regen/edits) stays NULL, so concurrent regens can never be mis-stamped.
// (c) Retention is RUN-aware: the last 10 runs stay complete; a flat cap would silently
//     eat the oldest run's story. (d) The journal reads Vietnamese — English emitter
//     strings are pinned gone at source.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import * as DB from '../src/db/index.js';
import { jlog } from '../src/pipeline/journal.js';
import { step, op, retryHook } from '../src/pipeline/progress.js';
import { withRunContext } from '../src/util/run-context.js';
import { DIRS } from '../src/config/paths.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rows = (projectId) => DB.listJournal({ projectId, limit: 2000 });

function mkProject(title = 'jt') {
  return DB.createProject({ title, topic: 'x', inputType: 'text', aspectRatio: '16:9', config: {} });
}

test('P32 jlog: insert/read roundtrip with level/stage/scene/kind/data', () => {
  const p = mkProject();
  jlog(p.id, { level: 'warn', stage: 'b6', sceneIdx: 4, kind: 'retry', msg: 'thử lại', data: { attempt: 2 } });
  const [r] = rows(p.id);
  assert.equal(r.level, 'warn');
  assert.equal(r.stage, 'b6');
  assert.equal(r.scene_idx, 4);
  assert.equal(r.kind, 'retry');
  assert.equal(r.msg, 'thử lại');
  assert.deepEqual(r.data, { attempt: 2 });
  assert.ok(r.ts > 0 && r.id > 0);
});

test('P32 run attribution: ALS jobId inside a run, NULL outside (regen can never be mis-stamped)', async () => {
  const p = mkProject();
  await withRunContext({ projectId: p.id, jobId: 'job_run1' }, async () => {
    jlog(p.id, { kind: 'op', msg: 'trong lần chạy' });
  });
  jlog(p.id, { kind: 'op', msg: 'ngoài lần chạy (regen)' });
  jlog(p.id, { kind: 'enqueue', jobId: 'job_run2', msg: 'xếp hàng đợi' }); // explicit override
  const rs = rows(p.id);
  assert.equal(rs.find((r) => r.msg === 'trong lần chạy').job_id, 'job_run1');
  assert.equal(rs.find((r) => r.msg.startsWith('ngoài')).job_id, null);
  assert.equal(rs.find((r) => r.kind === 'enqueue').job_id, 'job_run2');
});

test('P32 step funnel: Vietnamese labels + measured duration on done', async () => {
  const p = mkProject();
  step(p.id, 'b2', 'running', 'Tạo kịch bản');
  await sleep(25);
  step(p.id, 'b2', 'done', '12 cảnh');
  const rs = rows(p.id).filter((r) => r.kind === 'step');
  assert.equal(rs.length, 2);
  assert.match(rs[0].msg, /^▶ Kịch bản — Tạo kịch bản$/);
  assert.match(rs[1].msg, /^✓ Kịch bản hoàn tất — 12 cảnh \(\d+s\)$/);
  assert.ok(rs[1].data.durMs >= 10, 'measured stage duration');
  assert.equal(rs[1].level, 'success');
});

test('P32 op coalescing: percent ticks stay ticker-only, real ops journal', () => {
  const p = mkProject();
  op(p.id, '🎬 Cảnh 3/40 · 42%');
  op(p.id, '🎬 Cảnh 3/40 · 100%');
  op(p.id, '🎨 AI dựng cảnh 3/40');
  const ops = rows(p.id).filter((r) => r.kind === 'op');
  assert.equal(ops.length, 1, 'percent-progress ticks are not journaled');
  assert.equal(ops[0].msg, '🎨 AI dựng cảnh 3/40');
});

test('P32 retryHook: one warn retry row, no duplicate op row', () => {
  const p = mkProject();
  retryHook(p.id, 'b34', 7)(1, new Error('mất mạng'));
  const rs = rows(p.id);
  assert.equal(rs.length, 1, 'ticker op is not double-journaled');
  assert.equal(rs[0].kind, 'retry');
  assert.equal(rs[0].level, 'warn');
  assert.equal(rs[0].scene_idx, 7);
  assert.match(rs[0].msg, /Cảnh 8: lỗi "mất mạng"/);
});

test('P32 system lane: NULL project rows are stored and listable', () => {
  jlog(null, { kind: 'sys', level: 'error', stage: 'sys', msg: '⛔ Slot lịch "x" không tạo được video: hỏng' });
  const sys = DB.listJournal({ sys: true, limit: 50 });
  assert.ok(sys.some((r) => r.project_id === null && r.kind === 'sys' && /Slot lịch/.test(r.msg)));
});

test('P32 run-aware retention: an 11th run prunes run 1 wholesale, runs 2-11 stay complete', () => {
  const p = mkProject();
  for (let i = 1; i <= 11; i++) {
    jlog(p.id, { kind: 'op', msg: `việc của lần ${i}`, jobId: `job_r${i}` });
    jlog(p.id, { kind: 'status', msg: `chạy lần ${i}`, jobId: `job_r${i}` }); // status triggers prune
  }
  const rs = rows(p.id);
  assert.ok(!rs.some((r) => r.job_id === 'job_r1'), 'oldest run pruned wholesale');
  for (let i = 2; i <= 11; i++) {
    assert.equal(rs.filter((r) => r.job_id === `job_r${i}`).length, 2, `run ${i} stays complete`);
  }
});

test('P32 hard cap: pruneJournal bounds a project at 20000 rows', () => {
  const p = mkProject();
  const ins = [];
  for (let i = 0; i < 20100; i++) ins.push({ project_id: p.id, job_id: 'job_big', ts: i + 1, level: 'info', stage: null, scene_idx: null, kind: 'op', msg: `m${i}`, data: null });
  for (const r of ins) DB.insertJournal(r);
  DB.pruneJournal(p.id);
  const n = DB.listJournal({ projectId: p.id, limit: 2000 }); // capped read — count via raw
  const db = new Database(join(DIRS.data, 'studio.sqlite'));
  const c = db.prepare('SELECT COUNT(*) AS c FROM journal_events WHERE project_id=?').get(p.id).c;
  db.close();
  assert.ok(c <= 20000, `hard cap enforced (${c})`);
  assert.ok(n.length > 0);
});

test('P32 REST filters: job / level(warn=warn+error) / q / before', () => {
  const p = mkProject();
  jlog(p.id, { kind: 'op', msg: 'dòng thường', jobId: 'job_a' });
  jlog(p.id, { kind: 'log', level: 'warn', msg: 'cảnh báo nhẹ', jobId: 'job_a' });
  jlog(p.id, { kind: 'error', level: 'error', msg: 'lỗi nặng', jobId: 'job_b' });
  assert.equal(DB.listJournal({ projectId: p.id, jobId: 'job_a' }).length, 2);
  const warnPlus = DB.listJournal({ projectId: p.id, level: 'warn' });
  assert.deepEqual(warnPlus.map((r) => r.msg), ['cảnh báo nhẹ', 'lỗi nặng']);
  assert.equal(DB.listJournal({ projectId: p.id, level: 'error' }).length, 1);
  assert.equal(DB.listJournal({ projectId: p.id, q: 'cảnh báo' }).length, 1);
  const all = DB.listJournal({ projectId: p.id });
  const before = DB.listJournal({ projectId: p.id, before: all[2].id });
  assert.deepEqual(before.map((r) => r.msg), ['dòng thường', 'cảnh báo nhẹ']);
});

test('P32 FK cascade: project delete AND delete-all clear their journal rows', () => {
  const p1 = mkProject('del1'); const p2 = mkProject('del2');
  jlog(p1.id, { kind: 'op', msg: 'a' }); jlog(p2.id, { kind: 'op', msg: 'b' });
  DB.deleteProject(p1.id);
  assert.equal(rows(p1.id).length, 0, 'single delete cascades');
  DB.deleteAllProjects();
  assert.equal(rows(p2.id).length, 0, 'bulk delete cascades');
});

test('P32 restart persistence: a fresh DB connection still serves the journal', () => {
  const p = mkProject();
  jlog(p.id, { kind: 'done', level: 'success', msg: '🎉 Video hoàn thành' });
  const db2 = new Database(join(DIRS.data, 'studio.sqlite'));
  const r = db2.prepare('SELECT msg, level FROM journal_events WHERE project_id=? ORDER BY id DESC LIMIT 1').get(p.id);
  db2.close();
  assert.equal(r.msg, '🎉 Video hoàn thành');
  assert.equal(r.level, 'success');
});

test('P32 Vietnamese-first: the English emitter strings are gone at source', () => {
  const src = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
  assert.ok(!src('../src/pipeline/stages/script.js').includes('Script: ${'), 'script stage speaks Vietnamese');
  assert.ok(!src('../src/content/master-script.js').includes('master-script: got'), 'master engine speaks Vietnamese');
  assert.ok(!src('../src/pipeline/runner.js').includes("'Pipeline done'"), 'runner speaks Vietnamese');
  assert.ok(!src('../src/util/retry.js').includes('failed ('), 'retry helper speaks Vietnamese');
  assert.match(src('../src/pipeline/runner.js'), /Video hoàn thành/, 'done line is Vietnamese');
  // enqueue events journal at the scheduler funnel (submit + calendar promote)
  const sched = src('../src/pipeline/scheduler.js');
  assert.match(sched, /kind: 'enqueue'/, 'queued tasks journal an enqueue row');
  assert.match(sched, /jobId: job\.id/, 'run context carries the job id');
});
