// Beat-anchored piecewise time map (per-word AV sync for hyperframe scenes).
//
// A hyperframe script bakes ABSOLUTE animation seconds against the timeline it was authored
// at (props.plannedDur — an estimate in the scenes-first order). A single ratio
// (plannedDur/realDur) keeps the ends aligned but lets every in-between beat drift by
// however much the voice's word pacing differs from the estimate. This module upgrades the
// warp to a PIECEWISE-LINEAR map anchored on the baked beats themselves: each beat's
// authored time is pinned to the REAL moment its word is spoken (scene srt_json), so the
// element enters exactly when the narration reaches it — per-word sync, not per-scene.
//
// Output contract (consumed by the harness + FX prelude): an array of [authoredT, realT]
// control points, strictly increasing on BOTH axes, spanning [0,0] → [plannedDur, realDur].
// null = no usable anchors → callers fall back to the single-ratio scale.
import { fold } from '../hyperframe/beats.js';

const LEAD = 0.12; // element lands slightly before the word is fully spoken (mirror beats.js)
// Per-segment authored-per-real slope limits: an anchor that would locally slow the
// choreography below 0.6× or rush it above 1.8× is dropped — a mis-matched word must
// degrade to the neighbors' pacing, never to visibly rushed/sluggish motion (tightened
// from [0.4, 2.5] after the owner flagged fast-feeling playback: sync may bend pacing,
// never break it).
const SLOPE_MIN = 0.6;
const SLOPE_MAX = 1.8;

function flatWords(srtJson) {
  const out = [];
  for (const cue of Array.isArray(srtJson) ? srtJson : []) {
    for (const w of cue.words || []) {
      const word = fold(String(w.word || '')).replace(/[^\p{L}\p{N}%]/gu, '');
      if (word) out.push({ start: +w.start || 0, word });
    }
  }
  return out;
}

/**
 * Build the beat-anchored control points.
 * beats: props.beats [{t0, t1, text, kind}] in AUTHORED (planned) seconds.
 * srtJson: the scene's REAL word timeline (post-TTS).
 * Returns [[authored, real], ...] including the [0,0] and [planned, real] endpoints,
 * or null when fewer than one interior anchor survives (caller keeps the plain ratio).
 */
export function beatWarpMap(beats, plannedDur, realDur, srtJson) {
  const p = +plannedDur, r = +realDur;
  if (!Number.isFinite(p) || !Number.isFinite(r) || p <= 0 || r <= 0) return null;
  const words = flatWords(srtJson);
  if (!words.length || !Array.isArray(beats) || !beats.length) return null;

  // Sequential matcher: beats are authored in narration order, so each beat's label is
  // searched FORWARD from the previous match — duplicates of a word anchor to their own
  // occurrence instead of all snapping to the first one.
  const anchors = [];
  let cursor = 0;
  for (const b of [...beats].sort((a, c) => (+a.t0 || 0) - (+c.t0 || 0))) {
    const label = fold(String(b.text || '')).replace(/[^\p{L}\p{N}%\s]/gu, '').trim();
    if (!label) continue; // phrase-fallback beats carry no text — nothing to pin
    const parts = label.split(/\s+/);
    for (let i = cursor; i <= words.length - parts.length; i++) {
      let ok = true;
      for (let j = 0; j < parts.length; j++) if (words[i + j].word !== parts[j]) { ok = false; break; }
      if (!ok) continue;
      anchors.push([Math.max(0.05, +b.t0 || 0), Math.max(0.05, words[i].start - LEAD)]);
      cursor = i + parts.length;
      break;
    }
  }
  if (!anchors.length) return null;

  // Assemble with endpoints, then enforce strict monotonicity + slope sanity greedily:
  // a candidate that steps backwards on either axis (align hiccup) or bends the local
  // pacing outside [SLOPE_MIN, SLOPE_MAX] is dropped.
  const pts = [[0, 0]];
  const withEnd = [...anchors, [p, r]];
  for (const [a, t] of withEnd) {
    const [pa, pr] = pts[pts.length - 1];
    if (a <= pa + 0.05 || t <= pr + 0.05) continue;
    const slope = (a - pa) / (t - pr); // authored seconds per real second
    if (slope < SLOPE_MIN || slope > SLOPE_MAX) continue;
    pts.push([+a.toFixed(3), +t.toFixed(3)]);
  }
  // the endpoint must survive — if the last kept anchor made it unreachable, rebuild
  // without the offender(s) by trimming from the tail until the closing segment is sane
  while (pts.length > 1) {
    const [la, lr] = pts[pts.length - 1];
    if (la === +p.toFixed(3) && lr === +r.toFixed(3)) break;
    const slope = (p - la) / (r - lr);
    if (r > lr + 0.05 && p > la + 0.05 && slope >= SLOPE_MIN && slope <= SLOPE_MAX) {
      pts.push([+p.toFixed(3), +r.toFixed(3)]);
      break;
    }
    pts.pop();
  }
  if (pts.length < 3) return null; // endpoints only → no interior anchor → plain ratio is equal
  return pts;
}

/** Pure mirror of the in-page interpolator (tests + server-side previews). Real t → authored. */
export function warpTime(t, pts) {
  if (!Array.isArray(pts) || pts.length < 2) return t;
  if (t <= pts[0][1]) return pts[0][0];
  for (let i = 1; i < pts.length; i++) {
    const [a1, r1] = pts[i];
    if (t <= r1) {
      const [a0, r0] = pts[i - 1];
      return a0 + ((t - r0) / (r1 - r0)) * (a1 - a0);
    }
  }
  return pts[pts.length - 1][0]; // past the end: hold the authored endpoint
}

/** Pure local slope (authored seconds per real second) at real time t — mirrors __slopeAt.
 *  A value >1 means the choreography is COMPRESSED there (playing faster than authored). */
export function slopeAt(t, pts) {
  if (!Array.isArray(pts) || pts.length < 2) return 1;
  for (let i = 1; i < pts.length; i++) {
    if (t <= pts[i][1] || i === pts.length - 1) {
      const dr = pts[i][1] - pts[i - 1][1];
      return dr > 0 ? (pts[i][0] - pts[i - 1][0]) / dr : 1;
    }
  }
  return 1;
}
