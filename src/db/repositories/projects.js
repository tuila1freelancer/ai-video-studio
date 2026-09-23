// Project rows — the top-level unit of work (topic → config → scenes → final video).
import db, { stmt } from '../connection.js';
import { newId, safeJson } from '../../util/util.js';
import { activeChannelId } from './channels.js';

const _insProject = db.prepare(`INSERT INTO projects
  (id,title,topic,input_type,aspect_ratio,status,config,channel_id,client_ref,created_at,updated_at)
  VALUES (@id,@title,@topic,@input_type,@aspect_ratio,@status,@config,@channel_id,@client_ref,@created_at,@updated_at)`);
const _getProject = db.prepare('SELECT * FROM projects WHERE id=?');
const _listProjects = db.prepare('SELECT * FROM projects ORDER BY updated_at DESC');
const _delProject = db.prepare('DELETE FROM projects WHERE id=?');

function rowToProject(r) {
  if (!r) return null;
  return { ...r, config: safeJson(r.config, {}), metadata: safeJson(r.metadata, null) };
}

export function createProject({ title, topic, inputType, aspectRatio, config, channelId, clientRef = null }) {
  const id = newId('p');
  const now = Date.now();
  _insProject.run({
    id, title: title || 'Dự án mới', topic: topic || '', input_type: inputType || 'text',
    aspect_ratio: aspectRatio || '9:16', status: 'draft',
    config: JSON.stringify(config || {}), channel_id: channelId || activeChannelId(),
    client_ref: clientRef ? String(clientRef).slice(0, 120) : null, created_at: now, updated_at: now,
  });
  return rowToProject(_getProject.get(id));
}
export function getProject(id) { return rowToProject(_getProject.get(id)); }
/** The project an agent already created under this reference, or null. */
export function projectByClientRef(channelId, clientRef) {
  if (!clientRef) return null;
  return rowToProject(stmt('SELECT * FROM projects WHERE channel_id=? AND client_ref=?').get(channelId, String(clientRef)));
}
export function listProjects(channelId) {
  if (channelId && channelId !== 'all') {
    return stmt('SELECT * FROM projects WHERE channel_id=? ORDER BY updated_at DESC').all(channelId).map(rowToProject);
  }
  return _listProjects.all().map(rowToProject);
}
// The list the interface renders: everything but `config` and `metadata` (1.9 MB of a 1.95 MB
// reply on the live DB) and only the head of `topic`, which is often a whole pasted script.
const SUMMARY_COLS = 'id,title,substr(topic,1,200) AS topic,input_type,aspect_ratio,status,current_step,video_path,thumb_path,error,channel_id,created_at,updated_at,scenes_approved_at';
export function listProjectSummaries(channelId) {
  if (channelId && channelId !== 'all') {
    return stmt(`SELECT ${SUMMARY_COLS} FROM projects WHERE channel_id=? ORDER BY updated_at DESC`).all(channelId);
  }
  return stmt(`SELECT ${SUMMARY_COLS} FROM projects ORDER BY updated_at DESC`).all();
}
/** Titles for a set of ids in one query (the tasks feed used to fetch one full project per job). */
export function projectTitles(ids) {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return new Map();
  const rows = stmt(`SELECT id, title FROM projects WHERE id IN (${uniq.map(() => '?').join(',')})`).all(...uniq);
  return new Map(rows.map((r) => [r.id, r.title]));
}
/** `{ status: count }` without loading a single row's JSON. */
export function projectCountsByStatus() {
  return Object.fromEntries(stmt('SELECT status, COUNT(*) n FROM projects GROUP BY status').all().map((r) => [r.status, r.n]));
}
export function deleteProject(id) { _delProject.run(id); }
export function deleteAllProjects() { stmt('DELETE FROM projects').run(); }
// Boot recovery: a project can only be 'running' while a pipeline holds it in-process,
// so any 'running' rows at startup are crash leftovers → flip to 'paused' (Resume-able).
export function recoverZombieProjects() {
  return stmt("UPDATE projects SET status='paused' WHERE status='running'").run().changes;
}

// ---- durable stop ----------------------------------------------------------------------
// The in-process stop signal (pipeline/stop.js) dies with the process, and a job left
// 'running' by a killed app is requeued at boot. Without a record on disk, quitting the app
// mid-render ERASED the owner's decision to stop and the render resumed on the next launch.
//
// The flag means "a stop was asked for and has not been honoured yet". It is cleared when a
// run is deliberately started again, and when a run settles as paused.

export function markStopRequested(id) {
  return stmt('UPDATE projects SET stop_requested_at=? WHERE id=?').run(Date.now(), id).changes;
}

export function clearStopRequest(id) {
  return stmt('UPDATE projects SET stop_requested_at=NULL WHERE id=?').run(id).changes;
}

export function stopRequestedAt(id) {
  return stmt('SELECT stop_requested_at FROM projects WHERE id=?').get(id)?.stop_requested_at ?? null;
}

/** Every project with a stop still pending — used to rehydrate the signal at boot. */
export function stopRequestedProjects() {
  return stmt('SELECT id FROM projects WHERE stop_requested_at IS NOT NULL').all().map((r) => r.id);
}

export function updateProject(id, fields) {
  const allowed = ['title', 'topic', 'aspect_ratio', 'status', 'current_step', 'config', 'metadata', 'video_path', 'thumb_path', 'error', 'scenes_approved_at'];
  const sets = [], vals = {};
  for (const k of allowed) {
    if (k in fields) {
      sets.push(`${k}=@${k}`);
      vals[k] = (k === 'config' || k === 'metadata') && typeof fields[k] !== 'string'
        ? JSON.stringify(fields[k]) : fields[k];
    }
  }
  if (!sets.length) return getProject(id);
  vals.id = id; vals.updated_at = Date.now();
  stmt(`UPDATE projects SET ${sets.join(',')}, updated_at=@updated_at WHERE id=@id`).run(vals);
  return getProject(id);
}
