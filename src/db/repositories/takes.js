// Multi-take history — regenerating a scene's voice or visual APPENDS a take instead of
// silently overwriting the only copy. A take snapshots exactly the scene-row fields that
// make up the artifact; activating one projects the snapshot back onto the row, so every
// downstream stage keeps reading the plain scene columns and never learns takes exist.
import db from '../connection.js';
import { newId, safeJson } from '../../util/util.js';
import { updateScene, getScene } from './scenes.js';

const KEEP = 6; // takes kept per scene per kind (rows only — files stay for other refs)

const VOICE_FIELDS = ['audio_path', 'srt_path', 'srt_json', 'duration'];
const VISUAL_FIELDS = ['template', 'props', 'image_path', 'visual_prompt'];

function fieldsFor(kind) { return kind === 'voice' ? VOICE_FIELDS : VISUAL_FIELDS; }

/** Snapshot the scene's CURRENT artifact fields as a take. Returns null when empty. */
export function snapshotTake(scene, kind, { active = false } = {}) {
  const fields = fieldsFor(kind);
  const payload = {};
  for (const f of fields) payload[f] = scene[f] ?? null;
  const empty = kind === 'voice' ? !payload.audio_path : !(payload.template || payload.image_path);
  if (empty) return null;
  const id = newId('tk');
  db.transaction(() => {
    if (active) db.prepare('UPDATE scene_takes SET is_active=0 WHERE scene_id=? AND kind=?').run(scene.id, kind);
    db.prepare(`INSERT INTO scene_takes(id,scene_id,project_id,kind,payload,is_active,created_at)
      VALUES(?,?,?,?,?,?,?)`)
      .run(id, scene.id, scene.project_id, kind, JSON.stringify(payload), active ? 1 : 0, Date.now());
    // cap history: drop the oldest inactive rows beyond KEEP
    const extra = db.prepare(`SELECT id FROM scene_takes WHERE scene_id=? AND kind=? AND is_active=0
      ORDER BY created_at DESC LIMIT -1 OFFSET ?`).all(scene.id, kind, KEEP - 1);
    for (const r of extra) db.prepare('DELETE FROM scene_takes WHERE id=?').run(r.id);
  })();
  return getTake(id);
}

export function getTake(id) {
  const r = db.prepare('SELECT * FROM scene_takes WHERE id=?').get(id);
  return r ? { ...r, payload: safeJson(r.payload, {}) } : null;
}

export function listTakes(sceneId, kind = null) {
  const rows = kind
    ? db.prepare('SELECT * FROM scene_takes WHERE scene_id=? AND kind=? ORDER BY created_at DESC').all(sceneId, kind)
    : db.prepare('SELECT * FROM scene_takes WHERE scene_id=? ORDER BY created_at DESC').all(sceneId);
  return rows.map((r) => ({ ...r, payload: safeJson(r.payload, {}) }));
}

/**
 * Project a take's snapshot back onto its scene row.
 * A voice take carries different audio → the clip is stale; a visual take carries a
 * different spec → same. Both null video_path so resume re-renders (P8).
 */
export function activateTake(takeId) {
  const take = getTake(takeId);
  if (!take) throw new Error('take not found');
  const sc = getScene(take.scene_id);
  if (!sc) throw new Error('scene not found');
  db.transaction(() => {
    db.prepare('UPDATE scene_takes SET is_active=0 WHERE scene_id=? AND kind=?').run(take.scene_id, take.kind);
    db.prepare('UPDATE scene_takes SET is_active=1 WHERE id=?').run(takeId);
  })();
  const fp = { ...(sc.fp || {}) };
  delete fp.render; // the projected artifact differs from what the clip baked in
  if (take.kind === 'voice') delete fp.tts;
  updateScene(take.scene_id, { ...take.payload, video_path: null, fp });
  return getScene(take.scene_id);
}
