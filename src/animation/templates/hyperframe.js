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
import { normalizeGuide } from '../../styleguide/guide.js';

function m32(a) {
  return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
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

// Auto set-dressing — the premium look must NOT depend on what the LLM happens to author.
// Every hyperframe scene gets a deterministic living backdrop: dual counter-spinning rings,
// a ghost scene number, dim HUD corner statuses, drifting accent specks, and a pulse ring
// that fires on every narration beat (wired in build()). All pieces are gate-safe by
// construction: text opacity ≤0.34 (below every text-gate threshold), painted shapes feed
// the deadness decor counter, positions live in reserved corners/center-back.
function decoLayer(guide, ctx) {
  const { u, seed, idx } = ctx;
  const [a0, a1, a2] = guide.palette.accents;
  const rnd = m32(4400 + (seed | 0));
  const num = String(((idx | 0) % 99) + 1).padStart(2, '0');
  const status = (guide.hud?.statuses || [])[0] || '';
  let specks = '';
  for (let i = 0; i < 4; i++) {
    const c = [a0, a1, a2][i % 3];
    specks += `<div class="hf-dspeck" style="left:${(6 + rnd() * 88).toFixed(1)}%;top:${(8 + rnd() * 58).toFixed(1)}%;background:${c};animation-duration:${(5 + rnd() * 4).toFixed(1)}s;animation-delay:-${(rnd() * 5).toFixed(1)}s"></div>`;
  }
  return {
    css: `
  .hf-deco{position:absolute;inset:0;pointer-events:none}
  .hf-dring{position:absolute;left:50%;top:45%;width:${u(52)}px;height:${u(52)}px;margin:-${u(26)}px 0 0 -${u(26)}px;border:2px dashed ${a0};border-radius:50%;opacity:.14;animation:hfspin 34s linear infinite}
  .hf-dring2{position:absolute;left:50%;top:45%;width:${u(38)}px;height:${u(38)}px;margin:-${u(19)}px 0 0 -${u(19)}px;border:2px solid transparent;border-top-color:${a1};border-right-color:${a1}44;border-radius:50%;opacity:.2;animation:hfspin 22s linear infinite reverse}
  .hf-dghost{position:absolute;right:4.5%;top:7%;font-family:${guide.fonts.display};font-weight:800;font-size:${u(26)}px;line-height:1;color:${guide.palette.ink};opacity:.055;letter-spacing:-.02em}
  .hf-dst{position:absolute;left:4.5%;top:5.5%;font-family:${guide.fonts.mono};font-weight:700;font-size:${u(1.7)}px;letter-spacing:.3em;text-transform:uppercase;color:${guide.palette.muted};opacity:.34}
  .hf-dspeck{position:absolute;width:${Math.max(4, u(0.55))}px;height:${Math.max(4, u(0.55))}px;transform:rotate(45deg);opacity:.24;animation:hfdrift ease-in-out infinite alternate}
  .hf-dpulse{position:absolute;left:50%;top:45%;width:${u(30)}px;height:${u(30)}px;margin:-${u(15)}px 0 0 -${u(15)}px;border:${Math.max(2, u(0.3))}px solid ${a0};border-radius:50%;opacity:0}
  @keyframes hfspin{to{transform:rotate(360deg)}}
  @keyframes hfdrift{from{transform:rotate(45deg) translateY(0)}to{transform:rotate(45deg) translateY(-${u(2.4)}px)}}`,
    html: `<div class="hf-deco"><div class="hf-dring"></div><div class="hf-dring2"></div><div class="hf-dghost">${esc(num)}</div>${status ? `<div class="hf-dst">${esc(status)}</div>` : ''}${specks}<div class="hf-dpulse"></div></div>`,
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
  .hf-underline{height:${Math.max(3, u(0.45))}px;border-radius:99px;background:linear-gradient(90deg,${a0},${a1},#ffffffcc,${a0});background-size:240% 100%;box-shadow:0 0 ${u(1.4)}px ${a0}99;animation:hfsheen 3.4s ease-in-out infinite}
  @keyframes hfsheen{0%,100%{background-position:0% 0}50%{background-position:100% 0}}
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
    const deco = decoLayer(guide, ctx);
    const body = expandIcons(p.html || '');
    const css = baseCss(guide, ctx) + '\n' + motif.css + '\n' + deco.css + '\n' + (p.css || '');
    const html = `
    <div class="hf-cam">
      <div class="hf-layer hf-far">${motif.html}</div>
      ${deco.html}
      ${body}
      <div class="hf-layer" style="pointer-events:none"><div class="hf-beam"></div></div>
    </div>
    <div class="hf-layer hf-vig"></div>
    <div class="hf-layer hf-grain"></div>`;
    // Beat pulse: the backdrop ring flashes softly on every narration beat — the scene keeps
    // a visible heartbeat between the model's moments, no matter how quiet the spec is.
    // Beat times are authored-timeline seconds (same coordinates as the model script).
    const beatTs = (Array.isArray(p.beats) ? p.beats : [])
      .map((b) => +(+((b && (b.t0 ?? b.t)) || 0)).toFixed(2)).filter((t) => t > 0.2).slice(0, 8);
    const pulses = `var __hfBeats=${JSON.stringify(beatTs)};
for (var __hfI=0;__hfI<__hfBeats.length;__hfI++){
  tl.fromTo('.hf-dpulse',{opacity:0.3,scale:0.55},{opacity:0,scale:1.5,duration:0.7,ease:'power2.out'},__hfBeats[__hfI]);
}
`;
    // DUR is in AUTHORED-timeline coordinates: the LLM script's absolute seconds were
    // written for props.plannedDur. With the scenes-first time-warp (S.tplScale = planned/
    // real) the harness seeks the timeline at t*tplScale, so DUR must equal the authored
    // span (real*scale = planned) for end-of-scene positioning to stay correct.
    const script = fx('var DUR = (typeof window!=="undefined" && window.__authoredDur!=null) ? window.__authoredDur : S.duration * (S.tplScale || 1);\n'
      + pulses + (p.script && String(p.script).trim() ? p.script : DEFAULT_AMBIENT));
    return { css, html, script };
  },
};

export default hyperframe;

// re-export for callers that only need escaping (parity with other template modules)
export { esc, EASE };
