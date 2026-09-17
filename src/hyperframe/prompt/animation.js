// The animation spec and timeline skeleton (P37/P39) in the tl.*/FX.* vocabulary, and the creative-libraries block (P40).
import { advertisedLibs } from '../../animation/libs.js';

// P37/P39 (reference-parity): the reference app hands the model EXACT GSAP values (its
// {{ANIMATION_SPEC}} + {{TIMELINE_SKELETON}} blocks), not just doctrine — that concreteness is
// most of why its scenes land cleaner. We emit the same, in the `tl.*`/`FX.*` vocabulary (raw
// GSAP timeline authoring — standalone `gsap.to` still freezes, so motion goes on tl), derived
// from the scene's cinematic direction + motion signature + the real beat table.
const CAMERA_MOVE = {
  push_in: "{ scale: 1.06, profile: 'front' }",
  aggressive_zoom: "{ scale: 1.10, profile: 'front' }",
  dramatic_pan: '{ x: -24, y: 8 }',
  slow_pan: "{ x: -16, profile: 'front' }",
  subtle_zoom: "{ scale: 1.04, profile: 'front' }",
};
function easeFor(energy) {
  return energy === 'high' ? 'expo.out' : energy === 'dramatic' ? 'power3.out' : energy === 'low' ? 'sine.inOut' : 'power2.out';
}
export function animationSpecBlock(direction, sig, beats, duration) {
  const cam = CAMERA_MOVE[direction.camera] || CAMERA_MOVE.subtle_zoom;
  const ease = easeFor(direction.energy);
  const enterIn = direction.energy === 'high' ? 'carrier' : 'rise';
  const pulseDur = 1.6;
  const beamAt = Math.min(+duration * 0.4, 2.6).toFixed(2);
  return `ANIMATION SPEC — use THESE exact values when you author the GSAP (put motion on tl / FX.*; a bare gsap.to() freezes):
▶ CAMERA (once, at 0): FX.camPush(tl, ${cam}) — the simulated camera completes its move in the FIRST half, then holds (no back-half drift).
▶ MOTION per element (feel: ${sig.name} — ${sig.ease}):
  • ENTRY on the beat: FX.beat(tl, '<sel>', <t0>, <t1>, { 'in': '${enterIn}', out: 'settle' }) — arrival 0.35–0.5s, ease ${ease}; rotate the 'in' across the entrance library (never the same twice in a row).
  • IDLE between beats: FX.parallax(tl, '.hf-mid > *', { amp: 13 }) for the depth layer + FX.jitter(tl, '<settled-el>', { amp: 2 }) so a held element still breathes (never static > 0.5s).
  • PULSE for emphasis: FX.pulseGlow(tl, '<hero>', { at: <t>, dur: ${pulseDur}, repeat: Math.max(1, Math.ceil(DUR / ${pulseDur}) - 1) }) — finite repeats only.
  • EXIT: FX.beat's out — 'settle' keeps a dimmed element in the accumulating build; 'whip'/'flip'/'blur' clears a flash beat before the next enters.
▶ FX: FX.beamSweep(tl, '.hf-beam', { at: ${beamAt} }) once every ~5–7s to keep quiet stretches alive; FX.impact(tl, '<climax-el>', { at: <≈DUR-0.5> }) on the final beat. The grain / scanlines / vignette / progress bar are HARNESS-OWNED — do NOT author them.`;
}
export function timelineSkeletonBlock(beats, direction, duration) {
  const dur = +(+duration).toFixed(2);
  const bs = Array.isArray(beats) ? beats : [];
  const lines = ['// t=0.00s — the frame is NEARLY EMPTY: ambient + at most a kicker; content enters PER BEAT below.'];
  bs.forEach((b, i) => {
    const out = i === bs.length - 1 ? 'none' : 'settle';
    lines.push(`// t=${(+b.t0).toFixed(2)}s → ${(+b.t1).toFixed(2)}s | "${b.text}" — FX.beat(tl, '<sel>', ${(+b.t0).toFixed(2)}, ${(+b.t1).toFixed(2)}, { 'in': '…', out: '${out}' });`);
  });
  const climaxT = Math.max(0, dur - 0.5).toFixed(2);
  lines.push(`// t≈${climaxT}s — CLIMAX: the final element lands biggest (scale +15–25% over the earlier type)${direction.isClimax ? ', echo the hook motif,' : ''} FX.impact on it, then HOLD to DUR=${dur}s with a soft afterglow — the scene must END full, not fade to nothing.`);
  return `TIMELINE SKELETON — fill in THIS timeline (one entrance per beat, at the beat's real time; pick each element's 'in' from the entrance library):
${lines.join('\n')}`;
}

/**
 * CREATIVE LIBRARIES (P40) — reference-app parity. The reference lets its model pull in up to 4
 * CDN libraries (three.js, p5.js, …) and rewrites them to a local cache. We vendor the same set
 * and inject only what a scene references, but the renderer scrubs a PAUSED timeline, so a
 * library that draws on its own rAF clock would jitter. The block therefore teaches the ONE
 * pattern that keeps such a layer deterministic: redraw from window.__onSeek(t).
 * Returns '' when nothing is vendored, so a machine without vendor/libs never sees the offer.
 */
export function creativeLibsBlock(available = advertisedLibs()) {
  const has = (id) => available.includes(id);
  if (!available.length) return '';
  const lines = [];
  if (has('three')) {
    lines.push('- three.js (global THREE) — real 3D: a slowly rotating wireframe globe//grid/particle field behind the type, a refracting shape, a depth tunnel. Create <canvas> in your html, `new THREE.WebGLRenderer({canvas:document.getElementById(\'yourCanvas\'),alpha:true,antialias:true})`, build the scene ONCE, then redraw per frame from the hook.');
  }
  if (has('p5')) {
    lines.push('- p5.js (global p5) — generative 2D canvas art: flow fields, noise waves, particle constellations. INSTANCE MODE only, with s.noLoop() in setup and s.redraw() from the hook (never the global p5 or a draw loop).');
  }
  return `\nCREATIVE LIBRARIES (already loaded when you reference them — OPTIONAL, only reach for one when it genuinely lifts the scene; text-first scenes need none):
${lines.join('\n')}
- THE DETERMINISM RULE for any of them: the renderer SCRUBS a paused timeline, so nothing ticks by itself. Register a redraw hook ONCE and make the drawing a pure function of t:
    window.__onSeek(function(t){ /* t = scene seconds */ mesh.rotation.y = t * 0.35; renderer.render(scene, camera); });
  Do NOT call requestAnimationFrame, do NOT start an animation loop — a library layer without a hook renders frame 0 and then freezes.
- Keep the library layer BEHIND the type (z-index below your slots, opacity ≤0.65) — it is atmosphere, never the message. Your typography, beats and GSAP timeline still carry the scene.`;
}
