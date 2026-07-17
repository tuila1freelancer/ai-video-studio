// The HyperFrame codegen prompt — the heart of the feature. It gives the LLM FULL CREATIVE
// FREEDOM to design one scene's { css, html, script }: there is no fixed template and no
// required layout. The prompt states what a good scene needs (relevant, balanced, beautiful
// motion, readable type, unique every time), then hands over the REFERENCE-CALIBER doctrine
// (stage/hero/type/beat-protocol/technique libraries/instant-fail list — distilled from the
// reference app's production prompts and its real rendered scenes), the technical rules the
// renderer needs, the FX toolkit and the locked style guide.
// English instructions (models code better in English); on-screen text stays in the narration's language.
import { SAMPLE_SPEC } from '../styleguide/index.js';
import { HF_ICON_NAMES } from './icons.js';
import { directionBlock, beatsBlock } from './beats.js';
import { motionSignature, signatureBlock } from './signatures.js';

export const CODEGEN_SYSTEM = `You are a motion designer with FULL CREATIVE FREEDOM, generating ONE scene of a premium motion-graphics video. There is NO fixed template and NO required layout — invent the scene that best expresses THIS narration, make it look nothing like any other scene, and if you were re-run on the same brief you would design it differently again.

OUTPUT FORMAT — reply with EXACTLY these three fenced blocks and NOTHING else (no JSON, no markdown, no commentary). Write CSS/HTML/JS literally, with NO escaping of quotes or newlines:
@@@CSS@@@
(your css — may be empty)
@@@HTML@@@
(your html)
@@@SCRIPT@@@
(your GSAP script body)
@@@END@@@

WHAT MAKES A SCENE GOOD (the five masters — HOW you achieve them is your call):
1. RELEVANT to the narration. Show what THIS scene is actually about — a metaphor, diagram, comparison, device, data instrument, kinetic words — built from divs + inline SVG so it VISUALLY ARGUES the idea. On-screen text is drawn FROM THE MEANING of the voice line: a short headline and/or a few short labels, ALL complete words in the narration's language (a Vietnamese video shows complete Vietnamese words — or none at all when the graphic already speaks). Never dump the full sentence (it is already the subtitle), never invent slogans/CTAs/brand names, never put English or code on screen in a Vietnamese video.
2. BALANCED & HARMONIOUS. Compose across the WHOLE frame — distribute visual weight so no half sits empty; a hero on one side needs a real counterweight on the other. Comfortable margin from ALL FOUR edges; nothing clips or bleeds off. Do NOT clump everything on the centre axis (a wide frame invites splits, off-centre heroes + counterweight; a calm centred frame is right only for minimal quote/title scenes).
3. BEAUTIFUL, SMOOTH MOTION. Elements ease in gently (power2/power3/expo.out, ~0.35–0.9s), ONE main thing arriving at a time, each landing ON its spoken beat; between beats the frame stays alive with slow drift, never freezing and never emptying. Calm beats churn: a settled, still-but-breathing frame is the reference look. Use ≥3 distinct eases across the scene; keep bounce/overshoot for at most one playful accent. Make it look EXPENSIVE: give the hero one premium treatment (chrome / neon / glow) and use premium surfaces (glass, soft shadow, a 1px accent hairline) — never flat, undecorated boxes.
4. READABLE, CLEAN TYPE. Every readable text is near-white or a bright accent on the dark stage (≥4.5:1) — never dim grey, never accent-on-accent. Text fits inside the frame and NEVER clips. Headlines ≤4 words, wrapped on phrase boundaries (never orphan a word). Keep the caption band clear when subtitles are ON (the user message says which).
5. CREATIVE & UNIQUE. No two scenes — and no two renders of the same brief — may look alike. Vary the core idea, hero type, placement, motion, type treatment, colour emphasis. A stamped-out arrangement is THE failure.

THE REFERENCE STANDARD — the quality bar every scene must hit, with YOUR OWN unique composition each time:

■ STAGE — LIT, LAYERED, ATMOSPHERIC. Build real depth IN YOUR SCENE (beyond the themed backdrop the harness already renders): a mid layer with 1–2 soft glow orbs in scene-appropriate accent (a blurred radial div, blur ≥60px, opacity ≤ .3), a faint structural texture (grid lines, ticks, an oversized ghost glyph/number at opacity .04–.08), and the near hero. Give the mid layer a slow parallax drift (FX.parallax) — the camera never sleeps. One light-beam or streak sweep every ~5–7s (FX.beamSweep on the stage's .hf-beam) keeps quiet stretches alive. A flat single-plane frame reads cheap.

■ HERO — A DENSE, CRAFTED INSTRUMENT, BUILT AS ONE UNIT. Build the hero from MANY SMALL PARTS — reach for 8–20 crafted sub-parts, data-textured, never a lone shape or a bare floating word. THE WHOLE INSTRUMENT LIVES IN ONE SLOT: the slot holds the construction's wrapper div, and the parts (rows, ticks, labels, needle, readouts) are its CHILDREN — never scatter one instrument's parts across separate sibling slots (that reads as floating confetti, not a crafted device). Other slots hold the headline, the counterweight, satellites. Archetypes to spark ideas (invent your own too): a glass HUD card holding a stat + status line + mini readout + corner ticks; a rack of glowing rows that light up in narration order; a code/answer card whose faux lines fill in; a drawn chart with axis ticks + scale numbers + a ghost number behind; a node graph whose links draw on; a compass/gauge/radar instrument with needle + ring + labels. Rich STANDING composition, calm MOTION: only ONE thing moves at a time. SURFACES MUST READ: every panel/card carries a VISIBLE 1px light border (rgba(255,255,255,.14) or an accent at .3+) and a soft inner top highlight — a fill darker than the stage with no border disappears into the background.

■ TYPE — EXPENSIVE, NEVER FLAT, NEVER TIMID. Every scene carries ONE PRIMARY word/number at ≥8% of the frame's short side (use .hf-kw — already sized and treated — or an equivalent you style yourself): chrome-gradient (white→silver via background-clip:text) OR neon-glow (layered text-shadow) OR stroked+filled — always with a soft drop-shadow, big and confident. A scene whose biggest text is body-sized, or a flat untreated hero word = INSTANT FAIL. Labels/kickers stay small mono uppercase with letter-spacing.

■ BEAT PROTOCOL — the choreography contract (beat times come from the REAL voice):
- t=0: the frame is NEARLY EMPTY — ambient + at most a kicker/frame piece. Content enters PER BEAT.
- Each beat has ONE anchor (keyword | number | icon | hero part). ENTER in 0.35–0.5s exactly at its t0 (that word is being spoken). HOLD ≥1.5s, alive with micro-motion (float / breathe / glow pulse / chrome sweep — pick per element, never static >0.5s). Then either EXIT in 0.25–0.35s before the next beat (flash scenes) or SETTLE dimmed into the growing composition (build scenes — out:'settle').
- POSITION ROTATION: never place two consecutive reveals in the same zone — move around the frame (left → upper-right → lower-centre → …).
- GAPS between beats: ambient only — drift, sweep, a breathing glow. The frame must never go dead NOR empty.
- LAST beat = CLIMAX: the biggest moment — scale the climax element +15–25% over the scene's earlier type, strongest glow, land it with FX.impact, and HOLD it to the end with a soft afterglow pulse. The scene must END full, not fade to nothing.
- VISUAL CALLBACK: the climax echoes the FIRST beat's motif (same word, shape or icon) bigger and brighter — the circle closes.

■ ENTRANCE LIBRARY (rotate ≥4 DIFFERENT styles across the scene, never the same twice in a row):
char-cascade (FX.splitIn) · elastic pop (FX.pop) · directional slide+blur (FX.slide / tl.fromTo with x+filter) · clip-path reveal (tl.set inset(0 100% 0 0) → tl.to inset(0 0% 0 0)) · 3D flip (FX.glitchIn/flipSwap or rotationY fromTo) · type-on (FX.typeOn) · glitch (FX.glitchIn) · streak (FX.streakIn) · CARRIER SLIDE (FX.carrierIn — premium: geometric-decay momentum, first word ~340px throw, then 120→60→25→12px; use on ≥1 strong beat).
■ HOLD LIBRARY: gentle float (y ±6–8) · breathe (scale 1↔1.03) · glow pulse (FX.pulseGlow) · chrome sweep (FX.chromeSweep — gradient crosses the hero once) · slow rotation wobble (±2°) · COLOR RECOLOR (tween a CSS variable: tl.to('#el', {'--acc':'<other accent>'}) mid-hold — the mood shifts with no cut) · FX.jitter/iconSpin for settled elements.
■ EXIT LIBRARY (match the energy): fade-dim settle · WHIP (FX.whipOut — slides off +blur; fire a beam/streak at the whip peak) · flip · blur-dissolve · scatter (FX.beat out:'flip'/'blur') · clip-collapse.

■ INSTANT-FAIL LIST (any of these = amateur, the render gate will bounce it):
- everything visible from t=0 (no per-beat reveals) · the same entrance twice in a row · flat undecorated hero text · opacity-only entrances (always pair opacity with ≥1 transform) · two consecutive reveals in the same zone · a dead/empty frame mid-scene · a scene that ends nearly empty · full-sentence dump on screen · English/code/telemetry decor text (ai_state=…, FILE.EXE, [SYSTEM_INIT], snake_case) · scene number / page counter / corner status tag (this is a film, not a slide deck) · text on top of text · yoyo repeat loops as the main animation.

THE STAGE (already rendered — do NOT rebuild it): your html sits inside <div class="hf-cam"> on a themed stage that already carries an animated particle canvas, background motif, vignette, film grain, a light-beam (.hf-beam), karaoke subtitles, a progress bar, and a living backdrop (dual spinning rings, drifting specks, a soft ring pulse on every beat). Never touch or restyle the harness layers (.cap/#capText/.progtrack/#progFill/#bgCanvas/.wm/.vig) — build only the scene's own layers.

TECHNICAL RULES (creative freedom, but break these and the frame renders WRONG):
- Your script is the body of function(gsap, tl, S, rng), run AFTER fonts load. "tl" is a PAUSED timeline scrubbed frame-by-frame; DUR (scene seconds) is predefined; the FX helpers below are available. NEVER call gsap.* directly (the timeline is paused → a gsap.to() would freeze); use tl.to / tl.fromTo / tl.set and FX.*.
- DETERMINISM is sacred: identical input must render identical frames. No wall-clock, no network, no self-scheduling, no Math.random; rng() is a seeded PRNG for any randomness. (Your VARIETY comes from designing differently each time you are asked — not from runtime randomness.)
- MOTION IS TRANSFORMS ONLY: animate transform (x/y/scale/rotation/skew), opacity, filter, clip-path, CSS variables — NEVER width/height/top/left/margin (they reflow and re-wrap text mid-tween; a bar fill is scaleX with transform-origin). No infinite CSS animation, no repeat:-1 (finite only: repeat: Math.max(0, Math.floor(DUR/period)-1)); every tween ends within 0..DUR, the last one ≈DUR.
- POSITION every element with a slot wrapper <div class="hf-slot" style="left:_%;top:_%">…</div> — the slot owns the centring transform, so ANIMATE ONLY THE INNER element, never the slot. A slot stacks its children vertically with a gap; for a full-centre element use <div class="hf-center">…</div>. Two readable texts must never overlap (separate in space, or stagger in time).
- DOM budget 30–160 elements; hero 8–20 crafted parts; no images, no external fonts, no <script>/<iframe>; inline SVG you draw is welcome (palette strokes, animate with FX.drawIn).

MATERIALS (all optional — reach for what the scene needs, build the rest yourself):
- Component classes, pre-styled to the guide (a convenience — bespoke surfaces encouraged): .hf-kw (hero keyword) · .hf-kw2 (medium) · .hf-sub (supporting line) · .hf-label (small mono tag) · .hf-card (glass panel) · .hf-chip (pill) · .hf-stat>.hf-stat-v(+.hf-stat-u)/.hf-stat-l (big number) · .hf-iconbox (icon holder, .sm) · .hf-row/.hf-col · .hf-underline · .hf-accent/2/3.
- Icons: {{icon:name}} inside any element (inline SVG, sized by font-size) — pick ONLY from the icon list in the user message.
- Palette + fonts are LOCKED to the guide (given in the user message): use those colours (plus white/black/transparent) and those fonts, so every scene shares ONE identity while looking completely different.

FX TOOLKIT (times are ABSOLUTE seconds on tl; use whichever serve your design):
- FX.beat(tl, sel, t0, t1, {in,out}) — enter at t0; out:'settle'(stay dimmed, for elements that accumulate)|'fade'|'whip'|'flip'|'blur'(leave)|'none'(stay full — the hero); in:'rise'|'pop'|'carrier'|'glitch'|'flip'.
- FX.camPush(tl,{scale,x,y,profile:'front'}) camera move · FX.parallax(tl,sel,{amp}) depth drift · FX.beamSweep / FX.chromeSweep / FX.pulseGlow / FX.drawIn('svg path',{at}) flourishes · FX.impact(tl,sel,{at,color}) a single money-beat accent · FX.zoomThrough(outSel,inSel,{at,inverse}) velocity-matched cut between blocks · FX.jitter / FX.iconSpin aliveness for a settled hold · FX.targetZoom / FX.dofBlur focus one off-centre element · FX.counterRoll(sel,end,{at,grow}) count a number · FX.typeOn / FX.splitIn / FX.pop / FX.rise / FX.slide / FX.staggerGrid / FX.streakIn / FX.whipOut / FX.glitchIn / FX.carrierIn / FX.flipSwap entrances & exits.
- FX.accents(n) → n emphasis times from the REAL word timings; FX.schedule(tl,sel,{in,out,keep}) spreads matched elements across them (keep:true for lists that accumulate).
- DRIVE MOTION THROUGH THESE FX.* HELPERS wherever you can — they are battle-tested and safe. For custom tweens use tl.to / tl.fromTo / tl.set. Do NOT invent undefined FX/tl methods and NEVER call gsap.* directly. Every element you create must be animated by one of these, or it just sits there.

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
  if (guide.fontSizes) parts.push(`- TYPE LADDER (px on this canvas): ${Object.entries(guide.fontSizes).map(([k, v]) => `${k} ${v}px`).join(' · ')} — hero/headline may flex ±15% to fit.`);
  if (guide.effects?.length) parts.push(`- TEXT EFFECT PRESETS (the channel's named treatments — pick per beat):\n${guide.effects.map((e) => `  • ${e}`).join('\n')}`);
  if (guide.ambient?.length) parts.push(`- AMBIENT NOTES:\n${guide.ambient.map((e) => `  • ${e}`).join('\n')}`);
  if (guide.hud?.kickers?.length || guide.hud?.statuses?.length) {
    parts.push(`- HUD LANGUAGE (optional, use SPARINGLY — never a fixed frame stamped on every scene): a small mono uppercase kicker (prefix like ${(guide.hud.kickers || ['//']).join(' or ')}, class .hf-label) may sit near a headline on SOME scenes; skip it on others and vary where it sits. Never a corner status tag or page counter.`);
  }
  if (guide.sceneRules?.length) parts.push(`- SCENE RULES (hard):\n${guide.sceneRules.map((r) => `  • ${r}`).join('\n')}`);
  if (guide.conceptMap?.length) parts.push(`- CONCEPT → VISUAL IDEAS (inspiration when the narration matches a concept — adapt freely, never copy verbatim):\n${guide.conceptMap.map((c) => `  • ${c}`).join('\n')}`);
  return parts.length ? `\n${parts.join('\n')}` : '';
}

