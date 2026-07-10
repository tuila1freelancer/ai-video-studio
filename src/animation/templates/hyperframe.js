// HyperFrame — the LLM-codegen scene template. Unlike the fixed templates, its props ARE the
// scene spec produced by src/hyperframe/codegen.js: { css, html, script, guide }.
//   css/html/script: LLM-authored (already linted + icon-expanded upstream; build() expands
//     {{icon:*}} again so canned/hand-written specs also work)
//   guide: the project style guide — palette/fonts/motif/text treatment are rendered here,
//     OUTSIDE the LLM's reach, so every scene in a video shares one visual identity.
//
// Layout contract for generated markup (documented to the LLM in hyperframe/prompt.js):
//   - position elements with .hf-slot wrappers (the slot owns the centering transform);
//     animate ONLY the inner element — GSAP x/y tweens then never clobber CSS centering.
//   - .hf-cam wraps everything that the simulated camera (FX.camPush) may move.
//   - beat elements start hidden via FX.beat (tl.set opacity:0 at t=0) — screen opens empty.
//
// This template is intentionally NOT in the TEMPLATES registry (planner/LLM-plan must never
// pick it for classic animation mode); buildTemplate() resolves it explicitly.
import { esc, fx, EASE } from './_shared.js';
import { expandIcons } from '../../hyperframe/icons.js';

export const HF_DEFAULT_GUIDE = {
  id: 'chrome-kinetic', name: 'Chrome Kinetic',
  palette: { bg: '#07070D', bg2: '#10101F', ink: '#F2F5FF', muted: '#8A93AD', accents: ['#7C8CFF', '#22D3EE', '#F59E0B'] },
  fonts: {
    display: `'Oswald', 'Be Vietnam Pro', sans-serif`,
    body: `'Be Vietnam Pro', -apple-system, sans-serif`,
    mono: `'JetBrains Mono', ui-monospace, monospace`,
  },
  motif: 'mesh',            // mesh | bokeh | grid | particles | grain
  textTreatment: 'chrome',  // chrome | neon | solid | outline
  motionPersonality: 'kinetic',
  iconStyle: 'line',
  cameraDefault: 'push',
};

