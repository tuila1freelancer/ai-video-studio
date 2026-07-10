// Chapter divider: PHẦN N label scrambles in (glitch), rule draws horizontally, title chars fly in from both edges, dots pop.
import { esc, base, headingStyle, fx } from './_shared.js';

export default {
  id: 'chapter-break', name: 'Chapter Break', desc: 'Ngăn chương: PHẦN N · tên (scramble + chars from edges)',
  build(p, ctx) {
    const { u, theme, accent } = ctx;
    const chp = String(p.chapter || 'PHẦN 01');
    return {
      css: base(ctx) + `
      .chp{font:700 ${u(2.6)}px ${theme.mono};letter-spacing:.42em;color:${accent};text-transform:uppercase;opacity:.9;text-shadow:${theme.glowSoft(accent)}}
      .rule{width:${u(14)}px;height:2px;background:${theme.gradBar};margin:${u(2.6)}px 0;transform-origin:center}
      .h1{${headingStyle(ctx, 8.4)};}
      .brk{display:flex;gap:${u(0.9)}px;margin-top:${u(3.4)}px}
      .brk i{width:${u(1)}px;height:${u(1)}px;border-radius:50%;background:${theme.dim}}
      .brk i:nth-child(2){background:${accent}}`,
      html: `<div class="wrap">
        <div class="chp">${esc(chp)}</div>
        <div class="rule"></div>
        <div class="h1">${esc(p.heading)}</div>
        <div class="brk"><i></i><i></i><i></i></div>
      </div>`,
      script: fx(`
        tl.from('.chp', { opacity: 0, duration: 0.3, ease: 'power1.out' }, 0);
        FX.scramble(tl, '.chp', ${JSON.stringify(chp)}, { at: 0.15, dur: 0.9, chars: '█▓▒01<>' });
        tl.fromTo('.rule', { scaleX: 0 }, { scaleX: 1, duration: 0.7, ease: 'power3.inOut' }, 0.35);
        var st = FX.split('.h1');
        tl.from(st.chars, { y: ${u(3)}, opacity: 0, duration: 0.6, ease: 'power3.out',
          stagger: { each: 0.03, from: 'edges' } }, 0.45);
        FX.pop(tl, '.brk i', { at: 0.8, each: 0.1, dur: 0.5 });
        FX.loop(tl, '.brk i', { y: -${u(0.6)}, at: 1.7, dur: 2.2, each: 0.3 });
      `),
    };
  },
};
