// Headless render-validation for a HyperFrame spec. Runs the REAL scene page and checks the
// invariants a static syntax check can't: runtime script errors (calling a non-existent FX,
// undefined vars → __init throws → scene renders frozen/static), timeline coverage (frozen tail
// / overshoot past DUR), elements leaving the frame, and elements colliding with the caption band.
// No screenshots → fast (~1-2s), safe to run per-scene inside codegen's re-prompt loop.
import { buildTemplate, makeCtx } from '../animation/templates.js';
import { buildScenePage } from '../animation/harness.js';
import { themeFromGuide, normalizeGuide } from '../styleguide/index.js';
import { fold, labelIsFragment } from './beats.js';
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
  if (words.length < 2) {
    // single-word English DECOR on a non-English video ("ENTER", "EXECUTE", "SCANNING") —
    // judged on the RAW text: it must be pure ASCII ≥4 letters BEFORE folding (a Vietnamese
    // word like "TƯỞNG" folds to ascii but is NOT English decor) and absent from the
    // narration. Short acronyms (AI, GPT) stay allowed.
    if (narrLang !== 'en' && words.length === 1) {
      const raw = String(txt || '').replace(/[^\p{L}]/gu, '');
      return /^[A-Za-z]{4,}$/.test(raw) && !narrWords.has(fold(raw));
    }
    return false; // number / symbol — too little signal
  }
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
// Telemetry-junk pattern (mirrors the parity audit): snake_case tokens, code calls,
// file suffixes — leftover dev text that must never appear on screen.
const JUNK_RE = /\b[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+\b|\b[a-z_][\w]*(?:\.[a-z_][\w]*)+\s*\([^)]*\)|\b[\w-]+\.(?:exe|sh|js|ts|py|json|dll|bat|cfg|log|sys)\b/;

