// 2 opposing neon keywords: chars slide in opposite directions per character (SplitText),
// center rule scaleX, icon pop + wiggle. Ambient glowpulse kept in CSS.
import { esc, icon, hudLabel, base, headingStyle, fx } from './_shared.js';

export default {
  id: 'dual-keyword', name: 'Dual Keyword', desc: '2 từ khoá neon 2 màu + icon',
  build(p, ctx) {
    const { u, theme } = ctx;
    const a = ctx.accent, b = theme.accents[(ctx.idx + 1) % theme.accents.length];
    return {
      css: base(ctx) + `
      .k1{${headingStyle(ctx, 9.4, a)};align-self:flex-start;margin-left:${u(4)}px}
      .k2{${headingStyle(ctx, 9.4, b)};align-self:flex-end;margin-right:${u(4)}px;margin-top:${u(2)}px}
      .ico1{position:absolute;top:${u(16)}px;left:${u(9)}px;color:${a};animation:glowpulse 3s ease-in-out 1.4s infinite}
      .ico2{position:absolute;bottom:${u(20)}px;right:${u(9)}px;color:${b};animation:glowpulse 3s ease-in-out 1.7s infinite}
      .mid{width:${u(30)}px;height:2px;background:linear-gradient(90deg,${a},${b});margin:${u(1.4)}px 0;transform-origin:center}
      .sub{font:600 ${u(2.3)}px ${theme.mono};letter-spacing:.18em;color:${theme.muted};text-transform:uppercase;opacity:.9}`,
      html: `<div class="wrap">
        <div class="ico1">${icon(p.iconA || 'eye', u(5.4), a)}</div>
        <div class="ico2">${icon(p.iconB || 'shield', u(5.4), b)}</div>
        ${hudLabel(p.label || '', ctx)}
        <div class="k1">${esc((p.a || '').toUpperCase())}</div>
        <div class="mid"></div>
        <div class="k2">${esc((p.b || '').toUpperCase())}</div>
        ${p.sub ? `<div class="sub" style="margin-top:${u(2.4)}px">${esc(p.sub)}</div>` : ''}
      </div>`,
      script: fx(`
        var s1 = FX.split('.k1');
        var s2 = FX.split('.k2');
        tl.from(s1.chars, { x: -${u(6)}, opacity: 0, duration: 0.55, ease: 'power3.out', stagger: 0.03 }, 0.15);
        tl.from(s2.chars, { x: ${u(6)}, opacity: 0, duration: 0.55, ease: 'power3.out', stagger: 0.03 }, 0.4);
        tl.fromTo('.mid', { scaleX: 0 }, { scaleX: 1, duration: 0.6, ease: 'power2.out', transformOrigin: '50% 50%' }, 0.55);
        FX.pop(tl, '.ico1, .ico2', { at: 0.75, from: 0.4, dur: 0.55, each: 0.18 });
        FX.wiggle(tl, '.ico1', { at: 1.35, rot: 5, n: 6, dur: 0.7 });
        FX.wiggle(tl, '.ico2', { at: 1.5, rot: -5, n: 6, dur: 0.7 });
        ${p.sub ? `FX.rise(tl, '.sub', { at: 1.15, y: ${u(3)} });` : ''}
      `),
    };
  },
};
