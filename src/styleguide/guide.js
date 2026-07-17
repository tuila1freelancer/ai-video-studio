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
    // 7-section parity (optional; reference style guides carry all seven): a px type ladder,
    // named text-effect presets and ambient notes travel into the codegen prompt verbatim.
    fontSizes: (() => {
      const fs = g.fontSizes && typeof g.fontSizes === 'object' ? g.fontSizes : {};
      const num = (v) => (Number.isFinite(+v) && +v > 8 && +v < 600 ? Math.round(+v) : undefined);
      const out = {};
      for (const k of ['hero', 'headline', 'sub', 'label']) { const v = num(fs[k]); if (v) out[k] = v; }
      return Object.keys(out).length ? out : undefined;
    })(),
    effects: strList(g.effects, 8, 160),
    ambient: strList(g.ambient, 6, 160),
  };
}

// Canned demo spec — used by tpl-smoke, determinism.mjs and as the codegen few-shot example.
// Assumes duration ≥ 6s; beats at fixed seconds show the appear-on-voice / exit-before-next pattern.
export const SAMPLE_SPEC = {
  guide: HF_DEFAULT_GUIDE,
  css: `
  .hf-orb{position:absolute;border-radius:50%;filter:blur(2px);border:1px solid rgba(255,255,255,.14)}
  .o1{left:14%;top:22%;width:9%;padding-top:9%;background:radial-gradient(circle at 35% 30%,rgba(124,140,255,.5),rgba(124,140,255,.06))}
  .o2{left:82%;top:60%;width:6%;padding-top:6%;background:radial-gradient(circle at 35% 30%,rgba(34,211,238,.45),rgba(34,211,238,.05))}
  /* faint oversized watermark glyph = far-depth texture */
  .hf-ghost{position:absolute;right:6%;top:12%;font-family:'Oswald',sans-serif;font-weight:800;font-size:300px;line-height:.8;color:#fff;opacity:.05;letter-spacing:-.03em}
  /* BESPOKE HERO CONSTRUCTION — a self-built glass "verdict card" HUD instrument (not a bare component) */
  .hf-vcard{position:relative;width:560px;padding:24px 30px 28px;border-radius:18px;background:linear-gradient(160deg,rgba(20,22,40,.72),rgba(12,13,26,.72));border:1px solid rgba(124,140,255,.34);box-shadow:0 30px 80px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.06);backdrop-filter:blur(9px)}
  .hf-vcard::before,.hf-vcard::after{content:'';position:absolute;width:16px;height:16px;border:2px solid #22D3EE}
  .hf-vcard::before{left:-1px;top:-1px;border-right:none;border-bottom:none;border-radius:6px 0 0 0}
  .hf-vcard::after{right:-1px;bottom:-1px;border-left:none;border-top:none;border-radius:0 0 6px 0}
  .hf-vhead{display:flex;align-items:center;gap:12px;font-family:'JetBrains Mono',monospace;font-size:15px;letter-spacing:.22em;text-transform:uppercase;color:#C7D0E6}
  .hf-vhead b{width:9px;height:9px;border-radius:50%;background:#22D3EE;box-shadow:0 0 12px #22D3EE;display:block}
  .hf-vrow{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-top:16px;padding-bottom:12px;border-bottom:1px solid rgba(255,255,255,.08);opacity:0}
  .hf-vrow .k{font-family:'Be Vietnam Pro',sans-serif;font-weight:600;font-size:26px;color:#F2F5FF}
  .hf-vrow .v{font-family:'JetBrains Mono',monospace;font-weight:700;font-size:24px;color:#22D3EE}
  .hf-track{width:100%;height:5px;margin-top:16px;border-radius:3px;background:rgba(255,255,255,.10);overflow:hidden}
  .hf-track i{display:block;width:100%;height:100%;transform-origin:0 50%;background:linear-gradient(90deg,#7C8CFF,#22D3EE)}
  #kw1{white-space:nowrap}
  `,
  html: `
  <div class="hf-layer hf-mid">
    <div class="hf-orb o1"></div>
    <div class="hf-orb o2"></div>
    <div class="hf-ghost">01</div>
  </div>
  <div class="hf-layer hf-near">
    <div class="hf-slot" style="left:50%;top:11%"><div class="hf-label" id="lb1">// KIỂM CHỨNG</div></div>
    <div class="hf-slot" style="left:50%;top:27%"><div class="hf-kw" id="kw1">TỰ TIN ≠ ĐÚNG</div></div>
    <!-- the hero: a bespoke glass instrument whose rows light up in the order the voice names them -->
    <div class="hf-slot" style="left:32%;top:60%"><div class="hf-vcard" id="vc1">
      <div class="hf-vhead"><b></b><span>Đối chiếu sự thật</span></div>
      <div class="hf-vrow" id="vr1"><span class="k">Có nguồn?</span><span class="v">CHƯA</span></div>
      <div class="hf-vrow" id="vr2"><span class="k">Dữ kiện khớp?</span><span class="v">37%</span></div>
      <div class="hf-track"><i id="tk1"></i></div>
    </div></div>
    <div class="hf-slot" style="left:78%;top:57%"><div class="hf-stat" id="st1">
      <div class="hf-stat-v"><span id="st1v">0</span><span class="hf-stat-u">%</span></div>
      <div class="hf-stat-l">độ tin cậy thực</div>
    </div></div>
    <div class="hf-slot" style="left:78%;top:33%"><div class="hf-iconbox sm" id="ic1">{{icon:shield}}</div></div>
  </div>`,
  script: `
// camera completes its move in the FIRST half, then holds (no back-half drift).
// The living backdrop (rings / ghost number / HUD / beat pulses) is ALREADY on stage —
// every element below is spent on a BESPOKE hero construction, not ambient decor.
FX.camPush(tl, { scale: 1.055, profile: 'front' });
FX.parallax(tl, '.hf-mid > *', { amp: 14 });
FX.beat(tl, '#lb1', 0.35, DUR, { 'in': 'rise', out: 'none', drift: false, y: 22 });
// hero keyword: unhurried entrance, then SETTLES into the composition (build element)
FX.beat(tl, '#kw1', 0.9, 3.0, { 'in': 'carrier', out: 'settle', from: 340 });
FX.chromeSweep(tl, '#kw1', { at: 1.7 });
FX.jitter(tl, '#kw1', { at: 3.2, amp: 2 });   // settled hero kept alive — never a breathing scale loop
FX.beamSweep(tl, '.hf-beam', { at: 2.95 });
// the bespoke glass verdict-card enters as ONE unit, then its rows light up node-by-node on their
// beats — rows start HIDDEN (opacity:0) and enter at FULL near-white color, never dim/low-contrast
FX.beat(tl, '#vc1', 3.05, DUR, { 'in': 'pop', ease: 'power3.out', out: 'none' });
tl.set('#vr1', { x: -16 }, 0);
tl.set('#vr2', { x: -16 }, 0);
tl.to('#vr1', { opacity: 1, x: 0, duration: 0.4, ease: 'power2.out' }, 3.5);
tl.to('#vr2', { opacity: 1, x: 0, duration: 0.4, ease: 'power2.out' }, 4.05);
// data texture: the confidence track fills as the rows resolve (scaleX from a set width — never a width tween)
tl.set('#tk1', { scaleX: 0 }, 0);
tl.to('#tk1', { scaleX: 0.37, duration: 1.0, ease: 'power2.out' }, 4.05);
// secondary readout: smooth long-tail pop, counter grows with the value
FX.beat(tl, '#st1', 4.3, DUR, { 'in': 'pop', ease: 'power3.out', out: 'settle' });
FX.counterRoll(tl, '#st1v', 37, { at: 4.5, dur: 1.1, grow: true });
FX.beat(tl, '#ic1', 3.15, DUR, { 'in': 'rise', out: 'none' });
// the money beat: the readout lands with a shock ring + sparks (exactly once per scene)
FX.impact(tl, '#st1', { at: 5.45, color: '#22D3EE' });
FX.pulseGlow(tl, '#ic1', { at: 5.5, dur: 0.9, repeat: 1 });
`,
};
