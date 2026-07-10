// Stat metric: 270° gauge arc draws on (DrawSVG) proportional to the value, GSAP count-up
// synced with the stroke drawing, unit pops, title with 3D flying chars (SplitText).
import { esc, base, headingStyle, hudLabel, fx } from './_shared.js';

export default {
  id: 'counter-stat', name: 'Counter Stat', desc: 'Chỉ số %/con số lớn + vòng cung gauge vẽ nét',
  build(p, ctx) {
    const { u, theme, accent } = ctx;
    const rawIn = Number(p.value != null ? p.value : (p.number != null ? p.number : 75));
    const val = Number.isFinite(rawIn) ? rawIn : 75;
    const unit = p.unit != null ? String(p.unit) : '%';
    // '%' → arc fills to value/100 of the 270° sweep; other units → full arc
    const pct = unit === '%' ? Math.max(0, Math.min(100, val)) : 100;
    const pctStr = String(Math.round(pct * 10) / 10);
    // count-up only when the final counter text exactly matches the natural HTML
    const canCount = Number.isInteger(val);
    const disp = String(val);

    // gauge geometry: 270° arc, gap at the bottom (start 135° → clockwise to 45°)
    const r = u(16);
    const sw = Math.max(3, u(0.9));
    const c = r + sw + u(0.8);
    const box = c * 2;
    const k = Math.SQRT1_2;
    const x1 = +(c - r * k).toFixed(2), y1 = +(c + r * k).toFixed(2), x2 = +(c + r * k).toFixed(2);
    const d = `M ${x1} ${y1} A ${r} ${r} 0 1 1 ${x2} ${y1}`;
    const arcLen = r * Math.PI * 1.5;
    // natural (no-script) state must equal the final frame → pre-cut the value arc via dasharray
    const dash = pct >= 100 ? '' : `stroke-dasharray:${(arcLen * pct / 100).toFixed(2)} ${(arcLen * 2).toFixed(2)}`;

    const digits = disp.length + (unit ? 1 : 0);
    const fs = digits <= 4 ? u(10) : Math.max(u(4.5), Math.round(u(10) * 4 / digits));

    return {
      css: base(ctx) + `
      .hud{margin-bottom:${u(2.4)}px}
      .gauge{position:relative;width:${box}px;height:${box}px;margin-bottom:${u(3.2)}px}
      .gauge svg{position:absolute;inset:0;overflow:visible}
      .arct{fill:none;stroke:${accent}30;stroke-width:${sw}px;stroke-linecap:round}
      .arcv{fill:none;stroke:${accent};stroke-width:${sw}px;stroke-linecap:round;color:${accent};filter:drop-shadow(0 0 ${u(1.2)}px ${accent});animation:glowpulse 3.4s ease-in-out 1.4s infinite}
      .val{position:absolute;inset:0;display:grid;place-items:center}
      .vrow{font-weight:800;font-size:${fs}px;line-height:1;letter-spacing:-.01em;color:${accent};text-shadow:${theme.glow(accent)}}
      .unit{display:inline-block;font-size:.45em;font-weight:800;margin-left:${u(0.4)}px;color:${theme.ink};text-shadow:${theme.glowSoft(accent)}}
      .h1{${headingStyle(ctx, 6.2)}}
      .sub{margin-top:${u(2)}px;font-weight:600;font-size:${u(2.8)}px;color:${theme.muted}}`,
      html: `<div class="wrap">
        ${hudLabel(p.label || '', ctx, accent)}
        <div class="gauge">
          <svg width="${box}" height="${box}" viewBox="0 0 ${box} ${box}">
            <path class="arct" d="${d}"/>
            ${pct > 0 ? `<path class="arcv" d="${d}"${dash ? ` style="${dash}"` : ''}/>` : ''}
          </svg>
          <div class="val"><div class="vrow"><span id="statv">${esc(disp)}</span>${unit ? `<span class="unit">${esc(unit)}</span>` : ''}</div></div>
        </div>
        <div class="h1">${esc(p.heading)}</div>
        ${p.sub ? `<div class="sub">${esc(p.sub)}</div>` : ''}
      </div>`,
      script: fx(`
        FX.pop(tl, '.gauge', { at: 0.06, from: 0.6, dur: 0.6 });
        FX.drawIn(tl, '.arct', { at: 0.1, dur: 1.0, ease: 'power2.out' });
        ${pct > 0 ? (pct >= 100
          ? `FX.drawIn(tl, '.arcv', { at: 0.15, dur: 1.5, ease: 'power2.inOut' });`
          : `tl.fromTo('.arcv', { drawSVG: '0%' }, { drawSVG: '${pctStr}%', duration: 1.5, ease: 'power2.inOut' }, 0.15);`) : ''}
        FX.pop(tl, '.val', { at: 0.08, from: 0.55, dur: 0.55 });
        ${canCount ? `FX.count(tl, '#statv', ${val}, { dur: 1.5, at: 0.15 });` : ''}
        ${unit ? `FX.pop(tl, '.unit', { at: 1.6, from: 0.3, dur: 0.5 });` : ''}
        FX.splitIn(tl, '.h1', { at: 0.55, each: 0.026, y: ${u(4)}, persp: ${u(40)} });
        ${p.sub ? `FX.rise(tl, '.sub', { at: 1.15, y: ${u(2.5)} });` : ''}
        FX.loop(tl, '.gauge', { y: -${u(0.9)}, at: 2.3, dur: 3 });
      `),
    };
  },
};
