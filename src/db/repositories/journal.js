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

/**
 * Read FORWARDS from a cursor — the lane an agent polls, where listJournal pages backwards for a
 * person scrolling a panel. The id is an AUTOINCREMENT integer, so "everything after what I already
 * have" is exact and cheap, and an agent that was away for an hour misses nothing.
 *
 * @param {{afterId?:number, projectId?:string|null, channelId?:string|null, kinds?:string[],
 *          level?:string|null, limit?:number}} q
 */
export function journalAfter({ afterId = 0, projectId = null, channelId = null, kinds = null, level = null, limit = 200 } = {}) {
  const where = ['e.id > ?']; const args = [Math.max(0, parseInt(afterId, 10) || 0)];
  if (projectId) { where.push('e.project_id=?'); args.push(projectId); }
  if (channelId) { where.push('p.channel_id=?'); args.push(channelId); }
  if (level === 'warn') where.push(`e.level IN ('warn','error')`);
  else if (level) { where.push('e.level=?'); args.push(level); }
  const picked = (kinds || []).filter(Boolean);
  if (picked.length) { where.push(`e.kind IN (${picked.map(() => '?').join(',')})`); args.push(...picked); }
  const take = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 1000);
  const rows = stmt(`SELECT e.*, p.channel_id AS channel_id FROM journal_events e
    LEFT JOIN projects p ON p.id = e.project_id
    WHERE ${where.join(' AND ')} ORDER BY e.id ASC LIMIT ?`).all(...args, take + 1);
  const more = rows.length > take;
  return {
    events: rows.slice(0, take).map((r) => ({ ...r, data: safeJson(r.data, null) })),
    hasMore: more,
  };
}

/** The newest row id, so a caller can start "from now" instead of from the beginning. */
export function journalHeadId() {
  return stmt('SELECT MAX(id) AS id FROM journal_events').get()?.id || 0;
}
