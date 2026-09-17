// Kinetic Statement — self-heal fallback template: CSS intro animations are kept as the
// primary reveal (words() rise spans, typewriter subwipe, caret) so the scene is complete
// even with no script. GSAP adds only light extras on elements the CSS intros don't move
// the same way: a subtle wiggle on the pre-label text and a slow ambient drift on h1/h2.
// NOTE: .pre keeps its CSS fadeup (fill:both) intro, which owns `transform` in the cascade;
// the wiggle therefore targets an inner .prew span so the rotation is not overridden.
import { esc, words, base, headingStyle, EASE, fx } from './_shared.js';

export default {
  id: 'kinetic-statement', name: 'Kinetic Statement', desc: 'Câu nhấn chữ lớn + wipe reveal',
  build(p, ctx) {
    const { u, theme, accent } = ctx;
    const line2 = p.heading2 || '';
    return {
      css: base(ctx) + `
      .wrap{align-items:flex-start;text-align:left;padding:${u(10)}px ${u(9)}px}
      .pre{font:700 ${u(2.6)}px ${theme.font};letter-spacing:.12em;text-transform:uppercase;color:${theme.ink}CC;opacity:0;animation:fadeup .6s ${EASE} .1s both}
      .prew{display:inline-block}
      .h1{${headingStyle(ctx, ctx.vertical ? 9 : 11, accent)};margin-top:${u(1.6)}px}
      .h2{${headingStyle(ctx, ctx.vertical ? 8 : 9.5, theme.ink)};opacity:.94}
      .subwipe{display:flex;align-items:center;gap:${u(1)}px;margin-top:${u(2.6)}px;opacity:0;animation:fadeup .5s ${EASE} 1.15s both}
      .bar{width:${Math.max(2, u(0.35))}px;height:${u(3.2)}px;background:${accent};animation:caret 1s steps(1) infinite}
      .subt{overflow:hidden;white-space:nowrap;font:600 ${u(2.4)}px ${theme.mono};letter-spacing:.14em;color:${theme.muted};max-width:0;animation:typew ${Math.min(2.2, ctx.duration * 0.35)}s steps(28) 1.25s both}
      @keyframes typew{to{max-width:100%}}`,
      html: `<div class="wrap">
        ${p.pre ? `<div class="pre"><span class="prew">${esc(p.pre)}</span></div>` : ''}
        <div class="h1">${words(p.heading, 'rise', 0.25, 0.08)}</div>
        ${line2 ? `<div class="h2">${words(line2, 'rise', 0.6, 0.08)}</div>` : ''}
        ${p.sub ? `<div class="subwipe"><span class="bar"></span><span class="subt">${esc((p.sub || '').toUpperCase())}</span></div>` : ''}
      </div>`,
      script: fx(`
        ${p.pre ? `FX.wiggle(tl, '.prew', { at: 0.8, rot: 2, n: 5 });` : ''}
        FX.loop(tl, '.h1, .h2', { y: -${u(0.5)}, dur: 3.2 });
      `),
    };
  },
};
