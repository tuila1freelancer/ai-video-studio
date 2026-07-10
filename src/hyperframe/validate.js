// Headless render-validation for a HyperFrame spec. Runs the REAL scene page and checks the
// invariants a static syntax check can't: runtime script errors (calling a non-existent FX,
// undefined vars → __init throws → scene renders frozen/static), timeline coverage (frozen tail
// / overshoot past DUR), elements leaving the frame, and elements colliding with the caption band.
// No screenshots → fast (~1-2s), safe to run per-scene inside codegen's re-prompt loop.
import { buildTemplate, makeCtx } from '../animation/templates.js';
import { buildScenePage } from '../animation/harness.js';
import { themeFromGuide, normalizeGuide } from '../styleguide/index.js';
import { fold } from './beats.js';
import { getBrowser, chromeAvailable } from '../media/puppeteer.js';

// Diacritic-folded content words of the narration, for the invented/wrong-language text check.
function narrationWordSet(narration) {
  const t = (narration || '').trim();
  if (!t) return null;
  return new Set((fold(t).match(/[\p{L}\p{N}]+/gu) || []).filter((w) => w.length >= 2));
}
// True if the on-screen text is legitimately derived from the narration: any of its multi-letter
// words appears in the narration, OR it is purely numeric/symbolic (48%, ×10, →).
function textInNarration(txt, narrWords) {
  const words = (fold(txt || '').match(/[\p{L}]+/gu) || []).filter((w) => w.length >= 3);
  if (words.length < 2) return true; // single word / number / symbol — too little signal, don't flag
  return words.some((w) => narrWords.has(w));
}

// Lists every rendered foreground element (skips the background motif) with its effective
// opacity (product of ancestors) and bounding box, after a seek.
const PROBE = `(() => {
  function eff(el){ let o=1,n=el; while(n && n!==document.body && n){ const s=getComputedStyle(n);
    if(s.display==='none'||s.visibility==='hidden') return 0; o*=parseFloat(s.opacity||'1'); n=n.parentElement; } return o; }
  const W=innerWidth,H=innerHeight,cam=document.querySelector('.hf-cam'); if(!cam) return {W,H,els:[]};
  const out=[],seen=new Set();
  for(const el of cam.querySelectorAll('*')){ if(seen.has(el))continue; seen.add(el);
    const ownText=[...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim().length);
    const isIcon=el.classList.contains('hf-iconbox')||el.tagName==='svg';
    if(!ownText&&!isIcon)continue; if(el.closest('.hf-far'))continue;
    const o=eff(el); if(o<=0.02)continue; const r=el.getBoundingClientRect();
    if(r.width<1&&r.height<1)continue;
    out.push({o:+o.toFixed(3),x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height),
      cx:Math.round(r.left+r.width/2),cy:Math.round(r.top+r.height/2),
      cls:(el.className&&el.className.baseVal!==undefined?el.className.baseVal:String(el.className||'')).slice(0,32),
      txt:(el.textContent||'').trim().slice(0,22)}); }
  return {W,H,els:out};
})()`;

/**
 * @returns {ok, defects:[string], tlDur, skipped?} — defects are phrased as instructions the
 *   LLM can act on when re-prompted.
 */
