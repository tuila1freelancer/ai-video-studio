// Blueprint diagram that draws on: central icon draws on (DrawSVG), dashed elbow branches reveal gradually
// through a mask (DrawSVG on the mask's white copy — preserves the dashed pattern in the final state),
// node dots pop, mono chip labels slide in, dashed rect frame drawn last.
// Natural (no-script) state = complete state: the white mask already covers everything.
import { esc, IC, icon, hudLabel, base, headingStyle, fx } from './_shared.js';

// [side (-1 left / +1 right), vertical offset factor] for 1-4 branches
const SLOTS = {
  1: [[1, 0]],
  2: [[-1, -0.85], [1, 0.85]],
  3: [[-1, -1], [1, 0], [-1, 1]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
};

export default {
  id: 'draw-diagram', name: 'Draw Diagram', desc: 'Sơ đồ line-art vẽ nét: icon trung tâm + nhánh + nhãn',
  build(p, ctx) {
    const { u, theme, accent, vertical } = ctx;
    const f = (v) => +v.toFixed(1);
    const items = (p.items || []).slice(0, 4);
    const slots = SLOTS[items.length] || [];

    // Blueprint canvas: all coordinates precomputed via u() at build time (fits both 16:9 and 9:16).
    const W = u(60), H = u(vertical ? 30 : 26);
    const cx = W / 2, cy = H / 2;
    const iconS = u(9);                                   // central icon
    const chipW = u(vertical ? 13.5 : 15), chipH = u(4.6);
    const inset = u(2);                                   // chip inset from svg edge
    const axL = inset + chipW + u(1.2);                   // left anchor (chip edge + gap)
    const sOff = u(5.8);                                  // branch starts right at the icon edge
    const offY = u(vertical ? 9.5 : 7.5);
    const dotS = u(1.5);
    const connSw = Math.max(2, u(0.22));

    // Elbow branch: M center -> L horizontal -> L label anchor (diagonal ~45° when there is room).
    const geo = items.map((it, i) => {
      const [side, kf] = slots[i];
      const acc = theme.accents[(ctx.idx + i) % theme.accents.length];
      const ax = side < 0 ? axL : W - axL;
      const ay = cy + kf * offY;
      const sx = cx + side * sOff;
      const bl = Math.min(Math.abs(ay - cy), Math.max(0, Math.abs(ax - sx) - u(1)));
      const bx = ax - side * bl;
      return {
        i, acc, ax, ay,
        d: `M${f(sx)} ${f(cy)} L${f(bx)} ${f(cy)} L${f(ax)} ${f(ay)}`,
        chipX: side < 0 ? inset : W - inset - chipW,
      };
    });

    // White mask for each branch + frame: DrawSVG draws the white copy, the real dashed stroke stays intact.
    const masks = geo.map(({ i, d }) =>
      `<mask id="dgm${i}" maskUnits="userSpaceOnUse"><path class="mkc" d="${d}" stroke="#fff" stroke-width="${f(u(1.3))}" stroke-linecap="round" fill="none"/></mask>`).join('');
    const conns = geo.map(({ i, d, acc }) =>
      `<g mask="url(#dgm${i})"><path class="cn" d="${d}" stroke="${acc}" stroke-dasharray="${f(u(0.9))} ${f(u(0.75))}"/></g>`).join('');
    const fm = u(0.9);
    const dFrame = `M${f(fm)} ${f(fm)} H${f(W - fm)} V${f(H - fm)} H${f(fm)} Z`;
    const maskF = `<mask id="dgmf" maskUnits="userSpaceOnUse"><path class="mkf" d="${dFrame}" stroke="#fff" stroke-width="${f(u(0.8))}" fill="none"/></mask>`;
    const frame = `<g mask="url(#dgmf)"><path class="fr" d="${dFrame}" stroke-dasharray="${f(u(1.4))} ${f(u(1))}"/></g>`;

    // Central icon: line-art IC embedded directly into the svg, scaled from a 24×24 box.
    const gIcon = `<g class="dgi" transform="translate(${f(cx - iconS / 2)} ${f(cy - iconS / 2)}) scale(${f(iconS / 24)})" fill="none" stroke="${accent}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="color:${accent}">${IC[p.icon] || IC.gear}</g>`;

    const dots = geo.map(({ ax, ay, acc }) =>
      `<div class="nd" style="left:${f(ax - dotS / 2)}px;top:${f(ay - dotS / 2)}px;border-color:${acc};color:${acc}"></div>`).join('');
    const chips = geo.map(({ i, chipX, ay, acc }) => {
      const it = items[i];
      return `<div class="chip" style="left:${f(chipX)}px;top:${f(ay - chipH / 2)}px;border-color:${acc}55;color:${acc}">${it.icon ? icon(it.icon, u(1.9), acc) : ''}<span>${esc(it.title || it)}</span></div>`;
    }).join('');

    return {
      css: base(ctx) + `
      .h1{${headingStyle(ctx, 4.4)};margin-bottom:${u(1)}px}
      .map{position:relative;width:${W}px;height:${H}px;margin-top:${u(2.5)}px}
      .bp{position:absolute;inset:0;width:100%;height:100%;overflow:visible;filter:drop-shadow(0 0 ${u(0.6)}px ${accent}55)}
      .bp .cn{fill:none;stroke-width:${connSw};stroke-linecap:round;opacity:.85}
      .bp .fr{fill:none;stroke:${accent}3E;stroke-width:${Math.max(1.5, u(0.14))}}
      .bp .dgi{animation:glowpulse 3.2s ease-in-out 1.4s infinite}
      .nd{position:absolute;z-index:2;width:${dotS}px;height:${dotS}px;border-radius:50%;background:${theme.bg2};border:2px solid;box-shadow:0 0 ${u(0.9)}px currentColor}
      .chip{position:absolute;z-index:2;width:${chipW}px;min-height:${chipH}px;display:flex;align-items:center;justify-content:center;gap:${u(0.8)}px;padding:${u(0.6)}px ${u(1)}px;background:${theme.panel};border:1px solid ${theme.panelBorder};border-radius:${u(0.9)}px;font:700 ${u(1.6)}px ${theme.mono};letter-spacing:.08em;text-transform:uppercase;text-align:center;line-height:1.25;backdrop-filter:blur(4px)}
      .chip svg{flex-shrink:0}`,
      html: `<div class="wrap">
        ${hudLabel(p.label || '', ctx, accent)}
        <div class="h1" style="margin-top:${u(0.6)}px">${esc(p.heading)}</div>
        <div class="map">
          <svg class="bp" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"><defs>${masks}${maskF}</defs>${frame}${conns}${gIcon}</svg>
          ${dots}${chips}
        </div>
      </div>`,
      script: fx(`
        FX.splitIn(tl, '.h1', { at: 0.12, each: 0.026, y: ${u(3)}, persp: ${u(40)} });
        FX.drawIn(tl, '.dgi path, .dgi circle, .dgi rect', { at: 0.2, dur: 0.85, each: 0.12 });
        ${geo.length ? `FX.drawIn(tl, '.mkc', { at: 0.7, dur: 0.5, each: 0.18 });
        FX.pop(tl, '.nd', { at: 0.95, each: 0.18, dur: 0.5, from: 0.3 });
        FX.slide(tl, '.chip', { at: 1.05, each: 0.18, dur: 0.55, x: -${u(2)} });
        FX.loop(tl, '.chip', { y: -${u(0.55)}, at: 2.2, dur: 2.8, each: 0.3 });` : ''}
        FX.drawIn(tl, '.mkf', { at: 1.25, dur: 0.7 });
      `),
    };
  },
};
