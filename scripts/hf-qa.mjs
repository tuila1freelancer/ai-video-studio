// HyperFrame QA harness — renders a scene spec in headless Chrome and asserts the visual +
// timeline invariants a good motion-graphics scene must satisfy. Reusable: import { qaSpec }
// or run as CLI. Exits non-zero if any HARD defect is found.
//
//   node scripts/hf-qa.mjs [spec.json]         # audit one spec (default: canned SAMPLE_SPEC)
//   node scripts/hf-qa.mjs spec.json --det     # also run the 2× determinism check
//
// Hard defects: TPL_ERR (script threw), NO_ELEMENTS, FROZEN_TAIL (timeline ends >0.4s before DUR
//   → last beat freezes), OFFSCREEN (a visible element sits substantially outside the frame),
//   SUBTITLE_COLLISION (a visible foreground element sits in the bottom caption band),
//   NONDETERMINISTIC (--det only).
// Warnings: OVERSHOOT (timeline runs well past DUR), CROWDED (too many elements at once at t0),
//   START_NOT_EMPTY (screen not calm at scene open).
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { buildTemplate, makeCtx } from '../src/animation/templates.js';
import { SAMPLE_SPEC, normalizeGuide } from '../src/styleguide/index.js';
import { buildScenePage } from '../src/animation/harness.js';
import { themeFromGuide } from '../src/styleguide/index.js';
import { getBrowser, closeBrowser } from '../src/media/puppeteer.js';
import { PATHS, DIRS } from '../src/config/paths.js';

// Glyph-raster cache can flip a few pixels by ±1-2 between runs (PSNR>80dB) — that is not
// animation drift. Same tolerance the determinism suite uses.
const PSNR_OK = 70;
function psnr(a, b) {
  const pa = join(DIRS.tmp, 'hfqa_a.png'), pb = join(DIRS.tmp, 'hfqa_b.png');
  writeFileSync(pa, a); writeFileSync(pb, b);
  try {
    const r = spawnSync(PATHS.ffmpeg, ['-hide_banner', '-i', pa, '-i', pb, '-filter_complex', '[0][1]psnr', '-f', 'null', '-'], { encoding: 'utf8' });
    const m = String(r.stderr || '').match(/average:([\d.]+|inf)/);
    return m ? (m[1] === 'inf' ? Infinity : parseFloat(m[1])) : NaN;
  } finally { try { rmSync(pa); rmSync(pb); } catch { /* ignore */ } }
}

// In-page probe: after seek, list every rendered foreground element with effective opacity + bbox.
const PROBE = `(() => {
  function effOpacity(el){ let o=1, n=el; while(n && n!==document.body && n){ const s=getComputedStyle(n);
    if(s.display==='none'||s.visibility==='hidden') return 0; o*=parseFloat(s.opacity||'1'); n=n.parentElement; } return o; }
  const W=window.innerWidth, H=window.innerHeight;
  const cam=document.querySelector('.hf-cam'); if(!cam) return { W, H, els:[] };
  const out=[]; const seen=new Set();
  for(const el of cam.querySelectorAll('*')){
    if(seen.has(el)) continue; seen.add(el);
    const ownText=[...el.childNodes].some(n=>n.nodeType===3 && n.textContent.trim().length);
    const isIcon=el.classList.contains('hf-iconbox') || (el.tagName==='svg');
    if(!ownText && !isIcon) continue;
    if(el.closest('.hf-far')) continue; // background motif is allowed anywhere
    const o=effOpacity(el); if(o<=0.02) continue;
    const r=el.getBoundingClientRect();
    if(r.width<1 && r.height<1) continue;
    out.push({ o:+o.toFixed(3), x:Math.round(r.left), y:Math.round(r.top), w:Math.round(r.width), h:Math.round(r.height),
      cx:Math.round(r.left+r.width/2), cy:Math.round(r.top+r.height/2),
      tag:el.tagName.toLowerCase(), cls:(el.className&&el.className.baseVal!==undefined?el.className.baseVal:String(el.className||'')).slice(0,40),
      txt:(el.textContent||'').trim().slice(0,24) });
  }
  return { W, H, els:out };
})()`;

async function renderPage(spec, { w = 1080, h = 1920, duration = 6.2, seed = 3 } = {}) {
  const guide = normalizeGuide(spec.guide);
  const theme = themeFromGuide(guide);
  const ctx = makeCtx({ w, h, theme, seed, duration, idx: 2 });
  const tpl = buildTemplate('hyperframe', spec, ctx);
  return buildScenePage({
    w, h, theme, seed, duration, progressStart: 0, progressTotal: duration,
    template: tpl, captions: spec.__captions || [], watermark: null, captionStyle: {},
  });
}

