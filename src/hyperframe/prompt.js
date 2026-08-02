// The HyperFrame codegen prompt — the heart of the feature. It gives the LLM FULL CREATIVE
// FREEDOM to design one scene's { css, html, script }: there is no fixed template and no
// required layout. The prompt states what a good scene needs (relevant, balanced, beautiful
// motion, readable type, unique every time), then hands over the REFERENCE-CALIBER doctrine
// (stage/hero/type/beat-protocol/technique libraries/instant-fail list — distilled from the
// reference app's production prompts and its real rendered scenes), the technical rules the
// renderer needs, the FX toolkit and the locked style guide.
// English instructions (models code better in English); on-screen text stays in the narration's language.
import { SAMPLE_SPEC } from '../styleguide/index.js';
import { advertisedLibs } from '../animation/libs.js';
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
2. EVEN — THE ZONE BUDGET. Arithmetic, not taste: place by ZONE NAME and COUNT before you answer. Every element goes in a container with EXPLICIT bounds (top/left/width/height, or flex/grid) — never vague values that overflow — with a comfortable margin from ALL FOUR edges so nothing clips, bleeds off or touches an edge.
- THE NINE ZONES, binned by the two numbers YOU type on the slot (a .hf-slot centres itself on its left/top, so those numbers ARE its centre; a raw-CSS element bins by its box centre). Columns: L = left under 34% · C = 34–66% · R = over 66%. Rows: T = top under 34% · M = 34–66% · B = over 66%. That names TL TC TR / ML MC MR / BL BC BR. Comfortable anchor bands to write into: left 12–26% / 40–60% / 74–88%, top 10–24% / 40–60% / 72–88% — pick your own values inside them, never the same ones twice.
- AN ANCHOR is anything a viewer can point at: headline, keyword, instrument, card, stat, icon, label pair, tick rail, axis + scale numbers, legend, chart, ghost numeral, bracket. One element centre = one anchor in its zone, and a construction taller or wider than one zone ALSO anchors every zone its box reaches — a rail down the left edge pays for TL, ML and BL at once. A blurred glow orb alone anchors nothing.
- THE FOUR LAWS, measured on the SETTLED frame (last beat → DUR, the state the viewer stares at longest — the opening is bare by design): (1) at least 7 of the 9 zones hold an anchor; (2) TL, TR, BL and BR each hold at least one — the TWO TOP CORNERS are what every weak layout starves, fill them FIRST; (3) every row holds ≥2 anchors and every column holds ≥2; (4) MC holds AT MOST ONE anchor, and your three biggest masses sit in three DIFFERENT columns, never all in one row.
- THIS RULE NEVER ASKS FOR MORE ELEMENTS — it decides WHERE the ones you already have go. Satisfy it by MOVING, not adding: the kicker goes to a top corner instead of above the headline · the unit/legend/source label to the opposite corner · the instrument's axis or tick rail extends down into a bottom corner · a stat readout detaches to the far side · a 1px hairline or bracket runs along a starved edge. PLUGGING A HOLE WITH CONFETTI IS A WORSE FAILURE THAN THE HOLE — same element count, same calm, same negative space; only the weight moves.
- THE MID LAYER IS BALLAST: the .hf-mid glow orbs and the oversized ghost glyph you already build are positionless by default — park them in whichever zones your near layer left thinnest, diagonally opposed, never both behind the hero. Free area, zero extra DOM.
- BIND LEFT TO RIGHT WITH ONE ELEMENT: a hairline, rail, timeline or axis running most of the width (or height) ties the frame together and pays three zones by itself.
- SIZE IS NOT POSITION: the VIEWPORT numbers (SAFE_CENTER_W/H, HERO_MAX_W, TEXT_MAX_W, SUBJECT_MAX_H, CARD_MAX_W) cap how BIG one block may be — they never say where it must sit, and SAFE_CENTER is a footprint ceiling for ONE construction, NOT the box the composition lives in. Every point inside the padding line is legal ground. Only a bare quote or title card may stack on the centre axis.
- SELF-CHECK BEFORE YOU EMIT: read back your own slot list, name the zone each left/top lands in, and count. A bare corner, a row or column under 2, or a crowded MC → MOVE a slot and re-read. A clumped frame is the #1 amateur tell, however beautiful its parts.
3. BEAUTIFUL, SMOOTH MOTION — RICH & ALIVE. Elements ease in gently (power2/power3/expo.out, ~0.35–0.9s), ONE main thing arriving at a time, each landing ON its spoken beat; between beats the frame stays alive with slow drift, never freezing and never emptying. Aim for ≥5 elements animating at any given moment (hero parts + depth orbs + ticks/particles + ambient drift) so it reads as MOTION GRAPHICS, not a slide; run ≥2 parallax depth layers. Calm beats churn: a settled, still-but-breathing frame is the reference look. Use ≥3 distinct eases across the scene; keep bounce/overshoot for at most one playful accent. Make it look EXPENSIVE: give the hero one premium treatment (chrome / neon / glow) and use premium surfaces (glass, soft shadow, a 1px accent hairline) — never flat, undecorated boxes.
4. READABLE, CLEAN TYPE. Every readable text is near-white or a bright accent on the dark stage (≥4.5:1) — never dim grey, never accent-on-accent. Text fits inside the frame and NEVER clips. Headlines ≤4 words, wrapped on phrase boundaries (never orphan a word). When subtitles are ON, keep the PRIMARY headline out of the caption band — the band still carries structure and short labels; an empty bottom strip is a worse mistake than a busy one.
5. CREATIVE & UNIQUE. No two scenes — and no two renders of the same brief — may look alike. Vary the core idea, hero type, placement, motion, type treatment, colour emphasis. A stamped-out arrangement is THE failure.

