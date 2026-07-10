// Radial mindmap: hub pop (GSAP), SVG branches drawn on (DrawSVG), leaf pop stagger, h1 3D flying chars.
import { esc, icon, hudLabel, base, headingStyle, fx } from './_shared.js';

export default {
  id: 'mindmap-radial', name: 'Mindmap Radial', desc: 'Node trung tâm toả nhánh',
  build(p, ctx) {
    const { u, theme, accent, vertical } = ctx;
    const items = (p.items || []).slice(0, 6);
    const R = u(vertical ? 26 : 30);
    const W = Math.round(R * 2.7), H = Math.round(R * 2.35);
    const cx = W / 2, cy = H / 2;
    const f = (v) => +v.toFixed(1);
    // Branch geometry precomputed at build time — one gentle quadratic per leaf.
    const bows = items.map((it, i) => {
      const ang = (-90 + i * (360 / items.length)) * Math.PI / 180;
      const x = Math.cos(ang) * R, y = Math.sin(ang) * R;
      const acc = theme.accents[(ctx.idx + i) % theme.accents.length];
      const bend = u(1.5) * (i % 2 ? -1 : 1);            // alternate bow direction
      const nx = -y / R, ny = x / R;                     // unit perpendicular
      const qx = cx + x / 2 + nx * bend, qy = cy + y / 2 + ny * bend;
      return { i, x, y, acc, d: `M${f(cx)} ${f(cy)} Q${f(qx)} ${f(qy)} ${f(cx + x)} ${f(cy + y)}` };
    });
    const grads = bows.map(({ i, x, y, acc }) =>
      `<linearGradient id="mmg${i}" gradientUnits="userSpaceOnUse" x1="${f(cx)}" y1="${f(cy)}" x2="${f(cx + x)}" y2="${f(cy + y)}"><stop offset="0" stop-color="${accent}" stop-opacity=".5"/><stop offset="1" stop-color="${acc}"/></linearGradient>`).join('');
    const paths = bows.map(({ i, d }) => `<path d="${d}" stroke="url(#mmg${i})"/>`).join('');
    const leaves = bows.map(({ x, y, acc, i }) =>
      `<div class="leafw" style="transform:translate(${x}px,${y}px)"><div class="leaf" style="border-color:${acc}66;color:${acc}">${esc((items[i].title || items[i]).toUpperCase())}</div></div>`).join('');
    return {
      css: base(ctx) + `
      .h1{${headingStyle(ctx, 4.4)};margin-bottom:${u(2)}px}
      .map{position:relative;width:${W}px;height:${H}px;display:grid;place-items:center;margin-top:${u(2)}px}
      .mlines{position:absolute;inset:0;width:100%;height:100%;overflow:visible;z-index:1;filter:drop-shadow(0 0 ${u(0.6)}px ${accent}55)}
      .mlines path{fill:none;stroke-width:${Math.max(2, u(0.2))};stroke-linecap:round}
      .hub{position:absolute;width:${u(11)}px;height:${u(11)}px;border-radius:50%;background:${theme.bg2};border:2px solid ${accent};display:grid;place-items:center;box-shadow:${theme.glow(accent)};z-index:2;animation:glowpulse 3.4s ease-in-out 1.2s infinite;color:${accent}}
      .leafw{position:absolute;left:50%;top:50%;width:0;height:0;z-index:2}
      .leaf{position:absolute;left:-${u(9)}px;top:-${u(2.2)}px;width:${u(18)}px;text-align:center;padding:${u(1)}px ${u(1.2)}px;background:${theme.panel};border:1px solid;border-radius:${u(1)}px;font:700 ${u(1.75)}px ${theme.mono};letter-spacing:.1em;backdrop-filter:blur(4px)}`,
      html: `<div class="wrap">
        ${hudLabel(p.label || '', ctx, accent)}
        <div class="h1" style="margin-top:${u(0.6)}px">${esc(p.heading || p.center)}</div>
        <div class="map">
          <svg class="mlines" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"><defs>${grads}</defs>${paths}</svg>
          ${leaves}
          <div class="hub">${icon(p.icon || 'target', u(4.6), accent)}</div>
        </div>
      </div>`,
      script: fx(`
        FX.splitIn(tl, '.h1', { at: 0.12, each: 0.028, y: ${u(3)}, persp: ${u(40)} });
        FX.pop(tl, '.hub', { at: 0.15, from: 0.45, dur: 0.65 });
        ${items.length ? `FX.drawIn(tl, '.mlines path', { at: 0.5, dur: 0.5, each: 0.14 });
        FX.pop(tl, '.leaf', { at: 0.75, each: 0.16, dur: 0.55 });
        FX.loop(tl, '.leaf', { y: -${u(0.6)}, at: 1.8, dur: 2.8, each: 0.3 });` : ''}
      `),
    };
  },
};
