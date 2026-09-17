// Scene rows — one narrated beat of a project (voice, visual spec, timing, clip path).
import db, { stmt } from '../connection.js';
import { newId, safeJson } from '../../util/util.js';

const _insScene = db.prepare(`INSERT INTO scenes
  (id,project_id,idx,voice_text,visual_prompt,keywords,template,props,assets,status)
  VALUES (@id,@project_id,@idx,@voice_text,@visual_prompt,@keywords,@template,@props,@assets,'script')`);
const _listScenes = db.prepare('SELECT * FROM scenes WHERE project_id=? ORDER BY idx ASC');
const _getScene = db.prepare('SELECT * FROM scenes WHERE id=?');
const _delScenes = db.prepare('DELETE FROM scenes WHERE project_id=?');

function rowToScene(r) {
  if (!r) return null;
  return { ...r, keywords: safeJson(r.keywords, []), srt_json: safeJson(r.srt_json, null), props: safeJson(r.props, null), fp: safeJson(r.fp, null), assets: safeJson(r.assets, []) };
}
export function replaceScenes(projectId, scenes) {
  const tx = db.transaction((arr) => {
    _delScenes.run(projectId);
    arr.forEach((s, i) => _insScene.run({
      id: newId('s'), project_id: projectId, idx: i,
      voice_text: s.voice || s.voice_text || '', visual_prompt: s.visualPrompt || s.visual_prompt || s.visual || '',
      keywords: JSON.stringify(s.keywords || []),
      // Two-stage B2 may pre-assign a plan (e.g. chapter-break scenes); B5 backfills the rest.
      template: s.template || null, props: s.props ? JSON.stringify(s.props) : null,
      // master-engine asset assignment (image-full lane) — names resolved against config.assets
      assets: Array.isArray(s.assets) && s.assets.length ? JSON.stringify(s.assets) : null,
    }));
  });
  tx(scenes);
  return getScenes(projectId);
}
export function getScenes(projectId) { return _listScenes.all(projectId).map(rowToScene); }
export function getScene(id) { return rowToScene(_getScene.get(id)); }
export function updateScene(id, fields) {
  const allowed = ['idx', 'voice_text', 'visual_prompt', 'keywords', 'image_path', 'audio_path', 'srt_path', 'srt_json', 'html_path', 'video_path', 'duration', 'status', 'error', 'template', 'props', 'fp', 'assets'];
  const sets = [], vals = {};
  for (const k of allowed) {
    if (k in fields) {
      sets.push(`${k}=@${k}`);
      vals[k] = (k === 'keywords' || k === 'srt_json' || k === 'props' || k === 'fp' || k === 'assets') && fields[k] != null && typeof fields[k] !== 'string'
        ? JSON.stringify(fields[k]) : fields[k];
    }
  }
  if (!sets.length) return getScene(id);
  vals.id = id;
  stmt(`UPDATE scenes SET ${sets.join(',')} WHERE id=@id`).run(vals);
  return getScene(id);
}
