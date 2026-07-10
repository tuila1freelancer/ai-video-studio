// Bar race chart: title with 3D flying chars (SplitText), glass bars fill via scaleX
// racing toward their values + synced count-up (FX.count), winning bar wiggles + glow pulse ring.
// Natural (no-script) state = fills at their final width -> stays readable even if the script breaks.
import { esc, hudLabel, base, headingStyle, fx } from './_shared.js';

export default {
  id: 'bar-race', name: 'Bar Race', desc: 'Biểu đồ cột đua nhau + số đếm (so sánh số liệu)',
  build(p, ctx) {
    const { u, theme, accent } = ctx;
    const items = (Array.isArray(p.items) ? p.items : []).slice(0, 4);
    const vals = items.map((it, i) => {
      const raw = Number(it && typeof it === 'object' && it.value != null
        ? it.value : (Array.isArray(p.values) ? p.values[i] : NaN));
      return Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) : 0;
    });
    const titles = items.map((it, i) => typeof it === 'string'
      ? it : (it && it.title) || (Array.isArray(p.labels) && p.labels[i] != null ? String(p.labels[i]) : ''));
    const sfx = items.map((it) => (it && typeof it === 'object' && it.suffix != null) ? String(it.suffix) : '');
    const cols = items.map((_, i) => theme.accents[i % theme.accents.length]);
    const iWin = vals.length ? vals.indexOf(Math.max(...vals)) : -1;
    const aw = iWin >= 0 ? cols[iWin] : accent;
    const trackW = u(ctx.vertical ? 70 : 100);
    const barH = u(4.2);

    const rows = items.map((it, i) => {
      const c = cols[i];
      const win = i === iWin;
      return `<div class="row${win ? ' win' : ''}">
        <div class="rt">
          <span class="bt">${esc(titles[i])}</span>
          <span class="bv" style="color:${c};${win ? `text-shadow:${theme.glowSoft(c)}` : ''}"><span id="brv${i}">${esc(String(vals[i]))}</span>${sfx[i] ? `<span class="sfx">${esc(sfx[i])}</span>` : ''}</span>
        </div>
        <div class="tw">
          <div class="track"><div class="fill" style="width:${vals[i]}%;background:linear-gradient(90deg,${c}55,${c})"></div></div>
          ${win ? '<div class="wg"></div>' : ''}
        </div>
      </div>`;
    }).join('');

    // fill landing time of the winner bar (fills start 0.4 + i*0.18, run 1.1s)
    const landT = iWin >= 0 ? (0.4 + iWin * 0.18 + 1.1) : 0;
    const countsJs = items.map((_, i) =>
      (Number.isInteger(vals[i]) && vals[i] > 0)
        ? `FX.count(tl, '#brv${i}', ${vals[i]}, { dur: 1.1, at: ${(0.4 + i * 0.18).toFixed(2)}, ease: 'power3.out' });`
        : '').filter(Boolean).join('\n        ');
    const winJs = iWin >= 0 ? `
        tl.from('.wg', { opacity: 0, duration: 0.5, ease: 'power2.out' }, ${landT.toFixed(2)});
        FX.wiggle(tl, '.row.win', { rot: 1.6, n: 6, dur: 0.7, at: ${(landT + 0.05).toFixed(2)} });` : '';

    return {
      css: base(ctx) + `
      .h1{${headingStyle(ctx, 5.6)}}
      .chart{width:${trackW}px;margin-top:${u(4)}px;display:flex;flex-direction:column;gap:${u(2)}px;text-align:left}
      .rt{display:flex;justify-content:space-between;align-items:baseline;gap:${u(2)}px;margin-bottom:${u(0.9)}px}
      .bt{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700;font-size:${u(2.7)}px;letter-spacing:.04em;text-transform:uppercase;color:${theme.ink}}
      .row.win .bt{text-shadow:${theme.glowSoft(aw)}}
      .bv{font:700 ${u(2.6)}px ${theme.mono};letter-spacing:.04em;white-space:nowrap}
      .sfx{font-size:.72em;margin-left:${u(0.3)}px;opacity:.85}
      .tw{position:relative}
      .track{position:relative;height:${barH}px;border-radius:${u(2.1)}px;background:${theme.panel};border:1px solid ${theme.panelBorder};overflow:hidden}
      .fill{position:absolute;left:0;top:0;bottom:0;border-radius:inherit}
      .wg{position:absolute;inset:0;border-radius:${u(2.1)}px;pointer-events:none;border:1px solid ${aw}66;animation:wpulse 3s ease-in-out infinite}
      @keyframes wpulse{0%,100%{box-shadow:0 0 ${u(1.2)}px ${aw}55,inset 0 0 ${u(1)}px ${aw}22}50%{box-shadow:0 0 ${u(3)}px ${aw}88,inset 0 0 ${u(1.6)}px ${aw}44}}`,
      html: `<div class="wrap">
        ${hudLabel(p.label || '', ctx, accent)}
        <div class="h1" style="margin-top:${u(1)}px">${esc(p.heading)}</div>
        <div class="chart">${rows}</div>
      </div>`,
      script: fx(`
        FX.splitIn(tl, '.h1', { at: 0.12, each: 0.024, y: ${u(3.5)}, persp: ${u(40)} });
        FX.rise(tl, '.tw', { at: 0.25, each: 0.18, y: ${u(2)} });
        FX.slide(tl, '.bt', { at: 0.3, each: 0.18, x: -${u(5)} });
        FX.rise(tl, '.bv', { at: 0.35, each: 0.18, y: ${u(1.6)} });
        var fills = FX.q('.fill');
        for (var i = 0; i < fills.length; i++) {
          tl.fromTo(fills[i], { scaleX: 0 }, { scaleX: 1, transformOrigin: '0% 50%', duration: 1.1, ease: 'power3.out' }, 0.4 + i * 0.18);
        }
        ${countsJs}${winJs}
        FX.loop(tl, '.chart', { y: -${u(0.7)}, at: ${(iWin >= 0 ? landT + 1.0 : 2.6).toFixed(2)}, dur: 3.2 });
      `),
    };
  },
};
