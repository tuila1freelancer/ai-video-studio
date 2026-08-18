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
import { detectLibs, libsBundle } from './libs.js';
import { userFontsCss, uploadedFamilies } from './userfonts.js';
import { downloadedCss, downloadedFamilies } from '../fonts/files.js';

let fontsCssCache = null;
let faceBlocksCache = null;

function parseFaces(css) {
  const out = [];
  for (const m of String(css || '').matchAll(/@font-face\s*\{[^}]*\}/g)) {
    const fam = /font-family:\s*['"]([^'"]+)['"]/.exec(m[0])?.[1];
    if (fam) out.push({ family: fam, block: m[0] });
  }
  return out;
}

// Downloaded families are re-read rather than cached for the process lifetime: the owner can
// fetch one from the Library while the app is running, and the very next preview has to see it.
let webCache = { stamp: '', blocks: [] };
function webFaces() {
  const fams = downloadedFamilies();
  const stamp = fams.join('|');
  if (stamp !== webCache.stamp) {
    webCache = { stamp, blocks: fams.flatMap((f) => parseFaces(downloadedCss(f))) };
  }
  return webCache.blocks;
}

/** Every `@font-face` the renderer can supply — vendored plus anything fetched on request. */
function faceBlocks() {
  if (!faceBlocksCache) faceBlocksCache = parseFaces(rawFontsCss());
  return [...faceBlocksCache, ...webFaces()];
}

function rawFontsCss() {
  if (fontsCssCache == null) {
    const p = join(VENDOR_DIR, 'fonts', 'fonts.css');
    fontsCssCache = existsSync(p) ? readFileSync(p, 'utf8') : '';
  }
  return fontsCssCache;
}

/** Families the vendored CSS can supply — the scan set for `familiesIn`. */
export function vendoredFamilies() {
  return [...new Set(faceBlocks().map((f) => f.family))];
}

/**
 * Which of `known` does this page actually name?
 *
 * A plain substring scan rather than a CSS parse, on purpose: families are referenced from
 * `font-family:` declarations, from `font:` shorthand (`.wmt`), from inline style attributes, and
 * from whatever the codegen model wrote into the scene's own CSS. Missing one would silently
 * substitute a typeface; including one spuriously costs a few KB. The asymmetry decides it.
 */
export function familiesIn(text, known) {
  const s = String(text || '');
  return (known || []).filter((f) => s.includes(f));
}

/**
 * The `@font-face` blocks for `families`, or the whole vendored sheet when asked for everything.
 *
 * Every scene page used to carry all eight vendored families — 516 KB of base64 on a 757 KB page,
 * repeated for all 95 scenes of a video, to render text that names one or two of them. Embedding
 * only what the page references takes ~500 KB off each one, and it is the change that lets the
 * catalogue grow past a handful of Latin faces at all: a single CJK face is larger than the
 * entire current sheet.
 */
export function fontsCss(families) {
  if (!families) return rawFontsCss();
  const want = new Set(families);
  return faceBlocks().filter((f) => want.has(f.family)).map((f) => f.block).join('\n');
}

/**
 * Scene hand-off — emitted as its OWN script, only for a clip that asked for it.
 *
 * The clip's CONTENT leaves before the cut and arrives just after it, while the ground — the stage
 * gradient, the background canvas, the vignette, the grain, the progress bar and the watermark —
 * never moves. That asymmetry is the whole point: consecutive scenes share a backdrop, so a
 * cross-dissolve between them was only ever dissolving text over text, and a longer one made the
 * collision worse rather than softer. Ramping `.hf-cam` (the motif and the scene body, and nothing
 * else) leaves the join blending an emptied frame against an arriving one, over a ground that is
 * continuous through the cut. That is the "smooth and natural" the concat alone cannot buy.
 *
 * It is a separate script, registered through the public `window.__onSeek`, rather than a branch
 * inside RUNTIME — RUNTIME is one constant string, so a branch in it would change the bytes of
 * EVERY scene page including those of projects that never asked (tests/scene-page-golden.test.js).
 * This way an untouched project's page is identical to the byte and its clips stay valid.
 *
 * It runs on REAL time, like the caption and the progress bar. The template layers live in warped
 * authored coordinates and a hand-off that drifted with the warp would not meet a cut that happens
 * at a real timestamp. The window fits inside the clip's own silence (measured 0.68–0.93s of
 * trailing breath pad, 0.19–0.20s leading), so no narration is touched.
 */
