// LLM subtitle correction, scoped to where it
// actually helps US: cues that came from RAW whisper transcription (unknown audio). Our
// default 'align' engine already displays the script's own words, so narrated scenes never
// carry mishears; this lane exists for the whisper engine and transcription-driven flows
// (e.g. overlay-over-existing-footage).
//
// Contract (inviolable — enforced here, not just asked):
//   • block COUNT unchanged           • every timestamp unchanged
//   • only the TEXT of a block may change (fix misheard proper nouns / numbers / foreign
//     terms by comparing against the original narration when provided)
// A reply that violates the contract is DISCARDED — the original cues ship unchanged.
import { chat, llmEnabled } from '../providers/llm.js';

const msOf = (s) => {
  const m = /(\d+):(\d+):(\d+)[,.](\d+)/.exec(String(s || ''));
  return m ? (+m[1] * 3600 + +m[2] * 60 + +m[3]) * 1000 + +m[4] : NaN;
};
const fmt = (sec) => {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
  const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
  return `${h}:${m}:${s},${String(ms % 1000).padStart(3, '0')}`;
};

/** cues [{start,end,text}] → SRT text (index from 1). */
export function cuesToSrt(cues) {
  return cues.map((c, i) => `${i + 1}\n${fmt(c.start)} --> ${fmt(c.end)}\n${String(c.text || '').trim()}`).join('\n\n') + '\n';
}

/** Parse an SRT reply into [{startMs,endMs,text}] (tolerant of fences/blank lines). */
export function parseSrtReply(reply) {
  const body = String(reply || '').replace(/^```(?:srt)?\s*/i, '').replace(/```\s*$/, '').replace(/\r/g, '');
  const out = [];
  for (const block of body.split(/\n\n+/)) {
    const lines = block.trim().split('\n');
    if (lines.length < 2) continue;
    const ti = lines.findIndex((l) => l.includes('-->'));
    if (ti < 0) continue;
    const [a, b] = lines[ti].split('-->');
    const text = lines.slice(ti + 1).join(' ').trim();
    const startMs = msOf(a), endMs = msOf(b);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
    out.push({ startMs, endMs, text });
  }
  return out;
}

/**
 * Enforce the contract: same count, same timestamps (±10 ms tolerance for formatting),
 * text non-empty. Returns new cues array or null when the reply violates the contract.
 */
export function applyCorrection(cues, parsed) {
  if (!Array.isArray(parsed) || parsed.length !== cues.length) return null;
  const out = [];
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i], p = parsed[i];
    if (Math.abs(p.startMs - Math.round(c.start * 1000)) > 10) return null;
    if (Math.abs(p.endMs - Math.round(c.end * 1000)) > 10) return null;
    if (!p.text) return null;
    if (p.text === String(c.text || '').trim()) { out.push({ ...c }); continue; }
    // text changed → the cue's per-word karaoke stamps describe the OLD words; redistribute
    // the corrected tokens across the same cue span so karaoke stays in sync.
    const toks = p.text.split(/\s+/).filter(Boolean);
    const span = Math.max(0.05, c.end - c.start);
    const weights = toks.map((w) => Math.max(2, w.length));
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    let t = c.start;
    const words = toks.map((w, k) => {
      const d = (weights[k] / total) * span;
      const start = t; t += d;
      return { word: w, start: +start.toFixed(3), end: +t.toFixed(3) };
    });
    out.push({ ...c, text: p.text, words });
  }
  return out;
}

const SYS = `You are a subtitle-correction expert. The SRT below was transcribed by Whisper, which mishears foreign terms, numbers, symbols and proper nouns. ${''}Compare each block against the ORIGINAL NARRATION (when given) and fix ONLY misheard words, preferring the original spelling ("AI" not "ây ai", "$108,000" not the spelled-out words, product/brand names exactly as written).
ABSOLUTE RULES:
1. Keep the EXACT same number of blocks.
2. Keep EVERY timestamp EXACTLY as-is.
3. Keep each block's word distribution — only replace wrong words in place, never move words between blocks.
4. Change nothing that is already correct.
Reply with the corrected SRT only — no commentary, no fences.`;

/**
 * Correct whisper-transcribed cues with one LLM call. Never throws: on any failure or
 * contract violation the ORIGINAL cues return unchanged (flag .corrected tells the caller).
 * @param {Array<{start:number,end:number,text:string,words?:any[]}>} cues
 * @param {string} originalText the narration script when known ('' when unknown)
 * @param {{llm?:object, lang?:string, onLog?:Function}} opts
 */
export async function correctCues(cues, originalText, { llm = null, lang = '', onLog = () => {} } = {}) {
  if (!Array.isArray(cues) || cues.length === 0) return { cues, corrected: false };
  if (!llmEnabled(llm)) return { cues, corrected: false };
  const user = [
    originalText ? `ORIGINAL NARRATION (${lang || 'auto'}):\n"${String(originalText).trim()}"` : 'ORIGINAL NARRATION: (not available — fix only obvious mishears: numbers, units, well-known names/terms)',
    'SRT TO CORRECT:',
    cuesToSrt(cues),
  ].join('\n\n');
  try {
    const reply = await chat([
      { role: 'system', content: SYS },
      { role: 'user', content: user },
    ], { temperature: 0.2, maxTokens: 4000, llm });
    const fixed = applyCorrection(cues, parseSrtReply(reply));
    if (!fixed) { onLog('SRT correction reply violated the timestamp/count contract — keeping original'); return { cues, corrected: false }; }
    const changed = fixed.filter((c, i) => c.text !== cues[i].text).length;
    if (changed) onLog(`SRT correction: fixed ${changed}/${cues.length} block(s)`);
    return { cues: fixed, corrected: changed > 0 };
  } catch (e) {
    onLog(`SRT correction failed (${String(e.message).slice(0, 80)}) — keeping original`);
    return { cues, corrected: false };
  }
}
