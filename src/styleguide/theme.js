// Map a guide onto the render THEME shape (harness/canvas/captions/progress bar all follow
// the guide instead of the classic config.theme) — the whole page speaks one language.
// Pure: depends on nothing in animation/ or hyperframe/.

/**
 * Project a normalized guide onto the animation renderer's theme object.
 * @param {import('./guide.js').Guide} g normalized guide
 * @returns {object} theme consumed by animation/harness.js
 */
export function themeFromGuide(g) {
  const [a0, a1, a2] = g.palette.accents;
  const light = isLight(g.palette.bg);
  const glow = light ? () => 'none' : (c) => `0 0 14px ${c}AA, 0 0 44px ${c}55`;
  const glowSoft = light ? () => 'none' : (c) => `0 0 10px ${c}66, 0 0 30px ${c}2E`;
  return {
    name: `HF ${g.name}`,
    bg: g.palette.bg, bg2: g.palette.bg2,
    panel: light ? 'rgba(255,255,255,0.8)' : 'rgba(16,22,44,0.55)',
    panelBorder: light ? 'rgba(15,23,42,0.10)' : 'rgba(120,160,255,0.16)',
    ink: g.palette.ink, muted: g.palette.muted, dim: light ? '#B6C0D4' : '#4A5878',
    accents: [a0, a1, a2, a0, a1],
    gradBar: `linear-gradient(90deg,${a0},${a1})`,
    glow, glowSoft,
    font: g.fonts.body, mono: g.fonts.mono,
    particles: g.motif === 'particles' ? 70 : g.motif === 'grain' ? 0 : light ? 0 : 30,
    grid: false, // the hyperframe motif layer draws its own grid when asked
    streak: false, // the persistent diagonal streak reads as a scratch over the rich HF foreground;
                   // flourishes come from the on-demand .hf-beam (FX.beamSweep) instead.
    vignette: light ? 0 : 0.5,
    noise: 0,
  };
}

/** Perceived-luminance test (WCAG-ish) — true for light backgrounds. */
export function isLight(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return false;
  const v = parseInt(m[1], 16);
  const r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) > 150;
}
