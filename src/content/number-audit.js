// Unspoken-number audit for data-story scenes (deterministic, no LLM, no I/O).
// The render validator allows on-screen numbers the narration never says, on purpose — axis
// ticks are design, not claims. On a channel whose promise is "every figure has a source"
// that gap is where fabricated data points hide: a two-value narration ("259 → 334") comes
// back as a six-point line chart. This module lists, per scene, every number drawn on screen
// that neither the scene's narration nor the whole video speaks, so the scene gate can fix
// the brief before a single frame is rendered.

const WORD_NUMS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90, hundred: 100, thousand: 1000, million: 1e6, billion: 1e9, trillion: 1e12,
};
const NUM_RE = /[$€£]?\d[\d,]*(?:\.\d+)?(?:[KMBT](?![a-z]))?%?/g;
const SUFFIX = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };

// "$54K" and "$54,000" are the same claim; "$54" is not. Keys carry the suffix multiplied out.
function keyOf(raw) {
  const m = /^[$€£]?([\d,]*(?:\.\d+)?)([KMBT])?%?$/.exec(raw);
  if (!m) return '';
  const n = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(n)) return '';
  return String(m[2] ? n * SUFFIX[m[2]] : n);
}

// "twenty-nine" → 29, "six point five" is out of scope; compound tens+units only.
function wordNumbers(text) {
  const out = new Set();
  const words = String(text || '').toLowerCase().match(/[a-z]+(?:-[a-z]+)?/g) || [];
  for (const w of words) {
    const parts = w.split('-');
    if (parts.every((p) => p in WORD_NUMS)) {
      const v = parts.length === 2 ? WORD_NUMS[parts[0]] + WORD_NUMS[parts[1]] : WORD_NUMS[parts[0]];
      out.add(String(v));
    }
  }
  return out;
}

/** Canonical numeric keys ("1,600" → "1600", "29%" → "29", "$54,000" → "54000"). */
export function numbersIn(text) {
  const out = new Set();
  for (const raw of String(text || '').match(NUM_RE) || []) {
    const key = keyOf(raw);
    if (key) out.add(key);
  }
  for (const w of wordNumbers(text)) out.add(w);
  // "$1.6 trillion" is the same claim as "$1.6T": add the scaled key beside the bare one.
  const SCALE = { thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12 };
  for (const [, num, word] of String(text || '').matchAll(/(\d[\d,]*(?:\.\d+)?)\s+(thousand|million|billion|trillion)\b/gi)) {
    out.add(String(Number(num.replace(/,/g, '')) * SCALE[word.toLowerCase()]));
  }
  return out;
}

/** Visible text of a scene page: tags and entities stripped, whitespace collapsed. */
export function visibleText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').trim();
}

// Axis ticks and step labels look like data but are not claims: small integers and round
// multiples with no unit sign attached. Anything carrying $ or % is a claim by construction.
function isScaffold(raw, key) {
  if (/[$€£%]/.test(raw)) return false;
  if (!/^\d+$/.test(key)) return false;
  const n = Number(key);
  return n <= 12 || n % 5 === 0;
}

/**
 * @param {{html?:string, narration?:string, allNarration?:string}} s
 * @returns {{unspoken:string[], scaffold:string[], elsewhere:string[]}} raw tokens as drawn
 */
export function auditSceneNumbers({ html, narration = '', allNarration = '' }) {
  const here = numbersIn(narration);
  const anywhere = numbersIn(allNarration);
  const unspoken = [], scaffold = [], elsewhere = [];
  const seen = new Set();
  for (const raw of visibleText(html).match(NUM_RE) || []) {
    const key = keyOf(raw);
    if (!key || seen.has(raw)) continue;
    seen.add(raw);
    if (here.has(key)) continue;
    if (anywhere.has(key)) { elsewhere.push(raw); continue; }
    (isScaffold(raw, key) ? scaffold : unspoken).push(raw);
  }
  return { unspoken, scaffold, elsewhere };
}

/**
 * @param {Array<{idx?:number, voice_text?:string, voice?:string, props?:{html?:string}|string}>} scenes
 * @returns {{scenes:Array<{idx:number, unspoken:string[], scaffold:string[], elsewhere:string[]}>, defects:number}}
 */
export function auditProjectNumbers(scenes) {
  const list = Array.isArray(scenes) ? scenes : [];
  const allNarration = list.map((s) => String(s?.voice_text ?? s?.voice ?? '')).join(' ');
  const out = list.map((s, i) => {
    const props = typeof s?.props === 'string' ? safeParse(s.props) : s?.props;
    const r = auditSceneNumbers({ html: props?.html || '', narration: String(s?.voice_text ?? s?.voice ?? ''), allNarration });
    return { idx: Number.isFinite(+s?.idx) ? +s.idx : i, ...r };
  });
  return { scenes: out, defects: out.reduce((n, r) => n + r.unspoken.length, 0) };
}

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }
