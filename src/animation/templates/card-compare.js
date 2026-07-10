// So sánh 2–3 thẻ glass: thẻ bay vào 3D (rotationY xen kẽ), icon pop, tiêu đề chữ cascade (SplitText).
import { esc, icon, ICON_NAMES, hudLabel, base, headingStyle, fx } from './_shared.js';

export default {
  id: 'card-compare', name: 'Card Compare', desc: '2–3 thẻ glass so sánh',
  build(p, ctx) {
    const { u, theme, vertical } = ctx;
    const items = (p.items || []).slice(0, 3);
    const accs = items.map((_, i) => ctx.theme.accents[(ctx.idx + i) % ctx.theme.accents.length]);
    const cards = items.map((it, i) => `
      <div class="card" style="border-color:${accs[i]}44;animation-delay:${(1.8 + i * 0.5).toFixed(2)}s">
        <div class="cic" style="color:${accs[i]}">${icon(it.icon || ICON_NAMES[(ctx.idx + i * 3) % ICON_NAMES.length], u(5.4), accs[i])}</div>
        ${it.tag ? `<div class="ctag" style="color:${accs[i]}">${esc(it.tag.toUpperCase())}</div>` : ''}
        <div class="ctt" style="color:${accs[i]};text-shadow:${theme.glowSoft(accs[i])}">${esc(it.title)}</div>
        ${it.sub ? `<div class="csb">${esc(it.sub)}</div>` : ''}
      </div>`).join('');
    return {
      css: base(ctx) + `
      .h1{${headingStyle(ctx, 4.8)};margin-bottom:${u(3.2)}px}
      .cards{display:flex;flex-direction:${vertical && items.length > 2 ? 'column' : 'row'};gap:${u(2.4)}px;align-items:stretch;justify-content:center}
      .card{background:${theme.panel};border:1px solid;border-radius:${u(1.8)}px;padding:${u(3)}px ${u(2.6)}px;min-width:${u(vertical ? 60 : 24)}px;backdrop-filter:blur(6px);animation:floaty 5s ease-in-out 1.8s infinite}
      .cic{margin-bottom:${u(1.6)}px;animation:glowpulse 3.4s ease-in-out infinite}
      .ctag{font:700 ${u(1.6)}px ${theme.mono};letter-spacing:.22em;margin-bottom:${u(0.8)}px;opacity:.85}
      .ctt{font-weight:800;font-size:${u(3.2)}px;text-transform:uppercase;letter-spacing:.02em}
      .csb{margin-top:${u(1)}px;font-weight:500;font-size:${u(2)}px;color:${theme.muted};line-height:1.45}`,
      html: `<div class="wrap">
        ${hudLabel(p.label || '', ctx)}
        <div class="h1" style="margin-top:${u(0.8)}px">${esc(p.heading)}</div>
        <div class="cards">${cards}</div>
      </div>`,
      script: fx(`
        FX.splitIn(tl, '.h1', { at: 0.06, each: 0.022, y: ${u(3)}, persp: ${u(40)} });
        tl.from('.card', { opacity: 0, y: ${u(6)},
          rotationY: function(i){ return i % 2 ? 32 : -32; },
          transformPerspective: ${u(60)}, transformOrigin: '50% 50%',
          duration: 0.85, ease: 'back.out(1.4)', stagger: 0.22 }, 0.28);
        FX.pop(tl, '.cic', { at: 0.85, each: 0.22, dur: 0.5 });
        var tts = FX.q('.ctt');
        for (var i = 0; i < tts.length; i++) {
          var st = new SplitText(tts[i], { type: 'chars,words' });
          tl.from(st.chars, { opacity: 0, y: ${u(1.5)}, rotationX: -60, transformOrigin: '50% 100%',
            transformPerspective: ${u(30)}, duration: 0.45, ease: 'back.out(1.6)', stagger: 0.02 }, 0.8 + i * 0.22);
        }
      `),
    };
  },
};
