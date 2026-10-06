// "Dừng" has to mean stopped — now, and still after the app is closed and reopened.
//
// The bug, in one sentence: the stop signal was a Set in module memory, so quitting the app
// erased it, and boot recovery — seeing a job row still marked 'running' — requeued the job and
// carried on rendering the video the user had just stopped. The second half was that B7 (the
// join) carried no checkpoint at all, so even without a restart the stop was simply discarded.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as DB from '../src/db/index.js';
import { PATHS } from '../src/config/paths.js';
import { ffmpeg } from '../src/media/ffmpeg.js';
import {
  abortSignalFor, checkStop, clearStop, hydrateStops, isStopped, notStopped, requestStop, stopError,
} from '../src/pipeline/stop.js';
import { sourceOf } from './_source.mjs';


/** A project with one job in it, claimed so the row reads 'running' like a live render. */
function runningProject(title) {
  const p = DB.createProject({ title, topic: 't', inputType: 'text', aspectRatio: '9:16', config: {} });
  DB.enqueueJob({ kind: 'pipeline', projectId: p.id, payload: {} });
  const job = DB.claimNextJob(['pipeline']);
  assert.equal(job.status, 'running');
  return { project: p, job };
}

test('a stop survives the app being closed', () => {
  // The whole point: the intent is on disk before the process can die.
  const { project, job } = runningProject('stopped then killed');
  DB.markStopRequested(project.id);
  assert.ok(DB.stopRequestedAt(project.id), 'the request is recorded, not just remembered');

  // …the app is force-quit here, and this is what the next boot does.
  const { stopped, requeued } = DB.requeueZombieJobs();
  assert.equal(stopped, 1);
  assert.equal(DB.getJob(job.id).status, 'cancelled');
  assert.equal(DB.getJob(job.id).error, 'stopped by user');
  assert.equal(requeued, 0, 'and it is NOT handed back to the scheduler');
});

test('crash recovery still works for a project nobody stopped', () => {
  // The fix must not turn every restart into a stopped queue: an app that dies mid-render is
  // supposed to pick the work back up, which is the whole reason the job ledger exists.
  const { job } = runningProject('crashed');
  const { stopped, requeued } = DB.requeueZombieJobs();
  assert.equal(stopped, 0);
  assert.equal(requeued, 1);
  assert.equal(DB.getJob(job.id).status, 'queued');
});

test('a stop also clears work that was only waiting in the queue', () => {
  const p = DB.createProject({ title: 'queued too', topic: 't', inputType: 'text', aspectRatio: '9:16', config: {} });
  const queued = DB.enqueueJob({ kind: 'render', projectId: p.id, payload: {} });
  DB.markStopRequested(p.id);
  DB.requeueZombieJobs();
  assert.equal(DB.getJob(queued.id).status, 'cancelled', 'otherwise the next boot starts it');
});

test('starting again is the answer to an earlier stop', () => {
  const p = DB.createProject({ title: 'restarted', topic: 't', inputType: 'text', aspectRatio: '9:16', config: {} });
  DB.markStopRequested(p.id);
  DB.clearStopRequest(p.id);
  assert.equal(DB.stopRequestedAt(p.id), null);
  // A stale flag would have the next boot cancel the run that was just started.
  assert.ok(!DB.stopRequestedProjects().includes(p.id));

  // …and the two entry points that start work are the ones that clear it.
  const queue = sourceOf('src/pipeline/queue.js');
  assert.match(queue, /export function startProject[\s\S]{0,120}clearStopRequest\(projectId\)/);
  assert.match(queue, /export function renderProject[\s\S]{0,80}clearStopRequest\(projectId\)/);
  assert.match(queue, /markStopRequested\(projectId\);\s*\n\s*requestStop\(projectId\);/,
    'and disk is written before memory — the gap between them is exactly the crash this fixes');
});

test('boot re-arms the signal for a stop that was never honoured', () => {
  const id = 'p-hydrated';
  assert.equal(isStopped(id), false);
  hydrateStops([id]);
  assert.equal(isStopped(id), true);
  assert.throws(() => checkStop(id), (e) => e.stopped === true);
  clearStop(id);

  assert.match(sourceOf('src/server.js'), /hydrateStops\(pending\)/);
  assert.match(sourceOf('src/server.js'), /stopRequestedProjects\(\)/);
});

test('the stop signal reaches the child process, not just the next checkpoint', () => {
  const id = 'p-abort';
  clearStop(id);
  const signal = abortSignalFor(id);
  assert.equal(signal.aborted, false);
  requestStop(id);
  // A concat is ONE ffmpeg process that can run for a quarter of an hour. Checkpoints fire
  // between steps, so without this the stop waited for the work it was cancelling to finish.
  assert.equal(signal.aborted, true);
  assert.equal(signal.reason?.stopped, true, 'and it aborts with the stop tag, not a bare AbortError');

  // A signal asked for AFTER the stop must be born aborted — otherwise a process spawned in
  // that window runs free.
  const late = abortSignalFor(id);
  assert.equal(late.aborted, true);

  // Starting again hands out a live one.
  clearStop(id);
  assert.equal(abortSignalFor(id).aborted, false);
});

