// Forced alignment: the KNOWN script text + whisper's heard word timings → exact script
// words carrying real speech times. Whisper's transcription is never displayed (it can
// mis-hear words); it only donates timestamps. Needleman-Wunsch over diacritic-folded
// tokens (scene texts are ≤~80 words, so the DP is trivial), then unmatched script words
// interpolate between the bracketing matched anchors weighted by word length.
import { foldDiacritics } from '../util/util.js';

function norm(w) { return foldDiacritics(w).toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''); }

// Global alignment (match +2, mismatch -1, gap -1) → pairs of [scriptIdx, heardIdx].
function nwPairs(A, B) {
  const n = A.length, m = B.length;
  const S = Array.from({ length: n + 1 }, () => new Int16Array(m + 1));
  for (let i = 1; i <= n; i++) S[i][0] = S[i - 1][0] - 1;
  for (let j = 1; j <= m; j++) S[0][j] = S[0][j - 1] - 1;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const diag = S[i - 1][j - 1] + (A[i - 1] && A[i - 1] === B[j - 1] ? 2 : -1);
      S[i][j] = Math.max(diag, S[i - 1][j] - 1, S[i][j - 1] - 1);
    }
  }
  const pairs = [];
  let i = n, j = m;
  while (i > 0 && j > 0) {
    const match = A[i - 1] && A[i - 1] === B[j - 1];
    if (S[i][j] === S[i - 1][j - 1] + (match ? 2 : -1)) {
      if (match) pairs.push([i - 1, j - 1]);
      i--; j--;
    } else if (S[i][j] === S[i - 1][j] - 1) i--;
    else j--;
  }
  return pairs.reverse();
}

// Fill one unmatched run of script tokens across a time window, weighted by word length.
function fillGap(tokens, out, from, to, t0, t1) {
  const span = Math.max(0.05, t1 - t0);
  const weights = [];
  for (let k = from; k <= to; k++) weights.push(Math.max(2, tokens[k].length));
  const total = weights.reduce((a, b) => a + b, 0);
  let t = t0;
  for (let k = from; k <= to; k++) {
    const dur = (weights[k - from] / total) * span;
    out[k] = { start: +t.toFixed(3), end: +(t + dur).toFixed(3), word: tokens[k] };
    t += dur;
  }
}

/**
 * @param {string} scriptText the narration as written (what MUST be displayed)
 * @param {{start:number,end:number,word:string}[]} heard whisper's word timings
 * @param {number} speechDur speech span in seconds (without the trailing pad)
 * @returns {{start,end,word}[]|null} script words with aligned times, or null when the
 *   transcription matches too poorly to trust (<50% anchors — caller falls back).
 */
export function alignWords(scriptText, heard, speechDur) {
  const tokens = String(scriptText || '').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length || !heard?.length) return null;
  const A = tokens.map(norm);
  const B = heard.map((w) => norm(w.word));
  const pairs = nwPairs(A, B).filter(([a]) => A[a]); // drop punctuation-only tokens as anchors
  if (pairs.length < Math.max(2, tokens.length * 0.5)) return null;

  const out = new Array(tokens.length);
  for (const [a, b] of pairs) out[a] = { start: heard[b].start, end: heard[b].end, word: tokens[a] };
  // interpolate unmatched runs between anchors (and before the first / after the last)
  let prevIdx = -1;
  for (let i = 0; i <= tokens.length; i++) {
    const isAnchor = i < tokens.length && out[i];
    if (!isAnchor && i < tokens.length) continue;
    if (prevIdx + 1 <= i - 1) {
      const t0 = prevIdx >= 0 ? out[prevIdx].end : 0;
      const t1 = i < tokens.length ? out[i].start : Math.max(t0 + 0.1, speechDur || t0 + 0.1);
      fillGap(tokens, out, prevIdx + 1, i - 1, t0, t1);
    }
    prevIdx = i;
  }
  // enforce monotonic, non-overlapping times
  let last = 0;
  for (const w of out) {
    if (w.start < last) w.start = last;
    if (w.end <= w.start) w.end = w.start + 0.05;
    last = w.end;
  }
  return out;
}
