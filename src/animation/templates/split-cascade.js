// Split Cascade — câu punch full-bleed: SplitText chars nổ 3D từ tâm ra (stagger from:'center'),
// keyword neon được wrap sẵn ở build time (accent + glow), underline scaleX vẽ ngay sau cascade,
// heading thở nhẹ bằng FX.loop. Natural state = final state (mọi motion là from-tween);
// script hỏng thì scene vẫn render đủ chữ, đủ màu. Ambient: glowpulse CSS trên keyword (WAAPI seek).
import { esc, hudLabel, base, headingStyle, fx } from './_shared.js';

// tách heading thành [trước, keyword, sau] theo accentWord (so khớp bỏ dấu câu,
// không phân biệt hoa thường, hỗ trợ cụm nhiều từ); mặc định: từ cuối.
function splitAccent(heading, accentWord) {
  const ws = String(heading || '').trim().split(/\s+/).filter(Boolean);
  if (!ws.length) return null;
  const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const acc = String(accentWord || '').trim().split(/\s+/).filter(Boolean);
  let s0 = -1, s1 = -1;
  if (acc.length && acc.length <= ws.length) {
    for (let i = 0; i + acc.length <= ws.length; i++) {
      let ok = true;
      for (let j = 0; j < acc.length; j++) if (norm(ws[i + j]) !== norm(acc[j])) { ok = false; break; }
      if (ok) { s0 = i; s1 = i + acc.length; break; }
    }
  }
  if (s0 < 0) { s0 = ws.length - 1; s1 = ws.length; }
  return {
    before: ws.slice(0, s0).map(esc).join(' '),
    kw: ws.slice(s0, s1).map(esc).join(' '),
    after: ws.slice(s1).map(esc).join(' '),
  };
}

export default {
  id: 'split-cascade', name: 'Split Cascade', desc: 'Câu punch: chữ nổ 3D từng ký tự + keyword neon',
  build(p, ctx) {
    const { u, theme, accent } = ctx;
    const accent2 = theme.accents[(ctx.idx + 1) % theme.accents.length];
    const parts = splitAccent(p.heading, p.accentWord);
    const h1 = parts
      ? `${parts.before ? parts.before + ' ' : ''}<span class="kw">${parts.kw}<i class="ul"></i></span>${parts.after ? ' ' + parts.after : ''}`
      : '';
    return {
      css: base(ctx) + `
      .wrap{padding:${u(8)}px}
      .hudtop{position:absolute;top:${u(6.5)}px;left:0;right:0;display:flex;justify-content:center;z-index:2}
      .h1w{position:relative}
      .h1{${headingStyle(ctx, ctx.vertical ? 10 : 11.5)}}
      .kw{position:relative;display:inline-block;color:${accent};text-shadow:${theme.glow(accent)};animation:glowpulse 3.4s ease-in-out 1.9s infinite}
      .ul{position:absolute;left:${u(0.2)}px;right:${u(0.2)}px;bottom:-${u(1)}px;height:${Math.max(2, u(0.5))}px;border-radius:${u(0.25)}px;background:linear-gradient(90deg,${accent},${accent2});box-shadow:0 0 ${u(1.4)}px ${accent}88;transform-origin:0 50%}
      .sub{margin-top:${u(3.6)}px;font:600 ${u(2.3)}px ${theme.mono};letter-spacing:.2em;text-transform:uppercase;color:${theme.muted}}`,
      html: `<div class="wrap">
        ${p.label ? `<div class="hudtop">${hudLabel(p.label, ctx, accent)}</div>` : ''}
        <div class="h1w"><div class="h1">${h1}</div></div>
        ${p.sub ? `<div class="sub">${esc(p.sub)}</div>` : ''}
      </div>`,
      script: fx(`
        var st = new SplitText(FX.q('.h1'), { type: 'chars,words', ignore: '.ul' });
        var end = 0.14 + Math.ceil(st.chars.length / 2) * 0.024 + 0.4;
        if (st.chars.length) {
          tl.from(st.chars, { opacity: 0, y: ${u(5.5)}, rotationX: -85, transformOrigin: '50% 100%',
            transformPerspective: ${u(45)}, duration: 0.78, ease: 'back.out(1.8)',
            stagger: { each: 0.024, from: 'center' } }, 0.14);
        }
        ${parts ? `tl.fromTo('.ul', { scaleX: 0 }, { scaleX: 1, transformOrigin: '0% 50%', duration: 0.55, ease: 'power3.inOut' }, end);` : ''}
        ${p.sub ? `FX.rise(tl, '.sub', { at: end + 0.2, y: ${u(3)} });` : ''}
        FX.loop(tl, '.h1w', { y: -${u(0.7)}, at: 1.7, dur: 3.4 });
      `),
    };
  },
};
