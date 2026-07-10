// Terminal giải mã: panel pop-in, từng dòng scramble-decode (ScrambleText), tag đóng dấu
// power3.in + rung CustomWiggle, tiêu đề chữ bay 3D (SplitText). Scan line CSS loop giữ ambience.
import { esc, pad2, hudLabel, base, headingStyle, fx } from './_shared.js';

export default {
  id: 'terminal-scan', name: 'Terminal Scan', desc: 'Mock code + scan + tag cảnh báo',
  build(p, ctx) {
    const { u, theme, accent } = ctx;
    const acc2 = theme.accents[1];
    const lines = (p.lines || ['> analyzing input…', '[SYS] context: OK', '[SYS] goal: OK', '[ERR] missing: target audience']).slice(0, 6);
    const rows = lines.map((l, i) =>
      `<div class="ln" data-i="${i}"><span class="lnum">${pad2(i + 1)}</span><span class="ltx">${esc(l)}</span></div>`).join('');
    // Stamp impact keeps the original CSS timing (delay was 0.6 + n*0.4); the power3.in
    // from-tween accelerates INTO that moment, so it starts 0.45s earlier and lands there.
    const stampT = 0.6 + lines.length * 0.4;
    const stampAt = Math.max(0.1, stampT - 0.45);
    // Decode: scramble each line to its final text (escaped — ScrambleText writes innerHTML,
    // so entities render identically to the natural markup).
    const scrambles = lines.map((l, i) =>
      `FX.scramble(tl, '.ln[data-i="${i}"] .ltx', ${JSON.stringify(esc(l))}, { at: ${(0.5 + i * 0.4).toFixed(2)}, dur: 0.55, chars: '█▓▒<>/01' });`).join('\n        ');
    return {
      css: base(ctx) + `
      .term{position:relative;width:100%;max-width:${u(ctx.vertical ? 80 : 116)}px;background:${theme.panel};border:1px solid ${theme.panelBorder};border-radius:${u(1.4)}px;padding:${u(2.6)}px;text-align:left;backdrop-filter:blur(6px);overflow:hidden}
      .tbar{display:flex;gap:${u(0.7)}px;margin-bottom:${u(1.8)}px}
      .tbar i{width:${u(1.1)}px;height:${u(1.1)}px;border-radius:50%;background:${theme.dim}}
      .tbar i:first-child{background:${acc2}}
      .ln{font:500 ${u(2)}px ${theme.mono};color:${theme.muted};padding:${u(0.55)}px 0;white-space:nowrap;overflow:hidden}
      .ln[data-i="${lines.length - 1}"]{color:${acc2};text-shadow:${theme.glowSoft(acc2)}}
      .lnum{color:${theme.dim};margin-right:${u(1.4)}px}
      .scan{position:absolute;left:0;right:0;height:${u(4)}px;background:linear-gradient(180deg,transparent,${accent}18,transparent);animation:scanmv 3.2s ease-in-out .8s infinite}
      @keyframes scanmv{0%,100%{top:8%}50%{top:82%}}
      .tag{position:absolute;right:${u(2)}px;top:${u(2)}px;padding:${u(0.7)}px ${u(1.4)}px;border:2px solid ${acc2};color:${acc2};font:800 ${u(1.9)}px ${theme.mono};letter-spacing:.12em;border-radius:${u(0.6)}px;transform:rotate(6deg);box-shadow:${theme.glowSoft(acc2)}}
      .h1{${headingStyle(ctx, 4.6)};margin-top:${u(3)}px}`,
      html: `<div class="wrap">
        ${hudLabel(p.label || 'SYS.OP // ANALYSIS_ACTIVE', ctx, accent)}
        <div class="term" style="margin-top:${u(1.2)}px">
          <div class="tbar"><i></i><i></i><i></i></div>
          ${rows}<div class="scan"></div>
          ${p.tag ? `<div class="tag">${esc(p.tag.toUpperCase())}</div>` : ''}
        </div>
        <div class="h1">${esc(p.heading)}</div>
      </div>`,
      script: fx(`
        tl.from('.term', { scale: 0.92, opacity: 0, duration: 0.6, ease: 'power3.out' }, 0.15);
        ${lines.length ? `tl.from('.ln', { opacity: 0, duration: 0.3, ease: 'power2.out', stagger: 0.4 }, 0.5);
        ${scrambles}` : ''}
        ${p.tag ? `tl.from('.tag', { scale: 2.2, opacity: 0, rotation: 14, duration: 0.45, ease: 'power3.in' }, ${stampAt.toFixed(2)});
        FX.wiggle(tl, '.tag', { rot: 3, n: 5, at: ${stampT.toFixed(2)} });` : ''}
        FX.splitIn(tl, '.h1', { at: 0.55, each: 0.02, y: ${u(3)}, persp: ${u(40)} });
        FX.loop(tl, '.term', { y: -${u(0.7)}, at: 1.8, dur: 3.4 });
      `),
    };
  },
};
