// Headless render-validation for a HyperFrame spec. Runs the REAL scene page and checks the
// invariants a static syntax check can't: runtime script errors (calling a non-existent FX,
// undefined vars → __init throws → scene renders frozen/static), timeline coverage (frozen tail
// / overshoot past DUR), elements leaving the frame, and elements colliding with the caption band.
// No screenshots → fast (~1-2s), safe to run per-scene inside codegen's re-prompt loop.
import { buildTemplate, makeCtx } from '../animation/templates.js';
import { buildScenePage } from '../animation/harness.js';
import { themeFromGuide, normalizeGuide } from '../styleguide/index.js';
import { fold } from './beats.js';
import { detectLang } from '../util/lang.js';
import { getBrowser, chromeAvailable } from '../media/puppeteer.js';

// Diacritic-folded content words of the narration, for the wrong-language text check.
function narrationWordSet(narration) {
  const t = (narration || '').trim();
  if (!t) return null;
  return new Set((fold(t).match(/[\p{L}\p{N}]+/gu) || []).filter((w) => w.length >= 2));
}
// The prompt asks the model to pick on-screen text SEMANTICALLY (not verbatim from the voice
// line), so "not in the narration" alone is NOT a defect. What IS a defect is a LANGUAGE leak:
// e.g. an English display headline in a Vietnamese-narrated video. Flag only when the text is
// multi-word, shares no word with the narration, AND reads as a different language.
function textLanguageLeak(txt, narrWords, narrLang) {
  const words = (fold(txt || '').match(/[\p{L}]+/gu) || []).filter((w) => w.length >= 3);
  if (words.length < 2) return false; // single word / number / symbol — too little signal
  if (words.some((w) => narrWords.has(w))) return false; // derived from the narration — fine
  return detectLang(txt) !== narrLang; // semantic same-language headline — fine; leak — defect
}

// Pure geometry/color helpers — mirrored inside PROBE (which runs as a page string) and
// exported so the thresholds stay unit-testable without a browser.
export function overlapFrac(a, b) {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const minA = Math.min(a.w * a.h, b.w * b.h);
  return minA > 0 ? (ix * iy) / minA : 0;
}
export function contrastRatio([r1, g1, b1], [r2, g2, b2]) {
  const lum = (r, g, b) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const L1 = lum(r1, g1, b1), L2 = lum(r2, g2, b2);
  return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
}

