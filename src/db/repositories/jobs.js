// Durable job ledger — every long-running unit of work (pipeline run, manual render) is a
// row here, so queued/batched work survives a process crash and the run history is auditable.
// The scheduler (pipeline/scheduler.js) is the only writer of status transitions.
import db, { stmt } from '../connection.js';
import { newId, safeJson } from '../../util/util.js';

const _insert = db.prepare(`INSERT INTO jobs(id,kind,project_id,batch_id,payload,status,priority,attempts,created_at)
  VALUES(@id,@kind,@project_id,@batch_id,@payload,'queued',@priority,0,@created_at)`);

export function enqueueJob({ kind, projectId = null, batchId = null, payload = {}, priority = 0 }) {
  const job = {
    id: newId('job'), kind, project_id: projectId, batch_id: batchId,
    payload: JSON.stringify(payload || {}), priority, created_at: Date.now(),
  };
  _insert.run(job);
  return getJob(job.id);
}

export function getJob(id) {
  const row = stmt('SELECT * FROM jobs WHERE id=?').get(id);
  if (row) row.payload = safeJson(row.payload, {});
  return row;
}

/**
 * Atomically claim the next runnable queued job, honoring:
 *  - per-kind capacity (`kinds` = kinds that still have a free lane)
 *  - one running job per project (a project must never run twice concurrently)
 *  - one running job per batch (batches process one video at a time, by design)
 */
export function claimNextJob(kinds) {
  if (!kinds.length) return null;
  const marks = kinds.map(() => '?').join(',');
  return db.transaction(() => {
    const row = stmt(`
      SELECT j.* FROM jobs j
      WHERE j.status='queued' AND j.kind IN (${marks})
        AND NOT EXISTS (SELECT 1 FROM jobs r WHERE r.status='running' AND r.project_id = j.project_id)
        AND (j.batch_id IS NULL OR NOT EXISTS (SELECT 1 FROM jobs rb WHERE rb.status='running' AND rb.batch_id = j.batch_id))
      ORDER BY j.priority DESC, j.created_at ASC LIMIT 1`).get(...kinds);
    if (!row) return null;
    stmt(`UPDATE jobs SET status='running', started_at=?, attempts=attempts+1 WHERE id=?`).run(Date.now(), row.id);
    return getJob(row.id);
  })();
}

export function settleJob(id, status, error = null) {
  stmt(`UPDATE jobs SET status=?, error=?, finished_at=? WHERE id=?`)
    .run(status, error, Date.now(), id);
}

/** Cancel every queued job for a project (running jobs settle via the stop signal). */
export function cancelQueuedJobs(projectId) {
  return stmt(`UPDATE jobs SET status='cancelled', finished_at=? WHERE project_id=? AND status='queued'`)
    .run(Date.now(), projectId).changes;
}

export function cancelJob(id) {
  return stmt(`UPDATE jobs SET status='cancelled', finished_at=? WHERE id=? AND status='queued'`)
    .run(Date.now(), id).changes;
}

/** A queued or running job already covers this project → don't enqueue a duplicate.
 *  Returns the OLDEST active one — the job that will run (or is running) first. */
export function activeJobFor(projectId, kind) {
  const row = stmt(`SELECT * FROM jobs WHERE project_id=? AND kind=? AND status IN ('queued','running') ORDER BY created_at ASC LIMIT 1`)
    .get(projectId, kind);
  if (row) row.payload = safeJson(row.payload, {});
  return row || null;
}

/** True when the batch has no queued/running jobs left (the last one just settled). */
export function batchFinished(batchId) {
  return !stmt(`SELECT 1 FROM jobs WHERE batch_id=? AND status IN ('queued','running') LIMIT 1`).get(batchId);
}

/** Live jobs of one batch, without loading every job's payload. */
export function countBatchJobs(batchId) {
  return stmt('SELECT COUNT(*) n FROM jobs WHERE batch_id=?').get(batchId).n;
}
export function listJobs({ projectId = null, limit = 50 } = {}) {
  const rows = projectId
    ? stmt('SELECT * FROM jobs WHERE project_id=? ORDER BY created_at DESC LIMIT ?').all(projectId, limit)
    : stmt('SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?').all(limit);
  return rows.map((r) => ({ ...r, payload: safeJson(r.payload, {}) }));
}

/**
 * Boot reconcile (runs right after recoverZombieProjects, P13's superset): jobs left
 * 'running' by a dead process go back to 'queued' so the work continues — unless they
 * already crashed once before (attempts >= 2), which becomes a terminal error instead
 * of a boot crash-loop.
 */
export function requeueZombieJobs() {
  // A stop the owner asked for outranks crash recovery. Without this, pressing "Dừng" and then
  // quitting the app resurrected the very job that was stopped: the flag lived only in process
  // memory, the row was still 'running', and boot dutifully requeued it. This runs FIRST so
  // those rows are gone before the blanket requeue below sees them.
  const stopped = stmt(`UPDATE jobs SET status='cancelled', error='stopped by user', finished_at=?
    WHERE status IN ('running','queued')
      AND project_id IN (SELECT id FROM projects WHERE stop_requested_at IS NOT NULL)`)
    .run(Date.now()).changes;
  const dead = stmt(`UPDATE jobs SET status='error', error='process died twice during this job', finished_at=?
    WHERE status='running' AND attempts >= 2`).run(Date.now()).changes;
  const requeued = stmt(`UPDATE jobs SET status='queued', started_at=NULL WHERE status='running'`).run().changes;
  return { requeued, dead, stopped };
}