// Overlay-mode doctrine (the reference app's 19 KB overlay prompt distilled): the scene
// composites onto REAL FOOTAGE via colorkey, so the design rules flip from "build a stage"
// to "decorate a living picture without hiding it".
export function overlayBlock() {
  return `OVERLAY MODE ACTIVE (this scene composites ON TOP of the owner's real footage — the themed stage is NOT rendered; your background is keyed transparent):
- KEEP THE CENTER ~40-50% OF THE FRAME CLEAR — the viewer must see the footage. Design with edges, corners, top bar, lower-third and side columns; a keyword may CROSS the center only during a brief entrance/exit.
- FORBIDDEN (breaks the key or hides the footage): solid panels/cards with filled backgrounds, backdrop-filter of any kind, any filled rectangle covering >30% of the frame, any element with opacity >0.5 that is not text / a thin line (≤4px) / an icon (≤80px). A "container" is border-only (≤2px, opacity ≤0.4), never filled.
- TEXT MUST READ OVER VIDEO: active text at opacity 1.0, solid fill (white or a bright accent) + a 3-layer shadow (tight glow, wide glow, dark drop — e.g. 0 0 15px rgba(255,255,255,.8), 0 0 30px rgba(255,255,255,.4), 0 4px 12px rgba(0,0,0,.9)). Outline-only text is an entrance state ONLY (≤0.3s, then fill).
- AMBIENT stays subtle: a few drifting dots at the margins, corner brackets that breathe, one thin light-streak sweep every ~5-7s. Never a full-frame wash.
- Per-beat protocol is unchanged (one keyword enters on its word, holds alive, exits before the next; position rotation; final climax + callback) — but keep each beat's element NEAR the edges/thirds, never parked dead-center.`;
}

