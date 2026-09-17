// The generator: one ask, one chunk, adaptive spans, and generateMasterScenes() over all input modes.
import { chatJson, llmEnabled, splitSentences, scriptLang, topNouns, offlineScript } from '../../providers/llm.js';
import { countWords, wordJoiner } from '../../i18n/segment.js';
import { tp } from '../../i18n/t.js';
import { BATCH_TRIGGER, BATCH_SIZE, SCRIPT_MODE_MIN_WORDS, ctaPlanFor, planScenes, parseScenesInput } from './plan.js';
import { synthThumbnail, validateScenesJson } from './validate.js';
import { repairScenesSpec } from './repair.js';
import { buildMasterPrompt, defectNote } from './prompt.js';
import { toPipelineShape } from './shape.js';
import { generateOutline } from './outline.js';

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
  onLog(tp`Kịch bản: nhận ${v.spec.scenes.length}/${expect} cảnh, ${v.defects.length} lỗi${v.defects.length ? ` [${[...new Set(v.defects.map((d) => d.code))].join(',')}]` : ''}`);
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
      onLog(tp`Kịch bản: lần thử ${round + 1} thất bại (${String(e.message).slice(0, 100)})`);
      if (round === 1 && !best) throw e;
    }
  }
  const src = mode === 'script' ? input : '';
  // The opening is repaired even when nothing else is wrong: a rewritten hook is not a defect
  // the validator can see, but it is the line the video's retention rests on.
  const spec = repairScenesSpec(best.spec, best.ok ? [] : best.defects, { source: src, first: sttBase <= 1, language });
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
export function sourceSlicer(sentences, targetCount, code) {
  const cum = [0];
  for (const s of sentences) cum.push(cum[cum.length - 1] + countWords(s, code));
  const total = cum[cum.length - 1];
  const cut = (k) => { // first sentence index whose cumulative words reach k scenes' share
    if (k <= 0 || !total) return 0;
    if (k >= targetCount) return sentences.length;
    const want = (k / targetCount) * total;
    let lo = 0, hi = sentences.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] >= want) hi = mid; else lo = mid + 1; }
    return lo;
  };
  return (from, to) => sentences.slice(cut(from - 1), cut(to)).join(wordJoiner(code));
}

function sceneTail(scenes) {
  return scenes.slice(-3).map((s) => `  - "${s.voice.slice(0, 90)}${s.voice.length > 90 ? '…' : ''}"`).join('\n');
}

// P33 — the pinned-plan block for one span: throughline/spine written ONCE (before batch 1)
// and restated verbatim to every batch, plus the chapters this span covers. Without this,
// batch 2+ re-planned its own arc from a 3-voice tail — 8 loosely-stitched essays.
function outlineNoteFor(outline, from, to) {
  if (!outline) return '';
  const chaps = (outline.chapters || []).filter((c) => c.to >= from && c.from <= to);
  return `\n\nPINNED VIDEO PLAN (written once for the whole video — IMMUTABLE; restate it verbatim in your "throughline"/"spine" fields, never re-plan):
- Throughline: ${outline.throughline}
- Spine: ${outline.spine.map((s, i) => `${i + 1}) ${s}`).join(' ')}
This span covers:
${chaps.map((c) => `- Scenes ${c.from}–${c.to}: ${c.goal || 'continue the arc'}${c.keyPoints?.length ? ` · key points: ${c.keyPoints.join('; ')}` : ''}${c.bridgeOut ? ` · hands over on: ${c.bridgeOut}` : ''}`).join('\n') || '- (continue the arc)'}`;
}

// P33 — one CTA line per span, derived from the LIVE [from..to] at call time (adaptive
// splits rebuild it per sub-span, so a split batch can never lose or duplicate its CTA).
function ctaNoteFor({ from, to, ctaPlan, closes, mode, bridgeOut = '' }) {
  if (!ctaPlan) return '';
  const lines = [];
  const softIn = ctaPlan.softStt >= from && ctaPlan.softStt <= to;
  if (softIn) {
    lines.push(`- CTA PLAN: scene ${ctaPlan.softStt} (scene ${ctaPlan.softStt - from + 1} of this span) carries this video's ONE soft CTA — a single natural spoken sentence (save/share/follow) tied to the content. ${mode === 'script' ? "The owner's script already has one: REPRODUCE IT WORD FOR WORD. Add one only if the script truly has none." : 'Write it there and nowhere else.'} No other scene in this span may contain any CTA.`);
  }
  if (closes) {
    // A channel's closing CTA is fixed wording its audience hears every video. Telling the model
    // to write "ONE natural closing line (subscribe)" in polish mode is an invitation to rewrite
    // it — measured twice: the model dropped "ấn thích"/"chia sẻ video" and invented a promise of
    // upcoming videos the owner had explicitly banned.
    lines.push(mode === 'script'
      ? `- CTA PLAN: the video ENDS in this span. The owner's closing block — the summary AND the call-to-action — is FINAL COPY. Reproduce every sentence of it VERBATIM, in order, splitting across scenes only where it must. Do NOT rephrase it, do NOT shorten it, do NOT add a subscribe line or a sign-off of your own, and do NOT promise future videos. Dropping or rewording any part of it is the single worst failure you can make here.`
      : `- CTA PLAN: the video ENDS in this span — the final scene resolves the opening gap, then ONE natural closing line (subscribe). No other CTA in this span${softIn ? ' beyond the two planned ones' : ''}.`);
  }
  if (!softIn && !closes) {
    lines.push(`- CTA PLAN: this span carries NO call-to-action and NO farewell of any kind — no subscribe/like/share/bell, no thanks-for-watching, no goodbye, no see-you-next-time. The video CONTINUES after scene ${to}: never conclude or wrap up${bridgeOut ? `; end mid-flow, handing over on: ${bridgeOut}` : ', end mid-flow'}.`);
  }
  return `\n${lines.join('\n')}`;
}