export async function renderValidate({ spec, guide, w = 1080, h = 1920, duration = 6, beats = [], narration = '' }) {
  if (!chromeAvailable()) return { ok: true, skipped: true, defects: [] };
  const dur = Math.max(1.5, duration);
  const g = normalizeGuide(guide || spec.guide);
  const theme = themeFromGuide(g);
  const ctx = makeCtx({ w, h, theme, seed: 3, duration: dur, idx: 2 });
  const tpl = buildTemplate('hyperframe', { ...spec, guide: g }, ctx);
  const html = buildScenePage({
    w, h, theme, seed: 3, duration: dur, progressStart: 0, progressTotal: dur,
    template: tpl, captions: [], watermark: null, captionStyle: {},
  });
  const browser = await getBrowser();
  const page = await browser.newPage();
  const defects = [];
  try {
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'load', timeout: 20000 });
    const init = await page.evaluate(() => window.__init());
    if (init.tplErr) {
      defects.push(`your script threw at runtime: "${init.tplErr}". Only use documented FX.* helpers and tl.* methods; do not reference undefined variables or functions.`);
      return { ok: false, defects };
    }
    const tlDur = await page.evaluate(() => (window.__tl ? window.__tl.totalDuration() : 0));
    // An infinite timeline (a repeat:-1 loop) has totalDuration = Infinity — it renders fine over
    // 0..DUR (motion never freezes, nothing important lives past DUR), so skip the coverage checks.
    // Only flag EGREGIOUS overshoot (well past DUR) — a weak model can't compress a mild overshoot
    // and the real harm (a weak/empty ending) is detected directly below. Padded-tail timelines
    // report totalDuration past DUR but still end weak, which the ending check catches.
    if (Number.isFinite(tlDur) && tlDur > dur + Math.max(1.5, dur * 0.4)) {
      defects.push(`the animation runs to ${tlDur.toFixed(1)}s, far past DUR=${dur.toFixed(1)}s — the climax lands outside the rendered window. Compress everything so the LAST tween ends at ≈${dur.toFixed(1)}s.`);
    }

    // sample scene-open, each beat's ENTRANCE (t0) + peak + gap, and the tail
    const endT = +(dur - 0.1).toFixed(2);
    const times = new Set([0.05, +(dur * 0.5).toFixed(2), endT]);
    for (const b of beats) {
      times.add(+Math.min(dur - 0.05, b.t0).toFixed(2));
      times.add(+Math.min(dur - 0.05, b.t0 + 0.25).toFixed(2));
      times.add(+Math.min(dur - 0.05, (b.t0 + b.t1) / 2).toFixed(2));
    }
    const T = [...times].filter((t) => t >= 0 && t <= dur).sort((a, c) => a - c);
    const narrWords = narrationWordSet(narration);
    let anyVisible = false, endStrong = false, heroFrac = 0; const off = [], sub = [], bad = new Map();
    for (const t of T) {
      const { W, H, els } = await page.evaluate((tt, probe) => { window.__seek(tt); return eval(probe); }, t, PROBE);
      const vis = els.filter((e) => e.o > 0.15);
      if (vis.length) anyVisible = true;
      for (const e of vis) heroFrac = Math.max(heroFrac, e.w / W);
      // a scene must not fade to (near) nothing at the end — the last frame should still carry a hero
      if (t >= endT - 0.001 && els.some((e) => e.o > 0.35 && e.w > 0.06 * W)) endStrong = true;
      for (const e of vis) {
        const overflow = Math.max(-e.x, e.x + e.w - W, -e.y, e.y + e.h - H);
        if (overflow > 0.10 * Math.max(W, H)) off.push({ t, ...e, overflow: Math.round(overflow) });
        if (e.y + e.h > 0.80 * H) sub.push({ t, ...e }); // element BOTTOM edge intrudes on the caption band
        if (narrWords && /hf-kw/.test(e.cls || '') && !textInNarration(e.txt, narrWords)) bad.set(e.txt, e);
      }
    }
    if (!anyVisible) defects.push('no element is ever visible — the scene renders empty. Make each beat element visible during its window.');
    else if (!endStrong) defects.push(`the scene ends nearly empty (nothing prominent is on screen at ${endT.toFixed(1)}s) — keep the final keyword (or a climax element) clearly visible through the last second so the ending lands.`);
    // timid composition is a quality defect (cosmetic): the hero must dominate the frame
    if (anyVisible && heroFrac > 0 && heroFrac < 0.42) {
      defects.push(`the scene reads timid — the widest element ever visible spans only ${Math.round(heroFrac * 100)}% of the frame width. Scale the hero element up to DOMINATE (~55-75% of the width): bigger type, bigger main graphic.`);
    }
    if (off.length) { const o = off[0]; defects.push(`element "${o.txt || o.cls}" runs ${o.overflow}px off-screen at ${o.t.toFixed(1)}s — keep all content inside the frame with a 6% margin; shrink font-size or reposition.`); }
    if (sub.length) { const o = sub[0]; defects.push(`element "${o.txt || o.cls}" reaches the bottom of the frame at ${o.t.toFixed(1)}s — the bottom 22% is reserved for subtitles, move it up.`); }
    if (bad.size) { const o = [...bad.values()][0]; defects.push(`the on-screen text "${o.txt}" is not in the narration — every keyword must be taken verbatim from the narration and be in its language. Do not invent or translate text.`); }
    return { ok: defects.length === 0, defects, tlDur: Number.isFinite(tlDur) ? +tlDur.toFixed(2) : null };
  } catch (e) {
    return { ok: true, skipped: true, defects: [], error: String(e.message || e) }; // never block codegen on a harness hiccup
  } finally { await page.close().catch(() => {}); }
}
