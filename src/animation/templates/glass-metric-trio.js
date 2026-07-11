// Three glass metric cards: staggered 3D float-in, count-ups landing on the narration's
// accent beats, a shine sweep across each card, then a gentle float loop. Metrics come
// from props.metrics/bars/criteria/items (normalized to exactly 3) so both the planner
// and the gallery demo can feed it. .from-based motion → complete no-script layout.
import { esc, base, hudLabel, headingStyle, fx } from './_shared.js';

function pickMetrics(p) {
  const src = p.metrics || p.bars || p.criteria || null;
  let out = [];
  if (Array.isArray(src)) {
    out = src.map((m) => ({
      label: String(m.label || m.name || '').slice(0, 18),
      value: Number.isFinite(+((m.value ?? m.score))) ? +(m.value ?? m.score) : 0,
      unit: m.unit != null ? String(m.unit) : (m.score != null ? '/10' : ''),
    }));
  } else if (Array.isArray(p.items)) {
    out = p.items.slice(0, 3).map((t, i) => ({ label: String(t).slice(0, 18), value: (i + 1), unit: '' }));
  }
  while (out.length < 3) out.push({ label: ['Tốc độ', 'Chất lượng', 'Chi phí'][out.length], value: [92, 88, 35][out.length], unit: '%' });
  return out.slice(0, 3);
}

export default {
  id: 'glass-metric-trio', name: 'Glass Metric Trio', desc: '3 thẻ kính số liệu: đếm số theo nhịp đọc + vệt shine',
  build(p, ctx) {
    const { u, theme, accent, vertical } = ctx;
    const ms = pickMetrics(p);
    const accents = [accent, theme.accents[1] || accent, theme.accents[2] || accent];

    return {
      css: base(ctx) + `
      .h1{${headingStyle(ctx, 5.4)};margin-bottom:${u(4)}px;max-width:90%}
      .cards{display:flex;${vertical ? 'flex-direction:column;' : ''}gap:${u(2.2)}px;align-items:stretch;justify-content:center}
      .card{position:relative;overflow:hidden;min-width:${u(20)}px;padding:${u(2.6)}px ${u(3)}px;border-radius:${u(1.6)}px;
        background:linear-gradient(160deg, rgba(255,255,255,.10), rgba(255,255,255,.03));
        border:1px solid rgba(255,255,255,.16);backdrop-filter:blur(6px);
        box-shadow:0 ${u(1.2)}px ${u(3.6)}px rgba(0,0,0,.45)}
      .mv{font-weight:800;font-size:${u(6.6)}px;line-height:1;font-variant-numeric:tabular-nums}
      .mu{font-size:.42em;font-weight:800;margin-left:${u(0.3)}px;opacity:.85}
      .ml{margin-top:${u(1)}px;font:700 ${u(1.9)}px ${theme.mono};letter-spacing:.16em;text-transform:uppercase;color:${theme.muted}}
      .shine{position:absolute;top:-30%;bottom:-30%;width:${u(6)}px;left:-${u(10)}px;transform:rotate(18deg);
        background:linear-gradient(90deg, transparent, rgba(255,255,255,.28), transparent)}
      ${ms.map((_, i) => `.card:nth-child(${i + 1}) .mv{color:${accents[i]};text-shadow:${theme.glow(accents[i])}}`).join('\n')}`,
      html: `<div class="wrap">
        ${hudLabel(p.label || '', ctx, accent)}
        ${p.heading ? `<div class="h1">${esc(p.heading)}</div>` : ''}
        <div class="cards">
          ${ms.map((m, i) => `<div class="card">
            <div class="mv"><span id="gm${i}">${esc(String(m.value))}</span>${m.unit ? `<span class="mu">${esc(m.unit)}</span>` : ''}</div>
            <div class="ml">${esc(m.label)}</div>
            <div class="shine"></div>
          </div>`).join('')}
        </div>
      </div>`,
      script: (() => {
        // one count-up per card, each landing on its own narration accent when available
        const beats = ctx.accentTimes(3);
        const at = (i) => +Math.min(Math.max(0.3 + i * 0.12, beats[i] ?? (0.5 + i * 0.5)), Math.max(0.3, ctx.duration - 1.6)).toFixed(2);
        return fx(`
        ${p.heading ? `FX.splitIn(tl, '.h1', { at: 0.1, each: 0.024, y: ${u(3)}, persp: ${u(42)} });` : ''}
        tl.from('.card', { opacity: 0, y: ${u(4)}, rotationX: -24, transformPerspective: ${u(50)},
          duration: 0.7, ease: 'back.out(1.5)', stagger: 0.14 }, 0.35);
        ${ms.map((m, i) => Number.isInteger(m.value)
          ? `FX.count(tl, '#gm${i}', ${m.value}, { dur: 1.2, at: ${at(i)} });` : '').join('\n')}
        tl.fromTo('.shine', { x: 0 }, { x: ${u(34)}, duration: 1.0, ease: 'power2.inOut', stagger: 0.18 }, ${Math.min(1.6, Math.max(0.8, ctx.duration * 0.3)).toFixed(2)});
        FX.loop(tl, '.cards', { y: -${u(0.8)}, at: 2.6, dur: 3.2 });
      `);
      })(),
    };
  },
};
