// P38: background-style library + deterministic per-scene rotation. The palette stays LOCKED to
// the video's guide (brand identity); only the backdrop STYLE rotates scene-to-scene so a video
// never reads as the same dark stage every cut. Seeded by (idx + a per-video salt) → deterministic
// (P12): the same scene always renders the same backdrop.
//
// The style names below are implemented in animation/templates/hyperframe.js `motifLayer`.
// 'particles' / 'grain' stay valid guide values but are the plain fallbacks, so the rotation pool
// prefers the characterful ones. Keep this list in sync with the motif whitelist in
// styleguide/guide.js (normalizeGuide) — the P38 test asserts the two agree.
export const BACKDROP_STYLES = ['mesh', 'grid', 'spotlight', 'aurora', 'rays', 'dotmatrix', 'blueprint', 'bokeh', 'gradient-wash'];

// Every motif a guide may legally carry (rotation pool + the two plain fallbacks).
export const ALL_MOTIFS = [...BACKDROP_STYLES, 'particles', 'grain'];

/**
 * Pick a deterministic backdrop style for one scene. Consecutive scenes never repeat (a sequential
 * idx maps to a sequential pool slot); different videos start the rotation at a different slot via
 * `salt`. A calm cta / outro scene gets a quiet spotlight so the close reads focused.
 * @param {{visual_prompt?:string}} scene
 * @param {number} idx  scene index
 * @param {number} salt per-video seed (e.g. hash of projectId)
 * @returns {string} a backdrop style name from BACKDROP_STYLES
 */
export function backdropForScene(scene, idx, salt = 0) {
  const m = /\[ROLE\]\s*([a-z-]+)/i.exec(String(scene?.visual_prompt || ''));
  const role = m ? m[1].toLowerCase() : '';
  if (role === 'cta' || role === 'outro') return 'spotlight';
  const pool = BACKDROP_STYLES;
  const start = Math.abs(salt | 0) % pool.length;
  return pool[(start + Math.max(0, idx | 0)) % pool.length];
}
