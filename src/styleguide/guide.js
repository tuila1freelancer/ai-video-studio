// Style-guide SCHEMA — pure data + normalization, no I/O and no animation/hyperframe deps.
// A guide pins everything the LLM must NOT improvise: palette, fonts, background motif,
// keyword text treatment and motion personality, plus the v2 "art direction" fields
// (semantics / conceptMap / hud / sceneRules). Living here (not under animation/ or
// hyperframe/) is what lets BOTH visual systems depend on it without a dependency cycle.

/** @typedef {{id?:string,name?:string,palette:object,fonts:object,motif?:string,textTreatment?:string,motionPersonality?:string,iconStyle?:string,cameraDefault?:string,semantics?:object,conceptMap?:string[],hud?:object,sceneRules?:string[]}} Guide */

/** Default guide — "chrome-kinetic", the HyperFrames-style chrome kinetic typography look. */
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

/**
 * Fill a partial/untrusted guide with defaults + validate enums, hex, list caps.
 * @param {Partial<Guide>} g
 * @returns {Guide} a fully-populated, safe guide object
 */
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
