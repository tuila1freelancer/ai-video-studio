// The 8-item reference-caliber checklist, measured on a LIVE rendered scene page.
// Works on both our harness page (window.__seek) and a reference-app scene document
// (gsap timeline seek) — the caller passes a seek(t) function.
//
// Checklist (goal definition):
//  a. layered stage (≥3 depth planes) + atmosphere (vignette/noise/grid/orb/beam)
//  b. hero instrument with ≥8 crafted sub-parts
//  c. expensive type: chrome-gradient / neon-glow / stroked hero text (not flat white)
//  d. beat-locked reveals (ours only — needs beats)
//  e. calm: ≤2 median / ≤4 max concurrently-moving element groups
//  f. position rotation between consecutive beat reveals (ours only)
//  g. climax emphasis near the end
//  h. no junk/telemetry/wrong-language decor text
//
// Every check returns {pass, detail} so contact sheets can carry the numbers.

// Snapshot probe — runs INSIDE the page after a seek. Kept dependency-free.
const SNAP = `(() => {
  const W = innerWidth, H = innerHeight;
  const cls = (el) => (el.getAttribute && el.getAttribute('class')) || '';
  // stage-owned ambience (our harness deco + the reference's particles/progress) is calm by
  // design on BOTH sides — never counted as content or movers
  const bad = (el) => el.closest('.captions,.progtrack,.prog,.progress,#liveBtn,.wm,#particles-bg')
    || /hf-d(speck|pulse|ghost|ring)|hf-beam|hf-far/.test(cls(el));
  function eff(el){ let o=1,n=el; while(n && n!==document.documentElement){ const s=getComputedStyle(n);
    if(s.display==='none'||s.visibility==='hidden') return 0; o*=parseFloat(s.opacity||'1'); n=n.parentElement; } return o; }
  // group id = the element's slot/top-level container: parts of ONE construction entering
  // together count as ONE mover (a laptop assembling from 4 pieces is one main mover)
  const grpIds = new Map(); let grpSeq = 0;
  function grp(el){
    const host = el.closest('.hf-slot,.hf-center') || (function(){ let n=el, top=el;
      while(n && n.parentElement && !/hf-cam|stage|content/.test(cls(n.parentElement)||n.parentElement.id||'') && n.parentElement!==document.body){ n=n.parentElement; top=n; } return top; })();
    if(!grpIds.has(host)) grpIds.set(host, 'g'+(grpSeq++));
    return grpIds.get(host);
  }
  const texts=[], painted=[], atmo=new Set(); let partsHost=[];
  const all=[...document.querySelectorAll('body *')];
  for (const el of all) {
    if (bad(el)) continue;
    const s = getComputedStyle(el);
    if (s.display==='none'||s.visibility==='hidden') continue;
    const r = el.getBoundingClientRect();
    const o = eff(el);
    const ownText = [...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim().length>0);
    const bgi = s.backgroundImage||'';
    const hasBg = (s.backgroundColor&&s.backgroundColor!=='transparent'&&!/rgba\\((?:\\d+,\\s*){2}\\d+,\\s*0\\)/.test(s.backgroundColor)) || bgi!=='none';
    const hasBorder = parseFloat(s.borderTopWidth)>0&&s.borderTopStyle!=='none';
    const blur = (s.filter.match(/blur\\((\\d+(?:\\.\\d+)?)px\\)/)||[])[1];
    // atmosphere detection
    const area = r.width*r.height, frameA = W*H;
    if (o>0.02) {
      if (blur && +blur>=30 && area>0.01*frameA) atmo.add('orb');
      if (/fractalNoise|feTurbulence/.test(bgi) || /noise|grain/.test(cls(el))) atmo.add('noise');
      if ((/(repeating-)?linear-gradient/.test(bgi) && /1px|2px/.test(bgi) && area>0.5*frameA) || /scanline|grid/.test(cls(el))) atmo.add('grid');
      if ((/radial-gradient/.test(bgi) && /transparent/.test(bgi) && area>0.8*frameA) || (s.boxShadow.includes('inset') && area>0.8*frameA) || /vignette|vig\\b/.test(cls(el))) atmo.add('vignette');
      if (el.tagName==='CANVAS' && area>0.5*frameA) atmo.add('particles');
      if (/beam|flare|streak|spotlight/.test(cls(el)) && o>0.03) atmo.add('beam');
    }
    if (o<=0.02) continue;
    if (ownText && r.width>2 && r.height>2) {
      const shadows = (s.textShadow && s.textShadow!=='none') ? s.textShadow.split(/px(?:,|$)/).filter(x=>x.trim()).length : 0;
      const maxBlur = Math.max(0, ...((s.textShadow||'').match(/(\\d+(?:\\.\\d+)?)px(?=[^,]*(?:,|$))/g)||[]).map(parseFloat));
      texts.push({ x:r.left, y:r.top, w:r.width, h:r.height, cx:r.left+r.width/2, cy:r.top+r.height/2,
        fs:parseFloat(s.fontSize), o:+o.toFixed(3),
        grad:(s.webkitBackgroundClip==='text'||s.backgroundClip==='text'),
        shadowN:shadows, maxBlur, stroke:parseFloat(s.webkitTextStrokeWidth||'0')>0,
        color:s.color, txt:(el.textContent||'').trim().slice(0,60),
        key:(el.id||'')+'|'+cls(el).slice(0,30)+'|'+(el.textContent||'').trim().slice(0,16), grp:grp(el) });
    }
    if ((hasBg||hasBorder||el.tagName==='svg'||el.tagName==='IMG'||el.tagName==='CANVAS') && area>40) {
      painted.push({ x:r.left, y:r.top, w:r.width, h:r.height, area, o:+o.toFixed(3),
        frac:+(area/frameA).toFixed(4), tag:el.tagName,
        key:(el.id||'')+'|'+cls(el).slice(0,30), grp:grp(el) });
    }
    // hero-cluster candidates: containers holding many visible crafted parts
    if (area>0.06*frameA && area<0.92*frameA && el.children.length>=2) {
      let parts=0;
      for (const d of el.querySelectorAll('*')) {
        const ds=getComputedStyle(d); if(ds.display==='none') continue;
        const dr=d.getBoundingClientRect(); if(dr.width<3||dr.height<2) continue;
        const dHasText=[...d.childNodes].some(n=>n.nodeType===3&&n.textContent.trim());
        const dPainted=(ds.backgroundColor&&ds.backgroundColor!=='transparent'&&!/rgba\\((?:\\d+,\\s*){2}\\d+,\\s*0\\)/.test(ds.backgroundColor))
          ||(ds.backgroundImage&&ds.backgroundImage!=='none')
          ||(parseFloat(ds.borderTopWidth)>0&&ds.borderTopStyle!=='none')
          ||['PATH','RECT','CIRCLE','LINE','POLYGON','ELLIPSE','IMG'].includes(d.tagName.toUpperCase());
        if (dHasText||dPainted) parts++;
      }
      if (parts>=3) partsHost.push({ parts, frac:+(area/frameA).toFixed(3) });
    }
  }
  partsHost.sort((a,b)=>b.parts-a.parts);
  // keep top clusters that are NOT nested inside a bigger kept one (approx: dedupe by frac
  // similarity is impossible here, so report top-3 — the caller sums non-overlapping logic)
  return { W, H, texts, painted, atmo:[...atmo], hero: partsHost[0]||{parts:0,frac:0}, clusters: partsHost.slice(0,3) };
})()`;

