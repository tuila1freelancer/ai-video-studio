// Physics Burst — vụ nổ hạt năng lượng (Physics2DPlugin) + từ khoá lớn bật lên (back.out),
// heading chữ bay 3D (SplitText) phía dưới, sub rise. Dùng cho khoảnh khắc impact/kết quả.
// Hạt + shock-ring là trang trí thuần: trạng thái tự nhiên ẩn (opacity:0) — đó CŨNG là
// trạng thái cuối của hiệu ứng (bay ra rồi tắt), nên script hỏng thì cảnh vẫn đầy đủ:
// keyword + heading + sub hiển thị tĩnh, đọc được ngay. Mọi vận tốc/góc lấy từ rng (seeded).
import { esc, hudLabel, base, headingStyle, fx } from './_shared.js';

const N_PARTICLES = 26;

export default {
  id: 'physics-burst', name: 'Physics Burst', desc: 'Vụ nổ hạt năng lượng + từ khoá bật lên (impact/kết quả)',
  build(p, ctx) {
    const { u, theme, accent } = ctx;
    const kw = p.keyword || String(p.heading || '').split(/\s+/).filter(Boolean)[0] || '';
    const cols = [...theme.accents, '#FFFFFF'];
    const s0 = Math.max(3, u(0.4)), s1 = Math.max(s0 + 2, u(0.8));
    // deterministic per-index size/color mix (accents + white) — no randomness at build time
    const parts = Array.from({ length: N_PARTICLES }, (_, i) => {
      const s = s0 + Math.round(((i * 7) % 11) / 10 * (s1 - s0));
      const c = cols[i % cols.length];
      return `<i class="pb-p" style="width:${s}px;height:${s}px;margin-left:${-Math.round(s / 2)}px;margin-top:${-Math.round(s / 2)}px;background:${c};box-shadow:0 0 ${u(1.2)}px ${c};opacity:0"></i>`;
    }).join('');
    return {
      css: base(ctx) + `
      .burst{position:relative;margin:${u(2)}px 0 ${u(1)}px}
      .pb-p{position:absolute;left:50%;top:50%;border-radius:50%;z-index:1}
      .pb-ring{position:absolute;left:50%;top:50%;width:${u(14)}px;height:${u(14)}px;margin-left:${-u(7)}px;margin-top:${-u(7)}px;border-radius:50%;border:${Math.max(2, u(0.28))}px solid ${accent};box-shadow:0 0 ${u(2)}px ${accent}88, inset 0 0 ${u(2)}px ${accent}44;opacity:0;z-index:1}
      .pb-kw{position:relative;z-index:2;${headingStyle(ctx, 11, accent)}}
      .pb-h{font-weight:800;font-size:${u(ctx.vertical ? 4.2 : 4.6)}px;line-height:1.18;letter-spacing:.01em;color:${theme.ink};text-shadow:${theme.glowSoft(accent)};margin-top:${u(2.6)}px;max-width:100%}
      .sub{margin-top:${u(2.2)}px;font-weight:600;font-size:${u(2.8)}px;color:${theme.muted}}`,
      html: `<div class="wrap">
        ${hudLabel(p.label || '', ctx, accent)}
        <div class="burst">${parts}<div class="pb-ring"></div><div class="pb-kw">${esc(kw)}</div></div>
        <div class="pb-h">${esc(p.heading)}</div>
        ${p.sub ? `<div class="sub">${esc(p.sub)}</div>` : ''}
      </div>`,
      script: fx(`
        // energy burst: one physics tween per particle so each gets its own seeded velocity/angle
        var ps = FX.q('.pb-p');
        for (var i = 0; i < ps.length; i++) {
          tl.fromTo(ps[i], { x: 0, y: 0, opacity: 1, scale: 1 },
            { physics2D: { velocity: ${u(20)} + rng() * ${u(14)}, angle: rng() * 360, gravity: ${u(30)} },
              opacity: 0, scale: 0.3, duration: 1.4, ease: 'none' }, 0.35 + i * 0.008);
        }
        tl.fromTo('.pb-ring', { scale: 0.12, opacity: 0.9 },
          { scale: 3, opacity: 0, duration: 0.8, ease: 'power2.out' }, 0.35);
        tl.from('.pb-kw', { scale: 0.2, opacity: 0, duration: 0.7, ease: 'back.out(2.4)' }, 0.42);
        FX.wiggle(tl, '.pb-kw', { at: 1.12, rot: 2.5, n: 6, dur: 0.6 });
        FX.splitIn(tl, '.pb-h', { at: 0.9, each: 0.022, y: ${u(3.5)}, persp: ${u(40)} });
        ${p.sub ? `FX.rise(tl, '.sub', { at: 1.3, y: ${u(3)} });` : ''}
        FX.loop(tl, '.burst', { y: -${u(0.8)}, at: 1.9, dur: 2.8 });
      `),
    };
  },
};