function m32(a) {
  return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

// v2 "art direction" fields — optional per guide, embedded into the codegen prompt so the
// LLM designs every scene inside one locked visual language (reference-app parity):
//   semantics:   fixed meaning → color map (good/bad/warn/money…) — accents stay decorative
//   conceptMap:  "concept → visual" recipes ("so sánh → SPLIT 2 cột", "quy trình → stepper…")
//   hud:         decorative HUD vocabulary (mono kickers like "// SECTION", corner statuses)
//   sceneRules:  short hard rules applied to every scene of the video
const HEX_RE = /^#[0-9A-Fa-f]{6}$/;
const strList = (v, max, len = 200) => (Array.isArray(v) ? v : [])
  .map((s) => String(s || '').trim()).filter(Boolean).slice(0, max).map((s) => s.slice(0, len));
function normalizeSemantics(s, accents) {
  const out = {};
  for (const [k, v] of Object.entries(s && typeof s === 'object' ? s : {})) {
    if (HEX_RE.test(String(v || '').trim()) && out[k] === undefined && Object.keys(out).length < 8) {
      out[String(k).slice(0, 16)] = String(v).trim().toUpperCase();
    }
  }
  return Object.keys(out).length ? out : { good: '#34D399', bad: '#EF4444', warn: accents[2] || '#F59E0B' };
}

export function normalizeGuide(g) {
  const d = HF_DEFAULT_GUIDE;
  g = g && typeof g === 'object' ? g : {};
  const pal = g.palette || {};
  const fonts = g.fonts || {};
  const accents = Array.isArray(pal.accents) && pal.accents.length ? pal.accents.slice(0, 3) : d.palette.accents;
  while (accents.length < 3) accents.push(accents[accents.length - 1]);
  const hud = g.hud && typeof g.hud === 'object' ? g.hud : {};
  return {
    id: g.id || d.id, name: g.name || d.name,
    palette: {
      bg: pal.bg || d.palette.bg, bg2: pal.bg2 || d.palette.bg2,
      ink: pal.ink || d.palette.ink, muted: pal.muted || d.palette.muted, accents,
    },
    fonts: { display: fonts.display || d.fonts.display, body: fonts.body || d.fonts.body, mono: fonts.mono || d.fonts.mono },
    motif: ['mesh', 'bokeh', 'grid', 'particles', 'grain'].includes(g.motif) ? g.motif : d.motif,
    textTreatment: ['chrome', 'neon', 'solid', 'outline'].includes(g.textTreatment) ? g.textTreatment : d.textTreatment,
    motionPersonality: g.motionPersonality || d.motionPersonality,
    iconStyle: g.iconStyle || d.iconStyle,
    cameraDefault: g.cameraDefault || d.cameraDefault,
    semantics: normalizeSemantics(g.semantics, accents),
    conceptMap: strList(g.conceptMap, 14),
    hud: { kickers: strList(hud.kickers, 6, 24), statuses: strList(hud.statuses, 10, 32) },
    sceneRules: strList(g.sceneRules, 8),
  };
}

// tiny tileable SVG noise (fixed seed → static, deterministic)
const GRAIN_URI = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' seed='7' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E")`;

function motifLayer(guide, ctx) {
  const { u, w, h, seed } = ctx;
  const [a0, a1, a2] = guide.palette.accents;
  const rnd = m32(9001 + (seed | 0));
  const pct = (v) => (v * 100).toFixed(2) + '%';
  if (guide.motif === 'mesh') {
    const blobs = [a0, a1, a2].map((c, i) => {
      const x = pct(0.12 + rnd() * 0.76), y = pct(0.1 + rnd() * 0.7);
      const s = u(46 + i * 8);
      return `<div class="hf-blob" style="left:${x};top:${y};width:${s}px;height:${s}px;background:${c};opacity:${(0.22 - i * 0.05).toFixed(2)}"></div>`;
    }).join('');
    return { css: `.hf-blob{position:absolute;border-radius:50%;filter:blur(${u(9)}px);transform:translate(-50%,-50%)}`, html: blobs };
  }
  if (guide.motif === 'bokeh') {
    let dots = '';
    for (let i = 0; i < 9; i++) {
      const c = [a0, a1, a2][i % 3];
      dots += `<div class="hf-bok" style="left:${pct(rnd())};top:${pct(rnd())};width:${u(3 + rnd() * 9)}px;height:${u(3 + rnd() * 9)}px;background:${c};opacity:${(0.08 + rnd() * 0.14).toFixed(2)}"></div>`;
    }
    return { css: `.hf-bok{position:absolute;border-radius:50%;filter:blur(${u(2.2)}px);transform:translate(-50%,-50%)}`, html: dots };
  }
  if (guide.motif === 'grid') {
    const cell = Math.round(w / 18);
    return {
      css: `.hf-gridbg{position:absolute;inset:0;opacity:.12;background-image:linear-gradient(${a0}33 1px,transparent 1px),linear-gradient(90deg,${a0}33 1px,transparent 1px);background-size:${cell}px ${cell}px;mask-image:radial-gradient(120% 95% at 50% 50%,#000 32%,transparent 80%);-webkit-mask-image:radial-gradient(120% 95% at 50% 50%,#000 32%,transparent 80%)}
.hf-horiz{position:absolute;left:0;right:0;bottom:0;height:${Math.round(h * 0.4)}px;background:radial-gradient(70% 100% at 50% 100%,${a1}26 0%,transparent 70%)}`,
      html: '<div class="hf-gridbg"></div><div class="hf-horiz"></div>',
    };
  }
  // particles / grain → the page canvas + grain overlay carry the texture; add one soft halo
  return {
    css: `.hf-halo{position:absolute;left:50%;top:44%;width:${u(70)}px;height:${u(70)}px;transform:translate(-50%,-50%);border-radius:50%;background:radial-gradient(circle,${a0}22 0%,transparent 65%)}`,
    html: '<div class="hf-halo"></div>',
  };
}

function kwTreatment(guide, ctx) {
  const { u } = ctx;
  const [a0, a1] = guide.palette.accents;
  const light = isLightHex(guide.palette.bg);
  // On a light background a heavy black shadow muddies the type — use a soft light-tinted shadow.
  const softShadow = light
    ? `0 ${u(0.35)}px ${u(1.4)}px rgba(255,255,255,.6),0 ${u(0.15)}px ${u(0.6)}px rgba(0,0,0,.18)`
    : `0 ${u(0.35)}px ${u(1.6)}px rgba(0,0,0,.75)`;
  const glow = `drop-shadow(0 0 ${u(1.8)}px ${a0}88) drop-shadow(0 ${u(0.3)}px ${u(1)}px rgba(0,0,0,${light ? '.25' : '.8'}))`;
  if (guide.textTreatment === 'chrome' && !light) {
    return `background:linear-gradient(180deg,#FFFFFF 0%,#98A2B8 46%,#EDF1F9 52%,#818BA2 100%);background-size:240% 100%;background-position:50% 0;-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent;filter:${glow}`;
  }
  if (guide.textTreatment === 'neon' && !light) {
    return `color:${guide.palette.ink};text-shadow:0 0 ${u(1.6)}px ${a0}AA,0 0 ${u(5)}px ${a0}55,0 ${u(0.3)}px ${u(1.4)}px rgba(0,0,0,.85)`;
  }
  if (guide.textTreatment === 'outline') {
    return `color:transparent;-webkit-text-stroke:${Math.max(2, u(0.28))}px ${guide.palette.ink};filter:drop-shadow(0 0 ${u(2.4)}px ${a1}44)`;
  }
  // solid, or chrome/neon on a light bg (where they'd wash out) → clean high-contrast ink
  return `color:${guide.palette.ink};text-shadow:${softShadow}`;
}
function isLightHex(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '')); if (!m) return false;
  const v = parseInt(m[1], 16);
  return (0.2126 * ((v >> 16) & 255) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255)) > 150;
}

