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
// HyperFrame is resolved by buildTemplate() but kept OUT of TEMPLATES: the planner and the
// classic-mode LLM plan must never assign it — only the hyperframe pipeline branch does.
import hyperframe from './hyperframe.js';

export const TEMPLATES = Object.fromEntries([
  heroTitle, kineticStatement, numberHighlight, listReveal, cardCompare,
  timelineSteps, mindmapRadial, chatDemo, terminalScan, iconFocus,
  dualKeyword, ratingCriteria, chapterBreak, ctaOutro,
  splitCascade, counterStat, orbit3d, physicsBurst, drawDiagram, barRace,
].map((t) => [t.id, t]));

export function listTemplates() {
  return Object.values(TEMPLATES).map(({ id, name, desc }) => ({ id, name, desc }));
}

export function buildTemplate(templateId, props, ctx) {
  const t = templateId === 'hyperframe' ? hyperframe : (TEMPLATES[templateId] || TEMPLATES['kinetic-statement']);
  return t.build(props || {}, ctx);
}

export function makeCtx({ w, h, theme, accent, seed = 0, duration = 6, idx = 0 }) {
  const m = Math.min(w, h);
  return {
    w, h, theme, seed, duration, idx,
    accent: accent || theme.accents[idx % theme.accents.length],
    vertical: h > w,
    u: (n) => Math.round(m * n / 100),
  };
}