const HANDOFF = `
(() => {
  const S = window.__scene;
  const cam = document.querySelector('.hf-cam');
  if (!cam || !S.handoff) return;
  const dOut = S.handoff.out, dIn = S.handoff.in;
  window.__onSeek((t) => {
    const tail = Math.max(0, t - (S.duration - dOut)) / dOut; // 0 → 1 over the last dOut seconds
    const head = 1 - Math.max(0, Math.min(1, t / dIn));       // 1 → 0 over the first dIn seconds
    const k = Math.max(0, Math.min(1, Math.max(tail, head)));
    const e = k * k * (3 - 2 * k); // smoothstep — a linear ramp reads as a mechanical wipe
    cam.style.opacity = (1 - 0.94 * e).toFixed(4);
    // concatenation, not template literals: this runtime is itself inside one, so an
    // interpolation here would be substituted at PAGE BUILD time rather than at seek time
    cam.style.transform = 'scale(' + (1 + (tail > head ? 0.035 : -0.03) * e).toFixed(4) + ')';
    cam.style.filter = e > 0.001 ? 'blur(' + (3 * e).toFixed(2) + 'px)' : '';
  });
})();
`;

// The in-page runtime. Kept dependency-free and small.
const RUNTIME = `
(() => {
  const S = window.__scene; // { duration, seed, progressStart, progressTotal, captions, theme }
  let anims = [];

  // ---- deterministic seek hooks (P40) ----
  // A creative-library layer (THREE renderer, p5 sketch, hand-rolled canvas) must never run on
  // its own rAF clock: the renderer scrubs frames out of order, so wall-clock drawing yields a
  // different picture every run. A scene registers window.__onSeek(fn) and the hook is called
  // with (sceneTime, authoredTime) on EVERY seek — the layer stays a pure function of t.
  // Hooks are defined before __init so the template script can register during build.
  const seekHooks = [];
  window.__onSeek = (fn) => { if (typeof fn === 'function') { seekHooks.push(fn); return true; } return false; };
  window.__runSeekHooks = (t, st) => {
    for (const fn of seekHooks) { try { fn(t, st); } catch(e) { window.__hookErr = String(e && e.message || e); } }
  };

  // ---- seeded rng ----
  function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}

  // ---- background canvas (particles + streak), pure function of t ----
  const cv = document.getElementById('bgCanvas');
  let px = [];
  if (cv) {
    const ctx = cv.getContext('2d');
    const Z = S.zoom || 1;
    ctx.scale(Z, Z); // draw in logical coords on the Z× backing store — crisp at any output
    const W = cv.width / Z, H = cv.height / Z;
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
      // fit the cue deterministically: single-line mode shrinks until the width fits;
      // wrap mode (sentence chunking) allows up to 2 lines and shrinks on height instead.
      const cap = capEl.parentElement;
      if (cap) {
        cap.style.fontSize = '';
        if (ci >= 0) {
          let fs = parseFloat(getComputedStyle(cap).fontSize) || 40, g = 80;
          const over = () => S.capWrap
            ? cap.scrollHeight > fs * 1.25 * 2 + 4
            : cap.scrollWidth > cap.clientWidth + 1;
          while (g-- > 0 && over() && fs > 8) { fs -= 1; cap.style.fontSize = fs + 'px'; }
        }
      }
    }
    if (ci >= 0 && S.capMode !== 'plain') {
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

  // Vietnamese typesetting repair — runs before AND after __fitText, and is idempotent.
  //
  // A capital carrying a stacked mark reaches up to 44% higher above the baseline than a Latin
  // capital (measured on every vendored face), so a line-height tuned for Latin leaves the mark
  // OUTSIDE the line box. Three things then go wrong and all three shipped: background-clip:text
  // paints only inside the box, so the mark is never painted at all; two lines collide, because
  // the box is shorter than the ink; an overflow:hidden wrapper cuts the mark off.
  //
  // Every number comes from the element's OWN resolved font via measureText, never a constant:
  // the safe line-height runs from 1.18 (Anton) to 1.41 (Nunito).
  // grave, acute, tilde, hook-above, breve, circumflex, horn — the marks that sit ABOVE
  var VN_HIGH = /[\\u0300\\u0301\\u0303\\u0309\\u0306\\u0302\\u031B]/;
  var VN_LOW = /[\\u0323]/; // dot below
  const vnMetrics = (el, text) => {
    const cs = getComputedStyle(el);
    const fs = parseFloat(cs.fontSize) || 0;
    if (!fs) return null;
    const cv = window.__vnCanvas || (window.__vnCanvas = document.createElement('canvas').getContext('2d'));
    cv.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + fs + 'px ' + cs.fontFamily;
    // measureText knows nothing about text-transform, and CAPITALS are the tall case
    const tf = cs.textTransform;
    const shown = tf === 'uppercase' ? text.toUpperCase() : tf === 'lowercase' ? text.toLowerCase() : text;
    const m = cv.measureText(shown);
    const lhPx = cs.lineHeight === 'normal'
      ? m.fontBoundingBoxAscent + m.fontBoundingBoxDescent
      : parseFloat(cs.lineHeight);
    const leading = lhPx - (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent);
    return {
      cs: cs, fs: fs, lhPx: lhPx,
      // how far the ink pokes out of the line box, top and bottom
      over: Math.max(0, m.actualBoundingBoxAscent - (m.fontBoundingBoxAscent + leading / 2)),
      under: Math.max(0, m.actualBoundingBoxDescent - (m.fontBoundingBoxDescent + leading / 2)),
      // the smallest line-height at which two consecutive lines cannot touch
      safeLh: (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) / fs,
    };
  };

  window.__fitVietnamese = () => {
    const leaves = [];
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const t = n.nodeValue;
      if (!t || !t.trim()) continue;
      const norm = t.normalize('NFD');
      if (!VN_HIGH.test(norm) && !VN_LOW.test(norm)) continue;
      const el = n.parentElement;
      if (el && leaves.indexOf(el) < 0) leaves.push(el);
    }
    for (const el of leaves) {
      const text = el.textContent || '';
      const m = vnMetrics(el, text);
      if (!m) continue;
      const d = el.dataset;
      if (d.vnPadT === undefined) {
        d.vnPadT = m.cs.paddingTop; d.vnPadB = m.cs.paddingBottom;
        d.vnMarT = m.cs.marginTop; d.vnMarB = m.cs.marginBottom;
      }
      const padT = parseFloat(d.vnPadT) || 0, padB = parseFloat(d.vnPadB) || 0;
      // 1. two or more lines that could touch — the only case worth changing the layout for.
      //    A single tight line is left exactly as designed; steps 2 and 3 fix it invisibly.
      const lines = Math.max(1, Math.round((el.clientHeight - padT - padB) / m.lhPx));
      if (lines > 1 && m.safeLh > m.lhPx / m.fs + 0.001) el.style.lineHeight = m.safeLh.toFixed(3);
      // 2. paint room for the marks. Padding grows the box; a cancelling negative margin keeps the
      //    composition where the designer put it (measured: the glyphs move 0.10px).
      const after = vnMetrics(el, text) || m;
      const over = Math.ceil(after.over), under = Math.ceil(after.under);
      const clip = after.cs.webkitBackgroundClip || after.cs.backgroundClip || '';
      if (clip.indexOf('text') >= 0 && (over > 0 || under > 0)) {
        el.style.paddingTop = (padT + over) + 'px';
        el.style.marginTop = ((parseFloat(d.vnMarT) || 0) - over) + 'px';
        el.style.paddingBottom = (padB + under) + 'px';
        el.style.marginBottom = ((parseFloat(d.vnMarB) || 0) - under) + 'px';
      }
      // 3. a wrapper that clips the mark. Only a TEXT-TIGHT box is relaxed — a panel with
      //    overflow:hidden is hiding something on purpose (a bar fill, an ::after streak), and
      //    opening it would leak that instead of fixing this.
      let a = el;
      for (let hop = 0; hop < 3 && a && a !== document.body; hop++) {
        const acs = getComputedStyle(a);
        if (acs.overflow === 'hidden' || acs.overflowY === 'hidden') {
          const r = el.getBoundingClientRect(), ar = a.getBoundingClientRect();
          const tight = a.clientHeight <= after.lhPx * 1.6;
          const cuts = (r.top - over) < ar.top - 1 || (r.bottom + under) > ar.bottom + 1;
          if (tight && cuts) { a.style.overflow = 'visible'; a.style.overflowY = 'visible'; }
        }
        a = a.parentElement;
      }
    }
  };

  // fitText guard-rail (ported idea: HyperFrames fitTextFontSize): a single-line label whose
  // box can't hold its text — or that outgrows 88% of the frame — shrinks its font in 2px
  // steps to a floor, then may wrap as the last resort. Mechanical insurance against
  // truncated/overflowing labels, independent of what the LLM authored. Runs BEFORE the
  // template script builds so SplitText measures the final glyph sizes. hf-* classes are
  // hyperframe vocabulary, so heuristic templates render untouched.
  window.__fitText = () => {
    const frameW = (S.w || innerWidth), frameH = (S.h || innerHeight);
    const maxW = 0.88 * frameW;
    const z = (typeof S.zoom === 'number' && S.zoom > 0) ? S.zoom : 1;
    for (const el of document.querySelectorAll('.hf-kw, .hf-kw2, .hf-sub, .hf-label, .hf-chip, .hf-stat-l')) {
      if (!el.textContent || !el.textContent.trim()) continue;
      const cs = getComputedStyle(el);
      let size = parseFloat(cs.fontSize) || 0;
      if (!size) continue;
      const floor = Math.max(12, size * 0.55);
      const over = () => (el.scrollWidth - el.clientWidth > 3) || (el.getBoundingClientRect().width / z > maxW);
      let guard = 40;
      while (over() && size - 2 >= floor && guard-- > 0) { size -= 2; el.style.fontSize = size + 'px'; }
      if (over() && cs.whiteSpace === 'nowrap') el.style.whiteSpace = 'normal'; // wrapping beats clipping
      // GROW branch (two-sided fit): a weak model often builds a TINY hero headline floating in
      // black (the 'timid' defect). If the hero text is well under the frame, step it UP toward
      // ~72% width — bounded by the 88% width ceiling AND stopping before its bottom crosses the
      // subtitle-safe line (0.80*h), so growth can never manufacture overflow. Hero classes only.
      if (el.matches('.hf-kw, .hf-kw2')) {
        const wNow = () => el.getBoundingClientRect().width / z;
        const botOk = () => (el.getBoundingClientRect().bottom / z) < 0.80 * frameH;
        const topOk = () => (el.getBoundingClientRect().top / z) > 0.07 * frameH; // a tall wrapped headline must not clip the top
        let g = 40;
        while (wNow() < 0.66 * frameW && !over() && botOk() && topOk() && g-- > 0) { size += 2; el.style.fontSize = size + 'px'; }
        if (over() || !botOk() || !topOk()) { size -= 2; el.style.fontSize = size + 'px'; } // step back one on overshoot
      }
    }
  };

  // Deterministic caption-safe clamp: a weak model routinely rests a tall hero slot so low its
  // bottom crosses into the subtitle band (the #2 defect). On the resting layout (before the
  // timeline builds), lift ONLY the slots that actually intrude — no coordinate-system remap, so
  // a scene that was already safe never moves. Mutates the slot wrapper's top (never the inner
  // element the timeline animates), and refuses to push a slot above the header zone.
  window.__safeZone = () => {
    // Only reserve the bottom subtitle band when captions are actually ON (config.enableSubtitles).
    // With subtitles off, content may use the lower frame — __margins still keeps a 6% bottom margin.
    if (!(S.captions && S.captions.length)) return;
    const frameH = (S.h || innerHeight);
    const z = (typeof S.zoom === 'number' && S.zoom > 0) ? S.zoom : 1;
    const limit = 0.80 * frameH;
    for (const slot of document.querySelectorAll('.hf-near .hf-slot')) {
      let guard = 24;
      while (guard-- > 0) {
        const r = slot.getBoundingClientRect();
        const over = (r.bottom / z) - limit;
        if (over <= 2) break;
        const curTop = parseFloat(slot.style.top);
        if (!Number.isFinite(curTop) || curTop <= 12) break; // never push into the top header zone
        const stepPct = Math.min(curTop - 12, (over / frameH) * 100 + 0.5);
        slot.style.top = (curTop - stepPct) + '%';
      }
    }
  };

  // Deterministic edge-margin clamp: keep every foreground slot's content box a comfortable gap
  // inside all four edges (6% sides, 7% top; the bottom is owned by __safeZone) so nothing ever
  // touches or bleeds off the frame — the fix for a headline/card the model anchored against an
  // edge. Shifts the slot wrapper's left/top % only (never the animated inner element); a box too
  // wide to fit either side is centred. Pure function of the static resting layout → determinism.
  window.__margins = () => {
    const z = (typeof S.zoom === 'number' && S.zoom > 0) ? S.zoom : 1;
    const frameW = (S.w || innerWidth), frameH = (S.h || innerHeight);
    const mL = 0.06 * frameW, mR = 0.94 * frameW, mT = 0.07 * frameH, mB = 0.94 * frameH, safeW = mR - mL;
    for (const slot of document.querySelectorAll('.hf-near .hf-slot')) {
      const hasL = Number.isFinite(parseFloat(slot.style.left));
      const hasT = Number.isFinite(parseFloat(slot.style.top));
      if (hasL) {
        const r = slot.getBoundingClientRect(), w = r.width / z, l = r.left / z, rt = r.right / z;
        if (w >= safeW - 2) slot.style.left = '50%'; // too wide for either margin → centre it (symmetric, minimal)
        else if (l < mL) slot.style.left = (parseFloat(slot.style.left) + ((mL - l) / frameW) * 100) + '%';
        else if (rt > mR) slot.style.left = (parseFloat(slot.style.left) - ((rt - mR) / frameW) * 100) + '%';
      }
      if (hasT) {
        const r2 = slot.getBoundingClientRect(), tp = r2.top / z, bt = r2.bottom / z;
        if (tp < mT) slot.style.top = (parseFloat(slot.style.top) + ((mT - tp) / frameH) * 100) + '%';
        else if (bt > mB) slot.style.top = (parseFloat(slot.style.top) - ((bt - mB) / frameH) * 100) + '%'; // 6% bottom margin (the subtitle band, when on, is reserved tighter by __safeZone)
      }
    }
  };

  // Deterministic de-overlap: a weak model routinely rests a kicker/label DIRECTLY over the
  // headline (the #1 defect). On the resting layout, separate any two colliding meaning-text
  // slots by lifting/lowering the SMALLER one away from the larger (headline stays put), clamped
  // to the safe area. Mutates slot wrappers only (never the animated inner element); a few bounded
  // passes so a chain of nudges settles. Pure function of the static DOM → determinism preserved.
  window.__deoverlap = () => {
    const z = (typeof S.zoom === 'number' && S.zoom > 0) ? S.zoom : 1;
    const frameH = (S.h || innerHeight);
    const SEL = '.hf-kw, .hf-kw2, .hf-sub, .hf-label, .hf-chip, .hf-stat, .hf-stat-l';
    const items = [];
    for (const el of document.querySelectorAll('.hf-near .hf-slot')) {
      if (!el.matches(SEL) && !el.querySelector(SEL)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      items.push({ el, area: r.width * r.height });
    }
    for (let pass = 0; pass < 4; pass++) {
      let moved = false;
      for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
        const a = items[i], b = items[j];
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const ra = a.el.getBoundingClientRect(), rb = b.el.getBoundingClientRect();
        const ix = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
        const iy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
        if (ix <= 2 || iy <= 2) continue; // not overlapping
        // push BOTH apart — the upper one up, the lower one down, half the overlap each — so a
        // huge (fit-grown) headline and a kicker still separate even when one is clamped at an edge.
        const upper = (ra.top + ra.bottom) <= (rb.top + rb.bottom) ? a : b;
        const lower = upper === a ? b : a;
        const half = ((((iy + 10) / z) / frameH) * 100) / 2;
        const tU = parseFloat(upper.el.style.top), tL = parseFloat(lower.el.style.top);
        if (Number.isFinite(tU)) { const n = Math.max(8, tU - half); if (Math.abs(n - tU) > 0.2) { upper.el.style.top = n + '%'; moved = true; } }
        if (Number.isFinite(tL)) { const n = Math.min(80, tL + half); if (Math.abs(n - tL) > 0.2) { lower.el.style.top = n + '%'; moved = true; } }
      }
      if (!moved) break;
    }
  };

  // ---- init + seek ----
  window.__init = async () => {
    // Force-load EVERY declared face — all families, weights AND unicode-range subsets.
    // fonts.ready only covers loads already TRIGGERED by rendered text; a subset/weight
    // first used mid-timeline (typeOn/scramble content, a caption cue with a new diacritic)
    // would otherwise load lazily and SWAP mid-video — the "wrong font for a beat" flash.
    try {
      if (document.fonts && document.fonts.forEach) {
        const loads = [];
        document.fonts.forEach((f) => { try { loads.push(f.load()); } catch(e){} });
        await Promise.allSettled(loads);
      }
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
    } catch(e){}
    // twice: once so __fitText measures real line boxes, once so the paint room matches the font
    // size __fitText settled on. The pass is idempotent by design — it stashes the originals.
    try { window.__fitVietnamese(); } catch(e){}
    try { window.__fitText(); } catch(e){}
    try { window.__fitVietnamese(); } catch(e){}
    try { window.__deoverlap(); } catch(e){}
    try { window.__safeZone(); } catch(e){}
    try { window.__margins(); } catch(e){}
    // GSAP template timeline: build AFTER fonts (SplitText measures glyphs) with seeded randomness.
    window.__tplErr = null;
    if (window.gsap && window.__tplScript) {
      try {
        Math.random = mulberry32(0x9E3779B9 ^ (S.seed|0));
        const tl = gsap.timeline({ paused: true });
        window.__tplScript(gsap, tl, S, mulberry32(4242 + (S.seed|0)));
        window.__tl = tl;
      } catch(e) {
        // keep a short stack tail: "X is not a function" alone is undebuggable — the stack's
        // <anonymous>:line:col points into the inline script where the bad call actually is
        var st = e && e.stack ? String(e.stack).split('\\n').slice(0,3).join(' | ').slice(0,300) : '';
        window.__tplErr = String(e && e.message || e) + (st ? ' @ ' + st : '');
      }
      try { gsap.globalTimeline.pause(); } catch(e){}
    }
    anims = document.getAnimations ? document.getAnimations({ subtree: true }) : [];
    for (const a of anims) { try { a.pause(); } catch(e){} }
    // P30 loud-font probe: after every declared face is loaded, any requested family that
    // still can't satisfy document.fonts.check() WILL render as a substitute — surface it.
    var fontMiss = [];
    try {
      (S.fontChecks || []).forEach(function(f){
        if (document.fonts && !document.fonts.check('16px "' + f + '"')) fontMiss.push(f);
      });
    } catch(e){}
    window.__fontMiss = fontMiss;
    window.__seek(0);
    return { n: anims.length, gsap: !!window.__tl, tplErr: window.__tplErr, fontMiss: fontMiss };
  };
  // Real-time → authored-timeline map. S.tplWarp ([[authored, real], ...] control points,
  // strictly increasing on both axes) pins each baked beat to the real moment its word is
  // spoken — per-word sync. Without a warp the map degrades to the plain tplScale ratio.
  window.__r2a = (t) => {
    const W = S.tplWarp;
    if (!W || W.length < 2) return t * (S.tplScale || 1);
    if (t <= W[0][1]) return W[0][0];
    for (let i = 1; i < W.length; i++) {
      if (t <= W[i][1]) {
        const a0 = W[i-1][0], r0 = W[i-1][1];
        return a0 + ((t - r0) / (W[i][1] - r0)) * (W[i][0] - a0);
      }
    }
    return W[W.length - 1][0]; // past the end: hold the authored endpoint
  };
  // authored end of the template timeline (== plannedDur under a warp/scale)
  window.__authoredDur = S.tplWarp && S.tplWarp.length ? S.tplWarp[S.tplWarp.length - 1][0] : S.duration * (S.tplScale || 1);
  // Local authored-per-real slope at real time t (the derivative of __r2a) — how compressed the
  // choreography is at that moment. Exposed so motion helpers can keep an entrance above a
  // real-time floor even under a piecewise beat-warp (mirror: timewarp.js slopeAt).
  window.__slopeAt = (t) => {
    const W = S.tplWarp;
    if (!W || W.length < 2) return (S.tplScale || 1);
    for (let i = 1; i < W.length; i++) {
      if (t <= W[i][1] || i === W.length - 1) {
        const dr = W[i][1] - W[i-1][1];
        return dr > 0 ? (W[i][0] - W[i-1][0]) / dr : (S.tplScale || 1);
      }
    }
    return (S.tplScale || 1);
  };
  window.__seek = (t) => {
    // Template layers (GSAP timeline + the spec's CSS/WAAPI animations) run in AUTHORED
    // timeline coordinates via __r2a. Captions/progress/background stay on REAL time —
    // they are built from the real voice timeline at page build.
    const st = window.__r2a(t);
    const ms = st*1000;
    for (const a of anims) { try { a.currentTime = ms; } catch(e){} }
    // suppressEvents MUST be false: onUpdate-driven content (FX.count/typeOn counters) is a
    // pure function of tl time, but suppressing events froze it at its initial value.
    if (window.__tl) { try { window.__tl.time(st, false); } catch(e){} }
    window.__drawBg(t); window.__drawCaption(t); window.__drawProgress(t);
    // Creative-library layers redraw LAST, after the timeline settled this frame's state, and
    // receive both clocks: real scene time and authored (warped) timeline time.
    window.__runSeekHooks(t, st);
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
.stage{position:absolute;inset:0;background:${ov ? KEY : `radial-gradient(ellipse at 50% 30%, ${theme.bg2} 0%, ${theme.bg} 60%, #05050a 100%)`}}
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

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
