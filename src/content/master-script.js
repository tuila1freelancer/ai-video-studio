// Master Script Engine — ONE master prompt turns (a topic | a detailed owner script | a
// pasted scenes JSON) into the canonical production scenes JSON:
//
//   { "thumbnail": { "title", "prompt" },
//     "scenes": [ { "stt": 1, "voice": "…", "visual": "[ENVIRONMENT]…[MOOD]…", "assets": [] } ] }
//
// — the exact contract of the owner's content factory (and of the reference VideoPipeline
// app, whose extracted master prompt this engine descends from). Everything downstream of
// B2 then only consumes voice (TTS) + visual (HyperFrame codegen): a master visual carries
// [MAIN FOCUS], so the separate art-director pass skips it (direction.js DIRECTED marker).
//
// Four input modes:
//   'json'   — pasted scenes JSON: parse + validate + repair, ZERO LLM calls.
//   'script' — a detailed script (≥80 words): LIGHT POLISH only — keep ~90% of the wording
//              and every idea in order; fix broken sentences, smooth scene joins, add the
//              soft + closing CTA if missing. Guarded by the POLISH_FLOOR gate.
//   'topic'  — a topic name: the master prompt writes the whole video (plan-then-write:
//              throughline → spine → scenes), then the same visual doctrine applies.
//   'source' — a fetched article (URL input): write a NEW script FROM the material — the
//              topic doctrine with research attached, never polish (an article's words are
//              source material, not the owner's wording to preserve).
//
// Reliability model (weak models welcome): chatJson handles fences/JSON repair; this engine
// adds a defect-driven re-ask round (validator names the broken scenes), then a deterministic
// final repair — META_LEAK/NOT_SPEAKABLE scenes are DROPPED (never persisted — P18),
// defective visuals are STRIPPED so the existing direction pass re-directs just those scenes.
// Videos longer than 30 scenes generate in batches of 25 with rolling context (the last 3
// voices of the previous batch), the pattern proven by the reference app.
import {
  chatJson, llmEnabled, wordsForSlot, splitSentences,
  LANG_WPS, LANG_NAME, scriptLang, topNouns, offlineScript, scriptBudgetOk, bibleBlock,
} from '../providers/llm.js';
import { HF_LAYOUTS, guideBrief } from '../pipeline/direction.js';
import { wordCount, safeJson } from '../util/util.js';

// The 8 canonical visual sections (factory schema hard gate). A master visual must carry
// [MAIN FOCUS] plus at least MIN_BRACKETS of these to count as "directed".
export const VISUAL_BRACKETS = ['ENVIRONMENT', 'MAIN FOCUS', 'CAMERA', 'MOTION FLOW', 'LIGHTING & FX', 'TEXT STYLE', 'ON-SCREEN TEXT', 'MOOD'];
const MIN_BRACKETS = 5;
const BATCH_TRIGGER = 30; // > this many target scenes → batched generation
const BATCH_SIZE = 25;
// Inputs of at least this many words are a DETAILED SCRIPT (light-polish mode), not a topic.
// Shared with stages/budget.js so "owner's words → duration follows content" uses the same line.
export const SCRIPT_MODE_MIN_WORDS = 80;

// ---------------------------------------------------------------- duration planner
function structureGuideFor(videoDuration) {
  if (videoDuration < 90) return 'hook → one core insight → one concrete example → payoff + CTA';
  if (videoDuration < 300) return 'hook → the problem → the core explanation → 2-3 concrete examples/steps → one common mistake + fix → recap + CTA';
  return 'hook → problem/misconception → core concept explained simply → step-by-step process → 3+ real examples → common mistakes + fixes → checklist recap → CTA';
}

/** Word/scene arithmetic shared by the prompt, the validator and the batcher. */
export function planScenes({ videoDuration = 60, sceneDuration = 7, language = 'vi' } = {}) {
  const safeSceneDuration = Math.min(12, Math.max(4, +sceneDuration || 7));
  const dur = Math.max(10, +videoDuration || 60);
  const sceneCount = Math.max(1, Math.round(dur / safeSceneDuration));
  const wordsPerScene = wordsForSlot(safeSceneDuration, language);
  return {
    videoDuration: dur, sceneDuration: safeSceneDuration, sceneCount, wordsPerScene,
    minWords: Math.max(4, wordsPerScene - 3), maxWords: wordsPerScene + 4,
    totalWords: sceneCount * wordsPerScene, structureGuide: structureGuideFor(dur),
  };
}

