// The export history of a project.
//
// finalize has always written a new timestamped mp4 and never deleted the old one, so every past
// version of every video is already sitting on disk — invisible, because nothing indexed it. That
// is the difference between "I could go back if I had to" and "I dare not try anything".
import { stmt } from '../connection.js';
import { newId, safeJson } from '../../util/util.js';

const parse = (r) => (r ? {
  ...r,
  config: safeJson(r.config, {}) || {},
  changes: safeJson(r.changes, []) || [],
} : null);

/** Which config keys differ between two exports — what the owner would call "what changed". */
export function diffConfig(before = {}, after = {}) {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  return [...keys].filter((k) => JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k])).sort();
}

export function listRenders(projectId, limit = 40) {
  return stmt('SELECT * FROM renders WHERE project_id=? ORDER BY created_at DESC LIMIT ?')
    .all(projectId, limit).map(parse);
}

export function getRender(id) {
  return parse(stmt('SELECT * FROM renders WHERE id=?').get(id));
}

export function recordRender({ projectId, path, thumb, duration, tier, config, variant = null }) {
  const prev = stmt('SELECT config FROM renders WHERE project_id=? ORDER BY created_at DESC LIMIT 1').get(projectId);
  const changes = diffConfig(safeJson(prev?.config, {}) || {}, config || {});
  const row = {
    id: newId('rnd'), project_id: projectId, path: path || null, thumb: thumb || null,
    duration: duration || 0, tier: tier || null, variant: variant || null,
    config: JSON.stringify(config || {}), changes: JSON.stringify(changes), created_at: Date.now(),
  };
  stmt(`INSERT INTO renders (id,project_id,path,thumb,duration,tier,variant,config,changes,created_at)
    VALUES (@id,@project_id,@path,@thumb,@duration,@tier,@variant,@config,@changes,@created_at)`).run(row);
  return parse(row);
}