// Persistence tiering (ported from HyperFrames' layout audit): a geometry finding seen at
// only ONE sampled time is an entrance/exit transient (slow 0.5–0.9s eases sweep through
// odd states by design) — ignored; held across ≥2 samples (≈≥500ms on our grid) it is real.
export function heldAcrossSamples(entry) { return (entry?.n || 0) >= 2; }

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
  // decor: painted non-text elements (rings, ghost glyph boxes, cards, tracks) — they carry
  // real visual presence, so mid-scene deadness must count them (prompt v5 mandates them)
  let decorArea=0, centerCover=0;
  const cb={x:W*0.25,y:H*0.25,w:W*0.5,h:H*0.5};
  for(const el of cam.querySelectorAll('div,section,figure')){
    if(el.closest('.hf-far'))continue;
    const s=getComputedStyle(el);
    const painted=(s.backgroundColor&&!/rgba\\((?:\\d+, ){2}\\d+, 0\\)/.test(s.backgroundColor)&&s.backgroundColor!=='transparent')
      ||(s.backgroundImage&&s.backgroundImage!=='none')||(parseFloat(s.borderTopWidth)>0&&s.borderTopStyle!=='none');
    if(!painted)continue;
    const o=eff(el); if(o<0.12)continue;
    const r=el.getBoundingClientRect();
    if(r.width*r.height>=0.02*W*H&&r.left<W&&r.right>0&&r.top<H&&r.bottom>0) decorArea+=Math.min(r.width*r.height,0.2*W*H);
    // overlay gate input: how much of the CENTER window is blocked by solid-ish paint
    const am=(s.backgroundColor||'').match(/rgba?\\(([^)]+)\\)/);
    const alpha=am?(am[1].split(',').length>3?parseFloat(am[1].split(',')[3]):1):(s.backgroundImage!=='none'?0.6:0);
    if(o*alpha>0.45){
      const ix=Math.max(0,Math.min(r.right,cb.x+cb.w)-Math.max(r.left,cb.x));
      const iy=Math.max(0,Math.min(r.bottom,cb.y+cb.h)-Math.max(r.top,cb.y));
      centerCover+=ix*iy/(cb.w*cb.h);
    }
  }
  centerCover=Math.min(1,centerCover);
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
      txt:(el.textContent||'').trim().slice(0,40)});
    nodes.push({el,ownText,o,r}); }
  // readable text only: element opacity AND text-colour alpha must be substantial — a watermark
  // faded via rgba(...,.05) is decor, not readable text, so it must not count as an overlap.
  const txts=nodes.filter(n=>{ if(!(n.ownText&&n.o>0.35&&n.r.width>8&&n.r.height>8))return false;
    const cm=(getComputedStyle(n.el).color.match(/[\\d.]+/g)||[]); return !(cm.length>3&&parseFloat(cm[3])<0.4); });
  const overlaps=[];
  for(let i=0;i<txts.length;i++)for(let j=i+1;j<txts.length;j++){
    const a=txts[i],b=txts[j];
    if(a.el.contains(b.el)||b.el.contains(a.el))continue;
    // FX.splitIn wraps each glyph in a sibling span; mid-cascade those single-char siblings
    // transiently stack ("T"/"H") — a choreography artifact, not a real collision. Skip them.
    if(a.el.parentElement&&a.el.parentElement===b.el.parentElement&&(a.el.textContent||'').trim().length<=1&&(b.el.textContent||'').trim().length<=1)continue;
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
    if(ratio<2.2) lowContrast.push({txt:(n.el.textContent||'').trim().slice(0,20),ratio:+ratio.toFixed(2),
      id:n.el.id||'', cls:((n.el.className&&n.el.className.baseVal!==undefined?n.el.className.baseVal:String(n.el.className||'')).trim().split(/\\s+/)[0]||'')}); }
  // text occlusion: readable text with an OPAQUE non-related element painted on top of it.
  // elementsFromPoint walks the paint stack top-down; harness overlays (vignette/grain, outside
  // .hf-cam) are skipped, glass panels (low-alpha backgrounds) don't count as cover.
  const occluded=[];
  for(const n of txts){ if(n.o<0.5)continue; const r=n.r;
    const pts=[[r.left+r.width/2,r.top+r.height/2],[r.left+r.width*0.2,r.top+r.height/2],
      [r.left+r.width*0.8,r.top+r.height/2],[r.left+r.width/2,r.top+r.height*0.25],[r.left+r.width/2,r.top+r.height*0.75]];
    let cov=0, coverBy='';
    for(const pt of pts){ const px=pt[0],py=pt[1];
      if(px<0||py<0||px>=W||py>=H)continue;
      const stack=document.elementsFromPoint(px,py);
      for(const hit of stack){
        if(hit===n.el||n.el.contains(hit)||hit.contains(n.el))break; // reached self/own chain first — not covered here
        if(!cam.contains(hit))continue; // harness overlay layers never count
        const hs=getComputedStyle(hit);
        const am=(hs.backgroundColor||'').match(/rgba?\\(([^)]+)\\)/);
        const alpha=am?(am[1].split(',').length>3?parseFloat(am[1].split(',')[3]):1):0;
        const opaque=alpha>0.85||hit.tagName==='IMG'||hit.tagName==='CANVAS';
        if(opaque&&eff(hit)>0.5){ cov++;
          coverBy=String(hit.className&&hit.className.baseVal!==undefined?hit.className.baseVal:hit.className||hit.tagName).slice(0,24); }
        break; // only the topmost relevant element decides this probe point
      } }
    if(cov>=3) occluded.push({txt:(n.el.textContent||'').trim().slice(0,20),by:coverBy}); }
  // hero-instrument density (reference caliber): the biggest crafted cluster's part count —
  // a slot/container holding many visible text/painted/svg children. Mirrors the parity
  // checklist's (b) so the codegen loop can be re-asked toward the 8-20-part doctrine.
  let heroParts=0;
  for(const el of cam.querySelectorAll('div,section,figure')){
    if(el.closest('.hf-far'))continue;
    const r=el.getBoundingClientRect(); const area=r.width*r.height;
    const isSlot=/hf-slot|hf-center/.test(String(el.className||''));
    if(area<(isSlot?0.02:0.06)*W*H||area>0.92*W*H||el.children.length<2)continue;
    if(eff(el)<0.12)continue;
    let parts=0;
    for(const d of el.querySelectorAll('*')){
      const ds=getComputedStyle(d); if(ds.display==='none')continue;
      const dr=d.getBoundingClientRect(); if(dr.width<3||dr.height<2)continue;
      const dText=[...d.childNodes].some(n2=>n2.nodeType===3&&n2.textContent.trim());
      const dPaint=(ds.backgroundColor&&ds.backgroundColor!=='transparent'&&!/rgba\\((?:\\d+, ){2}\\d+, 0\\)/.test(ds.backgroundColor))
        ||(ds.backgroundImage&&ds.backgroundImage!=='none')||(parseFloat(ds.borderTopWidth)>0&&ds.borderTopStyle!=='none')
        ||['PATH','RECT','CIRCLE','LINE','POLYGON','ELLIPSE'].includes(d.tagName.toUpperCase());
      if(dText||dPaint)parts++;
    }
    if(parts>heroParts)heroParts=parts;
  }
  // primary-type treatment: the biggest readable text must carry chrome/neon/stroke — flat = cheap
  let primary=null;
  for(const n of txts){ if(n.o<0.4)continue; const fs=parseFloat(getComputedStyle(n.el).fontSize)||0;
    if(!primary||fs>primary.fs){ const cs=getComputedStyle(n.el);
      const grad=(cs.webkitBackgroundClip==='text'||cs.backgroundClip==='text');
      const stroke=parseFloat(cs.webkitTextStrokeWidth||'0')>0;
      const sh=cs.textShadow&&cs.textShadow!=='none';
      primary={fs,grad,stroke,sh,txt:(n.el.textContent||'').trim().slice(0,20)}; } }
  return {W,H,els:out,overlaps,lowContrast,occluded,decorArea:+(decorArea/(W*H)).toFixed(4),centerCover:+centerCover.toFixed(3),heroParts,primary};
})()`;

/**
 * @returns {ok, defects:[string], tlDur, skipped?} — defects are phrased as instructions the
 *   LLM can act on when re-prompted.
 */
export async function renderValidate({ spec, guide, w = 1080, h = 1920, duration = 6, beats = [], narration = '', captionsOn = true, overlay = false, caliber = true }) {
  if (!chromeAvailable()) return { ok: true, skipped: true, defects: [] };
  const dur = Math.max(1.5, duration);
  const g = normalizeGuide(guide || spec.guide);
  const theme = themeFromGuide(g);
  const ctx = makeCtx({ w, h, theme, seed: 3, duration: dur, idx: 2 });
  const tpl = buildTemplate('hyperframe', { ...spec, guide: g, ...(overlay ? { overlay: true } : {}) }, ctx);
  const html = buildScenePage({
    w, h, theme, seed: 3, duration: dur, progressStart: 0, progressTotal: dur,
    template: tpl, captions: [], watermark: null, captionStyle: {},
    overlay: overlay ? {} : null,
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
    // beat adherence sampling: a snapshot just BEFORE each beat's t0 and one after its
    // entrance window — compared post-loop to verify the beat produced a visual response.
    // Folded into the one ascending seek pass (backward scrubs are less trustworthy).
    const checkable = sb.filter((b) => (b.t0 || 0) >= 0.35 && b.t0 <= dur - 0.5).slice(0, 6);
    const beatPairs = [];
    for (const b of checkable) {
      const tp = +Math.max(0.05, b.t0 - 0.05).toFixed(2);
      const tq = +Math.min(dur - 0.05, b.t0 + 0.45).toFixed(2);
      if (tq > tp) { beatPairs.push({ tp, tq, t0: b.t0 }); times.add(tp); times.add(tq); }
    }
    const T = [...times].filter((t) => t >= 0 && t <= dur).sort((a, c) => a - c);
    const narrWords = narrationWordSet(narration);
    const narrLang = detectLang(narration || '');
    let anyVisible = false, endStrong = false, heroFrac = 0, unionFrac = 0, deadAt = null, maxTextH = 0;
    // Every geometry accumulator carries an occurrence count `n` — persistence tiering
    // (heldAcrossSamples) later drops one-sample transients instead of re-asking on them.
    const off = new Map(), sub = new Map(), bad = new Map(), ovl = new Map(), lowc = new Map(), clip = new Map(), occ = new Map(), frag = new Map(), junk = new Map();
    const snaps = new Map();
    const pairTimes = new Set(beatPairs.flatMap((p) => [p.tp, p.tq]));
    const bump = (map, k, data) => {
      const cur = map.get(k);
      if (cur) cur.n++;
      else map.set(k, { ...data, n: 1 });
    };
    let maxCenterCover = 0, maxHeroParts = 0, primaryInfo = null;
    for (const t of T) {
      const { W, H, els, overlaps = [], lowContrast = [], occluded = [], decorArea = 0, centerCover = 0, heroParts = 0, primary = null } = await page.evaluate((tt, probe) => { window.__seek(tt); return eval(probe); }, t, PROBE);
      maxCenterCover = Math.max(maxCenterCover, centerCover);
      maxHeroParts = Math.max(maxHeroParts, heroParts);
      if (primary && (!primaryInfo || primary.fs > primaryInfo.fs)) primaryInfo = primary;
      if (pairTimes.has(t)) snaps.set(t, els);
      for (const p of overlaps) bump(ovl, `${p.a}|${p.b}`, { t, ...p });
      for (const p of lowContrast) bump(lowc, p.txt, { t, ...p });
      for (const p of occluded) bump(occ, p.txt, { t, ...p });
      const vis = els.filter((e) => e.o > 0.15);
      if (vis.length) anyVisible = true;
      // mid-scene deadness: judged ONLY between beats (gap centers) — sampling an entrance
      // moment would contradict the slow-pacing contract (0.5–0.9s eases). After the first
      // entrance window, SOMETHING substantial must be on screen: a meaning element OR the
      // living mid-layer decor prompt v5 mandates (rings/ghost glyphs are real presence).
      if (deadAt == null && !overlay && gapTimes.has(t) && t > 1.4 && t < dur - 0.3
        && decorArea < 0.03
        && !els.some((e) => e.o >= 0.25 && e.w * e.h >= 0.015 * W * H)) deadAt = t;
      for (const e of vis) heroFrac = Math.max(heroFrac, e.w / W);
      // combined horizontal coverage (merged x-intervals): a split composition (object one
      // side, text column the other) fills the frame without any single dominant element
      const iv = vis.filter((e) => e.o > 0.35).map((e) => [Math.max(0, e.x), Math.min(W, e.x + e.w)])
        .filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
      let cov = 0, curA = -1, curB = -1;
      for (const [a, b] of iv) {
        if (a > curB) { cov += Math.max(0, curB - curA); curA = a; curB = b; }
        else curB = Math.max(curB, b);
      }
      cov += Math.max(0, curB - curA);
      unionFrac = Math.max(unionFrac, cov / W);
      // a scene must not fade to (near) nothing at the end — the last frame should still carry a hero
      for (const e of els) if (e.o > 0.35 && e.h > maxTextH) maxTextH = e.h;
      // climax doctrine: the ending must carry a PROMINENT element — a text at ≥70% of the
      // scene's own biggest type, or a large graphic. A shrunken afterthought is a weak
      // ending the codegen loop should fix, not ship.
      if (t >= endT - 0.001 && els.some((e) => e.o > 0.35
        && (e.w > 0.06 * W && (maxTextH === 0 || e.h >= 0.7 * maxTextH || e.w * e.h >= 0.03 * W * H)))) endStrong = true;
      for (const e of vis) {
        if (e.clip) bump(clip, e.txt, { t, ...e });
        const overflow = Math.max(-e.x, e.x + e.w - W, -e.y, e.y + e.h - H);
        if (overflow > 0.10 * Math.max(W, H)) bump(off, e.txt || e.cls, { t, ...e, overflow: Math.round(overflow) });
        if (e.y + e.h > 0.80 * H) bump(sub, e.txt || e.cls, { t, ...e }); // element BOTTOM edge intrudes on the caption band
        // meaning-bearing text: the component classes PLUS any clearly-readable custom text
        // (≥18px tall at ≥.5 opacity) — an English HUD phrase in a bespoke class is exactly
        // as wrong as one in .hf-label. Stat units stay excluded ("%", "x", "M").
        const meaning = /hf-(kw|label|sub|title|head|lead)/.test(e.cls || '') || (e.h >= 18 && e.o > 0.5);
        if (narrWords && meaning && textLanguageLeak(e.txt, narrWords, narrLang)) bad.set(e.txt, e);
        // completeness gate: a meaning label that begins/ends on a function word is a mid-phrase
        // fragment ("và điều quan trọng") — a clean-content-phrase re-ask, not a colour fix.
        if (meaning && e.txt && labelIsFragment(e.txt)) bump(frag, e.txt, { t, ...e });
        if (e.o > 0.25 && e.txt && !e.txt.includes('{{') && JUNK_RE.test(e.txt) && !/[À-ỿ]/.test(e.txt)) bump(junk, e.txt.slice(0, 30), { t, ...e });
      }
    }
    if (!anyVisible) defects.push('no element is ever visible — the scene renders empty. Make each beat element visible during its window.');
    else if (deadAt != null) defects.push(`the frame goes empty at ${deadAt.toFixed(1)}s mid-scene — nothing substantial is on screen between beats. Keep the composition alive: give earlier BUILD elements out:'settle' (they stay dimmed) or hold the previous element until the next one enters; the screen must never drop back to bare decor mid-scene.`);
    // A timeline running past DUR is harmless by itself (__seek samples only 0..DUR; idle
    // loops may legitimately outlive the window) — it becomes actionable only when the
    // ending is ALSO weak, i.e. the climax genuinely landed outside the rendered window.
    else if (!endStrong) defects.push(`the scene ends nearly empty (nothing prominent is on screen at ${endT.toFixed(1)}s)${Number.isFinite(tlDur) && tlDur > dur + 1.5 ? ` while the animation runs to ${tlDur.toFixed(1)}s — the climax lands past DUR=${dur.toFixed(1)}s; pull it back so it ENDS at ≈${(dur - 0.05).toFixed(1)}s` : ' — keep the final keyword (or a climax element) clearly visible through the last second so the ending lands'}.`);
    // sparse composition (cosmetic): only reject a NEAR-EMPTY frame — a tiny element lost in a
    // sea of black. A balanced or distributed layout that fills a reasonable share of the width
    // is fine (the model chooses the arrangement); this just catches the lone-small-keyword miss,
    // so the threshold is deliberately loose and does NOT force a single dominant hero.
    if (!overlay && anyVisible && heroFrac > 0 && heroFrac < 0.30 && unionFrac < 0.44) {
      defects.push(`the scene reads sparse — the widest element spans ${Math.round(heroFrac * 100)}% and everything together covers only ${Math.round(unionFrac * 100)}% of the frame width, leaving most of it empty. Fill the frame more — spread the composition across the width or enlarge the main element (the arrangement is yours; just don't leave it near-empty).`);
    }
    // overlay contract: the footage must stay visible — solid paint may not blanket the
    // center window (transient entrances are tolerated by the 0.45-alpha/held threshold).
    if (overlay && maxCenterCover > 0.4) {
      defects.push(`overlay mode: solid elements cover ${Math.round(maxCenterCover * 100)}% of the center of the frame — the owner's footage must stay visible. Keep the center ~40-50% clear; move panels/keywords to the edges, lower-third or side columns, and never use filled backgrounds larger than a chip.`);
    }
    // telemetry junk net (any size, any class): snake_case/dev tokens with no Vietnamese
    // diacritic — including ones a SCRIPT writes at runtime (normalizeSpec can only strip
    // the static HTML). Persistence-tiered like every geometry finding.
    const junkH = [...junk.values()].filter(heldAcrossSamples);
    if (junkH.length) { const o = junkH[0]; defects.push(`the on-screen text "${o.txt}" is leftover dev/telemetry decor (snake_case/code token) — remove it; on-screen words must be real ${narrLang === 'vi' ? 'Vietnamese' : narrLang} copy, numbers or icons.`); }
    // reference-caliber gates (re-ask drivers, cosmetic class — a scene still short after all
    // attempts ships as 'imperfect' LOUDLY rather than killing the run):
    // hero density — the standing composition must be a crafted instrument, not scattered bits
    if (caliber && !overlay && anyVisible && maxHeroParts < 6) {
      defects.push(`the hero construction carries only ${maxHeroParts} crafted sub-parts — build the main instrument from 8-20 parts (rows / ticks / labels / readouts / needle) INSIDE ONE container or slot, so the frame reads as a crafted device, never scattered fragments.`);
    }
    // primary type treatment — the biggest word must look expensive
    if (caliber && anyVisible && primaryInfo && primaryInfo.fs >= 0.05 * Math.min(w, h) && !primaryInfo.grad && !primaryInfo.stroke && !primaryInfo.sh) {
      defects.push(`the primary text "${primaryInfo.txt}" is flat/untreated — give the hero word a chrome gradient (background-clip:text), a layered neon text-shadow, or a stroke+fill, plus a soft drop-shadow.`);
    }
    // beat adherence: compare the snapshot before each beat with one after its entrance
    // window — some element must ENTER (newly visible) or take EMPHASIS (opacity/size jump).
    const missed = [];
    for (const p of beatPairs) {
      const pre = snaps.get(p.tp), post = snaps.get(p.tq);
      if (!pre || !post) continue;
      const key = (e) => `${e.cls}|${e.txt}`;
      const preMap = new Map(pre.map((e) => [key(e), e]));
      let responded = false;
      for (const e of post) {
        const p0 = preMap.get(key(e));
        if (!p0) { if (e.o > 0.3) { responded = true; break; } continue; }
        if (e.o - p0.o >= 0.3) { responded = true; break; }
        if (p0.w > 0 && Math.abs(e.w - p0.w) / p0.w >= 0.12) { responded = true; break; }
      }
      if (!responded) missed.push(p.t0);
    }
    if (beatPairs.length >= 2 && missed.length >= 2 && missed.length >= Math.ceil(beatPairs.length / 2)) {
      defects.push(`the beats at ${missed.slice(0, 3).map((t) => t.toFixed(1) + 's').join(', ')} produce no visual response — nothing enters or takes emphasis when those words are spoken. Schedule an entrance or emphasis EXACTLY at each beat's t0 (FX.beat / FX.accents) so the graphics land on the spoken words.`);
    }
    // geometry findings pass persistence tiering: one-sample transients are entrance/exit
    // states of slow eases, not defects — only findings HELD across ≥2 samples re-ask.
    const held = (m) => [...m.values()].filter(heldAcrossSamples);
    const offH = held(off), subH = held(sub), ovlH = held(ovl), lowcH = held(lowc), clipH = held(clip), occH = held(occ), fragH = held(frag);
    if (offH.length) { const o = offH[0]; defects.push(`element "${o.txt || o.cls}" runs ${o.overflow}px off-screen at ${o.t.toFixed(1)}s — keep all content inside the frame with a 6% margin; shrink font-size or reposition.`); }
    if (captionsOn && subH.length) { const o = subH[0]; defects.push(`element "${o.txt || o.cls}" reaches the bottom of the frame at ${o.t.toFixed(1)}s — the bottom 22% is reserved for subtitles, move it up.`); }
    if (bad.size) { const o = [...bad.values()][0]; defects.push(`the on-screen text "${o.txt}" is in the wrong language — the narration is ${narrLang === 'vi' ? 'Vietnamese' : narrLang}, and every keyword must be in the narration's language. Semantic (non-verbatim) keywords are fine; translating or mixing languages is not.`); }
    if (ovlH.length) { const o = ovlH[0]; defects.push(`the texts "${o.a}" and "${o.b}" overlap each other at ${o.t.toFixed(1)}s (${Math.round(o.frac * 100)}% of the smaller box) — text must NEVER sit on top of other text; separate them spatially or stagger their timing so only one occupies that area at a time.`); }
    if (lowcH.length) { const o = lowcH[0]; defects.push(`the text "${o.txt}" is unreadable at ${o.t.toFixed(1)}s — contrast ratio ${o.ratio}:1 against its background. Use the guide's ink color (or a bright accent) so readable text reaches at least 4.5:1.`); }
    if (clipH.length) { const o = clipH[0]; defects.push(`the text "${o.txt}" is clipped at ${o.t.toFixed(1)}s — its box is smaller than its content, cutting words off. Remove fixed widths/heights and overflow:hidden from text elements; shorten the label or let the element size itself.`); }
    if (occH.length) { const o = occH[0]; defects.push(`the text "${o.txt}" is covered by an opaque element ("${o.by}") at ${o.t.toFixed(1)}s — nothing may paint on top of readable text; move the decor behind it (DOM order/z-index) or offset it.`); }
    if (fragH.length) { const o = fragH[0]; defects.push(`the on-screen label "${o.txt}" is a sentence fragment — it begins or ends on a function word, so it reads as a mid-phrase slice. Use a COMPLETE 2–4 word phrase (a noun phrase or headline), never a fragment cut from the middle of a sentence.`); }
    // Deterministic contrast repair target: unreadable text on a dark stage is a colour mistake
    // the codegen loop can auto-fix (force ink) instead of dropping the whole bespoke scene to
    // the plain fallback. Emit a targetable selector (#id preferred, else .class) per element.
    const contrastFix = [];
    for (const o of lowcH) {
      const sel = o.id ? `#${o.id}` : (o.cls ? `.${o.cls}` : '');
      if (sel && !contrastFix.some((c) => c.sel === sel)) contrastFix.push({ sel, txt: o.txt, ratio: o.ratio });
    }
    return { ok: defects.length === 0, defects, tlDur: Number.isFinite(tlDur) ? +tlDur.toFixed(2) : null, contrastFix };
  } catch (e) {
    return { ok: true, skipped: true, defects: [], error: String(e.message || e) }; // never block codegen on a harness hiccup
  } finally { await page.close().catch(() => {}); }
}
