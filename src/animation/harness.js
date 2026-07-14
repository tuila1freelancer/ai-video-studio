// Builds the self-contained scene page: theme + fonts + background layers + template markup
// + caption karaoke + progress bar + watermark + the deterministic __seek(t) runtime.
//
// Determinism contract:
//  - every CSS animation on the page is collected once and PAUSED at load
//  - GSAP templates build ONE paused root timeline (window.__tl); __seek scrubs it with
//    tl.time(t, true) — its zero is its own, so creation timing can never skew frames
//  - Math.random is re-seeded from the scene seed before the template script runs, and
//    gsap.globalTimeline is paused so stray tweens freeze instead of drifting
//  - __seek(t) sets anim.currentTime = t*1000, redraws canvas layers, caption and progress from t
//  - nothing depends on wall-clock time → any frame can be rendered at any pace, in any order
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { VENDOR_DIR } from '../config/paths.js';
import { gsapBundle } from './gsap.js';
import { userFontsCss } from './userfonts.js';

let fontsCssCache = null;
export function fontsCss() {
  if (fontsCssCache == null) {
    const p = join(VENDOR_DIR, 'fonts', 'fonts.css');
    fontsCssCache = existsSync(p) ? readFileSync(p, 'utf8') : '';
  }
  return fontsCssCache;
}

// The in-page runtime. Kept dependency-free and small.
const RUNTIME = `
(() => {
  const S = window.__scene; // { duration, seed, progressStart, progressTotal, captions, theme }
  let anims = [];

  // ---- seeded rng ----
  function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}

  // ---- background canvas (particles + streak), pure function of t ----
  const cv = document.getElementById('bgCanvas');
  let px = [];
  if (cv) {
    const ctx = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    const rnd = mulberry32(1337 + (S.seed|0));
    const N = S.theme.particles|0;
    for (let i=0;i<N;i++) px.push({ x:rnd()*W, y:rnd()*H, r:(0.6+rnd()*1.9)*(W/1080), v:6+rnd()*22, tw:rnd()*6.28, c:rnd()<0.72?S.theme.accents[0]:(rnd()<0.5?S.theme.accents[1]:'#FFFFFF') });
    window.__drawBg = (t) => {
      ctx.clearRect(0,0,W,H);
      for (const p of px) {
        const y = ((p.y - p.v*t) % (H+40) + (H+40)) % (H+40) - 20;
        const x = p.x + Math.sin(t*0.35 + p.tw) * 14 * (W/1080);
        const a = 0.25 + 0.55 * (0.5 + 0.5*Math.sin(t*1.4 + p.tw*3));
        ctx.globalAlpha = a; ctx.fillStyle = p.c;
        ctx.beginPath(); ctx.arc(x, y, p.r, 0, 6.283); ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (S.theme.streak) {
        // one soft light streak sweeping diagonally across the scene duration
        const prog = (t * 0.55 / Math.max(3, S.duration)) % 1.2 - 0.1;
        const cxp = prog * (W*1.5) - W*0.25;
        const g = ctx.createLinearGradient(cxp-6, 0, cxp+6, 0);
        g.addColorStop(0,'rgba(255,255,255,0)'); g.addColorStop(0.5,'rgba(255,255,255,0.20)'); g.addColorStop(1,'rgba(255,255,255,0)');
        ctx.save(); ctx.translate(W/2,H/2); ctx.rotate(-0.32); ctx.translate(-W/2,-H/2);
        ctx.fillStyle = g; ctx.fillRect(cxp-8, -H*0.4, 16, H*1.8);
        ctx.restore();
      }
    };
  } else { window.__drawBg = () => {}; }

  // ---- caption karaoke ----
  const capEl = document.getElementById('capText');
  let curCue = -1;
  function findCue(t) {
    const cues = S.captions || [];
    for (let i=0;i<cues.length;i++) if (t >= cues[i].start - 0.02 && t <= cues[i].end + 0.12) return i;
    return -1;
  }
  window.__drawCaption = (t) => {
    if (!capEl) return;
    const cues = S.captions || [];
    const ci = findCue(t);
    if (ci !== curCue) {
      curCue = ci;
      capEl.innerHTML = ci < 0 ? '' : cues[ci].words.map((w,j)=>'<span class="capw" data-j="'+j+'">'+w.word.replace(/&/g,'&amp;').replace(/</g,'&lt;')+'</span>').join(' ');
    }
    if (ci >= 0) {
      const words = cues[ci].words;
      const spans = capEl.children;
      for (let j=0;j<spans.length;j++) {
        const w = words[j];
        spans[j].className = 'capw ' + (t >= w.end ? 'past' : (t >= w.start ? 'act' : 'fut'));
      }
    }
  };

  // ---- progress bar ----
  const pbar = document.getElementById('progFill');
  window.__drawProgress = (t) => {
    if (!pbar || !S.progressTotal) return;
    const p = Math.max(0, Math.min(1, (S.progressStart + t) / S.progressTotal));
    pbar.style.width = (p*100).toFixed(3) + '%';
  };

  // ---- init + seek ----
  window.__init = async () => {
    try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch(e){}
    // GSAP template timeline: build AFTER fonts (SplitText measures glyphs) with seeded randomness.
    window.__tplErr = null;
    if (window.gsap && window.__tplScript) {
      try {
        Math.random = mulberry32(0x9E3779B9 ^ (S.seed|0));
        const tl = gsap.timeline({ paused: true });
        window.__tplScript(gsap, tl, S, mulberry32(4242 + (S.seed|0)));
        window.__tl = tl;
      } catch(e) { window.__tplErr = String(e && e.message || e); }
      try { gsap.globalTimeline.pause(); } catch(e){}
    }
    anims = document.getAnimations ? document.getAnimations({ subtree: true }) : [];
    for (const a of anims) { try { a.pause(); } catch(e){} }
    window.__seek(0);
    return { n: anims.length, gsap: !!window.__tl, tplErr: window.__tplErr };
  };
  window.__seek = (t) => {
    // Template layers (GSAP timeline + the spec's CSS/WAAPI animations) run in AUTHORED
    // timeline coordinates: st = t * tplScale warps a spec authored for plannedDur across
    // the real duration. Captions/progress/background stay on REAL time — they are built
    // from the real voice timeline at page build.
    const st = t * (S.tplScale || 1);
    const ms = st*1000;
    for (const a of anims) { try { a.currentTime = ms; } catch(e){} }
    // suppressEvents MUST be false: onUpdate-driven content (FX.count/typeOn counters) is a
    // pure function of tl time, but suppressing events froze it at its initial value.
    if (window.__tl) { try { window.__tl.time(st, false); } catch(e){} }
    window.__drawBg(t); window.__drawCaption(t); window.__drawProgress(t);
    return true;
  };

  // ---- live preview mode (browser playback, not used by the renderer) ----
  if (S.live) {
    const btn = document.getElementById('liveBtn');
    const aud = document.getElementById('liveAud');
    const start = async () => {
      if (btn) btn.style.display = 'none';
      await window.__init();
      let t0 = performance.now();
      if (aud) { try { aud.currentTime = 0; await aud.play(); } catch(e){} }
      const loop = () => {
        let t;
        if (aud && aud.duration && !aud.paused) t = aud.currentTime;
        else t = ((performance.now() - t0) / 1000) % Math.max(0.5, S.duration);
        window.__seek(Math.min(t, S.duration));
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    };
    if (btn) btn.addEventListener('click', start);
  }
})();`;