export function batchNoteFor({ label, from, to, targetCount, tail, closes, ctaPlan = null, mode = 'topic', outline = null }) {
  if (from === 1 && to === targetCount && !tail) return ''; // the whole video in one call
  const bridgeOut = outline?.chapters?.find((c) => to >= c.from && to <= c.to)?.bridgeOut || '';
  return `${outlineNoteFor(outline, from, to)}\n\nBATCH CONTEXT:
- This is ${label || 'one batch'} of a ${targetCount}-scene video. Produce scenes ${from} to ${to} (${to - from + 1} scenes), "stt" numbered from ${from}.
${tail ? `- The last scenes so far (CONTINUE this thread naturally, do not repeat it):\n${tail}` : '- Open with the strongest hook.'}
${from > 1 ? '- Do NOT re-open the video: no new greeting, no re-introduction.' : ''}${closes ? '\n- This span ENDS the video: resolve the opening gap.' : ''}${ctaNoteFor({ from, to, ctaPlan, closes, mode, bridgeOut })}`;
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
    common.onLog(tp`Kịch bản: cảnh ${from}–${to} không có từ nguồn (câu dài rơi sang span kề) — bỏ qua`);
    return { spec: { title: '', thumbnail: null, scenes: [] }, defects: [] };
  }
  const batchNote = batchNoteFor({
    label, from, to, targetCount, tail, closes,
    ctaPlan: common.ctaPlan, mode: common.mode, outline: common.outline,
  });
  let why;
  try {
    const r = await generateChunk({ ...common, input, expect, sttBase: from, batchNote });
    if (r.spec.scenes.length >= Math.ceil(expect * 0.7) || expect < MIN_SPLIT * 2) return r;
    why = `only ${r.spec.scenes.length}/${expect} scenes came back`;
  } catch (e) {
    if (expect < MIN_SPLIT * 2) throw e;
    why = String(e.message).slice(0, 80);
  }
  common.onLog(tp`Kịch bản: cảnh ${from}–${to} (${why}) — chia thành 2 lần gọi nhỏ hơn`);
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
    for (const d of v.defects) onLog(tp`Nhập scenes-json: ${d.code}${d.stt != null ? ` @${Array.isArray(d.stt) ? d.stt.join(',') : d.stt}` : ''} — ${d.detail}`);
    return toPipelineShape(spec, { mode: 'json', defects: v.defects, onLog });
  }

  // 'source' (fetched article) outranks the word-count sniff: a long article is research
  // material for a NEW script, never a detailed owner script to polish.
  // countWords, not whitespace: a 5,000-character Chinese script has no spaces in it at all, so
  // the whitespace count was 1, it fell under the floor, and the owner's script was routed to
  // 'topic' mode and rewritten from scratch.
  const ownerWords = countWords(text, language);
  const mode = sourceText ? 'source' : ownerWords >= SCRIPT_MODE_MIN_WORDS ? 'script' : 'topic';
  const plan = planScenes({ videoDuration: config.videoDuration, sceneDuration: config.sceneDuration, language });
  // 'script' mode: the owner's content decides the length — the duration target does not.
  const targetCount = mode === 'script'
    ? Math.max(1, Math.min(400, Math.round(ownerWords / plan.wordsPerScene)))
    : plan.sceneCount;

  // 2) Offline fallback (LLM off): deterministic segmentation, same shape, no visuals
  //    (downstream heuristics own the look, exactly like the legacy offline path).
  if (!llmEnabled(llm)) {
    const matter = sourceText || text;
    const title = (String(source?.title || '').trim() || splitSentences(matter)[0] || matter || 'Video mới').slice(0, 64);
    const off = offlineScript(matter, { title, sceneCount: targetCount, wordsPerScene: plan.wordsPerScene, structure: plan.videoDuration >= 240, language });
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
  // P33: ONE soft CTA (~30%) + closing only — every span references the same plan; the
  // pinned outline (set below for batched topic/source) keeps batch 2+ on batch 1's arc.
  const ctaPlan = ctaPlanFor(targetCount);
  const common = { mode, plan, language, guide, memory, assets, llm, onLog, sourceDoc, ctaPlan, outline: null };
  // 'script' mode hands every span its word-balanced share of the owner's text; the shared
  // cut points guarantee batch (and split) boundaries never drop or repeat a sentence.
  const slice = mode === 'script' ? sourceSlicer(splitSentences(text, language), targetCount, language) : null;

  // 3) Single adaptive call for ≤30 scenes (splits itself if the reply overflows the window).
  if (targetCount <= BATCH_TRIGGER) {
    const { spec, defects } = await generateSpan({ common, from: 1, to: targetCount, targetCount, label: '', tail: '', closes: false, slice, topicText: text });
    if (!spec.scenes.length) throw new Error('master-script: no usable scenes after repair');
    return toPipelineShape({ ...spec, scenes: spec.scenes.map((s, i) => ({ ...s, stt: i + 1 })) }, { mode, defects, onLog });
  }

  // 4) Long video → adaptive batches of 25 with rolling context; thumbnail comes from batch 1.
  const nBatches = Math.ceil(targetCount / BATCH_SIZE);
  onLog(tp`Kịch bản: video dài (${targetCount} cảnh) → ${nBatches} đợt × ~${BATCH_SIZE} cảnh`);
  if (mode !== 'script') {
    common.outline = await generateOutline({ plan, language, llm, onLog, targetCount, topicText: text, sourceDoc, mode });
  }
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
  return toPipelineShape(spec, { mode, defects: warnings, onLog });
}