// Lists every rendered foreground element (skips the background motif) with its effective
// opacity (product of ancestors) and bounding box, after a seek — plus text-vs-text overlap
// pairs (DOM-containment aware, so a label inside its own card never counts) and
// low-contrast readable text (vs the nearest SOLID ancestor background; conservative
// threshold because glass panels/gradients dilute the measurement).
const PROBE = `(() => {
  function eff(el){ let o=1,n=el; while(n && n!==document.body && n){ const s=getComputedStyle(n);
    if(s.display==='none'||s.visibility==='hidden') return 0; o*=parseFloat(s.opacity||'1'); n=n.parentElement; } return o; }
  const W=innerWidth,H=innerHeight,cam=document.querySelector('.hf-cam'); if(!cam) return {W,H,els:[],overlaps:[],lowContrast:[]};
  const out=[],nodes=[],seen=new Set();
  for(const el of cam.querySelectorAll('*')){ if(seen.has(el))continue; seen.add(el);
    const ownText=[...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim().length);
    const isIcon=el.classList.contains('hf-iconbox')||el.tagName==='svg';
    if(!ownText&&!isIcon)continue; if(el.closest('.hf-far'))continue;
    const o=eff(el); if(o<=0.02)continue; const r=el.getBoundingClientRect();
    if(r.width<1&&r.height<1)continue;
    out.push({o:+o.toFixed(3),x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height),
      cx:Math.round(r.left+r.width/2),cy:Math.round(r.top+r.height/2),
      clip:(function(){ if(!ownText||o<=0.35||el.clientWidth<=0) return 0; const cs=getComputedStyle(el);
        const hides=cs.overflowX==='hidden'||cs.overflowY==='hidden'||cs.overflow==='hidden'||cs.textOverflow==='ellipsis';
        if(!hides) return 0; // overflow:visible text PAINTS outside — off-screen/overlap checks own that
        return (el.scrollWidth-el.clientWidth>3||el.scrollHeight-el.clientHeight>3)?1:0; })(),
      cls:(el.className&&el.className.baseVal!==undefined?el.className.baseVal:String(el.className||'')).slice(0,32),
      txt:(el.textContent||'').trim().slice(0,22)});
    nodes.push({el,ownText,o,r}); }
  const txts=nodes.filter(n=>n.ownText&&n.o>0.35&&n.r.width>8&&n.r.height>8);
  const overlaps=[];
  for(let i=0;i<txts.length;i++)for(let j=i+1;j<txts.length;j++){
    const a=txts[i],b=txts[j];
    if(a.el.contains(b.el)||b.el.contains(a.el))continue;
    const ix=Math.max(0,Math.min(a.r.right,b.r.right)-Math.max(a.r.left,b.r.left));
    const iy=Math.max(0,Math.min(a.r.bottom,b.r.bottom)-Math.max(a.r.top,b.r.top));
    const minA=Math.min(a.r.width*a.r.height,b.r.width*b.r.height);
    if(minA>0&&(ix*iy)/minA>0.30) overlaps.push({a:(a.el.textContent||'').trim().slice(0,20),
      b:(b.el.textContent||'').trim().slice(0,20),frac:+(((ix*iy)/minA)).toFixed(2)}); }
  function bgOf(el){ let n=el; while(n&&n!==document.documentElement){ const c=getComputedStyle(n).backgroundColor;
    if(c&&c!=='transparent'&&!/rgba\\((?:\\d+, ){2}\\d+, 0\\)/.test(c)) return c; n=n.parentElement; }
    return getComputedStyle(document.body).backgroundColor; }
  function lum(c){ const m=(c.match(/[\\d.]+/g)||[0,0,0]).map(Number);
    const f=v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)};
    return 0.2126*f(m[0])+0.7152*f(m[1])+0.0722*f(m[2]); }
  const lowContrast=[];
  for(const n of txts){ if(n.o<0.5)continue;
    const cs=getComputedStyle(n.el);
    // gradient-filled (background-clip:text) and stroked treatments render color:transparent
    // on purpose — measuring their computed color would be a guaranteed false positive
    if((cs.webkitBackgroundClip||cs.backgroundClip)==='text')continue;
    if(parseFloat(cs.webkitTextStrokeWidth||'0')>0)continue;
    const cm=cs.color.match(/[\\d.]+/g)||[];
    if(cm.length>3&&parseFloat(cm[3])<0.99)continue;
    const L1=lum(cs.color),L2=lum(bgOf(n.el));
    const ratio=(Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05);
    if(ratio<2.2) lowContrast.push({txt:(n.el.textContent||'').trim().slice(0,20),ratio:+ratio.toFixed(2)}); }
  return {W,H,els:out,overlaps,lowContrast};
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
    // gap centers between consecutive beats (and after the last beat): the exact places a
    // scene goes dead when every beat FLASH-exits and the next one is late
    const sb = [...beats].sort((a, c) => (a.t0 || 0) - (c.t0 || 0));
    const gapTimes = new Set([+(dur * 0.5).toFixed(2)]);
    for (let i = 0; i < sb.length; i++) {
      const nextStart = i + 1 < sb.length ? sb[i + 1].t0 : dur;
      const gapMid = ((sb[i].t1 || 0) + nextStart) / 2;
      if (gapMid > sb[i].t1 && gapMid < nextStart) {
        const gt = +Math.min(dur - 0.05, gapMid).toFixed(2);
        times.add(gt); gapTimes.add(gt);
      }
    }
    const T = [...times].filter((t) => t >= 0 && t <= dur).sort((a, c) => a - c);
    const narrWords = narrationWordSet(narration);
    const narrLang = detectLang(narration || '');
    let anyVisible = false, endStrong = false, heroFrac = 0, deadAt = null;
    const off = [], sub = [], bad = new Map(), ovl = new Map(), lowc = new Map(), clip = new Map();
    for (const t of T) {
      const { W, H, els, overlaps = [], lowContrast = [] } = await page.evaluate((tt, probe) => { window.__seek(tt); return eval(probe); }, t, PROBE);
      for (const p of overlaps) { const k = `${p.a}|${p.b}`; if (!ovl.has(k)) ovl.set(k, { t, ...p }); }
      for (const p of lowContrast) { if (!lowc.has(p.txt)) lowc.set(p.txt, { t, ...p }); }
      const vis = els.filter((e) => e.o > 0.15);
      if (vis.length) anyVisible = true;
      // mid-scene deadness: judged ONLY between beats (gap centers) — sampling an entrance
      // moment would contradict the slow-pacing contract (0.5–0.9s eases). After the first
      // entrance window (1.2s), SOMETHING substantial or visibly entering must be on screen.
      if (deadAt == null && gapTimes.has(t) && t > 1.2 && t < dur - 0.3
        && !els.some((e) => e.o >= 0.25 && e.w * e.h >= 0.015 * W * H)) deadAt = t;
      for (const e of vis) heroFrac = Math.max(heroFrac, e.w / W);
      // a scene must not fade to (near) nothing at the end — the last frame should still carry a hero
      if (t >= endT - 0.001 && els.some((e) => e.o > 0.35 && e.w > 0.06 * W)) endStrong = true;
      for (const e of vis) {
        if (e.clip && !clip.has(e.txt)) clip.set(e.txt, { t, ...e });
        const overflow = Math.max(-e.x, e.x + e.w - W, -e.y, e.y + e.h - H);
        if (overflow > 0.10 * Math.max(W, H)) off.push({ t, ...e, overflow: Math.round(overflow) });
        if (e.y + e.h > 0.80 * H) sub.push({ t, ...e }); // element BOTTOM edge intrudes on the caption band
        if (narrWords && /hf-kw/.test(e.cls || '') && textLanguageLeak(e.txt, narrWords, narrLang)) bad.set(e.txt, e);
      }
    }
    if (!anyVisible) defects.push('no element is ever visible — the scene renders empty. Make each beat element visible during its window.');
    else if (deadAt != null) defects.push(`the frame goes empty at ${deadAt.toFixed(1)}s mid-scene — nothing substantial is on screen between beats. Keep the composition alive: give earlier BUILD elements out:'settle' (they stay dimmed) or hold the previous element until the next one enters; the screen must never drop back to bare decor mid-scene.`);
    else if (!endStrong) defects.push(`the scene ends nearly empty (nothing prominent is on screen at ${endT.toFixed(1)}s) — keep the final keyword (or a climax element) clearly visible through the last second so the ending lands.`);
    // timid composition is a quality defect (cosmetic): the hero must dominate the frame
    if (anyVisible && heroFrac > 0 && heroFrac < 0.42) {
      defects.push(`the scene reads timid — the widest element ever visible spans only ${Math.round(heroFrac * 100)}% of the frame width. Scale the hero element up to DOMINATE (~55-75% of the width): bigger type, bigger main graphic.`);
    }
    if (off.length) { const o = off[0]; defects.push(`element "${o.txt || o.cls}" runs ${o.overflow}px off-screen at ${o.t.toFixed(1)}s — keep all content inside the frame with a 6% margin; shrink font-size or reposition.`); }
    if (sub.length) { const o = sub[0]; defects.push(`element "${o.txt || o.cls}" reaches the bottom of the frame at ${o.t.toFixed(1)}s — the bottom 22% is reserved for subtitles, move it up.`); }
    if (bad.size) { const o = [...bad.values()][0]; defects.push(`the on-screen text "${o.txt}" is in the wrong language — the narration is ${narrLang === 'vi' ? 'Vietnamese' : narrLang}, and every keyword must be in the narration's language. Semantic (non-verbatim) keywords are fine; translating or mixing languages is not.`); }
    if (ovl.size) { const o = [...ovl.values()][0]; defects.push(`the texts "${o.a}" and "${o.b}" overlap each other at ${o.t.toFixed(1)}s (${Math.round(o.frac * 100)}% of the smaller box) — text must NEVER sit on top of other text; separate them spatially or stagger their timing so only one occupies that area at a time.`); }
    if (lowc.size) { const o = [...lowc.values()][0]; defects.push(`the text "${o.txt}" is unreadable at ${o.t.toFixed(1)}s — contrast ratio ${o.ratio}:1 against its background. Use the guide's ink color (or a bright accent) so readable text reaches at least 4.5:1.`); }
    if (clip.size) { const o = [...clip.values()][0]; defects.push(`the text "${o.txt}" is clipped at ${o.t.toFixed(1)}s — its box is smaller than its content, cutting words off. Remove fixed widths/heights and overflow:hidden from text elements; shorten the label or let the element size itself.`); }
    return { ok: defects.length === 0, defects, tlDur: Number.isFinite(tlDur) ? +tlDur.toFixed(2) : null };
  } catch (e) {
    return { ok: true, skipped: true, defects: [], error: String(e.message || e) }; // never block codegen on a harness hiccup
  } finally { await page.close().catch(() => {}); }
}
