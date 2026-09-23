// Persistent per-run processing journal (P32). Every user-visible pipeline event is a row
// here so the story of a run survives page reloads, server restarts and old age.
// Written ONLY via src/pipeline/journal.js's jlog(); read by GET /projects/:id/journal
// and the global tasks feed. Retention is RUN-aware: the last KEEP_RUNS runs of a project
// stay complete — a flat row cap would silently eat the oldest run's story mid-history.
import db, { stmt } from '../connection.js';
import { safeJson } from '../../util/util.js';

const KEEP_RUNS = 10;    // most-recent runs kept complete per project
const HARD_CAP = 20000;  // absolute rows/project safety net

const _insert = db.prepare(`INSERT INTO journal_events(project_id,job_id,ts,level,stage,scene_idx,kind,msg,data,actor)
  VALUES(@project_id,@job_id,@ts,@level,@stage,@scene_idx,@kind,@msg,@data,@actor)`);

export function insertJournal(row) {
  // `actor` defaulted here rather than demanded of every caller: a row written by a script or an
  // older call site is still a journal row, and a missing name must never throw inside a run.
  return _insert.run({ actor: null, ...row }).lastInsertRowid;
}

/** Keep the newest KEEP_RUNS runs complete; prune older runs wholesale, then the hard cap. */
export function pruneJournal(projectId) {
  if (!projectId) return;
  const runs = stmt(`SELECT job_id, MAX(id) AS last FROM journal_events
    WHERE project_id=? AND job_id IS NOT NULL GROUP BY job_id ORDER BY last DESC`).all(projectId);
  if (runs.length > KEEP_RUNS) {
    const old = runs.slice(KEEP_RUNS).map((r) => r.job_id);
    const marks = old.map(() => '?').join(',');
    stmt(`DELETE FROM journal_events WHERE project_id=? AND job_id IN (${marks})`).run(projectId, ...old);
  }
  const n = stmt('SELECT COUNT(*) AS c FROM journal_events WHERE project_id=?').get(projectId).c;
  if (n > HARD_CAP) {
    stmt(`DELETE FROM journal_events WHERE id IN (
      SELECT id FROM journal_events WHERE project_id=? ORDER BY id ASC LIMIT ?)`).run(projectId, n - HARD_CAP);
  }
}

/**
 * List journal rows oldest→newest. `before` (a row id) pages backwards; `level:'warn'`
 * means warn+error; `sys:true` selects the project-less system lane.
 */
export function listJournal({ projectId = null, jobId = null, level = null, q = null, before = null, limit = 500, sys = false } = {}) {
  const where = []; const args = [];
  if (sys) where.push('project_id IS NULL');
  else if (projectId) { where.push('project_id=?'); args.push(projectId); }
  if (jobId) { where.push('job_id=?'); args.push(jobId); }
  if (level === 'warn') where.push(`level IN ('warn','error')`);
  else if (level) { where.push('level=?'); args.push(level); }
  if (q) { where.push('msg LIKE ?'); args.push(`%${q}%`); }
  if (before) { where.push('id < ?'); args.push(before); }
  const rows = stmt(`SELECT * FROM journal_events ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY id DESC LIMIT ?`).all(...args, Math.min(parseInt(limit, 10) || 500, 2000));
  rows.reverse();
  return rows.map((r) => ({ ...r, data: safeJson(r.data, null) }));
}
