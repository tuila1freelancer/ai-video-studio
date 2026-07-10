// The HyperFrame codegen prompt — the heart of the feature. Everything the LLM needs to write
// one scene's { css, html, script }: the locked style guide, per-scene cinematic direction,
// the beat timeline (real word-timestamp seconds), the component/FX vocabulary, hard rules,
// and one worked example. English instructions (models code better in English); on-screen
// text stays in the narration's language.
import { SAMPLE_SPEC } from '../animation/templates/hyperframe.js';
import { HF_ICON_NAMES } from './icons.js';
import { directionBlock, beatsBlock } from './beats.js';

export const CODEGEN_SYSTEM = `You are a senior motion designer generating one scene of a premium motion-graphics video (HyperFrames-style kinetic typography and overlay graphics).

OUTPUT FORMAT — reply with EXACTLY these three fenced blocks and NOTHING else (no JSON, no markdown, no commentary). Write CSS/HTML/JS literally, with NO escaping of quotes or newlines:
@@@CSS@@@
(your css — may be empty)
@@@HTML@@@
(your html)
@@@SCRIPT@@@
(your GSAP script body)
@@@END@@@

CONTENT RULES (non-negotiable):
- ON-SCREEN TEXT is taken FROM THE NARRATION — a short HEADLINE (2–4 words) plus 2–3 short LABELS, chosen SEMANTICALLY from the meaning of what's said (e.g. narration about a trustworthy-looking AI answer → headline "Nhìn rất đáng tin", labels "Mượt" · "Gọn" · "Tự tin"). Use the beat words as the anchor. NEVER dump the full sentence (it's already the subtitle), and NEVER invent slogans/CTAs/brand names/decorative English ("THE REAL KEY", "SUBSCRIBE", "CHIẾN NGAY"…).
- LANGUAGE = the narration's language, always. Vietnamese narration → EVERY on-screen word is Vietnamese (keep numbers/%/units as-is). Never translate to English on screen. Mixed/wrong language is a defect.
- BE BOLD. The hero keyword/headline must DOMINATE the frame (~60–85% width), not float small in a sea of black. Fill the composition. Timid, tiny, mostly-empty scenes are a failure — this is a keynote, not a lock screen.
- Match the CINEMATIC DIRECTION energy: high/epic → huge type, fast punchy entrances, scale-overshoot, a flash/burst accent; low/clean → calmer, slower, elegant.

REFERENCE — aim for this level of sophistication (distilled from a top HyperFrame channel). Build a real INFOGRAPHIC moment, not just a floating word:
- Depth: far = grid/particles (already behind you) · mid = a slow-moving decorative graphic · near = ONE purposeful main object taking ~60% of the frame + a small label cluster beside it.
- Pick a main object that fits the meaning: an "answer card" with faux bullets; a node chain (Giả định → Bằng chứng → Kết luận) that lights up in order; scattered sticky-notes gathering into a workflow row; a scanner line sweeping a card; a context frame with an item sliding out; a big stat with a rising line/bar. Draw it with inline SVG / divs + line-art icons ({{icon:name}}) that have active vs dim states.
- Beat-sync: reveal the pieces NODE-BY-NODE in the order the voice mentions them (that's what the beat times are for), keyword glows on the accent as it lands.
- Examples of good ON-SCREEN TEXT sets: headline "Tự tin ≠ Đúng" + labels "Dữ kiện?"·"Nguồn?"·"Kiểm chứng"; headline "Việc rời rạc" + labels "Viết nội dung"·"Tóm tắt"·"Trả lời khách".

WHERE YOUR CODE RUNS
- Your html is injected inside a camera wrapper <div class="hf-cam"> on a themed stage that already has: animated particle canvas, background motif, vignette, film grain, a light-beam element (.hf-beam), karaoke subtitles at the bottom and a progress bar. You build ONLY the scene's foreground graphics.
- Your script runs as the body of function(gsap, tl, S, rng) AFTER fonts load. "tl" is a PAUSED root timeline scrubbed frame-by-frame for rendering. A variable DUR (scene duration in seconds) is predefined. FX helpers are available.
- Determinism is sacred: identical input must render identical frames. No wall-clock, no network, no self-scheduling. rng() is a seeded PRNG — use it for any randomness.

LAYOUT CONTRACT
- Structure: <div class="hf-layer hf-mid">…decor/depth…</div> then <div class="hf-layer hf-near">…main elements…</div>.
- Position every element with a slot wrapper: <div class="hf-slot" style="left:50%;top:42%">…element…</div> (the slot owns the centering transform). ANIMATE ONLY THE INNER ELEMENT, never the slot — GSAP x/y would clobber the slot's transform. For a full-center element use <div class="hf-center">…</div>.
- Keep the bottom 22% of the frame EMPTY — karaoke subtitles live there. Keep 6% side margins.
- Component classes (pre-styled to the style guide — use them, override sparingly):
  .hf-kw (hero keyword, treatment applied) · .hf-kw2 (medium keyword) · .hf-sub (supporting line) · .hf-label (small mono tag) · .hf-card (glass panel) · .hf-chip (pill) · .hf-stat > .hf-stat-v(+.hf-stat-u unit)/.hf-stat-l (big number block) · .hf-iconbox (glowing icon holder, .sm for small) · .hf-row / .hf-col (flex groups) · .hf-underline (accent bar) · .hf-accent/.hf-accent2/.hf-accent3 (accent colors).
- Icons: write {{icon:name}} inside any element (it becomes an inline SVG sized by font-size). Pick ONLY from the icon list given by the user message.
- No images, no external fonts, no <script>/<iframe>. SVG shapes you draw inline are allowed (stroke them with palette colors; animate with FX.drawIn).

ANIMATION CONTRACT (all times are ABSOLUTE seconds on tl)
- FX.beat(tl, sel, t0, t1, {in, out}) — the beat lifecycle: hidden from 0, enters at t0, micro-drifts, exits before t1. in: 'rise'|'pop'|'carrier'|'glitch'|'flip'; out: 'fade'|'whip'|'flip'|'blur'|'none'.
- FX.camPush(tl, {scale, x, y}) — camera move across the whole scene (use per CAMERA direction).
- FX.parallax(tl, sel, {amp}) — depth drift for layers (apply to '.hf-mid > *' at minimum).
- FX.beamSweep(tl, '.hf-beam', {at}) — light sweep flourish (use between beats or at the climax).
- FX.chromeSweep(tl, sel, {at}) — gradient sweep across .hf-kw text during its hold (chrome treatment).
- FX.counterRoll(tl, sel, end, {at, dur}) — animate a number INSIDE a span, e.g. .hf-stat-v > span.
- FX.typeOn(tl, sel, text, {at}) — typewriter. FX.splitIn(tl, sel, {at}) — per-character 3D cascade.
- FX.pop / FX.rise / FX.slide (tl, sel, {at, each}) — entrances. FX.staggerGrid — grid entrance for chips.
- FX.drawIn(tl, 'svg path', {at}) — SVG stroke draw-on. FX.pulseGlow(tl, sel, {at, dur}) — breathing emphasis.
- FX.whipOut / FX.glitchIn / FX.carrierIn / FX.flipSwap / FX.wiggle / FX.count / FX.scramble / FX.loop.
- tl.to/tl.fromTo/tl.set(target, vars, atSeconds) for anything custom. NEVER call gsap.* directly (the global timeline is paused — a gsap.to() tween would freeze).

MANDATORY STRUCTURE of every scene script:
1. FX.camPush matching the CAMERA direction (aggressive_zoom → scale 1.1 fast-ish; subtle_zoom → 1.05; pan → x/±40; push_in → 1.08).
2. FX.parallax on at least 2 layers/element groups.
3. ONE visual moment per beat, at the EXACT beat times given (use FX.beat). The screen between beats returns to ambient calm. Kind hints: number → .hf-stat + FX.counterRoll; keyword → .hf-kw/.hf-kw2; phrase → .hf-kw2 or .hf-card.
4. A flourish (beamSweep, chromeSweep, glitch accent…) at least once mid-scene.
5. CLIMAX FILL — after the LAST beat ends (at its t1), compute climax_budget = DUR − t1. If budget < 0.3s, add NO final flourish (the last beat already carries the ending). If budget ≥ 0.3s, add ONE pulse/scale-drift whose duration ≤ climax_budget and which ENDS at DUR − 0.05s exactly. Never freeze, never overshoot.
6. Finite repeats only: repeat: Math.max(1, Math.ceil(DUR/period)-1). NEVER repeat:-1 (it makes the timeline infinite). All motion within 0..DUR.

HARD TIMING RULES (a frame is only rendered for t in 0..DUR — anything scheduled outside is invisible):
- EVERY tween's (startTime + duration) must be ≤ DUR. The final tween should END at ≈ DUR (climax fill), never past it. Before finishing, mentally check the latest-ending tween is ≤ DUR.
- Match the beat times EXACTLY — do not push a beat later than its given t0, or it may fall past DUR and never show.
- SHORT scene (DUR < 5s): keep it tight — fewer, faster beats (entrances ~0.25s), no long loops; the whole story must land inside DUR.
- LONG scene (DUR > 9s): space beats out and add ambient drift between them so the screen never sits static.

HARD FRAME RULES (keep everything readable and inside the frame — dimensions are given in the user message):
- Reserve the bottom 22% for subtitles: no foreground element's vertical center may sit below 78% of the height.
- Keep a 6% side margin. A hero keyword must fit within 88% of the width — if the text is long, LOWER its font-size (override .hf-kw font-size) so it never clips or wraps past the frame edge.
- Animate the element INSIDE its .hf-slot, never the slot. Big offsets (carrierIn from:340, whipOut x:480) must return/exit within the frame during the visible window.

QUALITY BAR
- 2–4 main elements max. Every element has entrance → living hold (drift/pulse) → exit. No plain opacity-only fades for main beats. Big confident type, generous spacing, palette colors only (plus white/black/transparent). This must feel like an Apple-keynote-grade animation, not a webpage.
- SCALE CHECK before finishing: the main object/keyword must span ≥50% of the frame width at its peak (cards/diagrams included — make them LARGE). A composition where everything is small chips floating in darkness is a defect and will be rejected.`;

