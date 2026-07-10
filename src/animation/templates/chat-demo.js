// Chat demo: bubbles pop theo nhịp GSAP, typing indicator 3 chấm trước mỗi tin AI,
// tin AI cuối gõ chữ dần bằng TextPlugin. Natural state = hội thoại hoàn chỉnh.
import { esc, icon, hudLabel, base, headingStyle, fx } from './_shared.js';

export default {
  id: 'chat-demo', name: 'Chat Demo', desc: 'Hội thoại bubble với AI (typing + type-on)',
  build(p, ctx) {
    const { u, theme, accent } = ctx;
    const msgs = (p.messages || []).slice(0, 4);
    const lastAi = msgs.reduce((acc, m, i) => (m.from === 'ai' ? i : acc), -1);
    const rows = msgs.map((m, i) => {
      const isAi = m.from === 'ai';
      const bubble = `
      <div class="msg ${isAi ? 'ai' : 'me'}" id="m${i}">
        ${isAi ? `<span class="who" style="color:${accent}">${icon('brain', u(2.4), accent)} AI</span>` : ''}
        <div class="btx">${esc(m.text)}</div>
      </div>`;
      return isAi
        ? `<div class="aiwrap"><div class="typing" id="ty${i}"><span class="td"></span><span class="td"></span><span class="td"></span></div>${bubble}</div>`
        : bubble;
    }).join('');

    // GSAP sequence: giữ nhịp gốc (bubble i vào tại 0.5 + i*0.55); trước mỗi bubble AI
    // hiện typing indicator (3 chấm nhấp nháy) rồi ẩn đi ngay trước khi bubble pop.
    const seq = msgs.map((m, i) => {
      const at = 0.5 + i * 0.55;
      const parts = [];
      if (m.from === 'ai') {
        parts.push(`tl.to('#ty${i}', { opacity: 1, duration: 0.15, ease: 'power1.out' }, ${(at - 0.42).toFixed(2)});`);
        parts.push(`tl.to('#ty${i} .td', { opacity: 1, duration: 0.1, ease: 'sine.inOut', stagger: 0.07, yoyo: true, repeat: 1 }, ${(at - 0.36).toFixed(2)});`);
        parts.push(`tl.to('#ty${i}', { opacity: 0, duration: 0.12, ease: 'power1.in' }, ${(at - 0.1).toFixed(2)});`);
      }
      parts.push(`tl.from('#m${i}', { y: ${u(3)}, opacity: 0, duration: 0.55, ease: 'back.out(1.7)' }, ${at.toFixed(2)});`);
      if (i === lastAi) {
        // TextPlugin type-on: html chứa FULL text (natural = final); tween thay thế dần từ rỗng.
        const full = String(m.text == null ? '' : m.text);
        const dur = Math.min(1.6, full.length * 0.03);
        parts.push(`tl.fromTo('#m${i} .btx', { text: '' }, { text: { value: ${JSON.stringify(full)} }, duration: ${dur.toFixed(2)}, ease: 'none' }, ${(at + 0.1).toFixed(2)});`);
      }
      return parts.join('\n        ');
    }).join('\n        ');

    return {
      css: base(ctx) + `
      .h1{${headingStyle(ctx, 4.6)};margin-bottom:${u(3)}px}
      .chat{display:flex;flex-direction:column;gap:${u(1.6)}px;width:100%;max-width:${u(ctx.vertical ? 78 : 112)}px}
      .msg{max-width:82%;padding:${u(1.7)}px ${u(2.2)}px;border-radius:${u(1.6)}px;font:500 ${u(2.15)}px ${theme.mono};line-height:1.5;text-align:left;backdrop-filter:blur(5px)}
      .me{align-self:flex-end;background:${accent}1C;border:1px solid ${accent}55;color:${theme.ink};border-bottom-right-radius:${u(0.4)}px}
      .ai{align-self:flex-start;background:${theme.panel};border:1px solid ${theme.panelBorder};color:${theme.ink}E6;border-bottom-left-radius:${u(0.4)}px}
      .aiwrap{position:relative;align-self:flex-start;max-width:82%}
      .aiwrap .msg{max-width:none}
      .typing{position:absolute;left:0;bottom:0;display:flex;align-items:center;gap:${u(0.7)}px;padding:${u(1.3)}px ${u(1.8)}px;border-radius:${u(1.6)}px;border-bottom-left-radius:${u(0.4)}px;background:${theme.panel};border:1px solid ${theme.panelBorder};opacity:0}
      .td{width:${u(0.85)}px;height:${u(0.85)}px;border-radius:50%;background:${accent};opacity:.3;box-shadow:0 0 ${u(1)}px ${accent}}
      .who{display:flex;align-items:center;gap:${u(0.7)}px;font:700 ${u(1.6)}px ${theme.mono};letter-spacing:.2em;margin-bottom:${u(0.8)}px}`,
      html: `<div class="wrap">
        ${hudLabel(p.label || 'AI CHAT // LIVE', ctx, accent)}
        <div class="h1" style="margin-top:${u(0.8)}px">${esc(p.heading)}</div>
        <div class="chat">${rows}</div>
      </div>`,
      script: fx(`
        FX.splitIn(tl, '.h1', { at: 0.06, each: 0.018, y: ${u(3.5)}, persp: ${u(40)} });
        ${seq}
        FX.loop(tl, '.chat', { y: -${u(0.5)}, at: 2.8, dur: 3.2 });
      `),
    };
  },
};
