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
//   conceptMap:  "concept → visual" recipes ("comparison → SPLIT 2 columns", "process → stepper…")
//   hud:         decorative HUD vocabulary (mono kickers like "// SECTION", corner statuses)
//   sceneRules:  short hard rules applied to every scene of the video
const HEX_RE = /^#[0-9A-Fa-f]{6}$/;
const strList = (v, max, len = 200) => (Array.isArray(v) ? v : [])
  .map((s) => String(s || '').trim()).filter(Boolean).slice(0, max).map((s) => s.slice(0, len));

// ---- WCAG contrast lock ----------------------------------------------------------------
// AI- or user-authored palettes carry no guarantee that text survives on the background.
// Every foreground color is nudged toward legibility here, at the single normalization seam,
// so no downstream renderer can ever paint unreadable captions. Floors: ink ≥ 4.5:1 (body
// text, WCAG AA), muted/accents/semantics ≥ 3:1 (large display text + graphics).
function hexToRgb(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('').toUpperCase();
}
function relLuminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrastRatio(a, b) {
  const la = relLuminance(a), lb = relLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
function mix(hex, toward, t) {
  const a = hexToRgb(hex), b = hexToRgb(toward);
  return rgbToHex([0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t));
}
/** Nudge fg toward white (dark bg) or black (light bg) until it clears `min` contrast on bg. */
export function ensureContrast(fg, bg, min) {
  if (!HEX_RE.test(String(fg || '')) || !HEX_RE.test(String(bg || ''))) return fg;
  if (contrastRatio(fg, bg) >= min) return fg;
  const toward = relLuminance(bg) > 0.35 ? '#000000' : '#FFFFFF';
  let out = fg;
  for (let t = 0.08; t <= 1.001; t += 0.08) {
    out = mix(fg, toward, t);
    if (contrastRatio(out, bg) >= min) return out;
  }
  return toward; // pathological palette — full white/black is always legible
}
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
  const hud = g.hud && typeof g.hud === 'object' ? g.hud : {};
  const bg = pal.bg || d.palette.bg;
  // WCAG lock: every foreground color must clear its contrast floor on the background
  const accentsRaw = Array.isArray(pal.accents) && pal.accents.length ? pal.accents.slice(0, 3) : d.palette.accents;
  while (accentsRaw.length < 3) accentsRaw.push(accentsRaw[accentsRaw.length - 1]);
  const accents = accentsRaw.map((a) => ensureContrast(a, bg, 3));
  const semantics = normalizeSemantics(g.semantics, accents);
  for (const k of Object.keys(semantics)) semantics[k] = ensureContrast(semantics[k], bg, 3);
  return {
    id: g.id || d.id, name: g.name || d.name,
    palette: {
      bg, bg2: pal.bg2 || d.palette.bg2,
      ink: ensureContrast(pal.ink || d.palette.ink, bg, 4.5),
      muted: ensureContrast(pal.muted || d.palette.muted, bg, 3),
      accents,
    },
    fonts: { display: fonts.display || d.fonts.display, body: fonts.body || d.fonts.body, mono: fonts.mono || d.fonts.mono },
    motif: ['mesh', 'bokeh', 'grid', 'particles', 'grain'].includes(g.motif) ? g.motif : d.motif,
    textTreatment: ['chrome', 'neon', 'solid', 'outline'].includes(g.textTreatment) ? g.textTreatment : d.textTreatment,
    motionPersonality: g.motionPersonality || d.motionPersonality,
    iconStyle: g.iconStyle || d.iconStyle,
    cameraDefault: g.cameraDefault || d.cameraDefault,
    semantics,
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
  .hf-track{width:180px;height:4px;margin:10px auto 0;border-radius:2px;background:rgba(255,255,255,.10);overflow:hidden}
  .hf-track i{display:block;width:100%;height:100%;transform-origin:0 50%;background:linear-gradient(90deg,#7C8CFF,#22D3EE)}
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
    <div class="hf-slot" style="left:50%;top:68%"><div class="hf-stat" id="st1">
      <div class="hf-stat-v"><span id="st1v">0</span><span class="hf-stat-u">%</span></div>
      <div class="hf-stat-l">hiệu suất công việc</div>
      <div class="hf-track"><i id="tk1"></i></div>
    </div></div>
    <div class="hf-slot" style="left:50%;top:24%"><div class="hf-iconbox" id="ic1">{{icon:rocket}}</div></div>
  </div>`,
  script: `
// camera completes its move in the FIRST half, then holds (no back-half drift).
// The living backdrop (rings / ghost number / HUD / beat pulses) is ALREADY on stage —
// every element below is spent on the hero story.
FX.camPush(tl, { scale: 1.055, profile: 'front' });
FX.parallax(tl, '.hf-mid > *', { amp: 14 });
FX.beat(tl, '#lb1', 0.35, DUR, { 'in': 'rise', out: 'none', drift: false, y: 22 });
// hero keyword: unhurried entrance, then SETTLES into the composition (build element —
// the scene assembles around it; nothing whips away)
FX.beat(tl, '#kw1', 0.9, 3.0, { 'in': 'carrier', out: 'settle', from: 340 });
FX.chromeSweep(tl, '#kw1', { at: 1.7 });
// settled hero stays alive with a subtle seeded jitter — never a breathing scale loop
FX.jitter(tl, '#kw1', { at: 3.2, amp: 2 });
FX.beamSweep(tl, '.hf-beam', { at: 2.95 });
// stat block: smooth long-tail pop on its spoken beat (no bounce), counter grows with the value
FX.beat(tl, '#st1', 3.05, 4.8, { 'in': 'pop', ease: 'power3.out', out: 'settle' });
FX.counterRoll(tl, '#st1v', 87, { at: 3.25, dur: 1.2, grow: true });
// data texture: the mini progress track fills alongside the counter
tl.set('#tk1', { scaleX: 0 }, 0);
tl.to('#tk1', { scaleX: 0.87, duration: 1.2, ease: 'power2.out' }, 3.25);
// the money beat: the stat lands with a shock ring + sparks (exactly once per scene)
FX.impact(tl, '#st1', { at: 4.45, color: '#22D3EE' });
// closing accent: the icon joins the assembled composition and holds focus to the end
FX.beat(tl, '#ic1', 4.9, DUR - 0.1, { 'in': 'rise', out: 'none' });
FX.pulseGlow(tl, '#ic1', { at: 5.4, dur: 0.9, repeat: 1 });
`,
};