const DENSITY_NOTE = {
  minimal: 'MOTION DENSITY: minimal — ONE clean hero element per beat, restrained motion, generous calm negative space. Skip decorative extras.',
  balanced: 'MOTION DENSITY: balanced — a hero element plus ONE supporting graphic per beat, with tasteful flourishes.',
  rich: 'MOTION DENSITY: rich — layer the hero with a supporting graphic, ambient decor and a flourish each beat; maximise tasteful motion (still ≤4 main elements on screen at once, never cluttered).',
};

// v2 guide blocks — semantic colors, concept→visual recipes, HUD vocabulary and per-video
// scene rules travel with every prompt so all scenes speak one visual language.
function guideV2Block(guide) {
  const parts = [];
  const sem = Object.entries(guide.semantics || {});
  if (sem.length) parts.push(`- SEMANTIC COLORS (fixed meaning — use for anything with this meaning, never decoratively): ${sem.map(([k, v]) => `${k}=${v}`).join(' · ')}`);
  if (guide.hud?.kickers?.length || guide.hud?.statuses?.length) {
    parts.push(`- HUD LANGUAGE: add ONE small mono uppercase kicker above/near the headline (prefix like ${(guide.hud.kickers || ['//']).join(' or ')}, letter-spacing ≥0.2em, class .hf-label)${guide.hud.statuses?.length ? `; optionally ONE dim corner status from: ${guide.hud.statuses.join(' · ')} (opacity ≤0.5, ≤22px, never near the focal element)` : ''}.`);
  }
  if (guide.sceneRules?.length) parts.push(`- SCENE RULES (hard):\n${guide.sceneRules.map((r) => `  • ${r}`).join('\n')}`);
  if (guide.conceptMap?.length) parts.push(`- CONCEPT → VISUAL RECIPES (when the narration matches a concept, build THAT visual):\n${guide.conceptMap.map((c) => `  • ${c}`).join('\n')}`);
  return parts.length ? `\n${parts.join('\n')}` : '';
}

