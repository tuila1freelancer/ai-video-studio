// Transition planning: which boundary flows how (the motion doctrine, P43's pickable styles).
// ---- Transition planning (motion doctrine: every boundary FLOWS — a short dip through black is
// the default hand-off, while one HERO transition still punches above it) ----
// Returns one entry per clip boundary: { type: 'cut'|'fade'|'fadeblack'|'zoomin', dur }.
// Role-driven when the art director stamped [ROLE] briefs (P4): the transition INTO a payoff
// scene is a zoom-through ('zoomin'); every other boundary dips, a touch longer at the structural
// ones (intro, chapter-break, cta, outro) than at an ordinary hand-off, so the shape of the video
// is still legible. Videos with no roles anywhere keep a single uniform dip. See planTransitions
// for why a dip and not a dissolve — it was measured on real adjacent clips, not chosen by taste.
const ROLE_RE = /\[ROLE\]\s*(\w+)/i;
// User-pickable transition styles (P43). 'auto' keeps the storytelling doctrine below — the
// default, and still the best answer — but the owner can now name one look for the whole video
// the way the reference app lets him, or 'varied' to rotate deterministically. Every value is a
// real ffmpeg xfade transition, verified against the vendored build.
/**
 * Ceiling on the xfade graph, in clips.
 *
 * It used to be 24, on the reasoning that "deep xfade chains keep every input decoder open →
 * unstable for very long videos". Measured on this machine with 192 real clips (801s of 1080×1920)
 * the full coupled xfade+acrossfade graph runs in 77s at a 2.6 GB peak and exits clean — there is
 * no instability to protect against. What the cap did instead was silently disable transitions on
 * every long-form video this app makes: 29 of 39 finished projects are over 24 clips, so the plan
 * was computed, fingerprinted and charged for, and then never rendered.
 *
 * This is now a backstop far above any real video rather than a working limit, and it lives here
 * alone — the copies that had drifted into the SFX offsets, the QC duration and the SRT export are
 * gone, each replaced by planOffsets, which is right whether or not the graph runs.
 */
export const MAX_GRAPH_CLIPS = 400;

export const TRANSITION_STYLES = ['auto', 'fade', 'dissolve', 'slideleft', 'circlecrop', 'circleopen', 'smoothleft', 'zoomin', 'pixelize', 'radial', 'wipeleft', 'varied', 'none'];
const VARIED_CYCLE = ['fade', 'dissolve', 'slideleft', 'circleopen', 'smoothleft', 'zoomin'];

/**
 * The scene-boundary doctrine.
 *
 * The default hand-off is a short DIP THROUGH BLACK rather than a cross-dissolve, and that is a
 * measured choice, not a taste. Rendering real adjacent clips and sampling across the blend:
 *
 *   fade @ 0.2   indistinguishable from a hard cut — both sides share the same radial-gradient
 *                stage (harness.js), so the only thing dissolving is text
 *   fade @ 0.6   WORSE. The clip ends on a held climax (the codegen prompt requires it: "the scene
 *                must END full, not fade to nothing") and the next one is already 0.35–0.5s into
 *                its entrances, so the midpoint is two headlines superimposed — the exact "text on
 *                top of text" the prompt calls an instant fail. Longer is not smoother here.
 *   fadeblack    the only clean middle, because black is a state neither side owns.
 *
 * 0.45 is the ceiling, also measured. Leading silence in a clip is 0.19–0.20s and programCues puts
 * the incoming scene's first cue at `starts[i+1]`, i.e. 0.19s into the window; past 0.45 the dark
 * point drifts under that cue and the video shows a bright caption floating on black.
 *
 * The real cure for a muddy dissolve is upstream — content leaving the frame before the cut, which
 * is what the hand-off ramp does for newly rendered clips. This is what is available to a video
 * that can only be re-joined.
 */
export function planTransitions({ scenes, clipCount, nIntro = 0, nOutro = 0, legacyDur = 0.4, softDur = 0.35, style = 'auto' }) {
  const n = Math.max(0, clipCount - 1);
  // An explicit style overrides the role doctrine entirely: the owner asked for ONE look.
  if (style && style !== 'auto') {
    if (style === 'none') return Array.from({ length: n }, () => ({ type: 'cut', dur: 0 }));
    if (style === 'varied') {
      // deterministic rotation — the same video always cuts the same way
      return Array.from({ length: n }, (_, b) => ({ type: VARIED_CYCLE[b % VARIED_CYCLE.length], dur: 0.4 }));
    }
    if (TRANSITION_STYLES.includes(style)) return Array.from({ length: n }, () => ({ type: style, dur: 0.4 }));
  }
  const roles = scenes.map((s) => (ROLE_RE.exec(s.visual_prompt || '')?.[1] || '').toLowerCase());
  const anyRole = roles.some(Boolean);
  const plan = [];
  let zoomLeft = 1; // at most ONE zoom-through hero transition per video
  for (let b = 0; b < n; b++) {
    const inClip = b + 1; // boundary b sits between clips b and b+1
    const sceneIdx = inClip - nIntro; // index into `scenes` of the INCOMING clip
    if (!anyRole) { plan.push({ type: 'fadeblack', dur: legacyDur }); continue; }
    if (inClip >= nIntro + scenes.length) { plan.push({ type: 'fadeblack', dur: 0.45 }); continue; } // into the outro card
    if (sceneIdx < 0) { plan.push({ type: 'fadeblack', dur: 0.45 }); continue; } // out of the intro card
    const sc = scenes[sceneIdx];
    if (sc?.template === 'chapter-break') { plan.push({ type: 'fadeblack', dur: 0.45 }); continue; }
    const role = roles[sceneIdx];
    if (role === 'payoff' && zoomLeft > 0) { zoomLeft--; plan.push({ type: 'zoomin', dur: 0.45 }); continue; }
    if (role === 'cta') { plan.push({ type: 'fadeblack', dur: 0.45 }); continue; }
    plan.push({ type: 'fadeblack', dur: softDur }); // clean hand-off — the hero zoom above still punches
  }
  return plan;
}
export function transitionLoss(plan, uptoBoundary = Infinity) {
  return (plan || []).slice(0, uptoBoundary).reduce((a, t) => a + (t.type === 'cut' ? 0 : t.dur), 0);
}

// Final assembly (B7): concat scene clips, mix BGM, overlay logo, make thumbnail.
// `transitions` is either a plan array from planTransitions (selective, doctrine mode) or
// boolean true (legacy uniform fade at every boundary).