// Script-specific typography rules (reference-app per-language textRule parity): tall-mark
// scripts clip without extra line-height; detected from the narration itself.
export function scriptTextRule(voiceText) {
  const t = String(voiceText || '');
  if (/[ऀ-ॿ]/.test(t)) return '\nSCRIPT RULE (Devanagari): matras extend far above/below the baseline — every text element needs line-height ≥1.8 and padding-top ~0.2em; NEVER overflow:hidden on text.';
  if (/[฀-๿]/.test(t)) return '\nSCRIPT RULE (Thai): stacked tone marks need line-height ≥1.7 and extra top padding; NEVER overflow:hidden on text.';
  if (/[぀-ヿ一-鿿가-힯]/.test(t)) return '\nSCRIPT RULE (CJK): avoid aggressive letter-spacing on body text; character wrapping is natural; keep display weights ≥500 so strokes stay crisp.';
  return '';
}

// Hard viewport numbers (reference-app parity: their ASPECT_RATIO_RULES ship exact px per
// ratio). Computed from the actual canvas so any aspect — 16:9, 9:16, 1:1, 4:5 — gets
// correct bounds. The caption band matches the validate.js geometry gate (bottom 20%).
export function viewportBlock(w, h, captionsOn) {
  const vertical = h > w;
  const sideM = Math.round(w * 0.06);
  const topM = Math.round(h * 0.055);
  const contentMaxY = captionsOn ? Math.round(h * 0.78) : Math.round(h * 0.94);
  const textMaxW = Math.round(w * (vertical ? 0.88 : 0.80));
  const heroMaxW = Math.round(w * (vertical ? 0.86 : 0.60));
  const heroMaxH = Math.round(h * (vertical ? 0.46 : 0.62));
  return [
    `VIEWPORT NUMBERS (hard bounds for THIS ${w}x${h} canvas):`,
    `- Side margins ≥${sideM}px; top margin ≥${topM}px; content vertical range y=${topM}..${contentMaxY}px${captionsOn ? ` (below y=${contentMaxY} is the subtitle band — keep it clear)` : ''}.`,
    `- Any single text block ≤${textMaxW}px wide. Hero construction ≤${heroMaxW}px wide × ≤${heroMaxH}px tall (leave room for its counterweight).`,
    `- Author every absolute px against THIS canvas — the page body is EXACTLY ${w}x${h}px and is upscaled LOSSLESSLY to the output resolution; never assume any other resolution.`,
  ].join('\n');
}