function baseCss(guide, ctx) {
  const { u } = ctx;
  const p = guide.palette;
  const [a0, a1, a2] = p.accents;
  return `
  .hf-cam{position:absolute;inset:0;transform-origin:50% 50%}
  .hf-layer{position:absolute;inset:0}
  .hf-far,.hf-mid,.hf-near{position:absolute;inset:0}
  .hf-slot{position:absolute;transform:translate(-50%,-50%);display:grid;place-items:center;text-align:center}
  .hf-center{position:absolute;inset:0;display:grid;place-items:center;text-align:center}
  .hf-kw{font-family:${guide.fonts.display};font-weight:800;font-size:${u(11)}px;line-height:1.02;letter-spacing:.005em;text-transform:uppercase;white-space:pre-line;${kwTreatment(guide, ctx)}}
  .hf-kw2{font-family:${guide.fonts.display};font-weight:700;font-size:${u(6.2)}px;line-height:1.08;text-transform:uppercase;color:${p.ink};text-shadow:0 ${u(0.3)}px ${u(1.4)}px rgba(0,0,0,.7)}
  .hf-sub{font-family:${guide.fonts.body};font-weight:500;font-size:${u(2.9)}px;color:${p.muted};line-height:1.4}
  .hf-label{font-family:${guide.fonts.mono};font-weight:700;font-size:${u(2.0)}px;letter-spacing:.3em;text-transform:uppercase;color:${a1}}
  .hf-card{background:linear-gradient(160deg,rgba(255,255,255,.09),rgba(255,255,255,.03));border:1px solid rgba(255,255,255,.12);border-radius:${u(1.8)}px;padding:${u(2.6)}px ${u(3.4)}px;box-shadow:0 ${u(1.6)}px ${u(4)}px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.08);backdrop-filter:blur(6px)}
  .hf-chip{display:inline-flex;align-items:center;gap:${u(1)}px;font-family:${guide.fonts.body};font-weight:600;font-size:${u(2.3)}px;color:${p.ink};background:rgba(255,255,255,.07);border:1px solid ${a0}55;border-radius:999px;padding:${u(0.9)}px ${u(2.2)}px}
  .hf-stat{display:grid;justify-items:center;gap:${u(0.6)}px}
  .hf-stat-v{font-family:${guide.fonts.display};font-weight:800;font-size:${u(13)}px;line-height:1;font-variant-numeric:tabular-nums;color:${p.ink};text-shadow:0 0 ${u(2.4)}px ${a0}66,0 ${u(0.4)}px ${u(1.6)}px rgba(0,0,0,.8)}
  .hf-stat-u{font-size:.55em;color:${a1};margin-left:.06em}
  .hf-stat-l{font-family:${guide.fonts.body};font-weight:600;font-size:${u(2.6)}px;letter-spacing:.12em;text-transform:uppercase;color:${p.muted}}
  .hf-iconbox{display:grid;place-items:center;font-size:${u(11)}px;color:${a1};filter:drop-shadow(0 0 ${u(2.2)}px ${a1}77)}
  .hf-iconbox.sm{font-size:${u(6)}px}
  .hf-lower3{position:absolute;left:7%;right:7%;bottom:20%;display:flex;align-items:center;gap:${u(1.6)}px;justify-content:center}
  .hf-row{display:flex;gap:${u(1.8)}px;align-items:center;justify-content:center}
  .hf-col{display:grid;gap:${u(1.4)}px;justify-items:center}
  .hf-beam{position:absolute;top:-25%;bottom:-25%;left:-14%;width:${u(9)}px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.55),transparent);transform:rotate(13deg);opacity:0;pointer-events:none}
  .hf-underline{height:${Math.max(3, u(0.45))}px;border-radius:99px;background:linear-gradient(90deg,${a0},${a1});box-shadow:0 0 ${u(1.4)}px ${a0}99}
  .hf-vig{pointer-events:none;box-shadow:inset 0 0 ${u(26)}px rgba(0,0,0,.44)}
  .hf-grain{pointer-events:none;background-image:${GRAIN_URI};background-size:${u(16)}px ${u(16)}px;opacity:${guide.motif === 'grain' ? '.07' : '.05'};mix-blend-mode:overlay}
  .hf-accent{color:${a0}}.hf-accent2{color:${a1}}.hf-accent3{color:${a2}}
  `;
}