// ---------------------------------------------------------------- tolerant input parse
/** Pasted scenes JSON (factory format, {script:[…]}, or a bare array) → raw object, else null. */
export function parseScenesInput(text) {
  const s = String(text || '').trim();
  if (!(s.startsWith('{') || s.startsWith('['))) return null;
  const parsed = safeJson(s, null);
  if (!parsed || typeof parsed !== 'object') return null;
  const arr = Array.isArray(parsed) ? parsed
    : Array.isArray(parsed.scenes) ? parsed.scenes
      : Array.isArray(parsed.script) ? parsed.script
        : Object.values(parsed).find((v) => Array.isArray(v));
  if (!Array.isArray(arr) || !arr.length) return null;
  if (!arr.some((x) => x && typeof x === 'object' && (x.voice || x.text || x.narration))) return null;
  return parsed;
}

// ---------------------------------------------------------------- validator + normalizer
function bracketSection(visual, name) {
  const re = new RegExp(`\\[${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]([\\s\\S]*?)(?=\\[[A-Z][A-Z &-]*\\]|$)`, 'i');
  const m = String(visual || '').match(re);
  return m ? m[1].trim() : '';
}
function bracketCount(visual) {
  return VISUAL_BRACKETS.reduce((n, b) => n + (new RegExp(`\\[${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]`, 'i').test(visual) ? 1 : 0), 0);
}
const tokenSet = (s) => new Set((String(s || '').toLowerCase().replace(/\d+/g, ' ').match(/[\p{L}]{2,}/gu) || []));
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

// Voice lines that are production METADATA, not narration — the exact leak observed in the
// factory's real output (CTA placement notes, hashtag lines, a thumbnail prompt read aloud).
// TTS must never speak these; P18 pins that they are never persisted.
const META_LEAK_RES = [
  /^\s*[-•*]?\s*(?:CTA|Hashtags?|Thumbnail|Title|Caption|Description|Mô tả video|Bình luận ghim|Pinned comment)\b[^:]{0,60}:/i,
  /\bcomma-separated\b/i,
  /(?:#[\p{L}\p{N}_]+\s*[, ]\s*){2,}#[\p{L}\p{N}_]+/u, // a run of 3+ hashtags
  /\bthumbnail\b[\s\S]{0,160}\b(?:16:9|9:16|1:1|4:5)\b|\b(?:16:9|9:16|1:1|4:5)\b[\s\S]{0,160}\bthumbnail\b/i,
];
const NOT_SPEAKABLE_RES = [/https?:\/\//i, /```/, /\{\{[\s\S]*?\}\}/, /^#{1,6}\s/m, /<[a-z][^>]*>/i];
export function isMetaLeakVoice(voice) { return META_LEAK_RES.some((re) => re.test(String(voice || ''))); }

function normalizeScene(s, i) {
  const voice = String(s?.voice ?? s?.text ?? s?.narration ?? '').trim();
  const visual = String(s?.visual ?? s?.visualPrompt ?? '').trim();
  const assets = Array.isArray(s?.assets) ? s.assets.map((a) => String(a ?? '').trim()).filter(Boolean) : [];
  return { stt: i + 1, voice, visual, assets };
}

function synthThumbnail(spec, fallbackTitle) {
  const t = spec?.thumbnail || {};
  const title = String(t.title || fallbackTitle || spec?.scenes?.[0]?.voice || 'Video thumbnail').trim().slice(0, 120);
  const prompt = String(t.prompt || '').trim()
    || `Static cinematic thumbnail for the video "${title}". Clear layout, strong contrast, one dominant subject, short bold text overlay, no real logos or people.`;
  return { title, prompt };
}

/**
 * Pure validate + normalize. Returns { spec, defects } — spec is the normalized canonical
 * JSON (stt renumbered from 1, assets coerced, extra fields stripped, thumbnail synthesized),
 * defects is a list of { code, stt?, detail } the engine feeds back into a re-ask or repairs.
 * mode 'script' additionally enforces the POLISH_FLOOR against `source`.
 */
export function validateScenesJson(raw, { mode = 'topic', plan = null, source = '', language = 'vi', expect = 0 } = {}) {
  const defects = [];
  const rootArr = Array.isArray(raw) ? raw
    : Array.isArray(raw?.scenes) ? raw.scenes
      : Array.isArray(raw?.script) ? raw.script
        : Object.values(raw || {}).find((v) => Array.isArray(v)) || [];
  const scenes = [];
  rootArr.forEach((s, i) => {
    const n = normalizeScene(s, scenes.length);
    if (!n.voice) { defects.push({ code: 'EMPTY', stt: i + 1, detail: 'scene has no voice' }); return; }
    scenes.push(n);
  });
  if (!scenes.length) defects.push({ code: 'EMPTY', detail: 'no usable scenes' });

  for (const sc of scenes) {
    if (isMetaLeakVoice(sc.voice)) {
      defects.push({ code: 'META_LEAK', stt: sc.stt, detail: `voice is production metadata, not narration: "${sc.voice.slice(0, 80)}"` });
    } else if (NOT_SPEAKABLE_RES.some((re) => re.test(sc.voice))) {
      defects.push({ code: 'NOT_SPEAKABLE', stt: sc.stt, detail: `voice contains URL/markup/code: "${sc.voice.slice(0, 80)}"` });
    }
    if (sc.visual && (!/\[MAIN FOCUS\]/i.test(sc.visual) || bracketCount(sc.visual) < MIN_BRACKETS)) {
      defects.push({ code: 'BRACKETS', stt: sc.stt, detail: `visual misses [MAIN FOCUS] or has <${MIN_BRACKETS}/8 bracket sections` });
    }
  }

  // MONOTONY: [MAIN FOCUS] must be scene-specific. Digits are stripped before comparing so
  // "Scene 4: …" vs "Scene 5: …" template stamps still count as duplicates.
  const withFocus = scenes.filter((sc) => sc.visual);
  const focusSets = withFocus.map((sc) => ({ stt: sc.stt, set: tokenSet(bracketSection(sc.visual, 'MAIN FOCUS') || sc.visual) }));
  const dupStt = [];
  for (let i = 1; i < focusSets.length; i++) {
    for (let j = 0; j < i; j++) {
      if (jaccard(focusSets[i].set, focusSets[j].set) >= 0.75) { dupStt.push(focusSets[i].stt); break; }
    }
  }
  if (withFocus.length >= 4 && dupStt.length / withFocus.length > 0.5) {
    defects.push({ code: 'MONOTONY', stt: dupStt, detail: `${dupStt.length}/${withFocus.length} visuals share a near-identical [MAIN FOCUS]` });
  }

  // Count band (soft): only when a target is known. ≥70% floor mirrors P4.
  if (expect > 0 && scenes.length) {
    const lo = Math.max(1, Math.ceil(expect * 0.7)); const hi = Math.max(lo + 1, Math.ceil(expect * 1.35));
    if (scenes.length < lo || scenes.length > hi) {
      defects.push({ code: 'COUNT', detail: `returned ${scenes.length} scenes, need ${lo}–${hi} (target ${expect})` });
    }
  }
  // 'source' writes fresh narration toward the duration target exactly like 'topic' does,
  // so the same word budget applies (POLISH_FLOOR below stays script-only by design).
  if ((mode === 'topic' || mode === 'source') && plan && scenes.length && !scriptBudgetOk(scenes, plan.wordsPerScene, language)) {
    defects.push({ code: 'WORD_BUDGET', detail: `mean words/scene far above the ~${plan.wordsPerScene} budget` });
  }

  // POLISH_FLOOR ('script' mode): the owner's wording must survive. Per scene ≥60% of its
  // tokens must come from the source (up to 2 fully-new scenes are allowed — the added CTAs),
  // and ≥70% of the source's tokens must reappear somewhere in the output (nothing dropped).
  if (mode === 'script' && source && scenes.length) {
    const srcTokens = tokenSet(source);
    const outTokens = new Set();
    let freshScenes = 0; const freshStt = [];
    for (const sc of scenes) {
      const toks = [...tokenSet(sc.voice)];
      toks.forEach((t) => outTokens.add(t));
      if (!toks.length) continue;
      const kept = toks.filter((t) => srcTokens.has(t)).length / toks.length;
      if (kept < 0.6) { freshScenes++; freshStt.push(sc.stt); }
    }
    let covered = 0;
    for (const t of srcTokens) if (outTokens.has(t)) covered++;
    const coverage = srcTokens.size ? covered / srcTokens.size : 1;
    if (freshScenes > 2) defects.push({ code: 'POLISH_FLOOR', stt: freshStt, detail: `${freshScenes} scenes are rewritten (>40% new words) — light edit only, keep the owner's wording` });
    if (coverage < 0.7) defects.push({ code: 'POLISH_FLOOR', detail: `only ${(coverage * 100) | 0}% of the owner's words survived — content was dropped` });
  }

  const spec = {
    title: String(raw?.title || '').trim().slice(0, 64),
    thumbnail: synthThumbnail(raw, String(raw?.title || '').trim()),
    scenes,
  };
  return { spec, defects, ok: defects.length === 0 };
}

// Deterministic final repair: drop unspeakable scenes, strip broken/duplicated visuals
// (direction.js re-directs those), renumber. This is the P18 floor — a META_LEAK voice can
// never leave this function alive.
export function repairScenesSpec(spec, defects) {
  const dropStt = new Set(); const stripStt = new Set();
  for (const d of defects) {
    const list = Array.isArray(d.stt) ? d.stt : d.stt != null ? [d.stt] : [];
    if (d.code === 'META_LEAK' || d.code === 'NOT_SPEAKABLE' || d.code === 'EMPTY') list.forEach((x) => dropStt.add(x));
    if (d.code === 'BRACKETS' || d.code === 'MONOTONY') list.forEach((x) => stripStt.add(x));
  }
  const scenes = spec.scenes
    .filter((sc) => !dropStt.has(sc.stt))
    .map((sc, i) => ({ stt: i + 1, voice: sc.voice, visual: stripStt.has(sc.stt) ? '' : sc.visual, assets: sc.assets }));
  return { ...spec, scenes };
}

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
  const persona = language === 'vi'
    ? '\n- Persona: the narrator says "mình", the audience is "các bạn" — never "tôi", never singular "bạn".' : '';
  const n = expect || plan.sceneCount;

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
- You may only: fix broken/truncated sentences and grammar slips, smooth the joins so consecutive scenes read as one continuous talk, and ADD a soft mid-video CTA (a natural spoken sentence, around 25-40% of the way through) plus a closing CTA if the script lacks them.
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
- Content arc: ${plan.structureGuide}.

VALUE ARCHITECTURE:
- Every scene TEACHES one concrete, true, non-obvious thing: claim → why/how → ONE specific named example. A scene that is only setup, a transition or a rhetorical question is a FAILED scene.
- Ground every figure: NEVER invent a statistic, percentage or count. A precise verb beats a fake number.
- Scenes connect by LOGIC with forward connectors (${language === 'vi' ? '"vì vậy…", "nhưng…", "vậy nên…"' : '"so…", "but…", "which is why…"'}) — never tease-questions; at most ONE genuine viewer question in the whole video.
- Scene 1 opens cold and concrete on the exact gap; the final scene resolves that same gap, then one natural line to subscribe.
- CTA placement: ONE soft CTA woven in around 25-40% of the video (save/share if the framework helps) + the closing CTA — both as natural spoken sentences tied to the content, never a production note.${persona}
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

function defectNote(defects, expect) {
  const lines = defects.slice(0, 8).map((d) => {
    const at = Array.isArray(d.stt) ? ` (scenes ${d.stt.slice(0, 10).join(', ')})` : d.stt != null ? ` (scene ${d.stt})` : '';
    return `- ${d.code}${at}: ${d.detail}`;
  });
  return `\n\nYOUR PREVIOUS ANSWER HAD DEFECTS — fix ALL of them this time${expect ? ` and return ~${expect} scenes` : ''}:\n${lines.join('\n')}`;
}

// ---------------------------------------------------------------- canonical export builder
/** Build the canonical factory-format JSON from DB rows (DB stays the source of truth). */
export function scenesJsonFromRows(project, rows) {
  const md = project?.metadata && typeof project.metadata === 'object' ? project.metadata : safeJson(project?.metadata, {}) || {};
  const thumbnail = synthThumbnail({ thumbnail: md.thumbnail }, project?.title || project?.topic || '');
  return {
    thumbnail,
    scenes: (rows || []).map((r, i) => ({
      stt: i + 1,
      voice: String(r.voice_text || ''),
      visual: String(r.visual_prompt || ''),
      assets: [],
    })),
  };
}

// ---------------------------------------------------------------- orchestrator
function toPipelineShape(spec, { mode, defects = [] } = {}) {
  return {
    title: (spec.title || spec.thumbnail?.title || spec.scenes[0]?.voice || 'Video mới').slice(0, 64),
    thumbnail: spec.thumbnail,
    scenes: spec.scenes.map((s) => ({
      voice: s.voice,
      visualPrompt: s.visual, // [MAIN FOCUS] inside → direction pass skips this scene
      keywords: topNouns(s.voice, 3),
    })),
    raw: { thumbnail: spec.thumbnail, scenes: spec.scenes },
    mode,
    warnings: defects,
  };
}

async function askOnce({ messages, expect, plan, mode, source, language, llm, onLog }) {
  // Output ceiling: ~perScene tokens buys one scene's voice + 8-bracket visual + JSON glue,
  // so a full 25-scene batch needs ~9k — and chatOnce (P1) floors every request at 16k for
  // hidden reasoning, so the content always fits with thinking headroom to spare. If a model
  // still overruns its window, chatJson's repairJson salvages the truncated array and
  // generateSpan splits the span into smaller calls — length degrades granularity, never the run.
  const perScene = Math.max(130, plan.wordsPerScene * 4) + 220; // voice + 8-bracket visual
  const parsed = await chatJson(messages, {
    maxTokens: Math.min(30000, expect * perScene + 800), attempts: 2, llm,
    validate: (p) => {
      const arr = Array.isArray(p?.scenes) ? p.scenes : Array.isArray(p?.script) ? p.script : Array.isArray(p) ? p : null;
      return Array.isArray(arr) && arr.filter((s) => s?.voice || s?.text).length >= Math.max(1, Math.ceil(expect * 0.5));
    },
  });
  const v = validateScenesJson(parsed, { mode, plan, source, language, expect });
  onLog(`master-script: got ${v.spec.scenes.length}/${expect} scenes, ${v.defects.length} defect(s)${v.defects.length ? ` [${[...new Set(v.defects.map((d) => d.code))].join(',')}]` : ''}`);
  return v;
}

// One generation unit (whole video or one batch): ask → defect re-ask → deterministic repair.
async function generateChunk({ mode, input, plan, expect, sttBase, batchNote, language, guide, memory, assets, llm, onLog, sourceDoc = null }) {
  const base = buildMasterPrompt({ mode, input, plan, language, guide, memory, assets, sttBase, expect, batchNote, sourceDoc });
  let best = null;
  for (let round = 0; round < 2; round++) {
    const messages = round === 0 || !best?.defects?.length ? base
      : [base[0], { role: 'user', content: base[1].content + defectNote(best.defects, expect) }];
    try {
      const v = await askOnce({ messages, expect, plan, mode, source: mode === 'script' ? input : '', language, llm, onLog });
      if (!best || v.defects.length < best.defects.length) best = v;
      if (v.ok) break;
    } catch (e) {
      onLog(`master-script: attempt ${round + 1} failed (${String(e.message).slice(0, 100)})`);
      if (round === 1 && !best) throw e;
    }
  }
  const spec = best.ok ? best.spec : repairScenesSpec(best.spec, best.defects);
  if (!spec.scenes.length) throw new Error('master-script: no usable scenes after repair');
  return { spec, defects: best.ok ? [] : best.defects };
}

// ---------------------------------------------------------------- adaptive spans
const MIN_SPLIT = 6; // halves below this many scenes lose the narrative thread — stop splitting

/**
 * Word-balanced partition of the source sentences over targetCount scenes ('script' mode).
 * Returns slice(fromScene, toScene) → the sentences whose cumulative word share covers that
 * scene span. Cut points are fixed by (sentences, targetCount) alone and shared between
 * adjacent spans, so batching — and any adaptive re-split of a batch — tiles the source
 * EXACTLY: no sentence dropped, none duplicated, order preserved.
 */
export function sourceSlicer(sentences, targetCount) {
  const cum = [0];
  for (const s of sentences) cum.push(cum[cum.length - 1] + wordCount(s));
  const total = cum[cum.length - 1];
  const cut = (k) => { // first sentence index whose cumulative words reach k scenes' share
    if (k <= 0 || !total) return 0;
    if (k >= targetCount) return sentences.length;
    const want = (k / targetCount) * total;
    let lo = 0, hi = sentences.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] >= want) hi = mid; else lo = mid + 1; }
    return lo;
  };
  return (from, to) => sentences.slice(cut(from - 1), cut(to)).join(' ');
}