export function buildCodegenPrompt({ scene, beats, direction, guide, w, h, duration, idx, total, density, creativeDirection, hookVisual = '', captionsOn = true, modeBlocks = [] }) {
  const vertical = h > w;
  const densityNote = DENSITY_NOTE[density] || DENSITY_NOTE.rich; // rich is the house default — sparse scenes read cheap
  const subNote = captionsOn
    ? 'SUBTITLES: ON — reserve the bottom ~22% of the frame for the karaoke subtitle band; keep foreground content above it.'
    : 'SUBTITLES: OFF for this video — there is NO subtitle band; use the FULL frame height (still keep a comfortable ~6% margin from every edge).';
  const dirNote = (creativeDirection || '').trim()
    ? `\nCREATIVE DIRECTION (apply to every scene of this video): ${creativeDirection.trim()}` : '';
  const rhymeNote = direction.isClimax && (hookVisual || '').trim()
    ? `\nVISUAL RHYME (closing scene): echo the hook scene's main motif — "${hookVisual.trim().slice(0, 220)}" — bring its main object/shape back BIGGER (~+25% scale) with a stronger glow as the final climax element.` : '';
  const modeNote = modeBlocks.length ? `\n${modeBlocks.join('\n')}` : '';
  const user = `STYLE GUIDE (LOCKED — use exactly these):
- Palette: bg ${guide.palette.bg} / bg2 ${guide.palette.bg2} · ink ${guide.palette.ink} · muted ${guide.palette.muted} · accents ${guide.palette.accents.join(' ')}
- Display font: ${guide.fonts.display} · Body: ${guide.fonts.body} · Mono: ${guide.fonts.mono}
- Keyword treatment: ${guide.textTreatment} (already baked into .hf-kw) · Background motif: ${guide.motif} (already rendered behind you)
- Motion personality: ${guide.motionPersonality}${guideV2Block(guide)}
${densityNote}${dirNote}${rhymeNote}${modeNote}

SCENE ${idx + 1}/${total} — CANVAS ${w}x${h} CSS px (${vertical ? 'vertical 9:16-class' : 'horizontal'}), DUR = ${(+duration).toFixed(3)}s
${viewportBlock(w, h, captionsOn)}${scriptTextRule(scene.voice_text)}
${subNote}
NARRATION (voice${captionsOn ? ', shown as karaoke subtitles at the bottom' : ' — subtitles are OFF, not shown on screen'} — do NOT repeat it verbatim on screen):
"${(scene.voice_text || '').trim()}"
VISUAL CONCEPT (an art-director's brief — let it INSPIRE your design: match its subject and its energy, but the exact composition, styling and execution are YOURS to invent, and two scenes must never come out alike; when it is structured [ROLE]/[LAYOUT]/[MAIN FOCUS]/[CAMERA]/[MOTION FLOW]/[MOOD], read the [ROLE] for energy — a titlecard/cta means restraint, a hook means maximum striking power — the beat times below still rule WHEN things appear):
"${(scene.visual_prompt || '').trim() || '(design freely from the narration keywords)'}"

CINEMATIC DIRECTION:
${directionBlock(direction)}

${signatureBlock(motionSignature(direction, idx))}

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
