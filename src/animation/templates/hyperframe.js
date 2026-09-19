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

function motifLayer(guide, ctx, name) {
  const { u, w, h, seed } = ctx;
  const [a0, a1, a2] = guide.palette.accents;
  const rnd = m32(9001 + (seed | 0));
  const pct = (v) => (v * 100).toFixed(2) + '%';
  const style = name || guide.motif; // P38: the per-scene backdrop can override the guide motif
  if (style === 'mesh') {
    const blobs = [a0, a1, a2].map((c, i) => {
      const x = pct(0.12 + rnd() * 0.76), y = pct(0.1 + rnd() * 0.7);
      const s = u(46 + i * 8);
      return `<div class="hf-blob" style="left:${x};top:${y};width:${s}px;height:${s}px;background:${c};opacity:${(0.22 - i * 0.05).toFixed(2)}"></div>`;
    }).join('');
    return { css: `.hf-blob{position:absolute;border-radius:50%;filter:blur(${u(9)}px);transform:translate(-50%,-50%)}`, html: blobs };
  }
  if (style === 'bokeh') {
    let dots = '';
    for (let i = 0; i < 9; i++) {
      const c = [a0, a1, a2][i % 3];
      dots += `<div class="hf-bok" style="left:${pct(rnd())};top:${pct(rnd())};width:${u(3 + rnd() * 9)}px;height:${u(3 + rnd() * 9)}px;background:${c};opacity:${(0.08 + rnd() * 0.14).toFixed(2)}"></div>`;
    }
    return { css: `.hf-bok{position:absolute;border-radius:50%;filter:blur(${u(2.2)}px);transform:translate(-50%,-50%)}`, html: dots };
  }
  if (style === 'grid') {
    const cell = Math.round(w / 18);
    return {
      css: `.hf-gridbg{position:absolute;inset:0;opacity:.12;background-image:linear-gradient(${a0}33 1px,transparent 1px),linear-gradient(90deg,${a0}33 1px,transparent 1px);background-size:${cell}px ${cell}px;mask-image:radial-gradient(120% 95% at 50% 50%,#000 32%,transparent 80%);-webkit-mask-image:radial-gradient(120% 95% at 50% 50%,#000 32%,transparent 80%)}
.hf-horiz{position:absolute;left:0;right:0;bottom:0;height:${Math.round(h * 0.4)}px;background:radial-gradient(70% 100% at 50% 100%,${a1}26 0%,transparent 70%)}`,
      html: '<div class="hf-gridbg"></div><div class="hf-horiz"></div>',
    };
  }
  // ── P38 backdrop styles (all seeded/deterministic, sit behind the scene in .hf-far) ──
  if (style === 'spotlight') {
    const x = pct(0.26 + rnd() * 0.48), y = pct(0.18 + rnd() * 0.34);
    return {
      css: `.hf-spot{position:absolute;inset:0;background:radial-gradient(58% 54% at ${x} ${y},${a0}22 0%,${a1}12 34%,transparent 70%)}`,
      html: '<div class="hf-spot"></div>',
    };
  }
  if (style === 'aurora') {
    return {
      css: `.hf-aur{position:absolute;inset:-12%;background:radial-gradient(38% 30% at 22% 30%,${a0}24,transparent 60%),radial-gradient(44% 34% at 78% 42%,${a1}1c,transparent 62%),radial-gradient(50% 40% at 50% 82%,${a2}18,transparent 66%);filter:blur(${u(6)}px);animation:hfAur 20s ease-in-out infinite alternate}
@keyframes hfAur{from{transform:translate(-2%,-1%) scale(1)}to{transform:translate(2%,1%) scale(1.06)}}`,
      html: '<div class="hf-aur"></div>',
    };
  }
  if (style === 'rays') {
    return {
      css: `.hf-rays{position:absolute;inset:0;background:repeating-conic-gradient(from 0deg at 50% 6%,${a0}12 0deg,transparent 3deg 9deg);opacity:.6;mask-image:radial-gradient(95% 92% at 50% 16%,#000 18%,transparent 76%);-webkit-mask-image:radial-gradient(95% 92% at 50% 16%,#000 18%,transparent 76%)}`,
      html: '<div class="hf-rays"></div>',
    };
  }
  if (style === 'dotmatrix') {
    const gap = Math.max(14, Math.round(w / 46));
    const dot = Math.max(1, Math.round(u(0.18)));
    return {
      css: `.hf-dm{position:absolute;inset:0;background-image:radial-gradient(${a1}55 ${dot}px,transparent ${dot + 1}px);background-size:${gap}px ${gap}px;opacity:.5;mask-image:radial-gradient(112% 92% at 50% 46%,#000 30%,transparent 80%);-webkit-mask-image:radial-gradient(112% 92% at 50% 46%,#000 30%,transparent 80%)}`,
      html: '<div class="hf-dm"></div>',
    };
  }
  if (style === 'blueprint') {
    const cell = Math.round(w / 26), fine = Math.max(6, Math.round(cell / 4));
    return {
      css: `.hf-bp{position:absolute;inset:0;background-image:linear-gradient(${a0}22 1px,transparent 1px),linear-gradient(90deg,${a0}22 1px,transparent 1px),linear-gradient(${a0}10 1px,transparent 1px),linear-gradient(90deg,${a0}10 1px,transparent 1px);background-size:${cell}px ${cell}px,${cell}px ${cell}px,${fine}px ${fine}px,${fine}px ${fine}px;opacity:.55;mask-image:radial-gradient(122% 100% at 50% 50%,#000 40%,transparent 86%);-webkit-mask-image:radial-gradient(122% 100% at 50% 50%,#000 40%,transparent 86%)}`,
      html: '<div class="hf-bp"></div>',
    };
  }
  if (style === 'gradient-wash') {
    return {
      css: `.hf-gw{position:absolute;inset:0;background:linear-gradient(122deg,${a0}20 0%,transparent 42%,${a1}18 100%)}`,
      html: '<div class="hf-gw"></div>',
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
// drifting accent specks, and a pulse ring that fires on every narration beat (wired in
// build()). DELIBERATELY NO scene-number / slide-number glyph and no fixed corner HUD tag —
// a per-scene number badge or a stamped corner status reads as a slide deck, not motion
// graphics. All pieces are gate-safe: painted shapes feed the deadness decor counter,
// positions live in reserved corners/center-back.
function decoLayer(guide, ctx) {
  const { u, seed } = ctx;
  const [a0, a1, a2] = guide.palette.accents;
  const rnd = m32(4400 + (seed | 0));
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
  .hf-dspeck{position:absolute;width:${Math.max(4, u(0.55))}px;height:${Math.max(4, u(0.55))}px;transform:rotate(45deg);opacity:.24;animation:hfdrift ease-in-out infinite alternate}
  .hf-dpulse{position:absolute;left:50%;top:45%;width:${u(30)}px;height:${u(30)}px;margin:-${u(15)}px 0 0 -${u(15)}px;border:${Math.max(2, u(0.3))}px solid ${a0};border-radius:50%;opacity:0}
  @keyframes hfspin{to{transform:rotate(360deg)}}
  @keyframes hfdrift{from{transform:rotate(45deg) translateY(0)}to{transform:rotate(45deg) translateY(-${u(2.4)}px)}}`,
    html: `<div class="hf-deco"><div class="hf-dring"></div><div class="hf-dring2"></div>${specks}<div class="hf-dpulse"></div></div>`,
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
// exported so the repair scanner can ask the same question the CSS asks
// Two CSS properties that are wrong outside Latin-like scripts.
//
// `text-transform:uppercase` is a no-op in CJK, Thai, Devanagari, Hebrew and Arabic — they have no
// case — and `letter-spacing` is worse than a no-op: it pulls apart the clusters that Devanagari,
// Thai and Arabic build their letters out of, and breaks cursive joining outright.
const CASED = new Set(['latin', 'vietnamese', 'cyrillic', 'greek']);
const CLUSTERED = new Set(['devanagari', 'thai', 'arabic', 'hebrew']);
const upper = (script) => (CASED.has(script || 'latin') ? 'text-transform:uppercase;' : '');
const track = (script, v) => (CLUSTERED.has(script || 'latin') ? '' : `letter-spacing:${v};`);

export function isLightHex(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '')); if (!m) return false;
  const v = parseInt(m[1], 16);
  return (0.2126 * ((v >> 16) & 255) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255)) > 150;
}

function baseCss(guide, ctx) {
  const { u } = ctx;
  const p = guide.palette;
  const [a0, a1, a2] = p.accents;
  // Light-paper guides: the stage dressing below was tuned for dark stages, where a black
  // vignette, white-glass cards and a white beam read as depth. On a light background the
  // same rules paint a black oval around every scene and make cards, chips, beam and underline
  // vanish — so each one gets an ink-tinted counterpart. Dark guides keep the exact strings.
  const light = isLightHex(p.bg);
  const vig = light ? `${p.ink}1F` : 'rgba(0,0,0,.44)';
  const kw2Shadow = light ? `0 ${u(0.15)}px ${u(0.6)}px rgba(0,0,0,.18)` : `0 ${u(0.3)}px ${u(1.4)}px rgba(0,0,0,.7)`;
  const cardBg = light ? 'linear-gradient(160deg,rgba(255,255,255,.82),rgba(255,255,255,.6))' : 'linear-gradient(160deg,rgba(255,255,255,.09),rgba(255,255,255,.03))';
  const cardBorder = light ? `${p.ink}2E` : 'rgba(255,255,255,.12)';
  const cardShadow = light ? `0 ${u(1.2)}px ${u(3.2)}px ${p.ink}1F,inset 0 1px 0 rgba(255,255,255,.9)` : `0 ${u(1.6)}px ${u(4)}px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.08)`;
  const chipBg = light ? `${p.ink}0F` : 'rgba(255,255,255,.07)';
  const statShadow = light ? `0 ${u(0.15)}px ${u(0.6)}px rgba(0,0,0,.15)` : `0 0 ${u(2.4)}px ${a0}66,0 ${u(0.4)}px ${u(1.6)}px rgba(0,0,0,.8)`;
  const beamMid = light ? `${p.ink}33` : 'rgba(255,255,255,.55)';
  const underlineMid = light ? `${p.ink}cc` : '#ffffffcc';
  return `
  .hf-cam{position:absolute;inset:0;transform-origin:50% 50%}
  .hf-layer{position:absolute;inset:0}
  .hf-far,.hf-mid,.hf-near{position:absolute;inset:0}
  /* flex-COLUMN (was grid place-items:center): a weak model routinely groups a kicker + headline
     (+ sublabel) as siblings inside ONE slot; a single-cell grid STACKS them on top of each other
     (the #1 overlap defect), whereas a column stacks them vertically with a gap. A single-child
     slot is centered identically to before, so existing scenes are unaffected. */
  .hf-slot{position:absolute;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${u(1.4)}px;text-align:center}
  .hf-center{position:absolute;inset:0;display:grid;place-items:center;text-align:center}
  .hf-kw{font-family:${guide.fonts.display};font-weight:800;font-size:${u(11)}px;line-height:1.02;${track(ctx.script, '.005em')}${upper(ctx.script)}white-space:pre-line;text-wrap:balance;${kwTreatment(guide, ctx)}}
  .hf-kw2{font-family:${guide.fonts.display};font-weight:700;font-size:${u(6.2)}px;line-height:1.08;${upper(ctx.script)}text-wrap:balance;color:${p.ink};text-shadow:${kw2Shadow}}
  .hf-sub{font-family:${guide.fonts.body};font-weight:500;font-size:${u(2.9)}px;color:${p.muted};line-height:1.4;text-wrap:balance}
  .hf-label{font-family:${guide.fonts.mono};font-weight:700;font-size:${u(2.0)}px;${track(ctx.script, '.3em')}${upper(ctx.script)}color:${a1}}
  .hf-card{background:${cardBg};border:1px solid ${cardBorder};border-radius:${u(1.8)}px;padding:${u(2.6)}px ${u(3.4)}px;box-shadow:${cardShadow};backdrop-filter:blur(6px)}
  .hf-chip{display:inline-flex;align-items:center;gap:${u(1)}px;font-family:${guide.fonts.body};font-weight:600;font-size:${u(2.3)}px;color:${p.ink};background:${chipBg};border:1px solid ${a0}55;border-radius:999px;padding:${u(0.9)}px ${u(2.2)}px}
  .hf-stat{display:grid;justify-items:center;gap:${u(0.6)}px}
  .hf-stat-v{font-family:${guide.fonts.display};font-weight:800;font-size:${u(13)}px;line-height:1;font-variant-numeric:tabular-nums;color:${p.ink};text-shadow:${statShadow}}
  .hf-stat-u{font-size:.55em;color:${a1};margin-left:.06em}
  .hf-stat-l{font-family:${guide.fonts.body};font-weight:600;font-size:${u(2.6)}px;${track(ctx.script, '.12em')}${upper(ctx.script)}color:${p.muted}}
  .hf-iconbox{display:grid;place-items:center;font-size:${u(11)}px;color:${a1};filter:drop-shadow(0 0 ${u(2.2)}px ${a1}77)}
  .hf-iconbox.sm{font-size:${u(6)}px}
  .hf-lower3{position:absolute;left:7%;right:7%;bottom:20%;display:flex;align-items:center;gap:${u(1.6)}px;justify-content:center}
  .hf-row{display:flex;gap:${u(1.8)}px;align-items:center;justify-content:center}
  .hf-col{display:grid;gap:${u(1.4)}px;justify-items:center}
  .hf-beam{position:absolute;top:-25%;bottom:-25%;left:-14%;width:${u(9)}px;background:linear-gradient(90deg,transparent,${beamMid},transparent);transform:rotate(13deg);opacity:0;pointer-events:none}
  .hf-underline{height:${Math.max(3, u(0.45))}px;border-radius:99px;background:linear-gradient(90deg,${a0},${a1},${underlineMid},${a0});background-size:240% 100%;box-shadow:0 0 ${u(1.4)}px ${a0}99;animation:hfsheen 3.4s ease-in-out infinite}
  @keyframes hfsheen{0%,100%{background-position:0% 0}50%{background-position:100% 0}}
  .hf-vig{pointer-events:none;box-shadow:inset 0 0 ${u(26)}px ${vig}}
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
    // Overlay mode: the scene composites onto real footage via colorkey — every stage
    // dressing that would paint the key color away (motif, deco rings, vignette, grain)
    // is omitted; the beam stays (a light streak over footage is reference doctrine).
    const overlay = !!p.overlay;
    // P38: per-scene backdrop rotation — p.backdrop (set by visuals/regen when backgroundVariety
    // is on) overrides the guide's fixed motif, so the video varies its background scene to scene
    // while palette/fonts stay LOCKED for one identity. Falls back to guide.motif for old scenes.
    const motif = overlay ? { css: '', html: '' } : motifLayer(guide, ctx, p.backdrop || guide.motif);
    const deco = overlay ? { css: '', html: '' } : decoLayer(guide, ctx);
    const body = expandIcons(p.html || '');
    const css = baseCss(guide, ctx) + '\n' + motif.css + '\n' + deco.css + '\n' + (p.css || '');
    const html = `
    <div class="hf-cam">
      ${overlay ? '' : `<div class="hf-layer hf-far">${motif.html}</div>`}
      ${deco.html}
      ${body}
      <div class="hf-layer" style="pointer-events:none"><div class="hf-beam"></div></div>
    </div>
    ${overlay ? '' : '<div class="hf-layer hf-vig"></div>\n    <div class="hf-layer hf-grain"></div>'}`;
    // Beat pulse: the backdrop ring flashes softly on every narration beat — the scene keeps
    // a visible heartbeat between the model's moments, no matter how quiet the spec is.
    // Beat times are authored-timeline seconds (same coordinates as the model script).
    const beatTs = overlay ? [] : (Array.isArray(p.beats) ? p.beats : [])
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