function sceneTail(scenes) {
  return scenes.slice(-3).map((s) => `  - "${s.voice.slice(0, 90)}${s.voice.length > 90 ? '…' : ''}"`).join('\n');
}

function batchNoteFor({ label, from, to, targetCount, tail, closes }) {
  if (from === 1 && to === targetCount && !tail) return ''; // the whole video in one call
  return `\n\nBATCH CONTEXT:
- This is ${label || 'one batch'} of a ${targetCount}-scene video. Produce scenes ${from} to ${to} (${to - from + 1} scenes), "stt" numbered from ${from}.
${tail ? `- The last scenes so far (CONTINUE this thread naturally, do not repeat it):\n${tail}` : '- Open with the strongest hook.'}
${from > 1 ? '- Do NOT re-open the video: no new greeting, no re-introduction.' : ''}${closes ? '\n- This batch ENDS the video: resolve the opening gap + closing CTA.' : ''}`;
}

/**
 * One adaptive generation span [from..to]. When a reply looks TRUNCATED — invalid JSON even
 * after repairJson, or far fewer scenes than asked (the model ran out of output window) —
 * the span SPLITS in two and each half generates in its own smaller call: dynamic batch-size
 * lowering, so an output overflow degrades to more, smaller calls instead of a dead run.
 * The second half continues from the first half's real tail, keeping the spoken thread
 * continuous across the split exactly like it is across normal batch boundaries.
 */
