// Template registry — after the single-visual-mode collapse (P36) only two fixed templates
// survive: kinetic-statement (the universal self-heal fallback — buildTemplate returns it for
// any unknown id, so a legacy scene whose stored template no longer exists still renders) and
// chapter-break (kept in hyperframe mode for section-title cards). HyperFrame is resolved by
// buildTemplate() but kept OUT of TEMPLATES. Shared helpers live in _shared.js.
// Contract: build(p, ctx) → { css, html, script? } (script = GSAP timeline body, run as
// function(gsap, tl, S, rng) by the harness after fonts load).
export { esc, IC, icon, ICON_NAMES, words, pad2, hudLabel, base, headingStyle, EASE, fx } from './_shared.js';

import kineticStatement from './kinetic-statement.js';
import chapterBreak from './chapter-break.js';
import hyperframe from './hyperframe.js';

export const TEMPLATES = Object.fromEntries([kineticStatement, chapterBreak].map((t) => [t.id, t]));

export function buildTemplate(templateId, props, ctx) {
  const t = templateId === 'hyperframe' ? hyperframe : (TEMPLATES[templateId] || TEMPLATES['kinetic-statement']);
  return t.build(props || {}, ctx);
}

/**
 * Pick n accent (emphasis) times from the scene's word timings — long content words and
 * numbers score highest, greedily chosen with a minimum gap, each landing LEAD before the
 * word is fully spoken (mirrors hyperframe/beats.js). Pure function of (captions, duration)
 * → build-time deterministic (P12): the same srt_json always yields the same page.
 * No captions → even spacing across the usable window (the pre-beat-sync behavior).
 */
export function accentTimes(captions, duration, n, { gap = 1.2, lead = 0.12 } = {}) {
  const d = Math.max(1.5, duration || 6);
  const usable0 = Math.min(0.8, d * 0.12), usable1 = d - Math.min(0.9, d * 0.14);
  const even = () => Array.from({ length: n }, (_, i) =>
    +(usable0 + ((i + 0.5) * (usable1 - usable0)) / n).toFixed(2));
  const words = [];
  for (const c of captions || []) for (const w of c.words || []) words.push(w);
  if (!words.length || n < 1) return even();
  const scored = words
    .map((w) => ({ t: Math.max(0.15, w.start - lead), s: String(w.word || '').replace(/[^\p{L}\p{N}]/gu, '') }))
    .filter((x) => x.s.length >= 2)
    .map((x) => ({ t: x.t, score: x.s.length + (/\d/.test(x.s) ? 8 : 0) })) // numbers ARE the emphasis
    .sort((a, b) => b.score - a.score || a.t - b.t);
  const picked = [];
  for (const c of scored) {
    if (picked.length >= n) break;
    if (c.t < usable0 || c.t > usable1) continue;
    if (picked.every((p) => Math.abs(p - c.t) >= gap)) picked.push(c.t);
  }
  if (picked.length < n) { // sparse speech — fill remaining slots evenly
    for (const t of even()) {
      if (picked.length >= n) break;
      if (picked.every((p) => Math.abs(p - t) >= gap * 0.6)) picked.push(t);
    }
  }
  return picked.sort((a, b) => a - b).map((t) => +t.toFixed(2));
}

export function makeCtx({ w, h, theme, accent, seed = 0, duration = 6, idx = 0, captions = [] }) {
  const m = Math.min(w, h);
  return {
    w, h, theme, seed, duration, idx,
    accent: accent || theme.accents[idx % theme.accents.length],
    vertical: h > w,
    u: (n) => Math.round(m * n / 100),
    captions,
    // beat-synced timing for templates: n accent times derived from the narration's word
    // timings (falls back to even spacing when the scene has no captions yet)
    accentTimes: (n, opts) => accentTimes(captions, duration, n, opts),
  };
}
