// Project rows — the top-level unit of work (topic → config → scenes → final video).
import db from '../connection.js';
import { newId, safeJson } from '../../util/util.js';
import { activeChannelId } from './channels.js';

const _insProject = db.prepare(`INSERT INTO projects
  (id,title,topic,input_type,aspect_ratio,status,config,channel_id,created_at,updated_at)
  VALUES (@id,@title,@topic,@input_type,@aspect_ratio,@status,@config,@channel_id,@created_at,@updated_at)`);
const _getProject = db.prepare('SELECT * FROM projects WHERE id=?');
const _listProjects = db.prepare('SELECT * FROM projects ORDER BY updated_at DESC');
const _delProject = db.prepare('DELETE FROM projects WHERE id=?');

function rowToProject(r) {
  if (!r) return null;
  return { ...r, config: safeJson(r.config, {}), metadata: safeJson(r.metadata, null) };
}

export function createProject({ title, topic, inputType, aspectRatio, config, channelId }) {
  const id = newId('p');
  const now = Date.now();
  _insProject.run({
    id, title: title || 'Dự án mới', topic: topic || '', input_type: inputType || 'text',
    aspect_ratio: aspectRatio || '9:16', status: 'draft',
    config: JSON.stringify(config || {}), channel_id: channelId || activeChannelId(), created_at: now, updated_at: now,
  });
  return rowToProject(_getProject.get(id));
}
export function getProject(id) { return rowToProject(_getProject.get(id)); }
export function listProjects(channelId) {
  if (channelId && channelId !== 'all') {
    return db.prepare('SELECT * FROM projects WHERE channel_id=? ORDER BY updated_at DESC').all(channelId).map(rowToProject);
  }
  return _listProjects.all().map(rowToProject);
}
export function deleteProject(id) { _delProject.run(id); }
export function deleteAllProjects() { db.prepare('DELETE FROM projects').run(); }
// Boot recovery: a project can only be 'running' while a pipeline holds it in-process,
// so any 'running' rows at startup are crash leftovers → flip to 'paused' (Resume-able).
export function recoverZombieProjects() {
  return db.prepare("UPDATE projects SET status='paused' WHERE status='running'").run().changes;
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
  db.prepare(`UPDATE projects SET ${sets.join(',')}, updated_at=@updated_at WHERE id=@id`).run(vals);
  return getProject(id);
}