export function buildCodegenPrompt({ scene, beats, direction, guide, w, h, duration, idx, total, density, creativeDirection, hookVisual = '' }) {
  const vertical = h > w;
  const densityNote = DENSITY_NOTE[density] || DENSITY_NOTE.balanced;
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

SCENE ${idx + 1}/${total} — ${w}x${h} (${vertical ? 'vertical 9:16-class' : 'horizontal'}), DUR = ${(+duration).toFixed(3)}s
NARRATION (voice, shown as karaoke subtitles at the bottom — do NOT repeat it verbatim on screen):
"${(scene.voice_text || '').trim()}"
VISUAL CONCEPT (art-director brief — when it is structured [LAYOUT]/[ENVIRONMENT]/[MAIN FOCUS]/[CAMERA]/[MOTION FLOW]/[LIGHTING & FX]/[MOOD], FOLLOW it: build ITS main object as your near-layer hero, honor its layout pattern, camera and entry/idle/exit flow — the beat times below still rule WHEN things appear):
"${(scene.visual_prompt || '').trim() || '(design freely from the narration keywords)'}"

CINEMATIC DIRECTION:
${directionBlock(direction)}

BEAT TIMELINE (from the real voice word-timestamps — the visual for each beat must appear at t0 and be gone by t1):
${beatsBlock(beats, duration)}

ICONS available (use as {{icon:name}}): ${HF_ICON_NAMES.join(', ')}

EXAMPLE of a good scene (structure reference — do NOT copy content; note the fenced format):
@@@CSS@@@
${SAMPLE_SPEC.css.trim()}
@@@HTML@@@
${SAMPLE_SPEC.html.trim()}
@@@SCRIPT@@@
${SAMPLE_SPEC.script.trim()}
@@@END@@@

Now design THIS scene. On-screen text = narration language, taken verbatim from the narration. Reply with ONLY the @@@CSS@@@/@@@HTML@@@/@@@SCRIPT@@@/@@@END@@@ fenced blocks.`;
  return [
    { role: 'system', content: CODEGEN_SYSTEM },
    { role: 'user', content: user },
  ];
}
