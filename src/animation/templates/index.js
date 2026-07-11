// Template registry — one module per template, shared helpers in _shared.js.
// Contract v2: build(p, ctx) → { css, html, script? } (script = GSAP timeline body,
// run as function(gsap, tl, S, rng) by the harness after fonts load).
export { esc, IC, icon, ICON_NAMES, words, pad2, hudLabel, base, headingStyle, EASE, fx } from './_shared.js';

import heroTitle from './hero-title.js';
import kineticStatement from './kinetic-statement.js';
import numberHighlight from './number-highlight.js';
import listReveal from './list-reveal.js';
import cardCompare from './card-compare.js';
import timelineSteps from './timeline-steps.js';
import mindmapRadial from './mindmap-radial.js';
import chatDemo from './chat-demo.js';
import terminalScan from './terminal-scan.js';
import iconFocus from './icon-focus.js';
import dualKeyword from './dual-keyword.js';
import ratingCriteria from './rating-criteria.js';
import chapterBreak from './chapter-break.js';
import ctaOutro from './cta-outro.js';
// GSAP showcase templates
import splitCascade from './split-cascade.js';
import counterStat from './counter-stat.js';
import orbit3d from './orbit-3d.js';
import physicsBurst from './physics-burst.js';
import drawDiagram from './draw-diagram.js';
import barRace from './bar-race.js';
// premium pack
import spotlightQuote from './spotlight-quote.js';
import glassMetricTrio from './glass-metric-trio.js';
// HyperFrame is resolved by buildTemplate() but kept OUT of TEMPLATES: the planner and the
// classic-mode LLM plan must never assign it — only the hyperframe pipeline branch does.
import hyperframe from './hyperframe.js';

export const TEMPLATES = Object.fromEntries([
  heroTitle, kineticStatement, numberHighlight, listReveal, cardCompare,
  timelineSteps, mindmapRadial, chatDemo, terminalScan, iconFocus,
  dualKeyword, ratingCriteria, chapterBreak, ctaOutro,
  splitCascade, counterStat, orbit3d, physicsBurst, drawDiagram, barRace,
  spotlightQuote, glassMetricTrio,
].map((t) => [t.id, t]));

export function listTemplates() {
  return Object.values(TEMPLATES).map(({ id, name, desc }) => ({ id, name, desc }));
}

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