test('an aborted encode is reported as a stop, never as a crash', async () => {
  // This distinction decides what the user sees. A plain AbortError is classified as a
  // pipeline failure: "⛔ Pipeline lỗi" — and, looking retryable, it triggers the automatic
  // resume, restarting the render that was just stopped.
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(ffmpeg(['-f', 'lavfi', '-i', 'testsrc=d=1', '-f', 'null', '-'], { signal: ac.signal }),
    (e) => e.stopped === true && notStopped(e));
});

test('a running encode dies when the stop arrives', { skip: !PATHS.ffmpeg && 'ffmpeg not installed' }, async () => {
  const ac = new AbortController();
  const t0 = Date.now();
  // 60s of work; the abort lands after a fraction of a second.
  const encode = ffmpeg(['-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30:d=60', '-f', 'null', '-'],
    { signal: ac.signal });
  setTimeout(() => ac.abort(), 300);
  await assert.rejects(encode, (e) => e.stopped === true);
  assert.ok(Date.now() - t0 < 15_000, 'it ends when asked, not when the encode would have finished');
});

test('the join can be interrupted at every point it spends time', () => {
  const fin = sourceOf('src/pipeline/stages/finalize.js');
  // B7 had ZERO checkpoints. It contains, in order: clip repairs (one render each), the join,
  // the audio master, a QC decode and up to three AI thumbnails — the longest stretch in the
  // app, and the one the user is most likely to be watching when they give up on it.
  assert.match(fin, /checkStop\(projectId\);\n {2}step\(projectId, 'b7', 'running'/);
  assert.match(fin, /checkStop\(projectId\); \/\/ a repair pass/);
  assert.match(fin, /checkStop\(projectId\);\n {2}const res = await timed\(projectId, 'concat'/);
  assert.match(fin, /checkStop\(projectId\); \/\/ an AI thumbnail/);
  // The encoder gets the signal itself…
  assert.match(fin, /signal: abortSignalFor\(projectId\),/);
  // …and an abort must not be mistaken for a failed attempt, or withRetry would start the
  // fifteen-minute join over again: pressing stop would have caused MORE work.
  assert.match(fin, /fatal: notStopped, onRetry: retryHook\(projectId, 'b7'\)/);
  // Two catch blocks in B7 swallow errors on purpose (a failed master or thumbnail must never
  // fail a finished video). A stop is not a failure and has to pass through them.
  assert.match(fin, /if \(e\.stopped\) throw e; \/\/ packaging may fail silently/);
  assert.match(fin, /if \(e\.stopped\) throw e;\n {4}logger\.warn\(`master:/);

  const render = sourceOf('src/pipeline/render.js');
  assert.match(render, /signal = undefined,/);
  assert.match(render, /await \(useAssBinary \? ffmpegAss : ffmpeg\)\(args, \{\s*\n\s*signal,/);
});

test('a stop noticed late still ends the run as stopped, not as done', () => {
  const runner = sourceOf('src/pipeline/runner.js');
  // Between the join and `status: 'done'` there was nothing to notice a stop, so a run that had
  // been stopped could still finish and announce a finished video.
  const afterFinalize = runner.indexOf("await finalize(projectId, { dir, size, config })");
  // Searched FROM the join: the edit-video branch earlier in the file also finishes with
  // `status: 'done'`, and anchoring on that one would compare a backwards slice.
  const done = runner.indexOf("DB.updateProject(projectId, { status: 'done' })", afterFinalize);
  const between = runner.slice(afterFinalize, done);
  assert.ok(afterFinalize > 0 && done > afterFinalize);
  assert.ok(between.includes('checkStop(projectId)'), 'no checkpoint between the join and success');
  assert.match(runner, /DB\.clearStopRequest\(projectId\);/, 'and an honoured stop clears the flag');

  const ro = sourceOf('src/pipeline/render-only.js');
  // mode:'concat' skips the scene loop, so the "ghép lại" path reached finalize without ever
  // asking whether the user still wanted it.
  assert.match(ro, /checkStop\(projectId\);\s*\n\s*await finalize\(projectId/);
  assert.match(ro, /DB\.clearStopRequest\(projectId\);/);

  // A stopped render used to be filed in the job ledger as 'done'.
  assert.match(sourceOf('src/pipeline/scheduler.js'),
    /await renderOnly\(projectId, job\.payload\);[\s\S]{0,220}status: 'cancelled', error: 'stopped by user'/);
});

test('stopError is one definition shared by every layer', () => {
  const e = stopError();
  assert.equal(e.stopped, true);
  assert.equal(notStopped(e), true);
  // media/ffmpeg.js imports it rather than re-inventing the tag, which is why stop.js has no
  // imports of its own — a database dependency there would reach into every spawn.
  assert.match(sourceOf('src/media/ffmpeg/run.js'), /import \{ stopError \} from '\.\.\/\.\.\/pipeline\/stop\.js';/);
  // `graph.args`, not `args`: the filtergraph is swapped for a -filter_complex_script file before
  // the spawn so `ps` cannot read the transition doctrine. The signal must survive that rewrite.
  assert.match(sourceOf('src/media/ffmpeg.js'), /spawn\(bin, graph\.args, \{ stdio: \['ignore', 'pipe', 'pipe'\], signal \}\)/);
  assert.ok(!/^import .*db\//m.test(sourceOf('src/pipeline/stop.js')), 'stop.js must stay dependency-free');
});
