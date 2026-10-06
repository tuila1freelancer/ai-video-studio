// The scenes-JSON validator and normaliser: brackets, meta-leak and speakability gates, defect list.
import { scriptBudgetOk } from '../../providers/llm.js';
import { words, wordJoiner } from '../../i18n/segment.js';
import { LANGUAGES } from '../../i18n/languages.js';
import { VISUAL_BRACKETS, MIN_BRACKETS } from './plan.js';

// ---------------------------------------------------------------- validator + normalizer
function bracketSection(visual, name) {
  const re = new RegExp(`\\[${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]([\\s\\S]*?)(?=\\[[A-Z][A-Z &-]*\\]|$)`, 'i');
  const m = String(visual || '').match(re);
  return m ? m[1].trim() : '';
}
function bracketCount(visual) {
  return VISUAL_BRACKETS.reduce((n, b) => n + (new RegExp(`\\[${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]`, 'i').test(visual) ? 1 : 0), 0);
}
// Tokens for the near-duplicate and polish-floor ratios. Length ≥2 drops single letters, which
// is right for Latin and wrong for Chinese, where a great many words are one character — so the
// floor only applies where a one-character word is genuinely noise.
export const tokenSet = (s, code) => new Set(
  words(String(s || '').toLowerCase().replace(/\d+/g, ' '), code)
    .filter((w) => (wordJoiner(code) === '' ? true : w.length >= 2)),
);
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/** The last `n` meaningful tokens of the user's script — the closing block, checked on its own. */
function tailTokens(source, n, code) {
  const all = String(source || '').trim().split(/\s+/);
  return tokenSet(all.slice(-Math.max(1, n)).join(' '), code);
}

// Voice lines that are production METADATA, not narration — the exact leak observed in the
// factory's real output (CTA placement notes, hashtag lines, a thumbnail prompt read aloud).
// TTS must never speak these; P18 pins that they are never persisted.
/**
 * Production-metadata labels a narration line must never speak, in every language the app writes.
 * The list was English plus two Vietnamese labels, so a German "Beschreibung:" line reached TTS.
 */
function metaLabelRe() {
  const own = LANGUAGES.flatMap((l) => l.metaLabels).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^\\s*[-•*]?\\s*(?:CTA|Hashtags?|Thumbnail|Title|Caption|Description|Pinned comment|${own.join('|')})\\b[^:]{0,60}:`, 'i');
}

const META_LEAK_RES = [
  metaLabelRe(),
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

export function synthThumbnail(spec, fallbackTitle) {
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
  const focusSets = withFocus.map((sc) => ({ stt: sc.stt, set: tokenSet(bracketSection(sc.visual, 'MAIN FOCUS') || sc.visual, language) }));
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

  // POLISH_FLOOR ('script' mode): the user's wording must survive. Per scene ≥60% of its
  // tokens must come from the source (up to 2 fully-new scenes are allowed — the added CTAs),
  // and ≥70% of the source's tokens must reappear somewhere in the output (nothing dropped).
  if (mode === 'script' && source && scenes.length) {
    const srcTokens = tokenSet(source, language);
    const outTokens = new Set();
    let freshScenes = 0; const freshStt = [];
    for (const sc of scenes) {
      const toks = [...tokenSet(sc.voice, language)];
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

    // The ENDING is the part that gets silently rewritten. Overall coverage cannot catch it: lose
    // the whole closing block of a 2,500-word script and coverage barely moves, yet the video ends
    // on wording the channel never approved. So the tail is checked on its own.
    const tail = tailTokens(source, 60, language);
    if (tail.size) {
      const outTail = new Set();
      for (const sc of scenes.slice(-6)) for (const tk of tokenSet(sc.voice, language)) outTail.add(tk);
      let kept = 0;
      for (const tk of tail) if (outTail.has(tk)) kept++;
      const ratio = kept / tail.size;
      if (ratio < 0.8) {
        defects.push({ code: 'ENDING_REWRITTEN', detail: `the closing block was rewritten or dropped (only ${(ratio * 100) | 0}% of its words survived) — reproduce the owner's summary and call-to-action verbatim` });
      }
    }
  }

  const spec = {
    title: String(raw?.title || '').trim().slice(0, 64),
    thumbnail: synthThumbnail(raw, String(raw?.title || '').trim()),
    scenes,
  };
  return { spec, defects, ok: defects.length === 0 };
}
