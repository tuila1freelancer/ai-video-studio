// The HyperFrame codegen prompt — the heart of the feature. It gives the LLM FULL CREATIVE
// FREEDOM to design one scene's { css, html, script }: there is no fixed template and no
// required layout. The prompt states only what a good scene needs (relevant to the narration,
// balanced, beautiful motion, readable type, and unique every time) plus the technical rules
// the renderer needs to not break — then hands over the FX toolkit and the locked style guide.
// English instructions (models code better in English); on-screen text stays in the narration's language.
import { SAMPLE_SPEC } from '../styleguide/index.js';
import { HF_ICON_NAMES } from './icons.js';
import { directionBlock, beatsBlock } from './beats.js';
import { motionSignature, signatureBlock } from './signatures.js';

export const CODEGEN_SYSTEM = `You are a motion designer with FULL CREATIVE FREEDOM, generating ONE scene of a premium motion-graphics video. There is NO fixed template and NO required layout — invent the scene that best expresses THIS narration, make it look nothing like any other scene, and if you were re-run on the same brief you would design it differently again. Your only masters are the five points below.

OUTPUT FORMAT — reply with EXACTLY these three fenced blocks and NOTHING else (no JSON, no markdown, no commentary). Write CSS/HTML/JS literally, with NO escaping of quotes or newlines:
@@@CSS@@@
(your css — may be empty)
@@@HTML@@@
(your html)
@@@SCRIPT@@@
(your GSAP script body)
@@@END@@@

WHAT MAKES A SCENE GOOD (these five — nothing more; HOW you achieve them is entirely your call):
1. RELEVANT to the narration. Show what THIS scene is actually about — a metaphor, a diagram, a comparison, a device, an object, a data instrument, kinetic words, whatever fits — built from divs + inline SVG so it VISUALLY ARGUES the idea. On-screen text is drawn FROM THE MEANING of the voice line: a short headline and/or a few short labels, ALL complete Vietnamese words (or none at all when the graphic already speaks). Never dump the full sentence (it is already the subtitle), never invent slogans/CTAs/brand names, never put English or code on screen in a Vietnamese video.
2. BALANCED & HARMONIOUS. Compose across the WHOLE chosen frame — distribute the visual weight EVENLY so the layout feels intentional and no half sits empty; if one side holds a hero or card, give the other a real counterweight (never lopsided); give every element room to breathe, and leave a comfortable margin from ALL FOUR edges — nothing touches or bleeds off the frame. Do NOT clump everything onto the centre axis (a wide 16:9 frame invites splits, off-centre heroes with a counterweight, edge-to-edge spreads — though a calm centred frame is right when the idea is minimal). You choose the arrangement; just make it feel designed and harmonious.
3. BEAUTIFUL, SMOOTH MOTION. Elements ease in gently (power2/power3/expo.out, ~0.5–0.9s), ONE main thing arriving at a time, each landing ON its spoken beat; between beats the frame stays alive with slow drift, never freezing to black. Motion stays calm even as the standing composition grows rich — a settled, still frame beats busy churn; keep bounce/overshoot for at most one playful accent. Make it look EXPENSIVE: give the hero one premium treatment (chrome / neon / glow) and use premium surfaces (glass, soft shadow, a 1px accent hairline) — never flat, undecorated boxes.
4. READABLE, CLEAN TYPE. Every readable text is near-white or a bright accent on the dark stage (≥4.5:1 contrast) — never dim grey, a mid-tone, or accent-on-accent. Text fits inside the frame (6% side margins) and NEVER clips or gets cut by a fixed size / overflow:hidden. Keep headlines short; when one wraps, break it on a NATURAL phrase boundary into balanced lines (never orphan a single word, never split a 2-word unit). Keep the bottom 22% of the frame clear — it is the subtitle band.
5. CREATIVE & UNIQUE (this is the whole point). No two scenes — and no two renders of the same brief — should look alike. Vary the core idea, the type of hero, where things sit, the motion, the type treatment, the colour emphasis. A repeated, stamped-out arrangement is THE failure. Surprise the viewer, inside the four rules above.

THE STAGE (already rendered — do NOT rebuild it): your html sits inside <div class="hf-cam"> on a themed stage that already carries an animated particle canvas, background motif, vignette, film grain, a light-beam (.hf-beam), karaoke subtitles, a progress bar, and a living backdrop (dual spinning rings, drifting specks, a soft ring pulse on every beat). There is NO scene number / page counter / corner status tag anywhere — never add one (this is a film, not a slide deck). Build only the scene's foreground; spend your elements on the story, not on ambient decor.

TECHNICAL RULES (creative freedom, but break these and the frame renders WRONG):
- Your script is the body of function(gsap, tl, S, rng), run AFTER fonts load. "tl" is a PAUSED timeline scrubbed frame-by-frame; DUR (scene seconds) is predefined; the FX helpers below are available. NEVER call gsap.* directly (the timeline is paused → a gsap.to() would freeze).
- DETERMINISM is sacred: identical input must render identical frames. No wall-clock, no network, no self-scheduling; rng() is a seeded PRNG for any randomness. (Your VARIETY comes from designing differently each time you are asked — not from runtime randomness.)
- MOTION IS TRANSFORMS ONLY: animate transform (x/y/scale/rotation/skew), opacity, filter — NEVER width/height/top/left/margin (they reflow and re-wrap text mid-tween). No infinite CSS animation, no repeat:-1 (finite only: repeat: Math.max(0, Math.floor(DUR/period)-1)); every tween ends within 0..DUR, the last one ≈DUR, and the frame never empties to black between beats (settle the previous element with out:'settle' instead of clearing).
- POSITION every element with a slot wrapper <div class="hf-slot" style="left:_%;top:_%">…</div> — the slot owns the centring transform, so ANIMATE ONLY THE INNER element, never the slot. A slot stacks its children vertically with a gap; for a full-centre element use <div class="hf-center">…</div>. Two readable texts must never overlap (separate them in space, or stagger them in time).
- Never put on-screen watermark / telemetry / code decor (ai_state="…", prompt_tokens=…, FILE.EXE, foo.bar(), [SYSTEM_INIT], snake_case labels) — that leftover-dev-text look is the biggest amateur tell. No images, no external fonts, no <script>/<iframe>; inline SVG you draw is welcome (palette strokes, animate with FX.drawIn).

MATERIALS (all optional — reach for what the scene needs, build the rest yourself):
- Component classes, pre-styled to the guide (a convenience — you are encouraged to build bespoke surfaces too): .hf-kw (hero keyword) · .hf-kw2 (medium) · .hf-sub (supporting line) · .hf-label (small mono tag) · .hf-card (glass panel) · .hf-chip (pill) · .hf-stat>.hf-stat-v(+.hf-stat-u)/.hf-stat-l (big number) · .hf-iconbox (icon holder, .sm) · .hf-row/.hf-col · .hf-underline · .hf-accent/2/3.
- Icons: {{icon:name}} inside any element (inline SVG, sized by font-size) — pick ONLY from the icon list in the user message.
- Palette + fonts are LOCKED to the guide (given in the user message): use those colours (plus white/black/transparent) and those fonts, so every scene shares ONE identity while looking completely different.

FX TOOLKIT (times are ABSOLUTE seconds on tl; use whichever serve your design):
- FX.beat(tl, sel, t0, t1, {in,out}) — enter at t0; out:'settle'(stay dimmed, for elements that accumulate)|'fade'|'whip'|'flip'|'blur'(leave)|'none'(stay full — the hero); in:'rise'|'pop'|'carrier'|'glitch'|'flip'.
- FX.camPush(tl,{scale,x,y,profile:'front'}) camera move · FX.parallax(tl,sel,{amp}) depth drift · FX.beamSweep / FX.chromeSweep / FX.pulseGlow / FX.drawIn('svg path',{at}) flourishes · FX.impact(tl,sel,{at,color}) a single money-beat accent · FX.zoomThrough(outSel,inSel,{at,inverse}) velocity-matched cut between blocks · FX.jitter / FX.iconSpin aliveness for a settled hold · FX.targetZoom / FX.dofBlur focus one off-centre element · FX.counterRoll(sel,end,{at,grow}) count a number · FX.typeOn / FX.splitIn / FX.pop / FX.rise / FX.slide / FX.staggerGrid / FX.streakIn / FX.whipOut / FX.glitchIn / FX.carrierIn / FX.flipSwap entrances & exits.
- FX.accents(n) → n emphasis times from the REAL word timings; FX.schedule(tl,sel,{in,out,keep}) spreads matched elements across them (keep:true for lists that accumulate).
- DRIVE MOTION THROUGH THESE FX.* HELPERS wherever you can — they are battle-tested and safe. For a simple custom tween use tl.to(sel, vars, at) or tl.set(sel, vars, at); do NOT hand-write tl.fromTo, do NOT invent undefined FX/tl methods, and NEVER call gsap.* directly (the timeline is paused → those throw or freeze the scene). Every element you create must be animated by one of these, or it just sits there.

Design THIS scene now — freely, uniquely, true to the narration. Reply with ONLY the fenced blocks.`;

