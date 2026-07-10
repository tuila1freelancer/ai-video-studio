// Large icon draws itself on (DrawSVG) then floats, heading with 3D flying chars (SplitText), chips pop + numbers wiggle.
import { esc, icon, pad2, hudLabel, base, headingStyle, fx } from './_shared.js';

export default {
  id: 'icon-focus', name: 'Icon Focus', desc: 'Icon lớn phát sáng + heading + chips',
  build(p, ctx) {
    const { u, theme, accent } = ctx;
    const chips = (p.chips || []).slice(0, 4).map((c, i) =>
      `<div class="chip"><span class="cnum" style="color:${accent}">${pad2(i + 1)}</span>${esc(c)}</div>`).join('');
    return {
      css: base(ctx) + `
      .big{color:${accent};filter:drop-shadow(0 0 ${u(2.4)}px ${accent}AA)}
      .h1{${headingStyle(ctx, 6.4)};margin-top:${u(2.6)}px}
      .sub{margin-top:${u(1.6)}px;font-weight:600;font-size:${u(2.5)}px;color:${theme.muted};border-left:${u(0.4)}px solid ${accent};padding-left:${u(1.4)}px;text-align:left}
      .chips{display:flex;gap:${u(1.6)}px;margin-top:${u(3)}px;flex-wrap:wrap;justify-content:center}
      .chip{display:flex;align-items:center;gap:${u(1)}px;background:${theme.panel};border:1px solid ${theme.panelBorder};padding:${u(1.1)}px ${u(1.8)}px;border-radius:${u(1)}px;font:700 ${u(1.85)}px ${theme.mono};letter-spacing:.1em;text-transform:uppercase;color:${theme.ink}D0;backdrop-filter:blur(4px)}
      .cnum{display:inline-block;font-weight:800}`,
      html: `<div class="wrap">
        ${hudLabel(p.label || '', ctx, theme.accents[1])}
        <div class="big" style="margin-top:${u(1)}px">${icon(p.icon || 'question', u(15), accent, 1.4)}</div>
        <div class="h1">${esc(p.heading)}</div>
        ${p.sub ? `<div class="sub">${esc(p.sub.toUpperCase())}</div>` : ''}
        ${chips ? `<div class="chips">${chips}</div>` : ''}
      </div>`,
      script: fx(`
        FX.drawIn(tl, '.big path, .big circle, .big rect', { at: 0.25, dur: 1.1, each: 0.12 });
        FX.splitIn(tl, '.h1', { at: 0.45, each: 0.024, y: ${u(4)}, persp: ${u(40)} });
        ${p.sub ? `FX.rise(tl, '.sub', { at: 0.95, y: ${u(3)} });` : ''}
        ${chips ? `FX.pop(tl, '.chips .chip', { at: 1.1, each: 0.16 });
        FX.wiggle(tl, '.chips .cnum', { at: 1.7, rot: 6, dur: 0.7 });` : ''}
        FX.loop(tl, '.big', { y: -${u(1.4)}, at: 1.6, dur: 2.6 });
      `),
    };
  },
};
