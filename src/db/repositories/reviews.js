// Per-scene review verdicts — the review gate (config.requireReview) holds the pipeline
// at a DISTINCT 'review' status before concat until every scene is approved. 'review' is
// deliberately not 'paused': boot zombie-recovery (P13) must never mistake a clean
// review-hold for a crash.
import { stmt } from '../connection.js';

export function setSceneReview(sceneId, projectId, { status, note = '' }) {
  if (!['approved', 'rejected'].includes(status)) throw new Error('review status must be approved|rejected');
  stmt(`INSERT INTO scene_reviews(scene_id,project_id,status,note,at) VALUES(?,?,?,?,?)
    ON CONFLICT(scene_id) DO UPDATE SET status=excluded.status, note=excluded.note, at=excluded.at`)
    .run(sceneId, projectId, status, String(note || '').slice(0, 500), Date.now());
  return getSceneReview(sceneId);
}

export function getSceneReview(sceneId) {
  return stmt('SELECT * FROM scene_reviews WHERE scene_id=?').get(sceneId) || null;
}

export function listReviews(projectId) {
  return stmt('SELECT * FROM scene_reviews WHERE project_id=?').all(projectId);
}

export function clearSceneReview(sceneId) {
  stmt('DELETE FROM scene_reviews WHERE scene_id=?').run(sceneId);
}

/** Scene ids still blocking the gate: unreviewed or rejected. */
export function pendingReview(projectId, sceneIds) {
  const byId = new Map(listReviews(projectId).map((r) => [r.scene_id, r.status]));
  return sceneIds.filter((id) => byId.get(id) !== 'approved');
}
