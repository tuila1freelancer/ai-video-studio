// Which clips on disk were typeset before the Vietnamese repair existed?
//
// `__fitVietnamese` fixes the page at render time, and nothing re-renders on its own —
// `renderFingerprint` hashes scene props and config keys, not the harness — so a finished video
// keeps its broken clips until something asks for them again. This is what asks.
//
// The rules mirror exactly what the repair pass changes, so a scene it would not touch is not
// re-rendered: no marks in the graphics text, no work to do.
import { isLightHex } from '../animation/templates/hyperframe.js';
import { TYPESET_VERSION } from './fingerprint.js';

/** A combining mark that sits above the letter, or the dot below — after NFD. */
const MARK = /[̛̣̀́̃̉̆̂]/;

const hasMarks = (s) => MARK.test(String(s || '').normalize('NFD'));

/** Every string the scene actually draws: its markup text, and any prop a template renders. */
function drawnText(props) {
  const html = String(props?.html || '').replace(/<[^>]*>/g, ' ');
  const fromProps = Object.entries(props || {})
    .filter(([k, v]) => typeof v === 'string' && k !== 'html' && k !== 'css' && k !== 'script')
    .map(([, v]) => v)
    .join(' ');
  return `${html} ${fromProps}`;
}

/**
 * Why this clip needs re-rendering, or null. Reasons are the three mechanisms measured in the
 * audit, plus the one the harness itself owns.
 */
export function typesetRisk(scene) {
  // Already drawn by a typesetter that knows about the marks — the render digest cannot say this,
  // because it never hashed the harness. Without it the scan would offer the same scenes forever.
  if ((scene?.fp?.typeset || 0) >= TYPESET_VERSION) return null;
  let props = scene?.props;
  if (typeof props === 'string') { try { props = JSON.parse(props); } catch { return null; } }
  if (!props) return null;
  if (!hasMarks(drawnText(props))) return null;

  const css = String(props.css || '');
  const reasons = [];
  // The model's own CSS.
  if (/(?:-webkit-)?background-clip\s*:\s*text/.test(css)) reasons.push('gradient-text');
  const tight = [...css.matchAll(/line-height\s*:\s*([\d.]+)\s*(?![a-z%\d])/g)]
    .map((m) => +m[1]).filter((v) => v > 0 && v < 1.28);
  if (tight.length) reasons.push(`line-height ${Math.min(...tight)}`);
  if (/overflow\s*:\s*hidden/.test(css)) reasons.push('overflow:hidden');
  // …and the harness's own headline, which nobody was looking at: `.hf-kw` is line-height 1.02,
  // and the DEFAULT guide treatment paints it through background-clip:text, so a chrome headline
  // lost its marks whatever the model wrote.
  const guide = props.guide || {};
  const chrome = guide.textTreatment === 'chrome' && !isLightHex(guide.palette?.bg || '#000');
  if (chrome && /class="[^"]*\bhf-kw2?\b/.test(String(props.html || ''))) reasons.push('hf-kw chrome');

  return reasons.length ? { reasons } : null;
}

/** The scenes of one project that a repair run has to re-render, in order. */
export function atRiskScenes(scenes) {
  const out = [];
  for (const s of scenes || []) {
    const risk = typesetRisk(s);
    if (risk) out.push({ id: s.id, idx: s.idx, reasons: risk.reasons });
  }
  return out;
}
