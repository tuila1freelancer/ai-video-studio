// The master prompt: JSON contract, visual doctrine, language notes, defect re-ask notes.
import { LANG_WPS, LANG_NAME, bibleBlock } from '../../providers/llm.js';
import { HF_LAYOUTS, guideBrief } from '../../pipeline/direction.js';

import { column, lang as langRow } from '../../i18n/languages.js';

// ---------------------------------------------------------------- master prompt
function assetsBlock(assets) {
  if (!assets?.length) return '';
  return `\nPROJECT ASSETS available (assign each to the 1-2 scenes it fits best; name them EXACTLY as listed; a scene with no asset keeps "assets": []):\n${assets.map((a) => `- ${a.name || a} ${a.type ? `| ${a.type}` : ''}`.trim()).join('\n')}\n`;
}

const CONTRACT = `RETURN PURE JSON WITH EXACTLY THIS SHAPE (no markdown, no commentary):
{
  "title": "click-worthy video title ≤60 chars, in the narration language",
  "throughline": "ONE sentence: the single argument the whole video makes",
  "spine": ["ordered logical steps that prove it — first = the exact gap to open on, last = the payoff that resolves it"],
  "scenes": [
    { "stt": 1, "voice": "pure spoken narration only", "visual": "[ENVIRONMENT] … [MAIN FOCUS] … [CAMERA] … [MOTION FLOW] … [LIGHTING & FX] … [TEXT STYLE] … [ON-SCREEN TEXT] … [MOOD] …", "assets": [] }
  ],
  "thumbnail": { "title": "short, strong, mobile-readable thumbnail text", "prompt": "one static cinematic thumbnail: background, main subject, text overlay, layout" }
}
HARD RULES:
- "stt" continuous integers starting at {{STT_BASE}}. No "duration" or any extra field on scenes. "assets" is [] unless assigned from the project list.
- "voice" is ONLY what the narrator speaks aloud. NEVER put production notes there: no "CTA …:" placement notes, no hashtag lines, no "comma-separated" lists, no thumbnail prompts, no titles/captions/descriptions. Those live in their own fields — a CTA is written as a natural spoken sentence inside a scene's narration.
- Voice sentences must be complete — never cut a subject/predicate, an example/result or a question/answer across scenes.`;

const VISUAL_DOCTRINE = `"visual" DOCTRINE — you are a professional motion designer; every scene is a premium animated
motion-graphics shot (Apple-keynote caliber), NEVER a static website layout. Each scene's visual
MUST contain ALL 8 bracket sections, concise (1-2 lines each):
[ENVIRONMENT] background + AT LEAST 3 depth layers (far / mid / near) + atmosphere (particles, fog, bokeh) — one consistent visual family across the WHOLE video so cuts feel continuous
[MAIN FOCUS] the ONE hero subject: a VISUAL METAPHOR for what THIS scene's voice says (an object / diagram / instrument / stat built from SVG line-art + divs — never "display text X"), with position + scale
[CAMERA] slow zoom in 3-5% | zoom out | pan | parallax shift between layers
[MOTION FLOW] Entry: how it appears · Idle: continuous subtle life (float/pulse/drift) · Beat-sync: the spoken keyword lights up as it is said · Exit: how it leaves
[LIGHTING & FX] glow, light sweep, depth blur, gradient light — use the video's palette; warm/danger accents only for risk moments
[TEXT STYLE] bold / minimal / futuristic / kinetic typography
[ON-SCREEN TEXT] 1 short design label (2-4 words, narration language) chosen by MEANING — never subtitles, never the whole voice line
[MOOD] 1-2 words
DIVERSITY IS MANDATORY: every scene's [MAIN FOCUS] must be UNIQUE to that scene's voice — rotate object types and layouts (${HF_LAYOUTS.slice(0, 12).join(' | ')}), never repeat a composition within 2 consecutive scenes, never stamp one template sentence across scenes.
Keep each scene to 2-3 main moving elements. Overly complex scenes = broken HTML.`;