THE REFERENCE STANDARD — the quality bar every scene must hit, with YOUR OWN unique composition each time:

■ STAGE — LIT, LAYERED, ATMOSPHERIC. Build real depth IN YOUR SCENE (beyond the themed backdrop the harness already renders): a mid layer with 1–2 soft glow orbs in scene-appropriate accent (a blurred radial div, blur ≥60px, opacity ≤ .3), a faint structural texture (grid lines, ticks, an oversized ghost glyph/number at opacity .04–.08), and the near hero. Author these as THREE planes inside <div class="hf-cam"> — .hf-far (accent texture), .hf-mid (the parallax orbs / ghost glyph), .hf-near (the hero + labels) — sitting on top of the harness backdrop (particles/vignette/grain). Give the mid layer a slow parallax drift (FX.parallax) — the camera never sleeps. One light-beam or streak sweep every ~5–7s (FX.beamSweep on the stage's .hf-beam) keeps quiet stretches alive. A flat single-plane frame reads cheap.

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
- everything visible from t=0 (no per-beat reveals) · the same entrance twice in a row · flat undecorated hero text · opacity-only entrances (always pair opacity with ≥1 transform) · two consecutive reveals in the same zone (zone = one of the nine named in master rule #2) · A SETTLED FRAME THAT LEAVES A CORNER BARE OR PILES TWO MASSES INTO MC · a dead/empty frame mid-scene · a scene that ends nearly empty · full-sentence dump on screen · English/code/telemetry decor text (ai_state=…, FILE.EXE, [SYSTEM_INIT], snake_case) · scene number / page counter / corner status tag (this is a film, not a slide deck) · text on top of text · yoyo repeat loops as the main animation.

THE STAGE (already rendered — do NOT rebuild it): your html sits inside <div class="hf-cam"> on a themed stage that already carries an animated particle canvas, background motif, vignette, film grain, a light-beam (.hf-beam), karaoke subtitles, a progress bar, and a living backdrop (dual spinning rings, drifting specks, a soft ring pulse on every beat). Never touch or restyle the harness layers (.cap/#capText/.progtrack/#progFill/#bgCanvas/.wm/.vig) — build only the scene's own layers.

TECHNICAL RULES (creative freedom, but break these and the frame renders WRONG):
- Your script is the body of function(gsap, tl, S, rng), run AFTER fonts load. "tl" is the PAUSED master timeline scrubbed frame-by-frame; DUR (scene seconds) is predefined; the FULL GSAP API and the FX helpers below are available. Author a RAW GSAP TIMELINE: add every timed tween to tl (tl.to / tl.from / tl.fromTo / tl.set); use gsap.set() for instant initial states, gsap.timeline() for nested sub-sequences (add them to tl with tl.add), plus gsap.utils and any ease. The ONE thing that breaks: a STANDALONE gsap.to()/gsap.from() lands on the paused GLOBAL timeline and freezes — always put motion on tl (or an FX.* helper).
- DETERMINISM is sacred: identical input must render identical frames. No wall-clock (Date.now/performance.now), no network, no self-scheduling (setTimeout/setInterval/requestAnimationFrame). Randomness is fine — the harness reseeds it per scene — though rng() (a seeded PRNG) is clearest. (Your VARIETY comes from designing differently each time you are asked — not from runtime randomness.)
- MOTION IS TRANSFORMS ONLY: animate transform (x/y/scale/rotation/skew), opacity, filter, clip-path, CSS variables — NEVER width/height/top/left/margin (they reflow and re-wrap text mid-tween; a bar fill is scaleX with transform-origin). No infinite CSS animation, no repeat:-1 (finite only: repeat: Math.max(0, Math.floor(DUR/period)-1)); every tween ends within 0..DUR, the last one ≈DUR.
- POSITION every element with a slot wrapper <div class="hf-slot" style="left:_%;top:_%">…</div> — the slot owns the centring transform, so ANIMATE ONLY THE INNER element, never the slot. A slot stacks its children vertically with a gap; for a full-centre element use <div class="hf-center">…</div>. Two readable texts must never overlap (separate in space, or stagger in time).
- DOM budget 30–160 elements; hero 8–20 crafted parts; no external fonts, no external URLs, no <script>/<iframe> tags in your html; inline SVG you draw is welcome (palette strokes, animate with FX.drawIn), and a <canvas> is fine when a creative library drives it. Images ONLY via the {{asset:NAME}} placeholders the user message lists — never an invented src.

MATERIALS (all optional — reach for what the scene needs, build the rest yourself):
- Component classes, pre-styled to the guide (a convenience — bespoke surfaces encouraged): .hf-kw (hero keyword) · .hf-kw2 (medium) · .hf-sub (supporting line) · .hf-label (small mono tag) · .hf-card (glass panel) · .hf-chip (pill) · .hf-stat>.hf-stat-v(+.hf-stat-u)/.hf-stat-l (big number) · .hf-iconbox (icon holder, .sm) · .hf-row/.hf-col · .hf-underline · .hf-accent/2/3.
- Icons: {{icon:name}} inside any element (inline SVG, sized by font-size) — pick ONLY from the icon list in the user message.
- Palette + fonts are LOCKED to the guide (given in the user message): use those colours (plus white/black/transparent) and those fonts, so every scene shares ONE identity while looking completely different.

FX TOOLKIT (times are ABSOLUTE seconds on tl; use whichever serve your design):
- FX.beat(tl, sel, t0, t1, {in,out}) — enter at t0; out:'settle'(stay dimmed, for elements that accumulate)|'fade'|'whip'|'flip'|'blur'(leave)|'none'(stay full — the hero); in:'rise'|'pop'|'carrier'|'glitch'|'flip'.
- FX.camPush(tl,{scale,x,y,profile:'front'}) camera move · FX.parallax(tl,sel,{amp}) depth drift · FX.beamSweep / FX.chromeSweep / FX.pulseGlow / FX.drawIn('svg path',{at}) flourishes · FX.impact(tl,sel,{at,color}) a single money-beat accent · FX.zoomThrough(outSel,inSel,{at,inverse}) velocity-matched cut between blocks · FX.jitter / FX.iconSpin aliveness for a settled hold · FX.targetZoom / FX.dofBlur focus one off-centre element · FX.counterRoll(sel,end,{at,grow}) count a number · FX.typeOn / FX.splitIn / FX.pop / FX.rise / FX.slide / FX.staggerGrid / FX.streakIn / FX.whipOut / FX.glitchIn / FX.carrierIn / FX.flipSwap entrances & exits.
- FX.accents(n) → n emphasis times from the REAL word timings; FX.schedule(tl,sel,{in,out,keep}) spreads matched elements across them (keep:true for lists that accumulate).
- The FX.* helpers are OPTIONAL conveniences (pre-tuned entrances/holds/exits) — reach for them, or write raw tl.* GSAP directly (tl.to / tl.from / tl.fromTo / tl.set, gsap.set, nested gsap.timeline added to tl), whichever best expresses your design. Do NOT invent undefined FX/tl methods, and remember a bare gsap.to() freezes (put motion on tl). Every element you create must be animated by tl/FX, or it just sits there.

Design THIS scene now — freely, uniquely, true to the narration. Reply with ONLY the fenced blocks.`;

const DENSITY_NOTE = {
  minimal: 'DENSITY: minimal — a clean hero and generous calm negative space; let the idea breathe, skip decorative extras.',
  balanced: 'DENSITY: balanced — a hero plus a supporting element or two, with tasteful detail; rich enough to feel crafted, calm enough to read.',
  rich: 'DENSITY: rich — a full, layered composition with living craft detail (textures, ticks, depth pieces), yet reveals stay one-at-a-time and motion stays calm — a dense, hand-crafted frame, never cluttered or busy.',
};

/**
 * P35 — role-aware per-scene density. The art-director pass writes [ROLE] into the brief;
 * high-stakes roles (hook/proof/payoff) render RICH, the cta breather renders MINIMAL, the
 * rest keep the project's own knob as the baseline. One project-wide prose note used to be
 * the only density lever — a hook and a titlecard got the same instruction.
 */
export function densityForScene(scene, baseDensity) {
  const m = /\[ROLE\]\s*([a-z-]+)/i.exec(String(scene?.visual_prompt || ''));
  const role = m ? m[1].toLowerCase() : '';
  if (role === 'hook' || role === 'proof' || role === 'payoff') return 'rich';
  if (role === 'cta') return 'minimal';
  return baseDensity || 'balanced';
}

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
export function overlayBlock({ edit = false } = {}) {
  // Owner order 2026-08-02: an EVEN frame outranks avoiding whatever text the footage already
  // burned in. No band is reserved here — the balance doctrine owns placement.
  const editNote = edit
    ? `
- THIS FOOTAGE IS THE OWNER'S OWN VIDEO and the narration you are given is what it ALREADY SAYS out loud at this moment. Your graphics ANNOTATE it — a keyword, a number, a label — they never restate the sentence.`
    : '';
  return `OVERLAY MODE ACTIVE (this scene composites ON TOP of the owner's real footage — the themed stage is NOT rendered; your background is keyed transparent):${editNote}
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

// P38 (reference-parity layout): the reference app does NOT balance layout with prose — it
// injects EXACT px thresholds per ratio and MANDATES using them directly in code, plus per-ratio
// distribution rules. That concreteness is what keeps its frames balanced and non-center-clumped.
// We emit the same, computed from the real canvas so any aspect gets correct bounds. The caption
// band matches the validate.js geometry gate (bottom ~20%).
export function ratioClass(w, h) {
  const r = w / h;
  if (r >= 1.12) return '16:9'; // any landscape → wide-frame rules
  if (r >= 0.9) return '1:1';
  if (r >= 0.72) return '4:5';
  return '9:16';
}
// P39 (raw-GSAP reference port): the reference app injects HARDCODED INTEGER threshold TABLES per
// aspect ratio — not formulas — and mandates using them verbatim. That concreteness is most of why
// its frames land balanced. We ship the SAME integer tables (at the reference resolutions the values
// are byte-identical; a non-standard canvas scales them proportionally so any size stays correct).
const REF_THRESHOLDS = {
  '16:9': { rw: 1920, rh: 1080, side: 90, top: 70, bottom: 90, textW: 980, heroW: 920, cardMin: 520, cardMax: 760, subjectH: 450, textBlockH: 300, safeCW: 1320, safeCH: 620, gap: 80 },
  '9:16': { rw: 1080, rh: 1920, side: 70, top: 90, bottom: 130, textW: 830, heroW: 810, cardMin: 620, cardMax: 780, subjectH: 990, textBlockH: 360, safeCW: 760, safeCH: 980, gap: 36 },
  '1:1': { rw: 1080, rh: 1080, side: 70, top: 70, bottom: 90, textW: 760, heroW: 730, cardMin: 520, cardMax: 700, subjectH: 700, textBlockH: 280, safeCW: 740, safeCH: 740, gap: 32 },
  '4:5': { rw: 1080, rh: 1350, side: 65, top: 60, bottom: 105, textW: 790, heroW: 760, cardMin: 600, cardMax: 820, subjectH: 760, textBlockH: 300, safeCW: 780, safeCH: 760, gap: 34 },
};
export function viewportBlock(w, h, captionsOn) {
  const cls = ratioClass(w, h);
  const T = REF_THRESHOLDS[cls] || REF_THRESHOLDS['16:9'];
  const sx = w / T.rw, sy = h / T.rh; // 1.0 at the reference resolution; scales any other canvas
  const X = (v) => Math.round(v * sx), Y = (v) => Math.round(v * sy);
  const sideP = X(T.side), topP = Y(T.top), bottomP = Y(T.bottom);
  const contentMaxY = h - bottomP;
  const lowerThirdY = Math.round(h * 0.807); // matches the validate.js caption-band geometry gate
  const inset = Math.max(6, Math.round(Math.min(sx, sy) * 10)); // reference #content inset:10px
  return [
    `VIEWPORT — hard layout thresholds for THIS ${w}x${h}px canvas (${cls}). USE THESE EXACT VALUES DIRECTLY in your CSS/JS — do NOT estimate:`,
    `- SIDE_PADDING=${sideP}px · TOP_PADDING=${topP}px · BOTTOM_PADDING=${bottomP}px — nothing may sit outside x=[${sideP}..${w - sideP}] or y=[${topP}..${contentMaxY}].`,
    `- SAFE_CENTER_W=${X(T.safeCW)}px · SAFE_CENTER_H=${Y(T.safeCH)}px — a FOOTPRINT CEILING for ONE construction, NOT the box the composition lives in (every point inside the padding line is legal ground) · SPLIT_GAP=${X(T.gap)}px minimum between side-by-side blocks.`,
    `- TEXT_MAX_W=${X(T.textW)}px (any single text block) · TEXT_BLOCK_MAX_H=${Y(T.textBlockH)}px (no taller vertical text stack).`,
    `- HERO_MAX_W=${X(T.heroW)}px × SUBJECT_MAX_H=${Y(T.subjectH)}px (the hero construction; leave room for its counterweight).`,
    `- CARD_MIN_W=${X(T.cardMin)}px · CARD_MAX_W=${X(T.cardMax)}px (any panel/card).`,
    // Owner order 2026-08-02: evenness outranks subtitle avoidance. The band is no longer a
    // no-go zone that evicts a third of the frame and pushes every composition upward — only the
    // BIGGEST readable text stays out of it; structure, panels and ambience may live there.
    captionsOn
      ? `- LOWER_THIRD_Y=${lowerThirdY}px: karaoke subtitles run below this line. Keep the PRIMARY headline and any long label above it, but the band is still yours for structure, panels, charts, ambience and short labels — do NOT leave the bottom of the frame empty.`
      : `- Subtitles are OFF — use the full height down to y=${contentMaxY}px (still keep the ${topP}px / ${bottomP}px margins).`,
    `- CONTENT is inset ${inset}px from every edge. Put every element in a container with explicit top/left/width/height OR flex/grid — never vague values that overflow. Nothing touches the edge of the safe zone. These numbers are MAXIMA AND MARGINS — how big one block may be and how near an edge it may sit; they never nominate a destination. If a SIZE conflicts with your concept, THE THRESHOLDS WIN; if you have read one as a reason to move the composition inward, you have misread a maximum as a target.`,
    `- The page body is EXACTLY ${w}x${h}px and is upscaled LOSSLESSLY to output; never assume any other resolution.`,
  ].join('\n');
}

// Per-ratio distribution rules (reference-app parity: its RULES_FOR_<ratio> blocks). A weak
// model's default gravity is center-stack; these push the composition to fill the frame's real
// shape — a wide frame spreads horizontally, a tall frame stacks in reading order.
export function ratioRulesBlock(w, h) {
  const cls = ratioClass(w, h);
  // Each branch turns master rule #2's zone budget into the quota for THIS shape, then shows one
  // legal worked map with its arithmetic spelled out. The map is a PATTERN to reason from, never
  // coordinates to copy — every branch says so, or every scene would land on identical numbers.
  if (cls === '16:9') {
    return `LAYOUT FOR 16:9 (wide, cinematic) — THE ZONE BUDGET FOR THIS CANVAS:
- QUOTA: ≥7 of the 9 zones anchored · TL TR BL BR each ≥1 · every row ≥2 · every column ≥2 · MC ≤1.
- THE WIDTH DOES THE READING: your three biggest masses sit in three DIFFERENT COLUMNS — an off-centre hero, a real counterweight across ≥SPLIT_GAP, and a third mass — never all in one row. Two clear columns or a 60/40 split are encouraged; the hero stays ≤HERO_MAX_W so it never becomes one long hard-to-read line.
- A wide frame with everything on the centre axis is the #1 amateur tell — it wastes the shape it was cut for.
- WORKED MAP (a legal PATTERN — reuse the ARITHMETIC, invent your own numbers, shift every value by ≥6%): TL kicker 15/17 · TC headline 50/13 · TR legend 84/19 · ML hero keyword 30/46 · MR instrument card 74/44 · BL axis + scale 19/78 · BC tick rail 50/88 · BR stat readout 82/74 → 8/9 zones · corners 4/4 · rows 3/2/3 · cols 3/2/3 · MC 0. LEGAL.`;
  }
  if (cls === '9:16') {
    return `LAYOUT FOR 9:16 (tall, mobile-first) — THE ZONE BUDGET FOR THIS CANVAS:
- QUOTA: all THREE ROWS anchored with ≥2 anchors EACH · TL TR BL BR each ≥1 · ≥7 of the 9 zones · MC ≤1. A card at CARD_MIN_W–CARD_MAX_W centred at 50% already spans all three columns, so on this shape the ROWS are what you must earn.
- THE HEIGHT DOES THE READING: your three biggest masses sit in three DIFFERENT ROWS — top, middle, bottom, in narration order — never all in one column. Keep the hero ≤SUBJECT_MAX_H so one mass never swallows two rows.
- WORK THE MARGINS: a tall frame starves its corners worst. A kicker top-left, an icon or unit top-right, an index rail down one side and a small readout at a bottom corner cost nothing and pay four zones.
- WORKED MAP (a legal PATTERN — reuse the ARITHMETIC, invent your own numbers, shift every value by ≥6%): TL kicker 18/10 · TR icon 82/12 · hero keyword 50/34 spanning L-C-R · MR side rail 88/46 · BL step label 19/72 · BC support card 50/80 spanning L-C-R · BR stat 82/88 → rows 2/2/3 · corners 4/4 · MC 0. LEGAL.`;
  }
  if (cls === '1:1') {
    return `LAYOUT FOR 1:1 (square) — THE ZONE BUDGET FOR THIS CANVAS:
- QUOTA: ≥7 of the 9 zones anchored · all FOUR corners ≥1 · every row ≥2 · every column ≥2 · MC ≤1.
- Symmetry is the shape's gift and its trap: balance DIAGONALLY (an accent in one corner answered across the frame) instead of mirroring left/right, or every scene comes out the same.
- WORKED MAP (a legal PATTERN — reuse the ARITHMETIC, invent your own numbers, shift every value by ≥6%): TL bracket 16/16 · TC kicker 50/12 · TR ghost numeral 84/18 · ML label pair 17/50 · MR instrument 80/47 · BL tick rail 18/82 · BC hero keyword 50/72 · BR unit 84/84 → 8/9 zones · corners 4/4 · MC 0. LEGAL.`;
  }
  return `LAYOUT FOR 4:5 (portrait) — THE ZONE BUDGET FOR THIS CANVAS:
- QUOTA: ≥7 of the 9 zones anchored · all FOUR corners ≥1 · every row ≥2 · every column ≥2 · MC ≤1.
- Slightly TOP-HEAVY so the hero leads, but "top-heavy" means the hero sits above centre — it never means the bottom row is empty; a bare bottom third reads as a cropped mistake.
- WORKED MAP (a legal PATTERN — reuse the ARITHMETIC, invent your own numbers, shift every value by ≥6%): TL kicker 17/13 · TR icon 83/15 · ML hero keyword 44/33 · MR stat 82/44 · BL caption 19/76 · BC scale rail 50/86 · BR bracket 84/80 → rows 2/2/3 · corners 4/4 · MC 0. LEGAL.`;
}

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

export function buildCodegenPrompt({ scene, beats, direction, guide, w, h, duration, idx, total, density, creativeDirection, hookVisual = '', captionsOn = true, modeBlocks = [], diversitySalt = 0 }) {
  const sig = motionSignature(direction, idx, diversitySalt);
  const densityNote = DENSITY_NOTE[density] || DENSITY_NOTE.rich; // rich is the house default — sparse scenes read cheap
  const subNote = captionsOn
    ? 'SUBTITLES: ON — karaoke subtitles run along the bottom. Keep the PRIMARY headline out of that band; everything else (structure, panels, ambience, short labels) may extend into it. Never leave the bottom third empty just to avoid the subtitles.'
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

SCENE ${idx + 1}/${total} — CANVAS ${w}x${h} CSS px (${ratioClass(w, h)}), DUR = ${(+duration).toFixed(3)}s
${viewportBlock(w, h, captionsOn)}
${ratioRulesBlock(w, h)}${scriptTextRule(scene.voice_text)}
${subNote}
NARRATION (voice${captionsOn ? ', shown as karaoke subtitles at the bottom' : ' — subtitles are OFF, not shown on screen'} — do NOT repeat it verbatim on screen):
"${(scene.voice_text || '').trim()}"
VISUAL CONCEPT (an art-director's brief — let it INSPIRE your design: match its subject and its energy, but the exact composition, styling and execution are YOURS to invent, and two scenes must never come out alike; when it is structured [ROLE]/[LAYOUT]/[MAIN FOCUS]/[CAMERA]/[MOTION FLOW]/[MOOD], read the [ROLE] for energy — a titlecard/cta means restraint, a hook means maximum striking power — the beat times below still rule WHEN things appear):
"${(scene.visual_prompt || '').trim() || '(design freely from the narration keywords)'}"

CINEMATIC DIRECTION:
${directionBlock(direction)}

${signatureBlock(sig)}

${animationSpecBlock(direction, sig, beats, duration)}

${timelineSkeletonBlock(beats, direction, duration)}

BEAT TIMELINE (from the real voice word-timestamps — the visual for each beat must appear at t0 and be gone by t1):
${beatsBlock(beats, duration)}

ICONS available (use as {{icon:name}}): ${HF_ICON_NAMES.join(', ')}
${creativeLibsBlock()}

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
