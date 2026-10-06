// Content calendar — scheduled slots the user created. Due slots are promoted into real
// projects + pipeline jobs on the scheduler's existing tick (no second timer).
import { stmt } from '../connection.js';
import { newId, safeJson } from '../../util/util.js';

import { m } from '../../i18n/t.js';
function row(r) { return r ? { ...r, config: safeJson(r.config, {}) } : null; }

export function addSlot({ channelId = null, topic, config = {}, dueAt }) {
  const t = String(topic || '').trim();
  if (t.length < 4) throw new Error(m('chủ đề quá ngắn'));
  if (!Number.isFinite(+dueAt)) throw new Error(m('thiếu thời điểm hẹn'));
  const id = newId('cal');
  stmt(`INSERT INTO calendar_slots(id,channel_id,topic,config,due_at,status,created_at)
    VALUES(?,?,?,?,?,'queued',?)`).run(id, channelId, t, JSON.stringify(config || {}), +dueAt, Date.now());
  return row(stmt('SELECT * FROM calendar_slots WHERE id=?').get(id));
}

export function listSlots({ includeDone = true } = {}) {
  const rows = includeDone
    ? stmt('SELECT * FROM calendar_slots ORDER BY due_at ASC').all()
    : stmt("SELECT * FROM calendar_slots WHERE status='queued' ORDER BY due_at ASC").all();
  return rows.map(row);
}

export function cancelSlot(id) {
  return stmt("UPDATE calendar_slots SET status='cancelled' WHERE id=? AND status='queued'").run(id).changes;
}

export function dueSlots(now = Date.now()) {
  return stmt("SELECT * FROM calendar_slots WHERE status='queued' AND due_at <= ? ORDER BY due_at ASC LIMIT 5")
    .all(now).map(row);
}

export function markSlotCreated(id, projectId) {
  stmt("UPDATE calendar_slots SET status='created', project_id=? WHERE id=?").run(projectId, id);
}

/** Edit a slot's config/due time — only while it is still waiting (queued). */
export function updateSlot(id, { config, dueAt } = {}) {
  const sets = [];
  const args = [];
  if (config !== undefined) { sets.push('config=?'); args.push(JSON.stringify(config || {})); }
  if (dueAt !== undefined) {
    if (!Number.isFinite(+dueAt)) throw new Error(m('thiếu thời điểm hẹn'));
    sets.push('due_at=?'); args.push(+dueAt);
  }
  if (!sets.length) return 0;
  return stmt(`UPDATE calendar_slots SET ${sets.join(',')} WHERE id=? AND status='queued'`)
    .run(...args, id).changes;
}

/** The slot a project was born from (for completion notifications). */
export function slotForProject(projectId) {
  return row(stmt('SELECT * FROM calendar_slots WHERE project_id=?').get(projectId));
}

// ---- recurring planning templates (fixed weekday+time production windows) ----
// Recurrences are INERT: they prefill the plan-week dialog and render as empty windows the
// user fills with a picked suggestion. They never promote or create anything by themselves.
export function addRecurrence({ channelId = null, weekday, time, config = {} }) {
  const wd = parseInt(weekday, 10);
  if (!(wd >= 0 && wd <= 6)) throw new Error(m('thứ trong tuần không hợp lệ'));
  if (!/^\d{1,2}:\d{2}$/.test(String(time || ''))) throw new Error(m('khung giờ không hợp lệ (HH:mm)'));
  const id = newId('rec');
  stmt('INSERT INTO calendar_recurrences(id,channel_id,weekday,time,config,active,created_at) VALUES(?,?,?,?,?,1,?)')
    .run(id, channelId, wd, String(time), JSON.stringify(config || {}), Date.now());
  return row(stmt('SELECT * FROM calendar_recurrences WHERE id=?').get(id));
}

export function listRecurrences(channelId = null) {
  const rows = channelId
    ? stmt('SELECT * FROM calendar_recurrences WHERE active=1 AND (channel_id=? OR channel_id IS NULL) ORDER BY weekday, time').all(channelId)
    : stmt('SELECT * FROM calendar_recurrences WHERE active=1 ORDER BY weekday, time').all();
  return rows.map(row);
}

export function deleteRecurrence(id) {
  return stmt('DELETE FROM calendar_recurrences WHERE id=?').run(id).changes;
}