// Per-language narration guidance (reference-app voiceNote parity): tone + address form so
// non-vi/en scripts read like a native presenter, not a translation.
export const LANG_VOICE_NOTES = column('voiceNote');

/**
 * Build the ONE master prompt (messages array). mode 'topic' writes the whole video;
 * mode 'script' light-polishes + slices the owner's script; mode 'source' writes a NEW
 * script from a fetched article (sourceDoc {title,text}). Batch calls append batchNote.
 */
export function buildMasterPrompt({
  mode, input, plan, language = 'vi', guide = null, memory = null, assets = [],
  sttBase = 1, expect = 0, batchNote = '', sourceDoc = null,
} = {}) {
  const langName = LANG_NAME[language] || language;
  const wps = LANG_WPS[language] || 3.0;
  // One lookup, not a Vietnamese special case with everything else as its else-branch — which is
  // how English, the app's second language, ended up with no register guidance at all.
  const persona = LANG_VOICE_NOTES[language] ? `\n- ${LANG_VOICE_NOTES[language]}` : '';
  // Reference-app LANGUAGE OVERRIDE semantics: narration in the target language, the
  // "visual" brief stays English (codegen instructions are English), title follows the voice.
  const langOverride = language !== 'en'
    ? `\n- LANGUAGE: the "voice" field MUST be written in ${langName}. The "visual" field MUST remain in English (it feeds an English-instruction rendering engine) — except [ON-SCREEN TEXT] labels, which are in ${langName}. thumbnail.title in ${langName}; thumbnail.prompt in English.` : '';
  const n = expect || plan.sceneCount;
  // P33 — a PARTIAL span (any call that is not the whole video in one go, batches AND
  // adaptive splits alike) must not carry the whole-video CTA instructions: the closing-CTA
  // order lives in THREE head sources (the scene-1/final-scene line, the CTA-placement line
  // and the structure guide's "+ CTA" tail) and every one of them made each 25-scene batch
  // write its own subscribe block + farewell. Partial prompts defer entirely to the CTA PLAN
  // inside the batch note; the single-call head stays byte-identical (test-pinned).
  const partial = !!batchNote;

  const opener = mode === 'source'
    ? `Write the COMPLETE production script for a ${langName} video from the SOURCE ARTICLE below.

REWRITE, NEVER COPY — the article is research material, not the deliverable:
- Use ONLY facts, ideas, examples and figures that appear in the article; NEVER invent new ones — a precise verb beats a fake number.
- Write completely NEW narration in the channel's own voice: never copy the article's sentences or its persona, and never mention "the article", "the author" or the website — the viewer hears the channel owner talking, not a summary of someone else's post.
- Re-structure the material freely to serve the video (follow the content arc below, not the article's section order).`
    : `Write the COMPLETE production script for a ${langName} video about: "${String(input).trim()}"`;

  const head = mode === 'script'
    ? `Convert the channel owner's detailed script below into the production scenes JSON. LIGHT EDIT ONLY:
- Keep ≥90% of the original wording and EVERY idea, in the original order — the owner's text is the deliverable, you are its editor, not its author.
${partial
    ? '- You may only: fix broken/truncated sentences and grammar slips, and smooth the joins so consecutive scenes read as one continuous talk. CTAs follow the CTA PLAN in the BATCH CONTEXT below — NEVER add any CTA or farewell it does not explicitly plan.'
    : '- You may only: fix broken/truncated sentences and grammar slips, smooth the joins so consecutive scenes read as one continuous talk, and ADD a soft mid-video CTA (a natural spoken sentence, around 25-40% of the way through) plus a closing CTA if the script lacks them.'}
- NEVER invent new content, new examples or new claims; never change the register or persona.${persona}
- Slice at natural idea boundaries, ~${plan.wordsPerScene} words per scene (${plan.minWords}–${plan.maxWords} fine); the total scene count follows the CONTENT.`
    : `${opener}

PLAN THEN WRITE (fill the JSON in this order — the plan comes first on purpose):
1) "throughline": the ONE sentence this whole video argues (an argument, not a topic).
2) "spine": the ordered steps that prove it — open on the exact situation/gap, each step BUILDS on the previous one, end on the payoff that resolves the opening gap.
3) "scenes": render the spine as ONE continuous talk and cut it into ~${n} scenes at natural idea boundaries — scene N+1 picks up exactly where scene N ended.

DURATION SPECS (estimates to pace the writing — real timing follows the TTS):
- total ≈ ${plan.videoDuration}s · ~${plan.sceneDuration}s per scene · target ${n} scenes (exact ${n} preferred)
- voice ≈ ${plan.wordsPerScene} words/scene (safe band ${plan.minWords}–${plan.maxWords}) · whole video ≈ ${n * plan.wordsPerScene} words
- TTS speaks ~${wps.toFixed(1)} words/second and reads FASTER than you imagine — write ENOUGH words, never stubby scenes.
${partial
    ? `- Content arc of the WHOLE video: ${plan.structureGuide.replace(/\s*\+\s*CTA\b/gi, '')} — this call writes ONLY its assigned span of that arc.`
    : `- Content arc: ${plan.structureGuide}.`}

VALUE ARCHITECTURE:
- Every scene TEACHES one concrete, true, non-obvious thing: claim → why/how → ONE specific named example. A scene that is only setup, a transition or a rhetorical question is a FAILED scene.
- Ground every figure: NEVER invent a statistic, percentage or count. A precise verb beats a fake number.
- Scenes connect by LOGIC with forward connectors (${langRow(language).connectors.map((c) => `"${c}"`).join(', ')}) — never tease-questions; at most ONE genuine viewer question in the whole video.
${partial
    ? `- The video's scene 1 opens cold on the exact gap and the video's FINAL scene resolves it — either may live OUTSIDE this span; write only your span, mid-flow.
- CTA placement: follow the CTA PLAN in the BATCH CONTEXT below EXACTLY — a CTA, a thanks-for-watching or a farewell anywhere it is not explicitly planned is a DEFECT.`
    : `- Scene 1 opens cold and concrete on the exact gap; the final scene resolves that same gap, then one natural line to subscribe.
- CTA placement: ONE soft CTA woven in around 25-40% of the video (save/share if the framework helps) + the closing CTA — both as natural spoken sentences tied to the content, never a production note.`}${persona}${langOverride}
- ALL narration written in ${langName}.`;

  const styleBits = [guide ? `\nLOCKED VISUAL STYLE for the whole video:\n${guideBrief(guide)}` : '', bibleBlock(memory), assetsBlock(assets)]
    .filter(Boolean).join('\n');

  const sys = 'You are a film director and screenwriter for premium educational motion-graphics videos. Reply with pure JSON only.';
  const sourceBlock = mode === 'source' && sourceDoc?.text
    ? `\nTHE SOURCE ARTICLE (research material${sourceDoc.title ? `: "${String(sourceDoc.title).trim().slice(0, 160)}"` : ''}):\n"""\n${String(sourceDoc.text).trim().slice(0, 24000)}\n"""\n` : '';
  const usr = `${head}
${mode === 'script' ? `\nTHE OWNER'S SCRIPT (source of truth):\n"""\n${String(input).trim().slice(0, 24000)}\n"""\n` : ''}${sourceBlock}${styleBits}

${VISUAL_DOCTRINE}

${CONTRACT.replace('{{STT_BASE}}', String(sttBase))}${batchNote}`;
  return [{ role: 'system', content: sys }, { role: 'user', content: usr }];
}

export function defectNote(defects, expect) {
  const lines = defects.slice(0, 8).map((d) => {
    const at = Array.isArray(d.stt) ? ` (scenes ${d.stt.slice(0, 10).join(', ')})` : d.stt != null ? ` (scene ${d.stt})` : '';
    return `- ${d.code}${at}: ${d.detail}`;
  });
  return `\n\nYOUR PREVIOUS ANSWER HAD DEFECTS — fix ALL of them this time${expect ? ` and return ~${expect} scenes` : ''}:\n${lines.join('\n')}`;
}
