// Video outro: title with 3D flying chars (SplitText), CTA pill pop (back.out) + confetti burst
// behind the pill (22 accent-colored pieces, trajectories precomputed via seeded rng — deterministic).
import { esc, hudLabel, base, headingStyle, fx } from './_shared.js';

export default {
  id: 'cta-outro', name: 'CTA Outro', desc: 'Kết video: cảm ơn + subscribe (confetti GSAP)',
  build(p, ctx) {
    const { u, theme, accent } = ctx;
    const NC = 22;
    // Confetti: decorative — natural state is opacity:0 inline (scene stays complete if the script fails).
    const confetti = Array.from({ length: NC }, (_, i) => {
      const sz = u(0.5 + (i % 5) * 0.1); // u(0.5)..u(0.9) cycle — deterministic per aspect
      const col = theme.accents[i % theme.accents.length];
      const rad = i % 2 ? '22%' : '50%';
      return `<div class="cf" style="width:${sz}px;height:${sz}px;margin:-${Math.round(sz / 2)}px 0 0 -${Math.round(sz / 2)}px;background:${col};color:${col};border-radius:${rad};opacity:0"></div>`;
    }).join('');
    return {
      css: base(ctx) + `
      .h1{${headingStyle(ctx, 8)};}
      .sub{margin-top:${u(2)}px;font-weight:600;font-size:${u(2.8)}px;color:${theme.muted}}
      .pillwrap{position:relative;margin-top:${u(4)}px}
      .cf{position:absolute;left:50%;top:50%;z-index:0;box-shadow:0 0 ${u(1)}px currentColor}
      .pill{position:relative;z-index:1;padding:${u(1.8)}px ${u(4.2)}px;border-radius:${u(4)}px;background:${accent};color:${theme.bg};font-weight:800;font-size:${u(2.6)}px;letter-spacing:.06em;text-transform:uppercase;box-shadow:${theme.glow(accent)};animation:pulse2 2.4s ease-in-out 1.8s infinite}
      .next{margin-top:${u(2.6)}px;font:600 ${u(2)}px ${theme.mono};color:${theme.muted};letter-spacing:.04em}
      .next b{color:${theme.ink}}
      @keyframes pulse2{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}`,
      html: `<div class="wrap">
        ${hudLabel(p.label || 'THANKS FOR WATCHING', ctx, accent)}
        <div class="h1" style="margin-top:${u(1.4)}px">${esc(p.heading || 'Cảm ơn đã xem')}</div>
        ${p.sub ? `<div class="sub">${esc(p.sub)}</div>` : ''}
        <div class="pillwrap">${confetti}<div class="pill">${esc(p.cta || 'Đăng ký kênh')}</div></div>
        ${p.next ? `<div class="next">▶ Xem tiếp: <b>${esc(p.next)}</b></div>` : ''}
      </div>`,
      script: fx(`
        FX.splitIn(tl, '.h1', { at: 0.15, each: 0.024, y: ${u(4.5)}, persp: ${u(40)} });
        ${p.sub ? `FX.rise(tl, '.sub', { at: 0.7, y: ${u(3)} });` : ''}
        tl.from('.pill', { scale: 0.3, opacity: 0, duration: 0.6, ease: 'back.out(2.2)' }, 0.95);
        ${p.next ? `FX.rise(tl, '.next', { at: 1.35, y: ${u(2)} });` : ''}
        // Confetti burst behind the pill at the pop moment. Single keyframed tween per piece:
        // opacity 0 -> 1 -> 0 so start state == natural state (scrub-safe in any frame order).
        var cf = FX.q('.cf');
        for (var i = 0; i < cf.length; i++) {
          var a = (i / cf.length) * Math.PI * 2;
          tl.to(cf[i], { keyframes: [
            { opacity: 1, duration: 0.03, ease: 'none' },
            { x: Math.cos(a) * (${u(14)} + rng() * ${u(8)}), y: Math.sin(a) * ${u(12)} + ${u(6)},
              rotation: rng() * 180, opacity: 0, duration: 1.1, ease: 'power2.out' } ] }, 1.0);
        }
      `),
    };
  },
};