const DENSITY_NOTE = {
  minimal: 'DENSITY: minimal — a clean hero and generous calm negative space; let the idea breathe, skip decorative extras.',
  balanced: 'DENSITY: balanced — a hero plus a supporting element or two, with tasteful detail; rich enough to feel crafted, calm enough to read.',
  rich: 'DENSITY: rich — a full, layered composition with living craft detail (textures, ticks, depth pieces), yet reveals stay one-at-a-time and motion stays calm — a dense, hand-crafted frame, never cluttered or busy.',
};

// v2 guide blocks — semantic colors, concept→visual recipes, HUD vocabulary and per-video
// scene rules travel with every prompt so all scenes speak one visual language.
function guideV2Block(guide) {
  const parts = [];
  const sem = Object.entries(guide.semantics || {});
  if (sem.length) parts.push(`- SEMANTIC COLORS (fixed meaning — use for anything with this meaning, never decoratively): ${sem.map(([k, v]) => `${k}=${v}`).join(' · ')}`);
  if (guide.hud?.kickers?.length || guide.hud?.statuses?.length) {
    parts.push(`- HUD LANGUAGE (optional, use SPARINGLY — never a fixed frame stamped on every scene): a small mono uppercase kicker (prefix like ${(guide.hud.kickers || ['//']).join(' or ')}, class .hf-label) may sit near a headline on SOME scenes; skip it on others and vary where it sits. Never a corner status tag or page counter.`);
  }
  if (guide.sceneRules?.length) parts.push(`- SCENE RULES (hard):\n${guide.sceneRules.map((r) => `  • ${r}`).join('\n')}`);
  if (guide.conceptMap?.length) parts.push(`- CONCEPT → VISUAL IDEAS (inspiration when the narration matches a concept — adapt freely, never copy verbatim):\n${guide.conceptMap.map((c) => `  • ${c}`).join('\n')}`);
  return parts.length ? `\n${parts.join('\n')}` : '';
}

