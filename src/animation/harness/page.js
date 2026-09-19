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
import { gsapBundle } from '../gsap.js';
import { detectLibs, libsBundle } from '../libs.js';
import { fontsCss, familiesIn, vendoredFamilies } from './fonts.js';
import { userFontsCss, uploadedFamilies } from '../userfonts.js';
import { HANDOFF, RUNTIME } from './runtime.js';
import { escapeHtml } from '../../util/util.js';

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
  // Overlay mode (reference-app parity): the page renders on a SOLID key color that ffmpeg
  // later keys transparent, so the graphics composite onto the owner's footage. Every stage
  // dressing that would pollute the key (particle canvas, grid, vignette, watermark,
  // progress bar) is omitted; captions stay — they belong on top of the footage.
  const ov = opts.overlay || null;
  const KEY = ov?.key || '#050510';
  // Lossless upscale: layout stays in the logical w×h px space; zoom re-rasterizes text/SVG
  // at device resolution (renderer viewport = w*Z × h*Z). The bg canvas gets a Z× backing
  // store with a scaled context so particles stay crisp too.
  const Z = Math.max(1, +opts.zoom || 1);
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
  // plain (non-karaoke) captions: base color, steady legibility fx — a colored glow would
  // read as a highlight, so that one downgrades to a neutral dark halo (P29)
  const capPlainFx = fx === 'glow' ? 'text-shadow:0 2px 14px rgba(0,0,0,.8)' : capActFx;
  const capCls = `${opts.captionStyle?.mode === 'plain' ? ' plain' : ''}${opts.capWrap ? ' wrap' : ''}`;
  const grid = theme.grid ? `
    .grid{position:absolute;inset:0;opacity:.10;background-image:linear-gradient(${theme.accents[0]}30 1px,transparent 1px),linear-gradient(90deg,${theme.accents[0]}30 1px,transparent 1px);background-size:${Math.round(w/16)}px ${Math.round(w/16)}px}` : '.grid{display:none}';
  const vig = theme.vignette ? `.vig{position:absolute;inset:0;box-shadow:inset 0 0 ${Math.round(Math.min(w,h)*0.42)}px rgba(0,0,0,${theme.vignette})}` : '.vig{display:none}';
  const wm = opts.watermark
    ? (opts.watermark.imageUri
      ? `<img class="wm" src="${opts.watermark.imageUri}">`
      : `<div class="wm wmt">${escapeHtml(opts.watermark.text || '')}</div>`)
    : '';

  const sceneData = {
    duration: opts.duration, seed: opts.seed || 0, zoom: Z, w, h,
    // tplScale (planned/real): template-timeline coordinates per real second. __seek drives
    // the GSAP/WAAPI template layers at t*tplScale while captions/progress/bg stay on real t
    // — reconciles specs authored against an estimated duration (scenes-first pipeline).
    // tplWarp upgrades the single ratio to a beat-anchored piecewise map (per-word sync).
    tplScale: opts.tplScale && opts.tplScale !== 1 ? opts.tplScale : 1,
    tplWarp: Array.isArray(opts.tplWarp) && opts.tplWarp.length >= 3 ? opts.tplWarp : null,
    progressStart: opts.progressStart || 0, progressTotal: opts.progressTotal || 0,
    captions: opts.captions || [],
    // P29 subtitle display contract: plain mode skips the karaoke word sweep, wrap mode
    // (sentence cues) fits on height across up to 2 lines instead of width on 1.
    capMode: opts.captionStyle?.mode === 'plain' ? 'plain' : 'karaoke',
    capWrap: !!opts.capWrap,
    // Chinese, Japanese and Thai put nothing between words; joining their karaoke spans with a
    // space draws gaps the language does not have. Present only when it differs, so an untouched
    // project keeps a byte-identical page.
    ...(opts.capJoin != null && opts.capJoin !== ' ' ? { capJoin: opts.capJoin } : {}),
    fontChecks: Array.isArray(opts.fontChecks) ? opts.fontChecks : [],
    theme: { particles: theme.particles, streak: theme.streak, accents: theme.accents },
    live: !!opts.live,
    // Present only when the hand-off ramp is on, so an untouched project keeps a byte-identical
    // page (tests/scene-page-golden.test.js) and its clips stay valid.
    ...(opts.handoff ? { handoff: { out: 0.38, in: 0.28 } } : {}),
  };
  // Creative runtime libraries (P40): only the ones this spec actually reaches for. An explicit
  // opts.libs wins (regen/preview paths that already resolved them); otherwise they are detected
  // from the spec text, so a plain text scene keeps the exact page weight it had before P40.
  const libIds = Array.isArray(opts.libs) ? opts.libs : detectLibs(template);
  const libSrc = libIds.length ? libsBundle(libIds) : '';
  const libScript = libSrc ? `<script>${libSrc}<\/script>\n` : '';

  const liveBits = opts.live ? `
  ${opts.liveAudioUrl ? `<audio id="liveAud" src="${opts.liveAudioUrl}" preload="auto"></audio>` : ''}
  <div id="liveBtn" style="position:absolute;inset:0;z-index:99;display:grid;place-items:center;cursor:pointer;background:rgba(3,6,15,.35)">
    <div style="width:${Math.round(Math.min(w, h) * 0.16)}px;height:${Math.round(Math.min(w, h) * 0.16)}px;border-radius:50%;background:${theme.accents[0]};display:grid;place-items:center;box-shadow:0 0 40px ${theme.accents[0]}88">
      <div style="width:0;height:0;border-style:solid;border-width:${Math.round(Math.min(w, h) * 0.035)}px 0 ${Math.round(Math.min(w, h) * 0.035)}px ${Math.round(Math.min(w, h) * 0.06)}px;border-color:transparent transparent transparent ${theme.bg};margin-left:${Math.round(Math.min(w, h) * 0.012)}px"></div>
    </div>
  </div>` : '';

  const styleBody = `*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${w}px;height:${h}px;overflow:hidden;background:${ov ? KEY : theme.bg}}
${Z !== 1 ? `body{zoom:${Z}}` : ''}
body{font-family:${theme.font};color:${theme.ink};-webkit-font-smoothing:antialiased}
.stage{position:absolute;inset:0;background:${ov ? KEY : `radial-gradient(ellipse at 50% 30%, ${theme.bg2} 0%, ${theme.bg} 60%, ${theme.edge || '#05050a'} 100%)`}}
#bgCanvas{position:absolute;inset:0;width:${w}px;height:${h}px}
${grid}
${vig}
.wm{position:absolute;top:${Math.round(h*0.028)}px;right:${Math.round(w*0.03)}px;z-index:40;opacity:.85}
img.wm{width:${Math.round(Math.min(w,h)*0.085)}px;height:auto}
.wmt{font:700 ${Math.round(Math.min(w,h)*0.02)}px ${theme.mono};letter-spacing:.18em;color:${theme.muted};text-transform:lowercase}
.progtrack{position:absolute;left:0;right:0;bottom:0;height:${Math.max(4, Math.round(h*0.006))}px;background:rgba(255,255,255,0.07);z-index:41}
#progFill{height:100%;width:0;background:${theme.gradBar};box-shadow:0 0 12px ${theme.accents[1]}66}
.cap{position:absolute;left:6%;right:6%;bottom:${capBottom}%;z-index:39;text-align:center;white-space:nowrap;font-weight:${capWeight};font-size:${capFS}px;line-height:1.2;letter-spacing:.01em${capExtra}}
.capw{color:${capBase};opacity:.92;text-shadow:0 2px 14px rgba(0,0,0,.75)}
.capw.fut{opacity:.4}
.capw.act{color:${capColor};opacity:1;${capActFx}}
.capw.past{opacity:.95}
.cap.wrap{white-space:normal;line-height:1.25}
.cap.plain .capw{color:${capBase};opacity:1;${capPlainFx}}
.tpl{position:absolute;inset:0;z-index:10}
/* baked legibility floor: a dark halo on meaning text so it clears contrast on the dark stage
   even if the codegen model authored no shadow (hf-kw carries its own chrome/neon filter, so it
   is left untouched). template.css follows and may override. */
.tpl .hf-kw2,.tpl .hf-sub,.tpl .hf-label,.tpl .hf-stat-v,.tpl .hf-stat-l{text-shadow:0 1px 3px rgba(0,0,0,.72)}
${template.css}${opts.brand ? opts.brand.css : ''}`;

  const stageHtml = `<div class="stage">
  ${ov ? '' : `<canvas id="bgCanvas" width="${w * Z}" height="${h * Z}"></canvas>
  <div class="grid"></div>`}
  <div class="tpl">${template.html}</div>
  ${ov ? '' : '<div class="vig"></div>'}
  ${ov ? '' : (opts.brand ? opts.brand.html : wm)}
  ${opts.captionsOff ? '' : `<div class="cap${capCls}"><span id="capText"></span></div>`}
  ${ov ? '' : '<div class="progtrack"><div id="progFill"></div></div>'}
  ${liveBits}
</div>`;

  // Embed the faces this page names and nothing else. The scan covers the CSS, the markup and
  // the template's own script, because a family can be introduced from any of them.
  const surface = `${styleBody}\n${stageHtml}\n${template.script || ''}`;
  const vendored = familiesIn(surface, vendoredFamilies());
  const uploaded = familiesIn(surface, uploadedFamilies());

  return `<!doctype html><html><head><meta charset="utf-8">
<style>
${fontsCss(vendored)}
${userFontsCss(uploaded)}
${styleBody}
</style></head><body>
${stageHtml}
<script>window.__scene=${JSON.stringify(sceneData).replace(/</g, '\\u003c')};<\/script>
${libScript}${template.script ? `<script>${gsapBundle()}<\/script>
<script>window.__tplScript=function(gsap,tl,S,rng){${String(template.script).replace(/<\/script/gi, '<\\/script')}
};<\/script>` : ''}
<script>${RUNTIME}<\/script>${opts.handoff ? `\n<script>${HANDOFF}<\/script>` : ''}
</body></html>`;
}
