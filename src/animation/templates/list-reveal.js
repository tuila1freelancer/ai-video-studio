// Danh sách đánh số: tiêu đề chữ bay 3D (SplitText), rows rise CSS, thanh selector neon
// trượt giữa các hàng theo đúng nhịp active-highlight (actn/actt) của CSS.
import { esc, pad2, hudLabel, base, headingStyle, EASE, fx } from './_shared.js';

export default {
  id: 'list-reveal', name: 'List Reveal', desc: 'Danh sách đánh số hiện lần lượt, item active glow',
  build(p, ctx) {
    const { u, theme, accent, duration } = ctx;
    const items = (p.items || []).slice(0, 6);
    const n = Math.max(1, items.length);
    // each item becomes "active" during its slice of the scene (deterministic via delays)
    const slice = Math.max(1.2, (duration - 1.2) / n);
    const actStarts = items.map((_, i) => (0.8 + i * slice).toFixed(2));
    const rows = items.map((it, i) => {
      const dIn = 0.25 + i * 0.14;
      const actStart = actStarts[i];
      return `<div class="row" style="animation-delay:${dIn}s">
        <span class="idx" style="animation:actn ${duration}s steps(1) ${actStart}s both">${pad2(i + 1)}</span>
        <span class="rtx" style="animation:actt ${duration}s steps(1) ${actStart}s both">${esc(it.title || it)}</span>
      </div>`;
    }).join('');
    // selector bar glides row→row at the SAME timestamps the CSS steps() use;
    // row offsets are measured in-page at build time (fonts loaded), timestamps inlined here
    const glides = items.map((_, i) => i === 0 ? '' : `
        if (rows[${i}]) tl.fromTo(sel,
          { y: rows[${i - 1}].offsetTop - y0, height: rows[${i - 1}].offsetHeight + padY * 2 },
          { y: rows[${i}].offsetTop - y0, height: rows[${i}].offsetHeight + padY * 2, duration: 0.5, ease: 'power3.inOut', immediateRender: false },
          ${actStarts[i]});`).join('');
    return {
      css: base(ctx) + `
      .wrap{align-items:flex-start;text-align:left}
      .h1{${headingStyle(ctx, 5.2)};margin-bottom:${u(3.4)}px}
      .row{position:relative;z-index:1;display:flex;align-items:baseline;gap:${u(2)}px;padding:${u(1.35)}px 0;border-bottom:1px solid ${theme.panelBorder};width:100%;max-width:${u(ctx.vertical ? 86 : 128)}px;opacity:0;animation:rise .6s ${EASE} both}
      .idx{font:700 ${u(2.6)}px ${theme.mono};color:${theme.dim}}
      .rtx{font-weight:700;font-size:${u(3.1)}px;color:${theme.ink}B8;letter-spacing:.02em;text-transform:uppercase}
      .sel{position:absolute;left:0;top:0;opacity:0;pointer-events:none;border-radius:${u(1.2)}px;background:${theme.panel};border:1px solid ${accent}55;box-shadow:${theme.glowSoft(accent)}}
      .sel::before{content:'';position:absolute;left:0;top:22%;bottom:22%;width:${Math.max(2, u(0.3))}px;border-radius:${u(0.3)}px;background:${accent};box-shadow:${theme.glowSoft(accent)}}
      @keyframes actn{0%{color:${theme.dim}}1%,100%{color:${accent};text-shadow:${theme.glowSoft(accent)}}}
      @keyframes actt{0%{color:${theme.ink}B8}1%,100%{color:${theme.ink};text-shadow:${theme.glowSoft(accent)}}}`,
      html: `<div class="wrap">
        ${hudLabel(p.label || '', ctx, accent)}
        <div class="h1" style="margin-top:${u(1)}px">${esc(p.heading)}</div>
        <div class="sel"></div>
        ${rows}
      </div>`,
      script: fx(`
        FX.splitIn(tl, '.h1', { at: 0.12, each: 0.022, y: ${u(3.5)}, persp: ${u(40)} });
        var rows = FX.q('.row');
        var sel = document.querySelector('.sel');
        if (sel && rows.length) {
          var padX = ${u(1.2)}, padY = ${u(0.5)};
          var y0 = rows[0].offsetTop;
          sel.style.left = (rows[0].offsetLeft - padX) + 'px';
          sel.style.top = (y0 - padY) + 'px';
          sel.style.width = (rows[0].offsetWidth + padX * 2) + 'px';
          sel.style.height = (rows[0].offsetHeight + padY * 2) + 'px';
          tl.fromTo(sel, { opacity: 0, x: -${u(2)} },
            { opacity: 1, x: 0, duration: 0.45, ease: 'power2.out', immediateRender: false }, ${actStarts[0] || '0.80'});
          ${glides}
        }
      `),
    };
  },
};