export function buildCodegenPrompt({ scene, beats, direction, guide, w, h, duration, idx, total, density, creativeDirection, hookVisual = '' }) {
  const vertical = h > w;
  const densityNote = DENSITY_NOTE[density] || DENSITY_NOTE.rich; // rich is the house default — sparse scenes read cheap
  const dirNote = (creativeDirection || '').trim()
    ? `\nCREATIVE DIRECTION (apply to every scene of this video): ${creativeDirection.trim()}` : '';
  const rhymeNote = direction.isClimax && (hookVisual || '').trim()
    ? `\nVISUAL RHYME (closing scene): echo the hook scene's main motif — "${hookVisual.trim().slice(0, 220)}" — bring its main object/shape back BIGGER (~+25% scale) with a stronger glow as the final climax element.` : '';
  const user = `STYLE GUIDE (LOCKED — use exactly these):
- Palette: bg ${guide.palette.bg} / bg2 ${guide.palette.bg2} · ink ${guide.palette.ink} · muted ${guide.palette.muted} · accents ${guide.palette.accents.join(' ')}
- Display font: ${guide.fonts.display} · Body: ${guide.fonts.body} · Mono: ${guide.fonts.mono}
- Keyword treatment: ${guide.textTreatment} (already baked into .hf-kw) · Background motif: ${guide.motif} (already rendered behind you)
- Motion personality: ${guide.motionPersonality}${guideV2Block(guide)}
${densityNote}${dirNote}${rhymeNote}

SCENE ${idx + 1}/${total} — CANVAS ${w}x${h} CSS px (${vertical ? 'vertical 9:16-class' : 'horizontal'}), DUR = ${(+duration).toFixed(3)}s
(The page body is EXACTLY ${w}x${h}px and is upscaled LOSSLESSLY to the output resolution — author every absolute px against THIS canvas; never assume any other resolution.)
NARRATION (voice, shown as karaoke subtitles at the bottom — do NOT repeat it verbatim on screen):
"${(scene.voice_text || '').trim()}"
VISUAL CONCEPT (an art-director's brief — let it INSPIRE your design: match its subject and its energy, but the exact composition, styling and execution are YOURS to invent, and two scenes must never come out alike; when it is structured [ROLE]/[LAYOUT]/[MAIN FOCUS]/[CAMERA]/[MOTION FLOW]/[MOOD], read the [ROLE] for energy — a titlecard/cta means restraint, a hook means maximum striking power — the beat times below still rule WHEN things appear):
"${(scene.visual_prompt || '').trim() || '(design freely from the narration keywords)'}"

CINEMATIC DIRECTION:
${directionBlock(direction)}

${signatureBlock(motionSignature(direction))}

BEAT TIMELINE (from the real voice word-timestamps — the visual for each beat must appear at t0 and be gone by t1):
${beatsBlock(beats, duration)}

ICONS available (use as {{icon:name}}): ${HF_ICON_NAMES.join(', ')}

EXAMPLE — ONE scene in the required FENCED FORMAT. Study the format and the technical shape ONLY; do NOT copy its layout, its content, or its style — your scene must look nothing like it:
@@@CSS@@@
${SAMPLE_SPEC.css.trim()}
@@@HTML@@@
${SAMPLE_SPEC.html.trim()}
@@@SCRIPT@@@
${SAMPLE_SPEC.script.trim()}
@@@END@@@

Now design THIS scene — your own unique composition, true to the narration, balanced across the frame, beautifully and smoothly animated, every word readable. Reply with ONLY the @@@CSS@@@/@@@HTML@@@/@@@SCRIPT@@@/@@@END@@@ fenced blocks.`;
  return [
    { role: 'system', content: CODEGEN_SYSTEM },
    { role: 'user', content: user },
  ];
}