export async function qaSpec(spec, { w = 1080, h = 1920, duration, beats, det = false, label = 'spec' } = {}) {
  const dur = duration || Math.max(1.5, (Array.isArray(beats) && beats.length ? beats[beats.length - 1].t1 + 0.8 : 6.2));
  const bts = Array.isArray(beats) ? beats : (Array.isArray(spec.beats) ? spec.beats : []);
  const html = await renderPage(spec, { w, h, duration: dur });
  const browser = await getBrowser();
  const page = await browser.newPage();
  const defects = [], warnings = [];
  try {
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'load', timeout: 30000 });
    const init = await page.evaluate(() => window.__init());
    if (init.tplErr) defects.push({ code: 'TPL_ERR', detail: init.tplErr });
    // timeline coverage
    const tlDur = await page.evaluate(() => (window.__tl ? window.__tl.totalDuration() : 0));
    if (!init.tplErr) {
      if (tlDur < dur - 0.4) defects.push({ code: 'FROZEN_TAIL', detail: `timeline ${tlDur.toFixed(2)}s < DUR ${dur.toFixed(2)}s (đóng băng cuối)` });
      if (tlDur > dur + 1.5) warnings.push({ code: 'OVERSHOOT', detail: `timeline ${tlDur.toFixed(2)}s > DUR ${dur.toFixed(2)}s` });
    }
    // sample times: scene open, each beat peak + gap, DUR tail
    const times = new Set([0.05, Math.max(0.1, dur * 0.5), dur - 0.12]);
    for (const b of bts) { times.add(+Math.min(dur - 0.05, b.t0 + 0.25).toFixed(2)); times.add(+Math.min(dur - 0.05, (b.t0 + b.t1) / 2).toFixed(2)); }
    const T = [...times].filter((t) => t >= 0 && t <= dur).sort((a, c) => a - c);

    let anyVisibleEver = false, maxAtOnce = 0;
    const offenders = { OFFSCREEN: [], SUBTITLE_COLLISION: [] };
    for (const t of T) {
      const { W, H, els } = await page.evaluate((tt, probe) => { window.__seek(tt); return eval(probe); }, t, PROBE);
      const vis = els.filter((e) => e.o > 0.15);
      if (vis.length) anyVisibleEver = true;
      maxAtOnce = Math.max(maxAtOnce, vis.length);
      for (const e of vis) {
        const outL = -e.x, outR = e.x + e.w - W, outT = -e.y, outB = e.y + e.h - H;
        const overflow = Math.max(outL, outR, outT, outB);
        if (overflow > 0.12 * Math.max(W, H)) offenders.OFFSCREEN.push({ t, ...e, overflow: Math.round(overflow) });
        if (e.cy > 0.82 * H) offenders.SUBTITLE_COLLISION.push({ t, ...e });
      }
      if (Math.abs(t - 0.05) < 0.001 && vis.filter((e) => e.o > 0.55).length > 3) {
        warnings.push({ code: 'START_NOT_EMPTY', detail: `${vis.filter((e) => e.o > 0.55).length} element hiện rõ ở t=0` });
      }
    }
    if (!anyVisibleEver && !init.tplErr) defects.push({ code: 'NO_ELEMENTS', detail: 'không element nào hiển thị suốt cảnh' });
    if (maxAtOnce > 6) warnings.push({ code: 'CROWDED', detail: `tối đa ${maxAtOnce} element cùng lúc` });
    // dedupe offenders to one representative each
    if (offenders.OFFSCREEN.length) { const o = offenders.OFFSCREEN[0]; defects.push({ code: 'OFFSCREEN', detail: `"${o.txt||o.cls}" tràn ${o.overflow}px @${o.t}s (bbox ${o.x},${o.y} ${o.w}x${o.h})`, count: offenders.OFFSCREEN.length }); }
    if (offenders.SUBTITLE_COLLISION.length) { const o = offenders.SUBTITLE_COLLISION[0]; defects.push({ code: 'SUBTITLE_COLLISION', detail: `"${o.txt||o.cls}" ở đáy (cy=${o.cy}/${h}) @${o.t}s — đè phụ đề`, count: offenders.SUBTITLE_COLLISION.length }); }

    if (det && !init.tplErr) {
      // Match the production renderer: fresh page, forward-only monotonic seeks (never reuse
      // `page`, which the layout sampling scrubbed backward — GSAP-owned transforms rewind, but
      // onUpdate-driven text does not, which would be a false positive here, not a render defect).
      const TS = [0.4, 1.2, 2.8, Math.min(dur - 0.2, 5.1)].sort((a2, b2) => a2 - b2);
      const freshShots = async () => {
        const p = await browser.newPage(); await p.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
        await p.setContent(html, { waitUntil: 'load' }); await p.evaluate(() => window.__init());
        const out = []; for (const t of TS) { await p.evaluate((tt) => window.__seek(tt), t); out.push(await p.screenshot({ type: 'png' })); }
        await p.close(); return out;
      };
      const a = await freshShots(), b = await freshShots();
      const worst = Math.min(...a.map((buf, i) => (Buffer.compare(buf, b[i]) === 0 ? Infinity : psnr(buf, b[i]))));
      if (worst < PSNR_OK) defects.push({ code: 'NONDETERMINISTIC', detail: `PSNR ${worst.toFixed(1)}dB < ${PSNR_OK}dB` });
    }
    return { label, ok: defects.length === 0, defects, warnings, tlDur: +tlDur.toFixed(2), dur: +dur.toFixed(2), sampled: T.length };
  } finally { await page.close().catch(() => {}); }
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv.find((a, i) => i >= 2 && !a.startsWith('--'));
  const det = process.argv.includes('--det');
  const spec = file ? JSON.parse(readFileSync(file, 'utf8')) : SAMPLE_SPEC;
  const r = await qaSpec(spec, { det, label: file || 'SAMPLE_SPEC' });
  await closeBrowser();
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.ok ? 0 : 1);
}
