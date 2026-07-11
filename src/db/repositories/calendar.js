// Content calendar — scheduled slots the OWNER created. Due slots are promoted into real
// projects + pipeline jobs on the scheduler's existing tick (no second timer).
import db from '../connection.js';
import { newId, safeJson } from '../../util/util.js';

function row(r) { return r ? { ...r, config: safeJson(r.config, {}) } : null; }

export function addSlot({ channelId = null, topic, config = {}, dueAt }) {
  const t = String(topic || '').trim();
  if (t.length < 4) throw new Error('chủ đề quá ngắn');
  if (!Number.isFinite(+dueAt)) throw new Error('thiếu thời điểm hẹn');
  const id = newId('cal');
  db.prepare(`INSERT INTO calendar_slots(id,channel_id,topic,config,due_at,status,created_at)
    VALUES(?,?,?,?,?,'queued',?)`).run(id, channelId, t, JSON.stringify(config || {}), +dueAt, Date.now());
  return row(db.prepare('SELECT * FROM calendar_slots WHERE id=?').get(id));
}

export function listSlots({ includeDone = true } = {}) {
  const rows = includeDone
    ? db.prepare('SELECT * FROM calendar_slots ORDER BY due_at ASC').all()
    : db.prepare("SELECT * FROM calendar_slots WHERE status='queued' ORDER BY due_at ASC").all();
  return rows.map(row);
}

export function cancelSlot(id) {
  return db.prepare("UPDATE calendar_slots SET status='cancelled' WHERE id=? AND status='queued'").run(id).changes;
}

export function dueSlots(now = Date.now()) {
  return db.prepare("SELECT * FROM calendar_slots WHERE status='queued' AND due_at <= ? ORDER BY due_at ASC LIMIT 5")
    .all(now).map(row);
}

export function markSlotCreated(id, projectId) {
  db.prepare("UPDATE calendar_slots SET status='created', project_id=? WHERE id=?").run(projectId, id);
}

/** Edit a slot's config/due time — only while it is still waiting (queued). */
export function updateSlot(id, { config, dueAt } = {}) {
  const sets = [];
  const args = [];
  if (config !== undefined) { sets.push('config=?'); args.push(JSON.stringify(config || {})); }
  if (dueAt !== undefined) {
    if (!Number.isFinite(+dueAt)) throw new Error('thiếu thời điểm hẹn');
    sets.push('due_at=?'); args.push(+dueAt);
  }
  if (!sets.length) return 0;
  return db.prepare(`UPDATE calendar_slots SET ${sets.join(',')} WHERE id=? AND status='queued'`)
    .run(...args, id).changes;
}

/** The slot a project was born from (for completion notifications). */
export function slotForProject(projectId) {
  return row(db.prepare('SELECT * FROM calendar_slots WHERE project_id=?').get(projectId));
}
