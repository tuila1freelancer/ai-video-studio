// Giant neon number: GSAP count-up (real numeric counting) + CustomWiggle settle,
// heading with 3D flying chars (SplitText), underline tick drawn horizontally with GSAP.
import { esc, pad2, base, headingStyle, fx } from './_shared.js';

export default {
  id: 'number-highlight', name: 'Number Highlight', desc: 'Con số neon khổng lồ + label',
  build(p, ctx) {
    const { u, theme, accent } = ctx;
    const num = p.number != null ? pad2(p.number) : '01';
    // Count-up only when the counter's final text exactly matches the natural HTML
    // (integer values; leading-zero pad to 2 like FX.count's pad option).
    const nVal = Number(p.number != null ? p.number : 1);
    const canCount = Number.isInteger(nVal) && String(nVal).padStart(2, '0') === num;
    const countEnd = 0.35 + 1.3; // FX.count at + dur → wiggle settle starts here
    return {
      css: base(ctx) + `
      .num{font-weight:800;font-size:${u(24)}px;line-height:1;color:${accent};text-shadow:${theme.glow(accent)};animation:glowpulse 3s ease-in-out 1s infinite}
      .lbl{font:700 ${u(2.2)}px ${theme.mono};letter-spacing:.3em;color:${theme.muted};text-transform:uppercase}
      .h1{${headingStyle(ctx, 6.4)};margin-top:${u(2)}px}
      .sub{margin-top:${u(1.6)}px;font-weight:600;font-size:${u(2.7)}px;color:${theme.muted}}
      .tick{width:${u(10)}px;height:${Math.max(3, u(0.5))}px;border-radius:3px;background:${accent};margin-top:${u(2.2)}px;transform-origin:left}`,
      html: `<div class="wrap">
        ${p.label ? `<div class="lbl">${esc(p.label)}</div>` : ''}
        <div class="num" id="bignum">${esc(num)}</div>
        <div class="h1">${esc(p.heading)}</div>
        <div class="tick"></div>
        ${p.sub ? `<div class="sub">${esc(p.sub)}</div>` : ''}
      </div>`,
      script: fx(`
        ${p.label ? `FX.rise(tl, '.lbl', { at: 0.05, y: ${u(2)}, dur: 0.55 });` : ''}
        FX.pop(tl, '.num', { at: 0.1, from: 0.5, dur: 0.55 });
        ${canCount ? `FX.count(tl, '#bignum', ${nVal}, { pad: true, dur: 1.3, at: 0.35 });` : ''}
        FX.wiggle(tl, '.num', { at: ${countEnd}, rot: 2.5, n: 6 });
        FX.splitIn(tl, '.h1', { at: 0.55, each: 0.026, y: ${u(3.5)}, persp: ${u(40)} });
        tl.fromTo('.tick', { scaleX: 0 }, { scaleX: 1, transformOrigin: 'left center', duration: 0.6, ease: 'power3.inOut' }, 0.85);
        ${p.sub ? `FX.rise(tl, '.sub', { at: 1.15, y: ${u(2.5)} });` : ''}
        FX.loop(tl, '.num', { y: -${u(0.8)}, at: 2.5, dur: 3 });
      `),
    };
  },
};