// Safe generic motion when a spec ships without a script (never happens via codegen,
// but canned/hand specs and hard fallbacks stay alive and gently animated).
const DEFAULT_AMBIENT = `
FX.camPush(tl, { scale: 1.05 });
FX.parallax(tl, '.hf-mid > *', { amp: 13 });
FX.rise(tl, '.hf-near > *', { y: 40, each: 0.14, at: 0.25 });
FX.beamSweep(tl, '.hf-beam', { at: Math.min(2.2, DUR * 0.4) });
`;

const hyperframe = {
  id: 'hyperframe',
  name: 'HyperFrame',
  desc: 'Motion graphics do AI dàn dựng theo beat lời thoại (không dành cho planner)',
  build(p, ctx) {
    const guide = normalizeGuide(p.guide);
    const motif = motifLayer(guide, ctx);
    const body = expandIcons(p.html || '');
    const css = baseCss(guide, ctx) + '\n' + motif.css + '\n' + (p.css || '');
    const html = `
    <div class="hf-cam">
      <div class="hf-layer hf-far">${motif.html}</div>
      ${body}
      <div class="hf-layer" style="pointer-events:none"><div class="hf-beam"></div></div>
    </div>
    <div class="hf-layer hf-vig"></div>
    <div class="hf-layer hf-grain"></div>`;
    const script = fx('var DUR = S.duration;\n' + (p.script && String(p.script).trim() ? p.script : DEFAULT_AMBIENT));
    return { css, html, script };
  },
};

export default hyperframe;

// Canned demo spec — used by tpl-smoke, determinism.mjs and as the codegen few-shot example.
// Assumes duration ≥ 6s; beats at fixed seconds show the appear-on-voice / exit-before-next pattern.
export const SAMPLE_SPEC = {
  guide: HF_DEFAULT_GUIDE,
  css: `
  .hf-orb{position:absolute;border-radius:50%;filter:blur(2px);border:1px solid rgba(255,255,255,.14)}
  .o1{left:16%;top:24%;width:9%;padding-top:9%;background:radial-gradient(circle at 35% 30%,rgba(124,140,255,.5),rgba(124,140,255,.06))}
  .o2{left:78%;top:66%;width:6%;padding-top:6%;background:radial-gradient(circle at 35% 30%,rgba(34,211,238,.45),rgba(34,211,238,.05))}
  #kw1{white-space:nowrap}
  `,
  html: `
  <div class="hf-layer hf-mid">
    <div class="hf-orb o1"></div>
    <div class="hf-orb o2"></div>
  </div>
  <div class="hf-layer hf-near">
    <div class="hf-slot" style="left:50%;top:9%"><div class="hf-label" id="lb1">HYPERFRAME · DEMO</div></div>
    <div class="hf-center"><div class="hf-kw" id="kw1">TĂNG TỐC ×10</div></div>
    <div class="hf-slot" style="left:50%;top:52%"><div class="hf-stat" id="st1">
      <div class="hf-stat-v"><span id="st1v">0</span><span class="hf-stat-u">%</span></div>
      <div class="hf-stat-l">hiệu suất công việc</div>
    </div></div>
    <div class="hf-slot" style="left:50%;top:48%"><div class="hf-iconbox" id="ic1">{{icon:rocket}}</div></div>
  </div>`,
  script: `
FX.camPush(tl, { scale: 1.055 });
FX.parallax(tl, '.hf-mid > *', { amp: 14 });
FX.beat(tl, '#lb1', 0.35, DUR, { 'in': 'rise', out: 'none', drift: false, y: 22 });
FX.beat(tl, '#kw1', 0.9, 2.9, { 'in': 'carrier', out: 'whip', from: 340 });
FX.chromeSweep(tl, '#kw1', { at: 1.5 });
FX.beamSweep(tl, '.hf-beam', { at: 2.95 });
FX.beat(tl, '#st1', 3.05, 4.55, { 'in': 'pop', out: 'blur' });
FX.counterRoll(tl, '#st1v', 87, { at: 3.15, dur: 1.0 });
FX.beat(tl, '#ic1', 4.7, DUR - 0.1, { 'in': 'glitch', out: 'fade' });
FX.pulseGlow(tl, '#ic1', { at: 5.0, dur: 0.7, repeat: 1 });
`,
};

// re-export for callers that only need escaping (parity with other template modules)
export { esc, EASE };
