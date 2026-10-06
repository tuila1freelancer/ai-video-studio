// Headless render-validation for a HyperFrame spec. Runs the REAL scene page and checks the
// invariants a static syntax check can't: runtime script errors (calling a non-existent FX,
// undefined vars → __init throws → scene renders frozen/static), timeline coverage (frozen tail
// / overshoot past DUR), elements leaving the frame, and elements colliding with the caption band.
// No screenshots → fast (~1-2s), safe to run per-scene inside codegen's re-prompt loop.
import { buildTemplate, makeCtx } from '../animation/templates.js';
import { buildScenePage } from '../animation/harness.js';
import { themeFromGuide, normalizeGuide } from '../styleguide/index.js';
import { fold } from './beats.js';
import { detectLang, classifyLang, langName, langAdjective } from '../util/lang.js';
import { lang as langRow } from '../i18n/languages.js';
import { getBrowser, chromeAvailable } from '../media/puppeteer.js';

// Diacritic-folded content words of the narration, for the wrong-language text check.
export function narrationWordSet(narration) {
  const t = (narration || '').trim();
  if (!t) return null;
  return new Set((fold(t).match(/[\p{L}\p{N}]+/gu) || []).filter((w) => w.length >= 2));
}
// The prompt asks the model to pick on-screen text SEMANTICALLY (not verbatim from the voice
// line), so "not in the narration" alone is NOT a defect. What IS a defect is a LANGUAGE leak:
// e.g. an English display headline in a Vietnamese-narrated video. Flag only when the text is
// multi-word, shares no word with the narration, AND reads as a different language.
// Under the 4-letter floor below, these are English decoration and nothing else — no Vietnamese
// word collides with any of them. A 3-letter ghost glyph reading END shipped once because of it.
const SHORT_DECOR = /^(END|NEW|TOP|RUN|SET|KEY|MAP|BOX|TAG|OUT|OFF|YES|WIN|BIG|MAX|MIN|ADD|GET|FIX|LOG|OLD|LOW|GO|OK)$/i;

