// Publish attempts ledger — one row per upload, so publish history is auditable and the
// UI can show where a video already lives.
import { stmt } from '../connection.js';
import { newId } from '../../util/util.js';

export function recordPublish({ projectId, platform, privacy, status = 'uploading' }) {
  const id = newId('pub');
  stmt(`INSERT INTO publish_targets(id,project_id,platform,privacy,status,at) VALUES(?,?,?,?,?,?)`)
    .run(id, projectId, platform, privacy, status, Date.now());
  return id;
}

export function settlePublish(id, { status, videoId = null, url = null, error = null }) {
  stmt(`UPDATE publish_targets SET status=?, video_id=?, url=?, error=? WHERE id=?`)
    .run(status, videoId, url, error ? String(error).slice(0, 500) : null, id);
}

export function listPublishes(projectId) {
  return stmt('SELECT * FROM publish_targets WHERE project_id=? ORDER BY at DESC').all(projectId);
}

/** Project ids that have at least one SUCCESSFUL publish — lets the grid badge them (P42). */
export function publishedProjectIds() {
  return stmt("SELECT DISTINCT project_id FROM publish_targets WHERE status='done'").all().map((r) => r.project_id);
}

/** Successful uploads for a channel since a moment — what a daily publish cap counts. */
export function publishCountSince(channelId, sinceTs, platform = null) {
  const where = ["t.status='done'", 't.at>=?'];
  const args = [sinceTs];
  if (channelId) { where.push('p.channel_id=?'); args.push(channelId); }
  if (platform) { where.push('t.platform=?'); args.push(platform); }
  return stmt(`SELECT COUNT(*) n FROM publish_targets t JOIN projects p ON p.id=t.project_id
    WHERE ${where.join(' AND ')}`).get(...args).n;
}
