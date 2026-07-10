// Rating criteria: heading with 3D flying chars (SplitText), row of stars dropping with bounce + wiggle.
import { esc, icon, hudLabel, base, headingStyle, EASE, fx } from './_shared.js';

export default {
  id: 'rating-criteria', name: 'Rating Criteria', desc: 'Tiêu chí + hàng sao rơi nảy đánh giá',
  build(p, ctx) {
    const { u, theme, accent } = ctx;
    const n = Math.min(5, Math.max(3, p.count || 5));
    const stars = Array.from({ length: n }, () =>
      `<div class="st">${icon('star', u(6.4), accent, 1.5)}</div>`).join('');
    return {
      css: base(ctx) + `
      .h1{${headingStyle(ctx, 7)};}
      .sub{margin-top:${u(1.4)}px;font:700 ${u(2.4)}px ${theme.mono};letter-spacing:.3em;color:${theme.muted};text-transform:uppercase;opacity:0;animation:fadeup .6s ${EASE} .5s both}
      .stars{display:flex;gap:${u(2.6)}px;margin-top:${u(4.5)}px}
      .st{color:${accent};animation:glowpulse 3.2s ease-in-out 2s infinite}`,
      html: `<div class="wrap">
        ${hudLabel(p.label || '', ctx, accent)}
        <div class="h1" style="margin-top:${u(1)}px">${esc(p.heading)}</div>
        ${p.sub ? `<div class="sub">${esc(p.sub)}</div>` : ''}
        <div class="stars">${stars}</div>
      </div>`,
      script: fx(`
        FX.splitIn(tl, '.h1', { at: 0.12, each: 0.024, y: ${u(3.5)}, persp: ${u(40)} });
        var sts = FX.q('.st');
        for (var i = 0; i < sts.length; i++) {
          var at = 0.7 + i * 0.22;
          tl.from(sts[i], { y: -${u(18)}, rotation: rng() * 24 - 12, duration: 0.7, ease: 'bounce.out' }, at);
          tl.from(sts[i], { opacity: 0, duration: 0.22, ease: 'power1.out' }, at);
          FX.wiggle(tl, sts[i], { rot: (rng() < 0.5 ? -1 : 1) * (3 + rng() * 2), n: 6, dur: 0.7, at: at + 0.74 });
        }
        FX.loop(tl, '.st', { y: -${u(0.8)}, at: ${(0.7 + (n - 1) * 0.22 + 1.5).toFixed(2)}, dur: 2.6, each: 0.3 });
      `),
    };
  },
};
