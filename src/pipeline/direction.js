// Per-scene cinematic direction — the art-director pass between script (B2) and HyperFrame
// codegen (B5). One batched LLM pass over the scene list writes a structured visual brief per
// scene ([LAYOUT]/[ENVIRONMENT]/[MAIN FOCUS]/[CAMERA]/[MOTION FLOW]/[LIGHTING & FX]/[MOOD]),
// so long videos stop shipping `voice.slice(0,90)` as their only visual concept. Directions
// see the WHOLE batch → adjacent scenes vary layout, the climax rhymes with the hook, and the
// guide's semantic colors / concept-map recipes are applied consistently.
//
// Failure never blocks the pipeline: a batch that can't be generated keeps the scenes'
// existing visual_prompt (codegen still works, just with a weaker brief).
import { chatJson, llmEnabled } from '../providers/llm.js';

// A structured direction always carries a [MAIN FOCUS] section — used as the "already
// directed" marker so resume runs and user-edited briefs are never overwritten.
const DIRECTED = /\[MAIN FOCUS\]/i;
export function hasDirection(scene) { return DIRECTED.test(scene?.visual_prompt || ''); }

// Scene layout taxonomy: distilled from the @TuiLa1Freelancer reference channel, plus the
// five HyperFrames blueprint shapes that cover roles the original ten lacked
// (docs/reference/hyperframes-notes.md → Blueprints).
export const HF_LAYOUTS = [
  'hero-center',        // 1 giant keyword/number centered + kicker + label
  'split-lr',           // text on one side, prop/diagram/icon on the other
  'list-steps',         // vertical numbered list 01/02/03, items revealed per beat
  'compare-ab',         // 2 symmetric cards/panels (pass vs fail, A vs B)
  'grid-cards',         // 2-4 equal cards: icon + keyword
  'timeline',           // horizontal stepper/timeline, active node lit
  'radial-hub',         // 1 central core + wired satellites
  'stat-hero',          // giant stat number + supporting line/bar
  'terminal',           // mono window with typewriter text
  'quote-punch',        // 1 short emphasized line/phrase, minimal
  'kinetic-type-beats', // the WORDS are the motion: a held line swaps its accent token per beat, or a statement builds block-by-block onto a payoff
  'ticker-takeover',    // typed lead-in + cycling accent word, then the hero element crashes in and shoves the text aside (hook/outro energy)
  'overwhelm-surround', // accumulation pressure: recognizable items pile in from all sides around a center subject (pain/problem scenes)
  'pan-stations',       // labeled stations pre-placed on one oversized canvas; a virtual camera pans station to station (processes, journeys)
  'titlecard-reveal',   // the calm breather: ONE restrained move (slide-up crossfade / wipe-to-reveal), then a still hold — low motion IS the payload
];

const BATCH = 14; // scenes per LLM call — big enough for coherence, small enough to stay valid

function guideBrief(guide) {
  const g = guide || {};
  const pal = g.palette || {};
  const sem = Object.entries(g.semantics || {}).map(([k, v]) => `${k}=${v}`).join(' ');
  const lines = [
    `Background ${pal.bg} · ink ${pal.ink} · accents ${(pal.accents || []).join(' ')}${sem ? ` · semantic colors: ${sem}` : ''}`,
    `Background motif: ${g.motif} · text treatment: ${g.textTreatment} · motion personality: ${g.motionPersonality}`,
  ];
  if (g.sceneRules?.length) lines.push(`Scene rules: ${g.sceneRules.join(' · ')}`);
  return lines.join('\n');
}