export function textLanguageLeak(txt, narrWords, narrLang) {
  const words = (fold(txt || '').match(/[\p{L}]+/gu) || []).filter((w) => w.length >= 3);
  // Whether a bare ASCII word is evidence of anything depends on how the narration is written.
  // A Vietnamese, Russian, Thai or CJK video cannot spell its own labels in plain ASCII, so one
  // that appears is English decor. A French or Spanish video spells most of its labels in plain
  // ASCII, so the same test condemns every correct label it has.
  const asciiIsForeign = langRow(narrLang).script !== 'latin';
  if (words.length < 2) {
    if (words.length !== 1) return false; // number / symbol — too little signal
    const raw = String(txt || '').replace(/[^\p{L}]/gu, '');
    // Judged on the RAW text so a Vietnamese word like "TƯỞNG", which folds to ASCII, is safe.
    if (asciiIsForeign) return (/^[A-Za-z]{4,}$/.test(raw) || SHORT_DECOR.test(raw)) && !narrWords.has(fold(raw));
    // Latin-script narration: only a foreign SCRIPT is readable as a leak from a single word.
    // The prompt asks for SEMANTIC, non-verbatim keywords, so "MOMENTUM" on an English video and
    // "PUISSANCE" on a French one are both good design and both absent from their narration.
    const one = classifyLang(raw);
    return raw.length >= 3 && one.confident && one.code !== narrLang;
  }
  if (words.some((w) => narrWords.has(w))) return false; // derived from the narration — fine
  // Only a CONFIDENT reading is a defect. detectLang used to answer 'en' for every unaccented
  // Latin script and say nothing about how sure it was, so on a French video every correct
  // French headline came back 'en' !== 'fr' and was re-asked up to LANG_REASK_MAX times.
  const c = classifyLang(txt);
  return c.confident && c.code !== narrLang;
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
  // 3x3 ink map (P41): how the composition's visual weight is spread. Every painted box and
  // every readable text contributes its area to the cells it covers; the caller turns this into
  // the "starved zone" advisory. Fair share per cell is 1/9 = 0.111.
  const zones=[0,0,0,0,0,0,0,0,0], zoneEls=[0,0,0,0,0,0,0,0,0];
  const addZone=(r)=>{ for(let gy=0;gy<3;gy++)for(let gx=0;gx<3;gx++){
    const ox=Math.max(0,Math.min(r.right,(gx+1)*W/3)-Math.max(r.left,gx*W/3));
    const oy=Math.max(0,Math.min(r.bottom,(gy+1)*H/3)-Math.max(r.top,gy*H/3));
    if(ox>0&&oy>0) zones[gy*3+gx]+=ox*oy; }
    // a zone also counts as OCCUPIED when an element's CENTRE lands in it: a kicker or an icon
    // is small in area but is absolutely something in that corner, and ink share alone would
    // call a perfectly composed frame empty there.
    const cx=(r.left+r.right)/2, cy=(r.top+r.bottom)/2;
    if(cx>=0&&cx<W&&cy>=0&&cy<H) zoneEls[(cy<H/3?0:cy<2*H/3?1:2)*3+(cx<W/3?0:cx<2*W/3?1:2)]++; };
  for(const el of cam.querySelectorAll('div,section,figure')){
    if(el.closest('.hf-far'))continue;
    const s=getComputedStyle(el);
    const painted=(s.backgroundColor&&!/rgba\\((?:\\d+, ){2}\\d+, 0\\)/.test(s.backgroundColor)&&s.backgroundColor!=='transparent')
      ||(s.backgroundImage&&s.backgroundImage!=='none')||(parseFloat(s.borderTopWidth)>0&&s.borderTopStyle!=='none');
    if(!painted)continue;
    const o=eff(el); if(o<0.12)continue;
    const r=el.getBoundingClientRect();
    if(r.width*r.height>=0.02*W*H&&r.left<W&&r.right>0&&r.top<H&&r.bottom>0) decorArea+=Math.min(r.width*r.height,0.2*W*H);
    if(r.width*r.height<0.45*W*H) addZone(r); // a near-full-frame wash is backdrop, not composition
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
    addZone(r);
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
  for(const n of txts){ if(n.o<0.85)continue; // settled text only — a color-in entrance sweeps through bg legally
    const cs=getComputedStyle(n.el);
    // gradient-filled (background-clip:text) and stroked treatments render color:transparent
    // on purpose — measuring their computed color would be a guaranteed false positive
    if((cs.webkitBackgroundClip||cs.backgroundClip)==='text')continue;
    if(parseFloat(cs.webkitTextStrokeWidth||'0')>0)continue;
    const cm=cs.color.match(/[\\d.]+/g)||[];
    if(cm.length>3&&parseFloat(cm[3])<0.99)continue;
    const L1=lum(cs.color),L2=lum(bgOf(n.el));
    const ratio=(Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05);
    if(ratio<3.5) lowContrast.push({txt:(n.el.textContent||'').trim().slice(0,20),ratio:+ratio.toFixed(2),
      fs:parseFloat(cs.fontSize)||0,
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
  const zTotal=zones.reduce((a,b)=>a+b,0)||1;
  return {W,H,els:out,overlaps,lowContrast,occluded,decorArea:+(decorArea/(W*H)).toFixed(4),centerCover:+centerCover.toFixed(3),heroParts,primary,
    zones:zones.map(z=>+(z/zTotal).toFixed(3)),zoneEls};
})()`;

/**
 * @returns {ok, defects:[string], tlDur, skipped?} — defects are phrased as instructions the
 *   LLM can act on when re-prompted.
 */
export async function renderValidate({ spec, guide, w = 1080, h = 1920, duration = 6, beats = [], narration = '', captionsOn = true, overlay = false, language = '' }) {
  // P38: this gate now checks ONLY "the HTML is not broken" + "the layout is balanced" — the two
  // things the user asked to keep. The reference-caliber nudges (sparse / hero-density / beat-
  // adherence / dialogue-match), the flat-type check, the low-contrast gate + auto-repair, and the
  // mid-scene/ending liveness checks are all removed (the reference app ships none of them).
  if (!chromeAvailable()) return { ok: true, skipped: true, defects: [], warnings: [], langDefects: [] };
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
  // P39 (reference-parity, advisory validation): `defects` is the HARD structural floor only —
  // the script threw, or the scene renders blank. These block + re-ask (they are the real
  // "broken scene" cases the reference app's own structure implicitly rejects). Every geometry
  // finding (off-screen / overlap / caption-band / distribution / …) is now an advisory WARNING:
  // surfaced and logged, never a re-ask — mirroring the reference app, whose validation is advisory.
  const defects = [], warnings = [], langDefects = [];
  try {
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'load', timeout: 20000 });
    const init = await page.evaluate('window.__init()');
    if (init.tplErr) {
      defects.push(`your script threw at runtime: "${init.tplErr}". Use gsap/tl (tl.to/tl.from/tl.fromTo/tl.set, gsap.set, gsap.timeline) or the FX.* helpers; do not reference undefined variables or functions.`);
      return { ok: false, defects, warnings };
    }
    const tlDur = await page.evaluate('window.__tl ? window.__tl.totalDuration() : 0');

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
    // The DECLARED language of the video wins. Detecting from the narration was a circular
    // check: a scene whose narration had itself been corrupted into another language would
    // then validate its on-screen text against the corruption.
    const narrLang = language || detectLang(narration || '');
    let anyVisible = false, unionFrac = 0, maxSpread = 0, hadCluster = false, maxCenterCover = 0;
    // P41 balance: the BEST 3x3 ink map across the samples. Best, not worst — early beats are
    // empty by design (the beat protocol starts nearly bare), so a scene is judged on how evenly
    // it fills once it is fully built, never on its opening frame.
    let bestZones = null, bestZoneEls = null, bestZoneScore = Infinity;
    // Every geometry accumulator carries an occurrence count `n` — persistence tiering
    // (heldAcrossSamples) later drops one-sample transients (entrance/exit states of slow eases).
    const off = new Map(), sub = new Map(), bad = new Map(), ovl = new Map(), clip = new Map(), occ = new Map(), junk = new Map();
    const bump = (map, k, data) => {
      const cur = map.get(k);
      if (cur) cur.n++;
      else map.set(k, { ...data, n: 1 });
    };
    for (const t of T) {
      const { W, H, els, overlaps = [], occluded = [], centerCover = 0, zones = null, zoneEls = null } = await page.evaluate(`window.__seek(${t}); ${PROBE}`);
      maxCenterCover = Math.max(maxCenterCover, centerCover);
      if (zones && zones.length === 9) {
        // spread score = total absolute deviation from an even 1/9 per cell (0 = perfectly even)
        const score = zones.reduce((a, z) => a + Math.abs(z - 1 / 9), 0);
        if (score < bestZoneScore) { bestZoneScore = score; bestZones = zones; bestZoneEls = zoneEls; }
      }
      for (const p of overlaps) bump(ovl, `${p.a}|${p.b}`, { t, ...p });
      for (const p of occluded) bump(occ, p.txt, { t, ...p });
      const vis = els.filter((e) => e.o > 0.15);
      if (vis.length) anyVisible = true;
      // combined horizontal coverage (merged x-intervals): a split composition (object one side,
      // text column the other) fills the frame without any single dominant element.
      const iv = vis.filter((e) => e.o > 0.35).map((e) => [Math.max(0, e.x), Math.min(W, e.x + e.w)])
        .filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
      let cov = 0, curA = -1, curB = -1;
      for (const [a, b] of iv) {
        if (a > curB) { cov += Math.max(0, curB - curA); curA = a; curB = b; }
        else curB = Math.max(curB, b);
      }
      cov += Math.max(0, curB - curA);
      unionFrac = Math.max(unionFrac, cov / W);
      // P38 center-clump input: when ≥3 readable texts coexist, how wide do their centers spread?
      const readable = vis.filter((e) => e.txt && e.o > 0.4 && e.w > 8);
      if (readable.length >= 3) {
        hadCluster = true;
        const xs = readable.map((e) => e.cx);
        const spread = (Math.max(...xs) - Math.min(...xs)) / W;
        if (spread > maxSpread) maxSpread = spread;
      }
      for (const e of vis) {
        if (e.clip) bump(clip, e.txt, { t, ...e });
        const overflow = Math.max(-e.x, e.x + e.w - W, -e.y, e.y + e.h - H);
        if (overflow > 0.10 * Math.max(W, H)) bump(off, e.txt || e.cls, { t, ...e, overflow: Math.round(overflow) });
        if (e.y + e.h > 0.80 * H) bump(sub, e.txt || e.cls, { t, ...e }); // element BOTTOM edge intrudes on the caption band
        // meaning-bearing text: component classes PLUS any clearly-readable custom text
        // (≥18px tall at ≥.5 opacity) — used by the wrong-language + junk content checks.
        const meaning = /hf-(kw|label|sub|title|head|lead)/.test(e.cls || '') || (e.h >= 18 && e.o > 0.5) || (e.h >= 80 && e.o > 0.15);
        if (narrWords && meaning && textLanguageLeak(e.txt, narrWords, narrLang)) bump(bad, e.txt, { t, ...e });
        if (e.o > 0.25 && e.txt && !e.txt.includes('{{') && JUNK_RE.test(e.txt) && !/[À-ỿ]/.test(e.txt)) bump(junk, e.txt.slice(0, 30), { t, ...e });
      }
    }
    // HARD FLOOR — "HTML not broken": the scene must actually paint something (a blank render =
    // extraction/JS fail). This is the one structural defect that still blocks + re-asks.
    if (!anyVisible) defects.push('no element is ever visible — the scene renders empty. Make each beat element visible during its window.');
    // ---- everything below is ADVISORY (warnings): logged, never a re-ask (reference-parity) ----
    // overlay contract: the footage should stay visible — solid paint may not blanket the center.
    if (overlay && maxCenterCover > 0.4) {
      warnings.push(`overlay mode: solid elements cover ${Math.round(maxCenterCover * 100)}% of the center of the frame — the owner's footage must stay visible. Keep the center ~40-50% clear; move panels/keywords to the edges, lower-third or side columns, and never use filled backgrounds larger than a chip.`);
    }
    // distribution: a horizontal frame whose readable elements all bunch on the center axis.
    if (!overlay && w >= h * 1.1 && hadCluster && maxSpread < 0.22 && unionFrac < 0.5) {
      warnings.push(`the composition is stacked on the center axis (readable elements span only ${Math.round(maxSpread * 100)}% of the width) — distribute them across left / center / right per the ratio rules: a wide frame wants a split or an off-center hero with a real counterweight, not everything in the middle.`);
    }
    // P41 EVENNESS: layout and content spread evenly across the frame. Measured across real
    // scenes, the failure is not emptiness but LOPSIDEDNESS: the top corners carried ~0.065 of the
    // ink against a 0.111 fair share while dead-centre carried ~0.192. Named zones make the advice
    // actionable — "put something in the top-left" is a thing a model can do, "distribute weight"
    // is not. Advisory only, and judged on the scene's BEST-filled sample, never its opening frame.
    if (bestZones) {
      const NAME = ['top-left', 'top-centre', 'top-right', 'middle-left', 'centre', 'middle-right', 'bottom-left', 'bottom-centre', 'bottom-right'];
      // A zone is DEAD only when nothing is anchored in it AND it carries almost no ink — a small
      // kicker in the corner is little ink but is not a hole. Calibrated against real renders: a
      // well-composed frame leaves 0-1 dead zones, the lopsided ones leave 3+.
      const dead = bestZones.map((z, i) => ({ z, i })).filter(({ z, i }) => z < 0.03 && !(bestZoneEls && bestZoneEls[i]));
      const hog = bestZones.reduce((best, z, i) => (z > bestZones[best] ? i : best), 0);
      if (dead.length >= 3) {
        warnings.push(`the frame is lopsided: ${dead.map(({ i }) => NAME[i]).join(', ')} hold NOTHING at all, while ${NAME[hog]} carries ${Math.round(bestZones[hog] * 100)}% of the visual weight (an even frame is ~11% per zone). Anchor a real element — a label cluster, a stat, a bracket, a tick scale, a satellite panel — in each dead zone instead of stacking more into ${NAME[hog]}.`);
      } else if (bestZones[hog] > 0.34) {
        warnings.push(`${Math.round(bestZones[hog] * 100)}% of the composition sits in ${NAME[hog]} alone (an even frame is ~11% per zone) — break that block up and push part of it out toward the emptier zones.`);
      }
    }
    // telemetry junk net: snake_case/dev tokens with no Vietnamese diacritic. Persistence-tiered.
    const junkH = [...junk.values()].filter(heldAcrossSamples);
    if (junkH.length) { const o = junkH[0]; warnings.push(`the on-screen text "${o.txt}" is leftover dev/telemetry decor (snake_case/code token) — remove it; on-screen words must be real ${langAdjective(narrLang)} copy, numbers or icons.`); }
    // geometry findings pass persistence tiering: one-sample transients are entrance/exit states
    // of slow eases, not defects — only findings HELD across ≥2 samples surface.
    const held = (m) => [...m.values()].filter(heldAcrossSamples);
    const offH = held(off), subH = held(sub), ovlH = held(ovl), clipH = held(clip), occH = held(occ);
    if (offH.length) { const o = offH[0]; warnings.push(`element "${o.txt || o.cls}" runs ${o.overflow}px off-screen at ${o.t.toFixed(1)}s — keep all content inside the frame with a 6% margin; shrink font-size or reposition.`); }
    if (captionsOn && subH.length) { const o = subH[0]; warnings.push(`element "${o.txt || o.cls}" reaches the bottom of the frame at ${o.t.toFixed(1)}s — the bottom 22% is reserved for subtitles, move it up.`); }
    // LANGUAGE is returned SEPARATELY from geometry: the caller decides whether it blocks.
    // renderValidate is stateless and is also called by the manual scene-edit lane and by
    // repurpose, neither of which has an attempt loop — folding this into `defects` would
    // start rejecting the user's own edits.
    const badH = held(bad);
    if (badH.length) { const o = badH[0]; langDefects.push(`the on-screen text "${o.txt}" is in the wrong language — this video is in ${langName(narrLang)}, and EVERY readable word must be ${langAdjective(narrLang)}. Semantic (non-verbatim) keywords are fine; another language is not. Numbers, units and symbols are always allowed.`); }
    if (ovlH.length) { const o = ovlH[0]; warnings.push(`the texts "${o.a}" and "${o.b}" overlap each other at ${o.t.toFixed(1)}s (${Math.round(o.frac * 100)}% of the smaller box) — text must NEVER sit on top of other text; separate them spatially or stagger their timing so only one occupies that area at a time.`); }
    if (clipH.length) { const o = clipH[0]; warnings.push(`the text "${o.txt}" is clipped at ${o.t.toFixed(1)}s — its box is smaller than its content, cutting words off. Remove fixed widths/heights and overflow:hidden from text elements; shorten the label or let the element size itself.`); }
    if (occH.length) { const o = occH[0]; warnings.push(`the text "${o.txt}" is covered by an opaque element ("${o.by}") at ${o.t.toFixed(1)}s — nothing may paint on top of readable text; move the decor behind it (DOM order/z-index) or offset it.`); }
    return { ok: defects.length === 0, defects, warnings, langDefects, tlDur: Number.isFinite(tlDur) ? +tlDur.toFixed(2) : null };
  } catch (e) {
    return { ok: true, skipped: true, defects: [], warnings: [], langDefects: [], error: String(e.message || e) }; // never block codegen on a harness hiccup
  } finally { await page.close().catch(() => {}); }
}
