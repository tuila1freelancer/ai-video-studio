// Topic-suggestion history — every batch the assistant proposes is persisted here so the
// user can browse, restore, and never see a dismissed/used idea again. Rows are DATA:
// status changes happen only on explicit user actions (accept/schedule/dismiss/restore);
// nothing in this repository touches the pipeline.
import db, { stmt } from '../connection.js';
import { newId, safeJson } from '../../util/util.js';

/** Diacritic-fold for dedupe comparisons (shared with topic-autopilot). */
export function foldTopic(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function row(r) {
  return r ? { ...r, score: safeJson(r.score, null), titles: safeJson(r.titles, null) } : null;
}

export function recordSuggestionBatch({ channelId = null, niche = '', origin = 'llm', seriesId = null, topics = [] }) {
  const batchId = newId('sgb');
  const now = Date.now();
  const ins = stmt(`INSERT INTO topic_suggestions(
    id,batch_id,channel_id,niche,topic,angle,source,score,titles,series_id,origin,status,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,'suggested',?)`);
  const ids = [];
  const tx = db.transaction(() => {
    for (const t of topics) {
      const id = newId('sg');
      ins.run(id, batchId, channelId, niche, t.topic, t.angle || '', t.source || '',
        t.score ? JSON.stringify(t.score) : null,
        Array.isArray(t.titles) && t.titles.length ? JSON.stringify(t.titles) : null,
        seriesId, origin, now);
      ids.push(id);
    }
  });
  tx();
  if (!ids.length) return [];
  const marks = ids.map(() => '?').join(',');
  // created_at ties within a batch — preserve insertion order explicitly
  const byId = new Map(stmt(`SELECT * FROM topic_suggestions WHERE id IN (${marks})`)
    .all(...ids).map((r) => [r.id, row(r)]));
  return ids.map((id) => byId.get(id));
}

export function getSuggestion(id) {
  return row(stmt('SELECT * FROM topic_suggestions WHERE id=?').get(id));
}

export function listSuggestions({ channelId = null, status = null, q = '', limit = 200, before = null } = {}) {
  const where = [];
  const args = [];
  if (channelId) { where.push('channel_id=?'); args.push(channelId); }
  if (status) { where.push('status=?'); args.push(status); }
  if (before) { where.push('created_at<?'); args.push(+before); }
  const sql = `SELECT * FROM topic_suggestions ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY created_at DESC LIMIT ?`;
  let rows = stmt(sql).all(...args, Math.min(500, +limit || 200)).map(row);
  if (q) {
    const needle = foldTopic(q);
    rows = rows.filter((r) => foldTopic(r.topic).includes(needle) || foldTopic(r.angle).includes(needle));
  }
  return rows;
}

// Legal transitions only — everything else is a no-op (returns 0 changes) so a stale UI
// click can never corrupt a decided row.
const TRANSITIONS = {
  suggested: ['accepted', 'scheduled', 'dismissed', 'expired'],
  dismissed: ['suggested'],
  expired: ['suggested'],
};

export function setSuggestionStatus(id, status, { projectId = null, slotId = null } = {}) {
  const cur = stmt('SELECT status FROM topic_suggestions WHERE id=?').get(id);
  if (!cur || !(TRANSITIONS[cur.status] || []).includes(status)) return 0;
  const clears = status === 'suggested'; // restore wipes stale linkage
  return stmt(`UPDATE topic_suggestions SET status=?, decided_at=?,
    project_id=COALESCE(?, ${clears ? 'NULL' : 'project_id'}),
    slot_id=COALESCE(?, ${clears ? 'NULL' : 'slot_id'})
    WHERE id=?`).run(status, status === 'suggested' ? null : Date.now(), projectId, slotId, id).changes;
}

/**
 * Folded topics the assistant must not re-suggest: used (accepted/scheduled) + explicitly
 * rejected. `includePending` also blocks ideas still sitting in the pool, so a fresh
 * suggest run never duplicates them; `expired` rows stay re-suggestable either way.
 */
export function suggestionBlockSet(channelId = null, { includePending = false } = {}) {
  const statuses = includePending
    ? "('accepted','scheduled','dismissed','suggested')"
    : "('accepted','scheduled','dismissed')";
  const rows = channelId
    ? stmt(`SELECT topic FROM topic_suggestions WHERE channel_id=? AND status IN ${statuses}`).all(channelId)
    : stmt(`SELECT topic FROM topic_suggestions WHERE status IN ${statuses}`).all();
  return new Set(rows.map((r) => foldTopic(r.topic)));
}

/** Lazy expiry: pending ideas older than the window stop cluttering the pool (still restorable). */
export function expireSuggestions({ channelId = null, olderThanMs = 14 * 864e5 } = {}) {
  const cutoff = Date.now() - olderThanMs;
  return channelId
    ? stmt("UPDATE topic_suggestions SET status='expired', decided_at=? WHERE channel_id=? AND status='suggested' AND created_at<?")
      .run(Date.now(), channelId, cutoff).changes
    : stmt("UPDATE topic_suggestions SET status='expired', decided_at=? WHERE status='suggested' AND created_at<?")
      .run(Date.now(), cutoff).changes;
}

/** A cancelled calendar slot returns its idea to the pool. */
export function restoreSuggestionBySlot(slotId) {
  return stmt("UPDATE topic_suggestions SET status='suggested', decided_at=NULL, slot_id=NULL WHERE slot_id=? AND status='scheduled'")
    .run(slotId).changes;
}

/** When a scheduled slot promotes into a real project, link the suggestion to it. */
export function linkSuggestionProject(slotId, projectId) {
  return stmt('UPDATE topic_suggestions SET project_id=? WHERE slot_id=? AND project_id IS NULL')
    .run(projectId, slotId).changes;
}

// ---- mini-series (a named group of episode suggestions) ----
export function createSeries({ channelId = null, name, description = '' }) {
  const id = newId('ser');
  stmt('INSERT INTO suggestion_series(id,channel_id,name,description,created_at) VALUES(?,?,?,?,?)')
    .run(id, channelId, String(name || 'Series').slice(0, 80), String(description || '').slice(0, 300), Date.now());
  return stmt('SELECT * FROM suggestion_series WHERE id=?').get(id);
}

