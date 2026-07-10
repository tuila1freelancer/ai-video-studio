// Process timeline: SVG rail drawn on (DrawSVG) + a spark running along the rail, dot pop stagger,
// heading with 3D flying chars (SplitText), text rises in sync with each node.
import { esc, icon, hudLabel, base, headingStyle, fx } from './_shared.js';

export default {
  id: 'timeline-steps', name: 'Timeline Steps', desc: 'Quy trình node ngang + icon',
  build(p, ctx) {
    const { u, theme, accent, vertical } = ctx;
    const items = (p.items || []).slice(0, 6);
    const f = (v) => +v.toFixed(1);
    // Rail geometry (all px from u at build time). The svg stretches to the real rail
    // box via preserveAspectRatio="none"; the cross-axis scale stays 1:1 so stroke
    // width renders true while drawSVG percentages remain correct along the length.
    const railT = Math.max(6, u(1.4));                       // svg cross-axis thickness
    const sw = Math.max(2, u(0.2));                          // stroke width
    const mid = f(railT / 2);
    const off = f(railT / 2 + u(0.45));                      // echo line offset
    const railLen = vertical
      ? Math.max(u(10), items.length * u(4.6) + Math.max(0, items.length - 1) * u(2.6) - 2 * u(2))
      : u(86);
    const spk = Math.max(6, u(1.3));                         // travelling spark size
    const line = (cls, color, y, opac) => vertical
      ? `<line class="${cls}" x1="${y}" y1="0" x2="${y}" y2="${railLen}" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" opacity="${opac}"/>`
      : `<line class="${cls}" x1="0" y1="${y}" x2="${railLen}" y2="${y}" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" opacity="${opac}"/>`;
    const rail = `<svg class="rail" viewBox="0 0 ${vertical ? `${railT} ${railLen}` : `${railLen} ${railT}`}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" fill="none">${line('rl1', accent, mid, 1)}${line('rl2', theme.accents[1], off, 0.3)}</svg>`;
    const nodes = items.map((it) => `
      <div class="node">
        <div class="dot">${icon(it.icon || 'check', u(2.6), accent)}</div>
        <div class="ntt">${esc(it.title || it)}</div>
      </div>`).join('');
    return {
      css: base(ctx) + `
      .h1{${headingStyle(ctx, 4.8)};margin-bottom:${u(4.5)}px}
      .tl{position:relative;display:flex;flex-direction:${vertical ? 'column' : 'row'};gap:${u(vertical ? 2.6 : 1.2)}px;align-items:flex-start;justify-content:center;width:100%;max-width:${u(90)}px}
      .rail{position:absolute;display:block;overflow:visible;${vertical
        ? `left:${f(u(2.3) - railT / 2)}px;top:${u(2)}px;width:${railT}px;height:calc(100% - ${2 * u(2)}px)`
        : `top:${f(u(2.3) - railT / 2)}px;left:${u(2)}px;height:${railT}px;width:calc(100% - ${2 * u(2)}px)`};filter:drop-shadow(0 0 ${u(0.5)}px ${accent}66)}
      .spark{position:absolute;z-index:1;width:${spk}px;height:${spk}px;border-radius:50%;background:${accent};color:${accent};box-shadow:0 0 ${u(1.2)}px ${accent},0 0 ${u(2.6)}px ${accent}77;${vertical
        ? `left:${f(u(2.3) - spk / 2)}px;bottom:${f(u(2) - spk / 2)}px`
        : `right:${f(u(2) - spk / 2)}px;top:${f(u(2.3) - spk / 2)}px`};animation:glowpulse 2.8s ease-in-out infinite}
      .node{position:relative;z-index:2;flex:1;display:flex;flex-direction:${vertical ? 'row' : 'column'};align-items:center;gap:${u(1.2)}px;min-width:0}
      .dot{width:${u(4.6)}px;height:${u(4.6)}px;border-radius:50%;background:${theme.bg2};border:${sw}px solid ${accent};display:grid;place-items:center;box-shadow:${theme.glowSoft(accent)};color:${accent};animation:glowpulse 3.4s ease-in-out 1.6s infinite}
      .ntt{font:700 ${u(1.9)}px ${theme.mono};letter-spacing:.14em;text-transform:uppercase;color:${theme.ink}D8;text-align:${vertical ? 'left' : 'center'}}`,
      html: `<div class="wrap">
        ${hudLabel(p.label || '', ctx, accent)}
        <div class="h1" style="margin-top:${u(0.8)}px">${esc(p.heading)}</div>
        <div class="tl">${rail}<div class="spark"></div>${nodes}</div>
      </div>`,
      script: fx(`
        FX.splitIn(tl, '.h1', { at: 0.12, each: 0.024, y: ${u(3.5)}, persp: ${u(40)} });
        FX.drawIn(tl, '.rail line', { at: 0.35, dur: 1.2, each: 0.08 });
        var railEl = document.querySelector('.rail');
        var rb = railEl ? railEl.getBoundingClientRect() : { width: 0, height: 0 };
        tl.fromTo('.spark', { ${vertical ? 'y' : 'x'}: -rb.${vertical ? 'height' : 'width'} },
          { ${vertical ? 'y' : 'x'}: 0, duration: 1.2, ease: 'power2.inOut' }, 0.35);
        tl.from('.spark', { opacity: 0, duration: 0.25, ease: 'power1.out' }, 0.35);
        ${items.length ? `FX.pop(tl, '.dot', { at: 0.5, each: 0.24, dur: 0.5 });
        tl.from('.ntt', { y: ${u(2.4)}, opacity: 0, duration: 0.55, ease: 'power3.out', stagger: 0.24 }, 0.62);` : ''}
        FX.loop(tl, '.tl', { y: -${u(0.7)}, at: 2.2, dur: 3.2 });
      `),
    };
  },
};