async function generateSpan({ common, from, to, targetCount, label, tail, closes, slice, topicText }) {
  const expect = to - from + 1;
  // whole-video 'script' calls keep the owner's raw text (paragraph breaks help the model);
  // batch/sub-spans take their word-balanced share of the sentence partition.
  const input = slice ? (from === 1 && to === targetCount ? topicText : slice(from, to)) : topicText;
  if (slice && !input) {
    common.onLog(`master-script: scenes ${from}–${to} carry no source words (a long sentence fell to a neighbour span) — skipped`);
    return { spec: { title: '', thumbnail: null, scenes: [] }, defects: [] };
  }
  const batchNote = batchNoteFor({ label, from, to, targetCount, tail, closes });
  let why;
  try {
    const r = await generateChunk({ ...common, input, expect, sttBase: from, batchNote });
    if (r.spec.scenes.length >= Math.ceil(expect * 0.7) || expect < MIN_SPLIT * 2) return r;
    why = `only ${r.spec.scenes.length}/${expect} scenes came back`;
  } catch (e) {
    if (expect < MIN_SPLIT * 2) throw e;
    why = String(e.message).slice(0, 80);
  }
  common.onLog(`master-script: scenes ${from}–${to} (${why}) — splitting into two smaller calls`);
  const mid = from + Math.ceil(expect / 2) - 1;
  const a = await generateSpan({ common, from, to: mid, targetCount, label, tail, closes: false, slice, topicText });
  const b = await generateSpan({
    common, from: mid + 1, to, targetCount, label,
    tail: a.spec.scenes.length ? sceneTail(a.spec.scenes) : tail, closes, slice, topicText,
  });
  const lead = a.spec.scenes.length ? a.spec : b.spec;
  return { spec: { ...lead, scenes: [...a.spec.scenes, ...b.spec.scenes] }, defects: [...a.defects, ...b.defects] };
}

