// Cinematic quote card: a huge ghost quotation mark, the line revealed word-by-word with a
// blur-rise, a spotlight that sweeps across the text, and the author signed off under an
// accent rule that draws in. All motion is .from-based → the no-script state is the final
// frame (gsapFx:false safety valve keeps a complete layout).
import { esc, base, hudLabel, fx } from './_shared.js';

export default {
  id: 'spotlight-quote', name: 'Spotlight Quote', desc: 'Trích dẫn điện ảnh: chữ hiện theo nhịp + vệt sáng quét',
  build(p, ctx) {
    const { u, theme, accent } = ctx;
    const quote = String(p.heading || p.text || p.keyword || '').trim() || '…';
    const author = String(p.sub || p.label || '').trim();
    const qLen = quote.length;
    const fs = qLen <= 40 ? u(7.2) : qLen <= 90 ? u(5.6) : u(4.4);

    return {
      css: base(ctx) + `
      .qmark{position:absolute;top:${u(10)}px;left:${u(7)}px;font-weight:800;font-size:${u(34)}px;line-height:.7;
        color:${accent}22;text-shadow:0 0 ${u(4)}px ${accent}14;user-select:none}
      .quote{position:relative;max-width:88%;font-weight:800;font-size:${fs}px;line-height:1.22;
        letter-spacing:-.008em;color:${theme.ink};text-shadow:0 ${u(0.3)}px ${u(1.6)}px rgba(0,0,0,.65)}
      .spot{position:absolute;inset:-20%;pointer-events:none;mix-blend-mode:screen;
        background:radial-gradient(ellipse ${u(30)}px ${u(46)}px at 50% 50%, ${accent}30 0%, transparent 70%)}
      .sig{margin-top:${u(4.2)}px;display:flex;flex-direction:column;align-items:center;gap:${u(1.2)}px}
      .rule{width:${u(14)}px;height:${Math.max(2, u(0.35))}px;border-radius:99px;background:${accent};
        box-shadow:0 0 ${u(1.6)}px ${accent};transform-origin:50% 50%}
      .who{font:700 ${u(2.6)}px ${theme.mono};letter-spacing:.18em;text-transform:uppercase;color:${theme.muted}}`,
      html: `<div class="wrap">
        <div class="qmark">“</div>
        ${hudLabel(p.hud || '', ctx, accent)}
        <div class="quote">${esc(quote)}<div class="spot"></div></div>
        ${author ? `<div class="sig"><div class="rule"></div><div class="who">${esc(author)}</div></div>` : ''}
      </div>`,
      script: (() => {
        // word reveals ride the narration's own emphasis times when captions exist
        return fx(`
        FX.pop(tl, '.qmark', { at: 0.05, from: 0.4, dur: 0.8 });
        FX.splitIn(tl, '.quote', { at: 0.22, type: 'words', words: true, each: 0.085, y: ${u(2.6)}, rotX: -38, persp: ${u(46)} });
        tl.fromTo('.spot', { xPercent: -46, opacity: 0 }, { xPercent: 0, opacity: 1, duration: 1.1, ease: 'power2.out' }, 0.3);
        tl.to('.spot', { xPercent: 46, duration: ${Math.max(2, ctx.duration - 2).toFixed(2)}, ease: 'sine.inOut' }, 1.4);
        tl.from('.rule', { scaleX: 0, duration: 0.6, ease: 'power3.out' }, 1.05);
        FX.splitIn(tl, '.who', { at: 1.2, each: 0.02, y: ${u(1.6)} });
        FX.loop(tl, '.quote', { y: -${u(0.6)}, at: 2.4, dur: 3.4 });
      `);
      })(),
    };
  },
};