function batchPrompt({ batch, title, total, guide, hookSummary, language }) {
  const conceptMap = (guide?.conceptMap || []).map((c) => `• ${c}`).join('\n');
  const list = batch.map((sc) => `${sc.idx}. "${String(sc.voice_text || '').trim().slice(0, 360)}"`).join('\n');
  const sys = 'You are an art director for premium Apple-keynote-style motion-graphics videos. Reply with pure JSON, no commentary.';
  const usr = `Video "${title}" (${total} scenes, narration in ${language || 'Vietnamese'}). The LOCKED style for the whole video:
${guideBrief(guide)}

Write the VISUAL DIRECTION for each scene below. For each scene return:
- "idx": the scene number (unchanged from the input)
- "role": this scene's job in the retention arc — one of: hook | problem | insight | step | proof | payoff | cta
- "layout": pick 1 of: ${HF_LAYOUTS.join(' | ')} — true to the content's nature, NEVER the same layout more than 2 scenes in a row
- "visual": a CONCISE English description following EXACTLY this frame (one line per section):
[ENVIRONMENT] far=…, mid=…, near=… + atmosphere (grounded in the style's motif)
[MAIN FOCUS] ONE hero subject that is a VISUAL METAPHOR for the narration's meaning (an object/diagram/stat/metaphor drawable with SVG line-art + divs — NOT "display text X"), position + scale (dominant/subtle)
[CAMERA] slow zoom in 3-5% | zoom out | pan | parallax shift
[MOTION FLOW] Entry: … Idle: … Exit: …
[CHOREOGRAPHY] one motion VERB per element — SLAMS / STAMPS (impact) · SLIDES / WIPES (directional) · DRAWS / FILLS / GROWS / ASSEMBLES / COUNTS UP (builds) · FLOATS / ORBITS (organic) · TYPES ON / LOCKS IN / SNAPS (mechanical). If you can't name an element's verb, that element isn't designed yet.
[LIGHTING & FX] glow/light-sweep/depth-blur using the style's colors (good concepts→good, risk/mistakes→bad, warnings→warn)
[MOOD] 1-2 words

ROLE → LAYOUT menu (a soft guide — the content's truth wins):
hook → kinetic-type-beats | ticker-takeover | stat-hero · problem → overwhelm-surround | compare-ab | quote-punch · insight → hero-center | radial-hub | split-lr · step → list-steps | timeline | pan-stations · proof → stat-hero | grid-cards | compare-ab · payoff → hero-center | stat-hero (echo the hook motif) · cta → titlecard-reveal | quote-punch | kinetic-type-beats

RULES:
- At most 2-3 main moving elements per scene, EXACTLY 1 focal element. An overcomplicated scene = broken code.
- The video's first scene (the hook) = the most striking one.${hookSummary ? `\n- If the LAST scene of this batch is the video's closing scene: ECHO the hook scene's motif ("${hookSummary.slice(0, 160)}") at a larger scale + stronger glow (visual rhyme).` : ''}
- Pacing needs a breather: in a batch of 8+ scenes, direct at least ONE titlecard-reveal (a calm landing beat — one restrained move, then a hold).
- NEVER describe a static website-style layout. Target: cinematic motion graphics.${conceptMap ? `\n- CONCEPT RECIPES (when a concept matches, use its exact recipe):\n${conceptMap}` : ''}

Scenes (idx. "narration"):
${list}

JSON: {"scenes":[{"idx":${batch[0].idx},"role":"…","layout":"…","visual":"[ENVIRONMENT] …"}]}  — exactly ${batch.length} elements, idx matching the input.`;
  return [{ role: 'system', content: sys }, { role: 'user', content: usr }];
}

const HF_ROLES = ['hook', 'problem', 'insight', 'step', 'proof', 'payoff', 'cta'];

function cleanDirection(d) {
  const layout = HF_LAYOUTS.includes(String(d.layout || '').trim()) ? String(d.layout).trim() : 'hero-center';
  const role = HF_ROLES.includes(String(d.role || '').trim().toLowerCase()) ? String(d.role).trim().toLowerCase() : '';
  let visual = String(d.visual || '').trim().slice(0, 1400);
  if (!DIRECTED.test(visual)) return null;
  if (!/^\[LAYOUT\]/i.test(visual)) visual = `[LAYOUT] ${layout}\n${visual}`;
  // [ROLE] rides at the top of the brief: codegen reads it for energy, the transition
  // planner reads it to place hero transitions at payoff/cta boundaries.
  if (role && !/\[ROLE\]/i.test(visual)) visual = `[ROLE] ${role}\n${visual}`;
  return { layout, role, visual };
}

/**
 * Generate directions for scenes that need one. Returns Map<idx, {layout, visual}> —
 * missing entries mean "keep the existing visual_prompt". Never throws.
 */
export async function generateDirections(scenes, { title = '', total = 0, guide = null, ai = null, language = '', onLog = () => {} } = {}) {
  const out = new Map();
  const llm = ai?.llm || null;
  if (!scenes.length || !llmEnabled(llm)) return out;
  const hookSummary = (scenes[0]?.idx === 0 ? scenes[0]?.voice_text : '') || '';
  for (let i = 0; i < scenes.length; i += BATCH) {
    const batch = scenes.slice(i, i + BATCH);
    try {
      const parsed = await chatJson(
        batchPrompt({ batch, title, total: total || scenes.length, guide, language,
          hookSummary: batch.some((s) => s.idx >= (total || scenes.length) - 1) ? hookSummary : '' }),
        {
          maxTokens: batch.length * 460 + 500, attempts: 2, llm,
          validate: (p) => Array.isArray(p.scenes) && p.scenes.length > 0,
        },
      );
      let got = 0;
      for (const d of parsed.scenes) {
        const idx = Number(d.idx);
        if (!batch.some((s) => s.idx === idx)) continue;
        const clean = cleanDirection(d);
        if (clean) { out.set(idx, clean); got++; }
      }
      onLog(`direction: batch ${Math.floor(i / BATCH) + 1} — ${got}/${batch.length} scenes directed`);
    } catch (e) {
      onLog(`direction: batch ${Math.floor(i / BATCH) + 1} failed (${String(e.message).slice(0, 80)}) — keeping old visual prompts`);
    }
  }
  return out;
}

// Single-scene variant for regenerate-one flows.
export async function generateSceneDirection(scene, opts = {}) {
  const dirs = await generateDirections([scene], { ...opts, total: opts.total || 1 });
  return dirs.get(scene.idx) || null;
}
