# HyperFrames (heygen-com/hyperframes) — distilled adoption notes

Source: https://github.com/heygen-com/hyperframes (Apache License 2.0).
These notes distill the formulas and doctrine we port into this app. Where code is adapted
from the upstream repo, this file is the attribution record required by the license.
Upstream paths cited below refer to that repo, not this one.

## Why it maps onto us

HyperFrames renders video the same way our renderer does: a paused, seekable GSAP timeline,
deterministic frame = f(time), captured by headless Chrome and muxed by FFmpeg. Their 4K path
supersamples via devicePixelRatio — equivalent to our logical-canvas + body-zoom architecture.
We adopt their *craft knowledge* (rules, doctrine, checks), never their engine.

## Motion doctrine (skills/faceless-explainer/references/motion-language.md)

Four load-bearing rules — "the difference between a serious explainer and an agent-made
PowerPoint":

1. **Smooth beats bouncy.** Long-tail decel eases (`power3.out`, `expo.out` on fast arrivals)
   are the default. Bounce/overshoot (`back.out`, `elastic`, `bounce`) is the #1 instant
   turn-off in agent-made videos; it is a rare, explicitly playful exception — never the
   house style.
2. **Sequential reveal in the back ~50%, timed to the voiceover.** Never dump content in the
   first ~25% of a scene. Each piece (a line, a card, even the headline) arrives when the
   narration mentions it. Fewer things, each on its spoken cue, beat a full canvas that
   animated once and froze.
3. **No lazy breathing, no bad pan/push.** Scaling elements up/down in a loop to look "alive"
   is the cheap tell; a slow pan/push in the back half of a scene disrupts the viewer's
   sightline. "I'd rather have NO motion than BAD motion." Sanctioned aliveness during a
   hold: a subtle low-amplitude jitter, or live SVG internals (rotating hands, pulsing dots,
   dash-flow) — the subject doing something, not a card breathing.
4. **Internal seams are velocity-matched cuts.** Cut at peak velocity, matching direction and
   speed on both sides (see cut catalog below).

## Cut catalog (skills/faceless-explainer/references/cut-catalog.md)

Velocity-matched cut recipes. Common physics: you never see both contents at once — blur and
opacity peak exactly at the swap frame; blur goes on the WRAPPER, never children; both sides
use the SAME peak blur. Peak blur scales with subject size: **10px for text-scale**, 18–20px
for full-frame surfaces (heavier blur on text smears it into a glitch).

- **Zoom-through (forward)** — Z-axis swap "progressing through": exit scales 1.0→1.2 with
  blur 0→10px over ~0.2s (`power3.in` on scale/blur, LINEAR on opacity 1→0.15); the incoming
  content continues scaling up from behind, decelerating (`power3.out`) into the focal plane.
- **Inverse zoom-through** — same, moving away from the viewer; reads as "arriving at" — use
  for payoff beats.
- **Cut-the-curve** — scene-to-scene cut on x/y where both sides move the same direction at
  matched velocity.
- **Waterfall** — cut-the-curve at word granularity (staggered exits/entries).

Choosing: unfinished phrase building one idea → cut-the-curve/waterfall; state change (new
part of the video) → zoom-through; arrival/payoff → inverse zoom-through.

## Beat direction (skills/hyperframes-creative/references/beat-direction.md)

- "Each beat is a WORLD, not a layout." Direct the experience, then derive the pixels.
- **Every element gets a motion VERB** — SLAMS / CRASHES / STAMPS (impact), SLIDES / WIPES
  (directional), DRAWS / FILLS / GROWS / ASSEMBLES / COUNTS UP (builds), FLOATS / DRIFTS /
  ORBITS (organic), TYPES ON / CLICKS / LOCKS IN / SNAPS (mechanical). "If you can't name
  the verb, the element is not yet designed."
- Transitions: 1–2 hero transitions per video (the reveal + the CTA); more flattens their
  impact. Connective tissue gets a plain crossfade or a hard cut.

## Blueprints (skills/hyperframes-animation/blueprints-index.md)

15 time-coded shot templates, each tied to narrative ROLES (Hook, Problem, Product_Intro,
Key_Feature, Benefits, Social_Proof, CTA, Brand_Outro). The ones we adopt as layouts:

- `kinetic-type-beats` — the words ARE the motion (token swaps / statement builds); the
  workhorse (6 roles).
- `ticker-takeover` — typed lead-in + cycling accent word, then the hero crashes in and
  physically shoves the text aside (hook/outro).
- `overwhelm-surround` — overwhelm by accumulation; elements close in from all sides
  (problem/pain scenes).
- `spatial-pan-stations` — labeled stations on one oversized canvas traversed by a single
  virtual camera (timelines, processes, long videos).
- `titlecard-reveal` — the calm breather: ONE restrained move, then a still hold. "Low motion
  is the payload, not a deficiency."

## Determinism rules worth restating in our codegen prompt

(skills/hyperframes-core/references/determinism-rules.md — "silent bugs lint won't catch")

- Transformed elements must be block-level AND sized — `scaleX/scaleY` on an inline or
  auto-width element renders nothing (invisible bars/fills).
- Finite repeats use `floor`, not `ceil`: `repeat: max(0, floor(dur/cycle) - 1)`.
- Absolutely-positioned decoratives that pulse/overshoot need clearance at their PEAK size.
- No `<br>` in body text (double-wraps against real font metrics); wrap via max-width.
- Pre-compute layout constants at setup; never `getBoundingClientRect()` at tween time (the
  renderer samples in parallel).
- No render-time clocks / unseeded random / network / input state; no `repeat: -1`.

## Static lint rules we port (packages/lint/src/rules/)

Determinism (`non_deterministic_code`, `requestanimationframe_in_composition`), GSAP misuse
(`gsap_infinite_repeat`, `gsap_non_transform_motion`, `gsap_from_opacity_noop`,
`gsap_css_transform_conflict`), duplicate ids (frames are injected by `getElementById` — dupes
render blank), infinite CSS animations (wall-clock, desync from seek).

## Runtime layout audit ideas we port (packages/cli/src/utils/layoutAudit.ts)

- Issue taxonomy: `text_box_overflow`, `clipped_text`, `content_overlap`, `text_occluded`,
  `caption_zone_collision`, `motion_frozen`, `motion_appears_late`, …
- **Persistence tiering**: a geometry finding seen at only ONE sampled time is an
  entrance/exit transient → ignore; held across ≥2 samples (≈≥500ms) → promote to error.
  This is the anti-false-positive mechanism that keeps validation from fighting slow eased
  entrances.

## Text fitting (packages/core/src/text/fitTextFontSize.ts)

Decrement font-size in steps from a base until the text lays out in one line within
maxWidth, with a floor; report `fits: false` below the floor. We implement the DOM-measured
equivalent as a harness guard-rail (shrink until `scrollWidth <= clientWidth`).

## Baseline (recorded 2026-07-14, before adoption phases)

QA sweep (`scripts/hf-qa.mjs` qaSpec) over the 16 real LLM-generated hyperframe scenes of the
two most recent productions ("Ba sai lầm…" 9:16, "Cách viết báo giá…" 16:9 4K):

- scenes: 16 · hard defects: 0 · warnings: 15 (13× CROWDED, 2× OVERSHOOT)
- production stats: 8/9 hyperframe scene rate on the 4K run (1 heuristic fallback), 2 codegen
  attempts consumed by a dead-air false positive before the gap-center rebalance.

Post-phase sweeps should keep defects at 0, reduce CROWDED warnings, and reduce re-ask/
fallback rates on future paid runs.
