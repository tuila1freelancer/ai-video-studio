// Single-tick job scheduler over the durable jobs ledger.
//
// Ticks are event-driven (after enqueue and after every job settles) with a slow safety-net
// re-arm, via setTimeout self-reschedule — never setInterval, so ticks can't overlap. The
// scheduler only sequences; each executor keeps its own healing exactly where it was:
// runPipeline still owns the macro auto-resume (P10) — a job row RECORDS the run, it never
// stacks another retry on top.
import * as DB from '../db/index.js';
import { hub } from '../ws/hub.js';
import { logger } from '../util/log.js';
import { withRunContext } from '../util/run-context.js';
import { runPipeline, renderOnly } from './runner.js';

// Per-kind lanes: how many jobs of a kind may run at once across the whole process.
// Two interactive pipelines may overlap (matches the old per-project Map semantics);
// batches are additionally capped to 1-at-a-time per batch inside claimNextJob.
const LANES = { pipeline: 2, render: 2 };

const running = new Map();   // jobId -> Promise (in-process view of the running set)
const settlers = new Map();  // jobId -> {resolve} — lets enqueue() hand back a completion promise
let timer = null;

function laneCapacity() {
  const used = { pipeline: 0, render: 0 };
  for (const id of running.keys()) {
    const j = DB.getJob(id);
    if (j) used[j.kind] = (used[j.kind] || 0) + 1;
  }
  return Object.keys(LANES).filter((k) => (used[k] || 0) < LANES[k]);
}

async function execute(job) {
  const projectId = job.project_id;
  // attribution for the cost meter: every llm/tts call in this async chain bills the project
  return withRunContext({ projectId, channelId: DB.getProject(projectId)?.channel_id || null }, () => executeInner(job));
}

async function executeInner(job) {
  const projectId = job.project_id;
  try {
    if (job.kind === 'pipeline') {
      // A requeued job (attempts > 1: the process died mid-run) is a CONTINUATION — always
      // resume, or the script/TTS artifacts already on disk would be regenerated from scratch.
      const resume = !!job.payload.resume || job.attempts > 1;
      // runPipeline never throws: it settles the project row itself (done/paused/error)
      await runPipeline(projectId, { resume });
      const p = DB.getProject(projectId);
      if (p?.status === 'done') return { status: 'done' };
      if (p?.status === 'paused') return { status: 'cancelled', error: 'stopped by user' };
      return { status: 'error', error: p?.error || 'pipeline ended in error' };
    }
    if (job.kind === 'render') {
      await renderOnly(projectId, job.payload);
      return { status: 'done' };
    }
    return { status: 'error', error: `unknown job kind ${job.kind}` };
  } catch (e) {
    return { status: 'error', error: String(e?.message || e).slice(0, 500) };
  }
}

function settle(job, { status, error = null }) {
  DB.settleJob(job.id, status, error);
  hub.broadcast({ type: 'job', id: job.id, kind: job.kind, projectId: job.project_id, status });
  settlers.get(job.id)?.resolve({ status, error });
  settlers.delete(job.id);
  // last job of a batch settled → the batch is done (parity with the old batch IIFE)
  if (job.batch_id && DB.batchFinished(job.batch_id)) {
    const total = DB.listJobs({ limit: 500 }).filter((j) => j.batch_id === job.batch_id).length;
    hub.broadcast({ type: 'batch-done', count: total });
  }
}

export function tick() {
  try {
    for (;;) {
      const kinds = laneCapacity();
      const job = DB.claimNextJob(kinds);
      if (!job) break;
      hub.broadcast({ type: 'job', id: job.id, kind: job.kind, projectId: job.project_id, status: 'running' });
      const p = execute(job)
        .then((r) => settle(job, r))
        .catch((e) => settle(job, { status: 'error', error: String(e?.message || e) }))
        .finally(() => { running.delete(job.id); scheduleTick(0); });
      running.set(job.id, p);
    }
  } catch (e) {
    logger.error(`scheduler tick failed: ${e.message}`);
  }
  scheduleTick(30000); // safety net — normal wakeups come from enqueue/settle
}

export function scheduleTick(delayMs = 0) {
  clearTimeout(timer);
  timer = setTimeout(tick, delayMs);
  timer.unref?.();
}

/**
 * Enqueue a job and get back a promise that resolves when it settles (same contract the
 * old in-memory queue gave callers). Deduped: an existing queued/running job for the same
 * project+kind is returned instead of double-enqueueing.
 */
export function submit({ kind, projectId, batchId = null, payload = {}, priority = 0 }) {
  const existing = DB.activeJobFor(projectId, kind);
  if (existing) return { job: existing, done: promiseFor(existing.id) };
  const job = DB.enqueueJob({ kind, projectId, batchId, payload, priority });
  hub.broadcast({ type: 'job', id: job.id, kind, projectId, status: 'queued' });
  const done = promiseFor(job.id);
  scheduleTick(0);
  return { job, done };
}

function promiseFor(jobId) {
  if (settlers.has(jobId)) return settlers.get(jobId).promise;
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  settlers.set(jobId, { promise, resolve });
  return promise;
}

/** Boot: requeue jobs orphaned by a dead process (after P13's project recovery), then start. */
export function startScheduler() {
  const { requeued, dead } = DB.requeueZombieJobs();
  if (requeued || dead) logger.info(`job recovery: ${requeued} requeued, ${dead} marked dead`);
  scheduleTick(500); // give boot a beat before resuming heavy work
}
