// The per-scene word budget every script prompt, the editorial rewrite, the duration-fit gate and the UI estimate share.
import { detectLang, declaredLang, LANG_NAME, langName } from '../../util/lang.js';
import { column } from '../../i18n/languages.js';
import { countWords } from '../../i18n/segment.js';

// Spoken words(-as-written-tokens) per second by language — Vietnamese "words" are syllables,
// so neural voices land near a natural presenter's ~270 syllables/min. Undershooting this
// (the old flat 2.6) produced scenes that ran seconds shorter than their slot.
// P5 core rates (vi 4.4 …) are measured and pinned; the 2026-07 additions extend the table
// to the full language set (published per-language speaking rates where known,
// family-consistent estimates otherwise) — existing entries are untouched.
export const LANG_WPS = column('wps');
// LANG_NAME now lives in util/lang.js next to detectLang so the render validator and the codegen
// prompt can name a language without importing this module (db + metering + pricing). Re-exported
// here because a dozen call sites already import it from providers/llm.js.
export { LANG_NAME, langName };

/**
 * The video's language AT SCRIPT TIME, when no scenes exist yet — so the fallback is the SOURCE
 * TEXT (topic / pasted document), not the narration. Once scenes exist, use resolveLang().
 */
export function scriptLang(config, sourceText) {
  return declaredLang(config) || detectLang(String(sourceText || '').slice(0, 400));
}
// THE canonical per-scene word budget. One formula shared by the script prompts, the
// editorial rewrite target, the duration-fit gate and the UI estimate — if these ever use
// different math, a fully compliant script audits as over/under and gets mangled.
// Model: a sceneDuration slot holds (slot − breath pad) seconds of SPEECH at the measured
// delivery rate (LANG_WPS budget × 0.95 spoken ratio — mirrors providers/subtitle.js).
export function wordsForSlot(sceneDuration, language) {
  const wps = LANG_WPS[language] || 3.0;
  const pad = language === 'vi' ? 0.65 : 0.4;
  return Math.max(8, Math.round((Math.max(2, sceneDuration) - pad) * wps * 0.95));
}

// The word-budget line every script prompt carries — scenes must FILL their time slot,
// and must never overflow it: overruns compound across scenes into a video far longer
// than the user asked for (the duration-adherence gate then has to cut).
export function wordBudgetNote(wordsPerScene, wps = 4.4) {
  return `each scene ${wordsPerScene - 3}–${wordsPerScene + 4} words, NO more (target ~${wordsPerScene}; TTS speaks ~${(+wps).toFixed(1)} words/second — write ENOUGH words, never stubby under ${wordsPerScene - 3}, never overflowing past ${wordsPerScene + 4}; ruthlessly cut every filler phrase like "as I said before", "well, actually"…)`;
}

// Soft budget validator for chatJson: only GROSS overruns re-ask (mean words/scene > 1.5×
// target) — a strict gate here would push good-but-chatty replies into the offline
// fallback; the deterministic budget-fit pass (stages/budget.js) owns fine trimming.
export function scriptBudgetOk(scenes, wordsPerScene, language) {
  const arr = (scenes || []).map((s) => String(s.voice || s.text || '')).filter(Boolean);
  if (!arr.length) return false;
  // Japanese and Chinese used to skip this gate entirely, because counting their whitespace
  // "would misfire wildly" — true of whitespace, not of words. Now they are counted properly
  // and held to the same budget as everything else.
  const mean = arr.reduce((a, v) => a + countWords(v, language), 0) / arr.length;
  return mean <= wordsPerScene * 1.5;
}

// Additive Show-Bible block (channel persona + anti-repeat ledger). Purely appended to
// prompts — never restructures the JSON schema or touches the scene-count guard (P4).
export function bibleBlock(memory) {
  if (!memory) return '';
  const lines = [];
  if ((memory.bible || '').trim()) lines.push(`CHANNEL CONTEXT (Show Bible — stay true to this identity, never read it aloud): ${memory.bible.trim().slice(0, 800)}`);
  const recent = (memory.topics || []).slice(-10).map((t) => t.t).filter(Boolean);
  if (recent.length) lines.push(`The channel's recent videos (do NOT repeat their content or angle): ${recent.join('; ')}`);
  return lines.length ? `\n${lines.join('\n')}` : '';
}