/**
 * The engine entry point. Returns { title, thumbnail, scenes:[{voice, visualPrompt, keywords}],
 * raw (canonical factory JSON), mode, warnings }. Never throws while an offline fallback can
 * still produce a script; JSON input never spends an LLM call. A fetched article passed as
 * `source` {title,text} switches the engine to mode 'source' (new script FROM the material).
 */
export async function generateMasterScenes({ input, source = null, config = {}, ai = null, memory = null, guide = null, assets = [], onLog = () => {} } = {}) {
  const llm = ai?.llm || null;
  const text = String(input || '').trim();
  const sourceText = String(source?.text || '').trim();
  const language = scriptLang(config, sourceText || text);

  // 1) Pasted scenes JSON → normalize + repair, zero LLM cost. META_LEAK scenes are dropped
  //    (the factory's own files carry that defect — TTS must not read hashtags aloud).
  const pasted = parseScenesInput(text);
  if (pasted) {
    const v = validateScenesJson(pasted, { mode: 'json', language });
    const spec = v.ok ? v.spec : repairScenesSpec(v.spec, v.defects);
    if (!spec.scenes.length) throw new Error('Scenes JSON has no usable narration scenes');
    for (const d of v.defects) onLog(`scenes-json import: ${d.code}${d.stt != null ? ` @${Array.isArray(d.stt) ? d.stt.join(',') : d.stt}` : ''} — ${d.detail}`);
    return toPipelineShape(spec, { mode: 'json', defects: v.defects });
  }

  // 'source' (fetched article) outranks the word-count sniff: a long article is research
  // material for a NEW script, never a detailed owner script to polish.
  const mode = sourceText ? 'source' : wordCount(text) >= SCRIPT_MODE_MIN_WORDS ? 'script' : 'topic';
  const plan = planScenes({ videoDuration: config.videoDuration, sceneDuration: config.sceneDuration, language });
  // 'script' mode: the owner's content decides the length — the duration target does not.
  const targetCount = mode === 'script'
    ? Math.max(1, Math.min(400, Math.round(wordCount(text) / plan.wordsPerScene)))
    : plan.sceneCount;

  // 2) Offline fallback (LLM off): deterministic segmentation, same shape, no visuals
  //    (downstream heuristics own the look, exactly like the legacy offline path).
  if (!llmEnabled(llm)) {
    const matter = sourceText || text;
    const title = (String(source?.title || '').trim() || splitSentences(matter)[0] || matter || 'Video mới').slice(0, 64);
    const off = offlineScript(matter, { title, sceneCount: targetCount, wordsPerScene: plan.wordsPerScene, structure: plan.videoDuration >= 240 });
    const spec = {
      title: off.title,
      thumbnail: synthThumbnail({}, off.title),
      scenes: off.scenes.map((s, i) => ({ stt: i + 1, voice: s.voice, visual: '', assets: [] })),
    };
    const shaped = toPipelineShape(spec, { mode: `${mode}-offline` });
    // keep the offline planner's richer fields (chapter-break templates, its keywords)
    shaped.scenes = off.scenes.map((s) => ({ voice: s.voice, visualPrompt: s.visualPrompt || '', keywords: s.keywords || topNouns(s.voice, 3), ...(s.template ? { template: s.template, props: s.props } : {}) }));
    return shaped;
  }

  const sourceDoc = mode === 'source' ? { title: String(source?.title || '').trim(), text: sourceText } : null;
  const common = { mode, plan, language, guide, memory, assets, llm, onLog, sourceDoc };
  // 'script' mode hands every span its word-balanced share of the owner's text; the shared
  // cut points guarantee batch (and split) boundaries never drop or repeat a sentence.
  const slice = mode === 'script' ? sourceSlicer(splitSentences(text), targetCount) : null;

  // 3) Single adaptive call for ≤30 scenes (splits itself if the reply overflows the window).
  if (targetCount <= BATCH_TRIGGER) {
    const { spec, defects } = await generateSpan({ common, from: 1, to: targetCount, targetCount, label: '', tail: '', closes: false, slice, topicText: text });
    if (!spec.scenes.length) throw new Error('master-script: no usable scenes after repair');
    return toPipelineShape({ ...spec, scenes: spec.scenes.map((s, i) => ({ ...s, stt: i + 1 })) }, { mode, defects });
  }

  // 4) Long video → adaptive batches of 25 with rolling context; thumbnail comes from batch 1.
  const nBatches = Math.ceil(targetCount / BATCH_SIZE);
  onLog(`master-script: long video (${targetCount} scenes) → ${nBatches} batches × ~${BATCH_SIZE}`);
  const all = []; let thumbnail = null; let title = ''; const warnings = [];
  for (let b = 0; b < nBatches; b++) {
    const from = b * BATCH_SIZE + 1;
    const to = Math.min((b + 1) * BATCH_SIZE, targetCount);
    const { spec, defects } = await generateSpan({
      common, from, to, targetCount, label: `batch ${b + 1}/${nBatches}`,
      tail: sceneTail(all), closes: b === nBatches - 1, slice, topicText: text,
    });
    if (b === 0) { thumbnail = spec.thumbnail; title = spec.title; }
    warnings.push(...defects);
    all.push(...spec.scenes);
  }
  if (!all.length) throw new Error('master-script: no usable scenes after repair');
  const spec = { title, thumbnail: thumbnail || synthThumbnail({}, title || text), scenes: all.map((s, i) => ({ ...s, stt: i + 1 })) };
  return toPipelineShape(spec, { mode, defects: warnings });
}
