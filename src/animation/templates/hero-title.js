// Opening chapter: neon ring pops in, icon draws on (DrawSVG), title with 3D flying chars (SplitText).
import { esc, icon, base, headingStyle, hudLabel, fx } from './_shared.js';

export default {
  id: 'hero-title', name: 'Hero Title', desc: 'Mở chương: icon neon vẽ nét trong ring + tiêu đề chữ bay 3D',
  build(p, ctx) {
    const { u, theme, accent } = ctx;
    const ic = p.icon || 'key';
    const ring = u(24);
    return {
      css: base(ctx) + `
      .ring{position:relative;width:${ring}px;height:${ring}px;margin-bottom:${u(4)}px}
      .ring .r1,.ring .r2{position:absolute;inset:0;border-radius:50%;border:${Math.max(2, u(0.22))}px dashed ${accent}55}
      .ring .r1{animation:spin 26s linear infinite}
      .ring .r2{inset:${u(2.4)}px;border-style:solid;border-color:${accent}33;animation:spin 40s linear infinite reverse}
      .ring .ic{position:absolute;inset:0;display:grid;place-items:center;color:${accent};animation:glowpulse 3.2s ease-in-out infinite}
      .h1{${headingStyle(ctx, 9.5)};margin-top:${u(1.5)}px}
      .sub{margin-top:${u(2.4)}px;font-weight:600;font-size:${u(3)}px;color:${theme.muted}}`,
      html: `<div class="wrap">
        ${hudLabel(p.label || '', ctx, accent)}
        <div class="ring"><div class="r1"></div><div class="r2"></div><div class="ic">${icon(ic, Math.round(ring * 0.44), accent)}</div></div>
        <div class="h1">${esc(p.heading)}</div>
        ${p.sub ? `<div class="sub">${esc(p.sub)}</div>` : ''}
      </div>`,
      script: fx(`
        FX.pop(tl, '.ring', { at: 0.08, from: 0.5, dur: 0.7 });
        FX.drawIn(tl, '.ring .ic path, .ring .ic circle, .ring .ic rect', { at: 0.32, dur: 0.9, each: 0.14 });
        FX.splitIn(tl, '.h1', { at: 0.5, each: 0.024, y: ${u(4.5)}, persp: ${u(40)} });
        ${p.sub ? `FX.rise(tl, '.sub', { at: 1.2 });` : ''}
        FX.loop(tl, '.ring', { y: -${u(1)}, at: 1.3, dur: 2.8 });
      `),
    };
  },
};