const JUNK = /\b[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+\b|\b[A-Za-z_][\w-]*\s*=\s*(?:"[^"]*"|'[^']*'|[\d,.]+|true|false|null)|\b[a-z_][\w]*(?:\.[a-z_][\w]*)+\s*\([^)]*\)|\b[\w-]+\.(?:exe|sh|js|ts|py|json|dll|bat|cfg|log|sys)\b|\b(?:PROMPT_OVERFLOW|SYSTEM_INIT|LOREM|IPSUM)\b/;

function zone(cx, cy, W, H) { return `${Math.min(2, Math.floor((cx / W) * 3))}${Math.min(2, Math.floor((cy / H) * 3))}`; }

/**
 * Audit one live page. seek(t) must land the page on absolute scene-time t.
 * beats may be [] (reference pages) — then d/f are reported as null (not scored).
 */
export async function auditScene({ page, seek, duration, beats = [], hasBeats = true }) {
  const dur = duration;
  const fr = (f) => +(Math.min(dur - 0.08, dur * f)).toFixed(2);
  const keyTimes = [fr(0.25), fr(0.5), fr(0.75), fr(0.95)];

  const snapAt = async (t) => { await seek(t); return page.evaluate((p) => eval(p), SNAP); };

  // --- snapshots at the 4 key times + a motion-pair 0.15s later
  const snaps = {}, movePairs = {};
  for (const t of keyTimes) {
    snaps[t] = await snapAt(t);
    movePairs[t] = await snapAt(Math.min(dur - 0.02, t + 0.15));
  }

  // (a) layers + atmosphere
  const atmoUnion = new Set();
  let depthPass = false;
  for (const t of keyTimes) {
    const s = snaps[t];
    for (const a of s.atmo) atmoUnion.add(a);
    const bands = { back: 0, mid: 0, near: 0 };
    for (const p of s.painted) {
      if (p.frac >= 0.5) bands.back++;
      else if (p.frac >= 0.04) bands.mid++;
      else bands.near++;
    }
    if (bands.back >= 1 && bands.mid >= 1 && bands.near >= 1) depthPass = true;
  }
  const a = { pass: depthPass && atmoUnion.size >= 2, detail: `atmo=[${[...atmoUnion].join(',')}] depth=${depthPass}` };

  // (b) hero sub-parts — one dense instrument (≥8 parts) OR a split composition whose
  // top panels together carry ≥10 crafted parts (the reference often splits the hero
  // into two glass panels of 5-6 parts each; clusters can nest, so the sum is clamped)
  const heroParts = Math.max(...keyTimes.map((t) => snaps[t].hero.parts));
  const splitParts = Math.max(...keyTimes.map((t) => {
    const cl = snaps[t].clusters || [];
    if (cl.length < 2) return 0;
    return Math.min(cl[0].parts + cl[1].parts, Math.round(cl[0].parts * 1.8));
  }));
  const b = { pass: heroParts >= 8 || splitParts >= 10, detail: `maxParts=${heroParts} split=${splitParts}` };

  // (c) expensive type on the dominant text
  let cPass = false, cDetail = 'no big text';
  for (const t of [fr(0.5), fr(0.75), fr(0.95), fr(0.25)]) {
    const s = snaps[t];
    const big = s.texts.filter((x) => x.o > 0.35 && x.fs >= 0.038 * Math.min(s.W, s.H)).sort((x, y) => y.fs - x.fs)[0];
    if (!big) continue;
    const fancy = big.grad || big.stroke || (big.shadowN >= 1 && big.maxBlur >= 6) || big.shadowN >= 2;
    cDetail = `fs=${Math.round(big.fs)} grad=${big.grad} shadows=${big.shadowN} blur=${Math.round(big.maxBlur)} "${big.txt.slice(0, 18)}"`;
    if (fancy) { cPass = true; break; }
  }
  const c = { pass: cPass, detail: cDetail };

  // (d) beat-locked reveals — before/after each beat entrance
  let d = { pass: null, detail: 'no beats (ref)' };
  if (hasBeats && beats.length >= 2) {
    let responded = 0, checked = 0;
    const entrances = []; // for (f): what newly appeared per beat + where
    for (const bt of beats) {
      if (bt.t0 < 0.3 || bt.t0 > dur - 0.4) continue;
      checked++;
      const pre = await snapAt(Math.max(0.02, bt.t0 - 0.05));
      const post = await snapAt(Math.min(dur - 0.02, bt.t0 + 0.5));
      const preKeys = new Map(pre.texts.concat(pre.painted).map((e) => [e.key, e]));
      let hit = null;
      for (const e of post.texts) {
        const p0 = preKeys.get(e.key);
        if ((!p0 && e.o > 0.3) || (p0 && e.o - p0.o >= 0.3)) { hit = e; break; }
      }
      if (!hit) for (const e of post.painted) {
        const p0 = preKeys.get(e.key);
        if ((!p0 && e.o > 0.3 && e.frac > 0.003) || (p0 && e.o - p0.o >= 0.35)) { hit = e; break; }
      }
      if (hit) { responded++; entrances.push({ t0: bt.t0, cx: hit.cx ?? (hit.x + hit.w / 2), cy: hit.cy ?? (hit.y + hit.h / 2), W: post.W, H: post.H }); }
    }
    d = { pass: checked >= 2 ? responded >= Math.ceil(checked * 0.8) : null, detail: `${responded}/${checked} beats answered`, entrances };
  }

  // (e) calm — ONE MAIN mover at a time. Ambient drift and keep-alive micro-motion
  // (float ±8, breathe 3%, glow cycles, counter ticks) ARE the doctrine and never count;
  // a MAIN mover is an entrance/exit-scale movement: ≥160 px/s translation, ≥100%/s scale
  // change, or ≥2/s opacity change (over the 0.15 s pair window). Calibrated so the
  // reference app's own scenes pass.
  const movers = [], moverKeys = [];
  for (const t of keyTimes) {
    const A = new Map(snaps[t].texts.concat(snaps[t].painted).map((e2) => [e2.key, e2]));
    const B = snaps[t] === movePairs[t] ? [] : movePairs[t].texts.concat(movePairs[t].painted);
    const moved = new Set();
    for (const e2 of B) {
      const p0 = A.get(e2.key);
      if (!p0) continue;
      const dx = Math.abs((e2.x ?? 0) - (p0.x ?? 0)), dy = Math.abs((e2.y ?? 0) - (p0.y ?? 0));
      const dScale = p0.w > 0 ? Math.abs(e2.w - p0.w) / p0.w : 0;
      const dO = Math.abs((e2.o ?? 1) - (p0.o ?? 1));
      if (dx > 24 || dy > 24 || dScale > 0.15 || dO > 0.3) moved.add(e2.grp || e2.key);
    }
    movers.push(moved.size);
    moverKeys.push([...moved].slice(0, 4).join('+'));
  }
  const sortedM = [...movers].sort((x, y) => x - y);
  const medianM = sortedM[Math.floor(sortedM.length / 2)];
  const e = { pass: medianM <= 2 && Math.max(...movers) <= 3, detail: `movers=${movers.join(',')} [${moverKeys.filter(Boolean).join(' | ')}]` };

  // (f) position rotation between consecutive beat entrances (ours only)
  let f = { pass: null, detail: 'no beats (ref)' };
  if (hasBeats && d.entrances && d.entrances.length >= 2) {
    const zs = d.entrances.map((en) => zone(en.cx, en.cy, en.W, en.H));
    let repeats = 0;
    for (let i = 1; i < zs.length; i++) if (zs[i] === zs[i - 1] && i !== zs.length - 1) repeats++;
    // doctrine: rotate positions. Annotating an established hero once is legitimate design,
    // so scenes with ≥4 reveals may keep ONE adjacent repeat; parking everything in one
    // zone (2+ repeats) always fails.
    const allow = zs.length >= 4 ? 1 : 0;
    f = { pass: repeats <= allow, detail: `zones=${zs.join('>')}` };
  }

  // (g) climax emphasis near the end — any of: end type outgrows the early type, a glowing
  // end hero at near-early size, the main GRAPHIC grew ≥12%, or a big element ENTERED in
  // the final stretch (climax entrance). Calibrated against the reference's own scenes.
  const endS = snaps[fr(0.95)];
  const earlyMax = Math.max(1, ...[fr(0.25), fr(0.5)].flatMap((t) => snaps[t].texts.filter((x) => x.o > 0.35).map((x) => x.fs)));
  const endBig = endS.texts.filter((x) => x.o > 0.35).sort((x, y) => y.fs - x.fs)[0];
  const endGlow = endBig && (endBig.maxBlur >= 10 || endBig.grad || endBig.shadowN >= 2);
  const bigPaint = (s) => s.painted.filter((p) => p.o > 0.3 && p.frac < 0.6).sort((x, y) => y.area - x.area)[0];
  const p50 = bigPaint(snaps[fr(0.5)]), p95 = bigPaint(snaps[fr(0.95)]);
  const paintGrew = p50 && p95 && p95.area >= p50.area * 1.12;
  const midKeys = new Set(snaps[fr(0.5)].texts.concat(snaps[fr(0.5)].painted).map((x) => x.key));
  const lateEntrance = endS.texts.concat(endS.painted).some((x) => !midKeys.has(x.key) && x.o > 0.4
    && ((x.fs && x.fs >= earlyMax * 0.8) || (x.area && x.area >= 0.04 * endS.W * endS.H)));
  const g = {
    pass: (!!endBig && (endBig.fs >= earlyMax * 1.05 || (endGlow && endBig.fs >= earlyMax * 0.8))) || paintGrew || lateEntrance,
    detail: endBig ? `end fs=${Math.round(endBig.fs)}/early ${Math.round(earlyMax)} glow=${!!endGlow} paint↑=${!!paintGrew} late=${!!lateEntrance}` : `end text empty paint↑=${!!paintGrew} late=${!!lateEntrance}`,
  };

  // (h) junk / telemetry text
  const junkHits = [];
  for (const t of keyTimes) {
    for (const x of snaps[t].texts) {
      if (x.o < 0.25) continue;
      if (x.txt.includes('{{')) continue;
      if (JUNK.test(x.txt) && !/[À-ỿ]/.test(x.txt)) junkHits.push(x.txt.slice(0, 30));
    }
  }
  const h = { pass: junkHits.length === 0, detail: junkHits.length ? `junk: ${[...new Set(junkHits)].slice(0, 3).join(' · ')}` : 'clean' };

  const checks = { a, b, c, d, e, f, g, h };
  const scored = Object.values(checks).filter((x) => x.pass !== null);
  const passed = scored.filter((x) => x.pass).length;
  return { checks, passed, scored: scored.length, full: passed === scored.length };
}