/**
 * Build the complete scene page HTML.
 * opts: {
 *   w, h, theme, seed, duration, progressStart, progressTotal,
 *   template: { css, html, script? },  // sized markup from templates.js; script = GSAP
 *     timeline builder body run as function(gsap, tl, S, rng) after fonts load — everything
 *     must be added to the paused root timeline `tl`
 *   captions,                  // [{start,end,text,words:[{start,end,word}]}] or null
 *   watermark: { text } | { imageUri } | null,
 *   brand: { css, html } | null,   // channel brand layer (from branding.js) — supersedes watermark
 *   captionStyle: { color, fontSizePx, bottomPct }
 * }
 */
export function buildScenePage(opts) {
  const { w, h, theme, template } = opts;
  const capFS = Math.round((opts.captionStyle?.fontSizePx) || Math.min(w, h) * 0.052);
  const capBottom = opts.captionStyle?.bottomPct ?? (h > w ? 10 : 7);
  const capColor = opts.captionStyle?.color || theme.accents[0];
  // Subtitle-preset extensions — every default reproduces the historic CSS byte-for-byte.
  const capBase = opts.captionStyle?.baseColor || theme.ink;
  const capWeight = opts.captionStyle?.weight || 800;
  const capExtra = [
    opts.captionStyle?.textCase && opts.captionStyle.textCase !== 'original'
      ? `;text-transform:${opts.captionStyle.textCase === 'titlecase' ? 'capitalize' : opts.captionStyle.textCase}` : '',
    opts.captionStyle?.fontFamily ? `;font-family:${opts.captionStyle.fontFamily}` : '',
  ].join('');
  const fx = opts.captionStyle?.effect || 'glow';
  const capActFx = fx === 'outline'
    ? `-webkit-text-stroke:${Math.max(1, Math.round(capFS * 0.045))}px rgba(0,0,0,.92);text-shadow:0 2px 8px rgba(0,0,0,.85)`
    : fx === 'box'
      ? `background:${opts.captionStyle?.boxBg || 'rgba(10,10,16,.85)'};padding:.06em .28em;border-radius:.16em;-webkit-box-decoration-break:clone;box-decoration-break:clone;text-shadow:none`
      : fx === 'shadow'
        ? 'text-shadow:0 2px 0 rgba(0,0,0,.85),0 5px 16px rgba(0,0,0,.7)'
        : `text-shadow:${theme.glow(capColor)}`;
  const grid = theme.grid ? `
    .grid{position:absolute;inset:0;opacity:.10;background-image:linear-gradient(${theme.accents[0]}30 1px,transparent 1px),linear-gradient(90deg,${theme.accents[0]}30 1px,transparent 1px);background-size:${Math.round(w/16)}px ${Math.round(w/16)}px}` : '.grid{display:none}';
  const vig = theme.vignette ? `.vig{position:absolute;inset:0;box-shadow:inset 0 0 ${Math.round(Math.min(w,h)*0.42)}px rgba(0,0,0,${theme.vignette})}` : '.vig{display:none}';
  const wm = opts.watermark
    ? (opts.watermark.imageUri
      ? `<img class="wm" src="${opts.watermark.imageUri}">`
      : `<div class="wm wmt">${escapeHtml(opts.watermark.text || '')}</div>`)
    : '';

  const sceneData = {
    duration: opts.duration, seed: opts.seed || 0,
    // tplScale (planned/real): template-timeline coordinates per real second. __seek drives
    // the GSAP/WAAPI template layers at t*tplScale while captions/progress/bg stay on real t
    // — reconciles specs authored against an estimated duration (scenes-first pipeline).
    tplScale: opts.tplScale && opts.tplScale !== 1 ? opts.tplScale : 1,
    progressStart: opts.progressStart || 0, progressTotal: opts.progressTotal || 0,
    captions: opts.captions || [],
    theme: { particles: theme.particles, streak: theme.streak, accents: theme.accents },
    live: !!opts.live,
  };
  const liveBits = opts.live ? `
  ${opts.liveAudioUrl ? `<audio id="liveAud" src="${opts.liveAudioUrl}" preload="auto"></audio>` : ''}
  <div id="liveBtn" style="position:absolute;inset:0;z-index:99;display:grid;place-items:center;cursor:pointer;background:rgba(3,6,15,.35)">
    <div style="width:${Math.round(Math.min(w, h) * 0.16)}px;height:${Math.round(Math.min(w, h) * 0.16)}px;border-radius:50%;background:${theme.accents[0]};display:grid;place-items:center;box-shadow:0 0 40px ${theme.accents[0]}88">
      <div style="width:0;height:0;border-style:solid;border-width:${Math.round(Math.min(w, h) * 0.035)}px 0 ${Math.round(Math.min(w, h) * 0.035)}px ${Math.round(Math.min(w, h) * 0.06)}px;border-color:transparent transparent transparent ${theme.bg};margin-left:${Math.round(Math.min(w, h) * 0.012)}px"></div>
    </div>
  </div>` : '';

  return `<!doctype html><html><head><meta charset="utf-8">
<style>
${fontsCss()}
${userFontsCss()}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${w}px;height:${h}px;overflow:hidden;background:${theme.bg}}
body{font-family:${theme.font};color:${theme.ink};-webkit-font-smoothing:antialiased}
.stage{position:absolute;inset:0;background:radial-gradient(130% 110% at 28% 6%, ${theme.bg2} 0%, ${theme.bg} 62%)}
#bgCanvas{position:absolute;inset:0}
${grid}
${vig}
.wm{position:absolute;top:${Math.round(h*0.028)}px;right:${Math.round(w*0.03)}px;z-index:40;opacity:.85}
img.wm{width:${Math.round(Math.min(w,h)*0.085)}px;height:auto}
.wmt{font:700 ${Math.round(Math.min(w,h)*0.02)}px ${theme.mono};letter-spacing:.18em;color:${theme.muted};text-transform:lowercase}
.progtrack{position:absolute;left:0;right:0;bottom:0;height:${Math.max(4, Math.round(h*0.006))}px;background:rgba(255,255,255,0.07);z-index:41}
#progFill{height:100%;width:0;background:${theme.gradBar};box-shadow:0 0 12px ${theme.accents[1]}66}
.cap{position:absolute;left:8%;right:8%;bottom:${capBottom}%;z-index:39;text-align:center;font-weight:${capWeight};font-size:${capFS}px;line-height:1.32;letter-spacing:.01em${capExtra}}
.capw{color:${capBase};opacity:.92;text-shadow:0 2px 14px rgba(0,0,0,.75)}
.capw.fut{opacity:.4}
.capw.act{color:${capColor};opacity:1;${capActFx}}
.capw.past{opacity:.95}
.tpl{position:absolute;inset:0;z-index:10}
${template.css}${opts.brand ? opts.brand.css : ''}
</style></head><body>
<div class="stage">
  <canvas id="bgCanvas" width="${w}" height="${h}"></canvas>
  <div class="grid"></div>
  <div class="tpl">${template.html}</div>
  <div class="vig"></div>
  ${opts.brand ? opts.brand.html : wm}
  <div class="cap"><span id="capText"></span></div>
  <div class="progtrack"><div id="progFill"></div></div>
  ${liveBits}
</div>
<script>window.__scene=${JSON.stringify(sceneData).replace(/</g, '\\u003c')};<\/script>
${template.script ? `<script>${gsapBundle()}<\/script>
<script>window.__tplScript=function(gsap,tl,S,rng){${String(template.script).replace(/<\/script/gi, '<\\/script')}
};<\/script>` : ''}
<script>${RUNTIME}<\/script>
</body></html>`;
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
