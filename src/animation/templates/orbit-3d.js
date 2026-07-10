// Quỹ đạo 3D: hub neon pop, ellipse quỹ đạo vẽ nét (DrawSVG), chip khái niệm bay từ tâm
// ra vị trí quỹ đạo (back.out) rồi trôi nhẹ so le — ảo giác orbit, không phải orbit thật.
import { esc, icon, hudLabel, base, headingStyle, fx } from './_shared.js';

export default {
  id: 'orbit-3d', name: 'Orbit 3D', desc: 'Chip khái niệm bay quỹ đạo 3D quanh icon trung tâm',
  build(p, ctx) {
    const { u, theme, accent, vertical } = ctx;
    const items = (p.items || []).slice(0, 5);
    const n = Math.max(1, items.length);
    const rx = u(vertical ? 20 : 26), ry = u(vertical ? 14 : 11);   // elliptical orbit radii
    const R = u(14);                                                 // hub ring size
    const CW = u(vertical ? 15.5 : 18);                              // chip pill width
    const W = 2 * rx + CW + u(3), H = 2 * ry + u(8);
    const cx = W / 2, cy = H / 2;
    const f = (v) => +v.toFixed(1);
    // Chip geometry precomputed at build time — natural state = final orbit position.
    const pts = items.map((it, i) => {
      const ang = (-90 + i * 360 / n) * Math.PI / 180;
      const dx = Math.cos(ang) * rx, dy = Math.sin(ang) * ry;
      const front = dy > 0.5;                                        // lower rim → in front of hub
      const s = +(1 + 0.07 * (dy / ry)).toFixed(3);                  // subtle depth scale
      const acc = theme.accents[(ctx.idx + i) % theme.accents.length];
      return { i, dx: f(dx), dy: f(dy), front, s, acc, title: (it && it.title) || it || '' };
    });
    const chips = pts.map(({ i, dx, dy, front, s, acc, title }) =>
      `<div class="chipw" style="z-index:${front ? 3 : 1};transform:translate(${dx}px,${dy}px) scale(${s})"><div class="chip chip${i}" style="border-color:${acc}66;color:${acc};box-shadow:${theme.glowSoft(acc)}">${esc(String(title).toUpperCase())}</div></div>`).join('');
    const chipIn = pts.map(({ i, dx, dy }) =>
      `tl.from('.chip${i}', { scale: 0.3, opacity: 0, x: ${f(-dx * 0.55)}, y: ${f(-dy * 0.55)}, duration: 0.55, ease: 'back.out(1.6)' }, ${(0.5 + i * 0.16).toFixed(2)});`).join('\n        ');
    const chipLoop = pts.map(({ i }) =>
      `FX.loop(tl, '.chip${i}', { y: ${i % 2 ? u(0.8) : -u(0.8)}, rot: ${i % 2 ? -1.5 : 1.5}, at: ${(1.75 + i * 0.24).toFixed(2)}, dur: ${(2.3 + (i % 3) * 0.35).toFixed(2)} });`).join('\n        ');
    return {
      css: base(ctx) + `
      .orb{position:relative;width:${W}px;height:${H}px;margin-top:${u(2)}px}
      .orbsvg{position:absolute;inset:0;width:100%;height:100%;overflow:visible;z-index:0;filter:drop-shadow(0 0 ${u(0.5)}px ${accent}44)}
      .orbsvg ellipse{fill:none;stroke:${accent};stroke-opacity:.4;stroke-width:${Math.max(2, u(0.16))};stroke-linecap:round}
      .ring{position:absolute;left:${f((W - R) / 2)}px;top:${f((H - R) / 2)}px;width:${R}px;height:${R}px;z-index:2}
      .ring .r1,.ring .r2{position:absolute;inset:0;border-radius:50%;border:${Math.max(2, u(0.2))}px dashed ${accent}55}
      .ring .r1{animation:spin 22s linear infinite}
      .ring .r2{inset:${u(1.6)}px;border-style:solid;border-color:${accent}30;animation:spin 34s linear infinite reverse}
      .ring .core{position:absolute;inset:${u(2.7)}px;border-radius:50%;background:${theme.bg2};border:2px solid ${accent};box-shadow:${theme.glowSoft(accent)};display:grid;place-items:center;color:${accent};animation:glowpulse 3.2s ease-in-out 1.4s infinite}
      .chipw{position:absolute;left:${f(cx)}px;top:${f(cy)}px;width:0;height:0}
      .chip{position:absolute;left:${-Math.round(CW / 2)}px;top:${-u(2.3)}px;width:${CW}px;padding:${u(1.05)}px ${u(1.2)}px;background:${theme.panel};border:1px solid ${theme.panelBorder};border-radius:${u(5)}px;font:700 ${u(1.7)}px ${theme.mono};letter-spacing:.08em;line-height:1.3;text-align:center;backdrop-filter:blur(4px)}
      .h1{${headingStyle(ctx, vertical ? 4.6 : 5.2)};margin-top:${u(3)}px;max-width:${u(vertical ? 74 : 96)}px}`,
      html: `<div class="wrap">
        ${hudLabel(p.label || '', ctx, accent)}
        <div class="orb">
          <svg class="orbsvg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"><ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${rx}" ry="${ry}"/></svg>
          ${chips}
          <div class="ring"><div class="r1"></div><div class="r2"></div><div class="core">${icon(p.icon || 'target', Math.round(R * 0.34), accent)}</div></div>
        </div>
        <div class="h1">${esc(p.heading)}</div>
      </div>`,
      script: fx(`
        FX.pop(tl, '.ring', { at: 0.08, from: 0.45, dur: 0.65 });
        ${items.length ? `FX.drawIn(tl, '.orbsvg ellipse', { at: 0.3, dur: 1.1 });` : ''}
        ${chipIn}
        FX.splitIn(tl, '.h1', { at: 0.45, each: 0.026, y: ${u(3.6)}, persp: ${u(40)} });
        ${chipLoop}
      `),
    };
  },
};
