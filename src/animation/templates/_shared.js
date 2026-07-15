// Shared helpers for all motion templates: icon set, text utils, base CSS, and the
// in-page FX runtime (GSAP helper functions) prepended to every template script.
//
// Template contract v2: build(p, ctx) → { css, html, script? }
//  - css/html: sized markup, all px precomputed from ctx (deterministic per aspect)
//  - script: body of function(gsap, tl, S, rng) run AFTER fonts load; every tween/timeline
//    must be added to the paused root timeline `tl` (the harness scrubs tl.time(t, true)).
//    Author HTML/CSS so the NATURAL state is the final visible state and animate in with
//    tl.from(...) — if the script ever fails, the scene still renders complete, just static.
//  - keep ambient CSS keyframe loops (glowpulse/spin/floaty) — WAAPI seek handles them;
//    remove only the CSS *intro* animations that GSAP replaces (no double-reveal).

export const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

export function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---- icon set (24×24 line-art, stroke=currentColor) ----
export const IC = {
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12 21 2M16 7l3 3M13 10l2 2"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="3"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/>',
  question: '<path d="M9 9a3 3 0 1 1 5.2 2c-.9.9-2.2 1.4-2.2 3"/><circle cx="12" cy="18.4" r=".8" fill="currentColor"/>',
  bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 1 3.5 10.9c-.8.6-1.5 1.6-1.5 2.6h-4c0-1-.7-2-1.5-2.6A6 6 0 0 1 12 3z"/>',
  star: '<path d="m12 3 2.7 5.7 6.3.8-4.6 4.3 1.2 6.2L12 17l-5.6 3 1.2-6.2L3 9.5l6.3-.8z"/>',
  doc: '<path d="M6 2h8l4 4v16H6z"/><path d="M14 2v4h4M9 12h6M9 16h6"/>',
  chat: '<path d="M4 5h16v11H8l-4 4z"/><path d="M8 9h8M8 12h5"/>',
  folder: '<path d="M3 6h6l2 2h10v12H3z"/>',
  shield: '<path d="M12 2 20 6v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z"/>',
  bolt: '<path d="M13 2 4 14h6l-1 8 9-12h-6z"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/>',
  chart: '<path d="M4 20V4M4 20h16"/><path d="M8 16v-5M12 16V7M16 16v-8"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  warn: '<path d="M12 3 22 20H2z"/><path d="M12 9v5"/><circle cx="12" cy="17" r=".8" fill="currentColor"/>',
  rocket: '<path d="M12 2c4 2 6 6 6 10l-3 3h-6l-3-3c0-4 2-8 6-10z"/><circle cx="12" cy="9" r="2"/><path d="M9 15l-3 6 4-2M15 15l3 6-4-2"/>',
  brain: '<path d="M9 3a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 3 3c1 0 3-1 3-3V6c0-2-2-3-3-3zM15 3a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-3 3c-1 0-3-1-3-3V6c0-2 2-3 3-3z"/>',
  arrow: '<path d="M4 12h16M14 6l6 6-6 6"/>',
};
export function icon(name, sizePx, color, sw = 1.7) {
  const body = IC[name] || IC.bolt;
  return `<svg width="${sizePx}" height="${sizePx}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}
export const ICON_NAMES = Object.keys(IC);

// word-stagger reveal spans (CSS path — kept for templates/props that still use it)
export function words(text, cls, delay0 = 0.15, step = 0.055) {
  return String(text || '').split(/\s+/).filter(Boolean).map((w, i) =>
    `<span class="${cls}" style="animation-delay:${(delay0 + i * step).toFixed(3)}s">${esc(w)}</span>`).join(' ');
}
export function pad2(n) { return String(n).padStart(2, '0'); }
export function hudLabel(text, ctx, color) {
  return `<div class="hud" style="color:${color || ctx.theme.muted}">${esc((text || '').toUpperCase())}</div>`;
}

// shared css for every template
export function base(ctx) {
  const { u, theme } = ctx;
  return `
  .wrap{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:${u(9)}px}
  .hud{font:700 ${u(2.0)}px ${theme.mono};letter-spacing:.28em;text-transform:uppercase;opacity:0;animation:fadeup .7s ${EASE} .05s both}
  .rise{display:inline-block;opacity:0;transform:translateY(${u(3)}px);animation:rise .65s ${EASE} both}
  @keyframes rise{to{opacity:1;transform:translateY(0)}}
  @keyframes fadeup{from{opacity:0;transform:translateY(${u(2)}px)}to{opacity:.9;transform:translateY(0)}}
  @keyframes popin{0%{opacity:0;transform:scale(.6)}60%{transform:scale(1.06)}100%{opacity:1;transform:scale(1)}}
  @keyframes glowpulse{0%,100%{filter:drop-shadow(0 0 ${u(1.2)}px currentColor)}50%{filter:drop-shadow(0 0 ${u(3)}px currentColor)}}
  @keyframes floaty{0%,100%{transform:translateY(0)}50%{transform:translateY(-${u(1.4)}px)}}
  @keyframes spin{to{transform:rotate(360deg)}}
  @keyframes caret{0%,49%{opacity:1}50%,100%{opacity:0}}
  @keyframes drawx{from{transform:scaleX(0)}to{transform:scaleX(1)}}
  .accent{color:${ctx.accent}}
  `;
}
export function headingStyle(ctx, sizeU, color) {
  const { u, theme } = ctx;
  return `font-weight:800;font-size:${u(sizeU)}px;line-height:1.08;letter-spacing:-.01em;text-transform:uppercase;color:${color || theme.ink};text-shadow:${theme.glow(color || ctx.accent)}`;
}

// ---- FX runtime: GSAP helpers available inside every template script ----
// Runs in-page. All motion is added to `tl` (paused root timeline) → deterministic scrub.
// rng is the seeded PRNG — NEVER use Math.random in scripts (it is reseeded, but rng is explicit).
const FX_SRC = `
// Authored-timeline coordinates: with S.tplScale (scenes-first time-warp) the template
// timeline was authored for plannedDur = S.duration * TSCALE and the harness seeks it at
// st = t*TSCALE. Every FX time derived from REAL seconds (S.duration, caption word stamps)
// must therefore be converted into authored coordinates — multiply by TSCALE — so the event
// still fires at the intended REAL moment. TSCALE is 1 everywhere except hyperframe specs
// whose estimated duration differs from the real voice.
var TSCALE = (S.tplScale || 1);
// R2A: real seconds -> authored coordinates. Under a beat warp (window.__r2a from the
// harness) this is piecewise — caption word stamps land EXACTLY where the authored
// timeline expects them; without one it is the plain TSCALE ratio.
var R2A = (typeof window !== 'undefined' && window.__r2a) ? window.__r2a : function(t){ return t * TSCALE; };
var TD = (typeof window !== 'undefined' && window.__authoredDur != null) ? window.__authoredDur : S.duration * TSCALE;
// Entrance-duration floor: under a COMPRESSED timeline (TSCALE>1 — the real voice ran shorter
// than the authored estimate) an authored entrance of d seconds plays in d/TSCALE REAL seconds,
// so a small d flashes sub-perceptually ("rushed pops"). Lengthen the authored duration so every
// reveal occupies at least MIN_ENTRANCE real seconds. No-op when TSCALE≈1 (uncompressed renders
// stay byte-identical); a pure function of the deterministic TSCALE, so determinism holds.
var MIN_ENTRANCE = 0.4;
function edur(d){ d = +d || 0; if (TSCALE <= 1.05) return d; return (d / TSCALE) < MIN_ENTRANCE ? MIN_ENTRANCE * TSCALE : d; }
var FX = {
  q: function(sel){ return document.querySelectorAll(sel); },
  split: function(sel, type){ return new SplitText(FX.q(sel), { type: type || 'chars,words' }); },
  // char cascade in: 3D flip-up per glyph
  splitIn: function(tl, sel, o){ o=o||{};
    var st = FX.split(sel, o.type);
    var tg = o.words ? st.words : st.chars;
    tl.from(tg, { opacity:0, y:o.y==null?42:o.y, rotationX:o.rotX==null?-72:o.rotX, transformOrigin:'50% 100%',
      transformPerspective:o.persp==null?420:o.persp,
      duration:edur(o.dur||0.72), ease:o.ease||'back.out(1.6)', stagger:o.each==null?0.026:o.each }, o.at||0.15);
    return st; },
  // SVG stroke draw-on (DrawSVG)
  drawIn: function(tl, sel, o){ o=o||{};
    tl.fromTo(sel, { drawSVG:'0%' }, { drawSVG:'100%', duration:edur(o.dur||1.1), ease:o.ease||'power2.inOut', stagger:o.each||0.09 }, o.at||0.1); },
  pop: function(tl, sel, o){ o=o||{};
    tl.from(sel, { scale:o.from==null?0.4:o.from, opacity:0, duration:edur(o.dur||0.6), ease:o.ease||'back.out(2)', stagger:o.each||0.12 }, o.at||0.2); },
  rise: function(tl, sel, o){ o=o||{};
    tl.from(sel, { y:o.y==null?34:o.y, opacity:0, duration:edur(o.dur||0.65), ease:o.ease||'power3.out', stagger:o.each||0.1 }, o.at||0.15); },
  slide: function(tl, sel, o){ o=o||{};
    tl.from(sel, { x:o.x==null?-60:o.x, opacity:0, duration:edur(o.dur||0.7), ease:o.ease||'power3.out', stagger:o.each||0.12 }, o.at||0.15); },
  // ambient float loop (yoyo, infinite — fine under time-scrub)
  loop: function(tl, sel, o){ o=o||{};
    tl.to(sel, { y:o.y==null?-10:o.y, rotation:o.rot||0, duration:o.dur||2.4, ease:'sine.inOut', yoyo:true, repeat:-1,
      stagger:o.each||0.35 }, o.at==null?1.0:o.at); },
  wiggle: function(tl, sel, o){ o=o||{};
    var nm = 'fxwg' + (o.n||7);
    try { CustomWiggle.create(nm, { wiggles:o.n||7, type:o.type||'easeOut' }); } catch(e){}
    tl.to(sel, { rotation:o.rot||6, x:o.x||0, duration:o.dur||0.8, ease:nm }, o.at||0.6); },
  // numeric counter — textContent is a pure function of tl time
  count: function(tl, sel, end, o){ o=o||{};
    var el = document.querySelector(sel); if (!el) return;
    var obj = { v: o.from||0 };
    tl.to(obj, { v:end, duration:o.dur||1.4, ease:o.ease||'power2.out',
      onUpdate: function(){ el.textContent = o.pad ? String(Math.round(obj.v)).padStart(2,'0') : String(Math.round(obj.v)); } }, o.at||0.3); },
  scramble: function(tl, sel, text, o){ o=o||{};
    tl.to(sel, { scrambleText:{ text:text, chars:o.chars||'01<>/#=+', speed:o.speed||0.4 }, duration:o.dur||1.1, ease:'none' }, o.at||0.15); },

  // ---- HyperFrame motion vocabulary (used by LLM-generated scene scripts) ----
  // carrier-pattern entrance: successive targets slide in with geometrically decaying distance
  carrierIn: function(tl, sel, o){ o=o||{};
    var els = FX.q(sel), d = o.from==null?360:o.from, k = o.decay==null?0.34:o.decay;
    if (!(k>0 && k<1)) k = 0.34; // guard: a 0 or ≥1 decay would collapse or explode the slide
    for (var i=0;i<els.length;i++){
      tl.from(els[i], { x:(o.axis==='y'?0:d*(o.dir||1)), y:(o.axis==='y'?d*(o.dir||1):0), opacity:0,
        duration:edur(o.dur||0.33), ease:o.ease||'expo.out' }, (o.at||0.1) + i*(o.gap==null?0.09:o.gap));
      d = Math.max(12, d*k);
    } },
  // chrome gradient sweep across background-clipped text (.hf-kw sets background-size:240%)
  chromeSweep: function(tl, sel, o){ o=o||{};
    tl.fromTo(sel, { backgroundPosition:'120% 0' }, { backgroundPosition:'-40% 0',
      duration:o.dur||0.9, ease:o.ease||'power1.inOut' }, o.at||0.5); },
  // whip exit: small anticipation pull, then fast skewed fling out
  whipOut: function(tl, sel, o){ o=o||{}; var at=o.at==null?1:o.at, dx=o.x==null?520:o.x;
    tl.to(sel, { x:-0.12*dx, duration:0.12, ease:'power2.out' }, at)
      .to(sel, { x:dx, opacity:0, skewX:o.skew==null?-10:o.skew, duration:o.dur||0.24, ease:'power3.in' }, at+0.12); },
  // glitch entrance: hidden from t=0, then jitter-in with skew flashes
  glitchIn: function(tl, sel, o){ o=o||{}; var at=o.at||0.1;
    tl.set(sel, { opacity:0, x:-12, skewX:7 }, 0)
      .to(sel, { keyframes:[
        { opacity:1, x:9, skewX:-5, duration:0.05 }, { x:-6, skewX:3, duration:0.05 },
        { x:3, skewX:-1.5, duration:0.05 }, { x:0, skewX:0, duration:0.07 } ] }, at); },
  // counter with an end pulse (odometer feel). grow:true scales the block up WITH the value
  // (counting-dynamic-scale) so the climb itself escalates.
  counterRoll: function(tl, sel, end, o){ o=o||{}; FX.count(tl, sel, end, o);
    if (o.grow) tl.fromTo(sel, { scale:o.growFrom==null?0.8:o.growFrom }, { scale:1,
      duration:o.dur||1.4, ease:o.ease||'power2.out' }, o.at||0.3);
    tl.fromTo(sel, { scale:1 }, { scale:o.pulse==null?1.14:o.pulse, duration:0.2,
      ease:'back.out(1.3)', yoyo:true, repeat:1 }, (o.at||0.3) + (o.dur||1.4)); },
  // light beam sweeping across the frame (pair with a .hf-beam element, which sits at
  // left:-14% — travel is in viewport widths so it fully crosses any aspect)
  beamSweep: function(tl, sel, o){ o=o||{};
    // travel in page px, NOT vw: viewport units resolve against the PHYSICAL viewport while
    // the body is zoomed — '165vw' overshoots 2x at 4K. S.w is the logical page width.
    var _bx = o.x != null ? o.x : (S.w ? S.w * 1.65 : '165vw');
    tl.fromTo(sel, { x:0, opacity:0 }, { x:_bx, opacity:o.op==null?0.55:o.op,
      duration:edur(o.dur||0.5), ease:o.ease||'power3.in' }, o.at||0.4); },
  // typewriter reveal — textContent is a pure function of tl time
  typeOn: function(tl, sel, text, o){ o=o||{}; var el=document.querySelector(sel); if(!el) return;
    var obj={ n:0 }; el.textContent='';
    tl.to(obj, { n:String(text).length, duration:o.dur||Math.min(1.6, String(text).length*0.045), ease:'none',
      onUpdate:function(){ el.textContent = String(text).slice(0, Math.round(obj.n)); } }, o.at||0.2); },
  // 3D flip transition between two elements
  flipSwap: function(tl, outSel, inSel, o){ o=o||{}; var at=o.at==null?1:o.at, d=o.dur||0.38;
    if(!FX.q(outSel).length || !FX.q(inSel).length) return; // both targets must exist
    tl.to(outSel, { rotationX:88, opacity:0, transformOrigin:'50% 50%', transformPerspective:620, duration:d, ease:'power2.in' }, at);
    tl.fromTo(inSel, { rotationX:-88, opacity:0, transformPerspective:620 },
      { rotationX:0, opacity:1, duration:d, ease:'power2.out' }, at + d*0.85); },
  // depth-layer drift: each matched layer drifts at a different speed/direction for the scene
  parallax: function(tl, sel, o){ o=o||{}; var els=FX.q(sel), dur=(o.dur||TD);
    for (var i=0;i<els.length;i++){ var amp=(o.amp==null?16:o.amp)*(1+i*0.7)*((i%2)?-1:1);
      tl.to(els[i], { x:amp, y:amp*0.55, duration:dur/2, yoyo:true, repeat:1, ease:'sine.inOut' }, 0);
    } },
  // simulated camera move on the .hf-cam wrapper (slow push/pan across the whole scene).
  // profile:'front' completes the move in the first ~55% and then HOLDS — a slow push in the
  // back half of a scene drags the viewer's sightline (motion doctrine); default keeps the
  // legacy full-duration drift so existing templates render unchanged.
  camPush: function(tl, o){ o=o||{};
    var front = o.profile === 'front';
    tl.fromTo('.hf-cam', { scale:o.fromScale==null?1:o.fromScale, x:0, y:0 },
      { scale:o.scale==null?1.06:o.scale, x:o.x||0, y:o.y||0,
        duration:o.dur||(front?TD*0.55:TD),
        ease:o.ease||(front?'power2.out':'none'), transformOrigin:o.origin||'50% 50%' }, o.at||0); },
  // velocity-matched Z-axis content swap (zoom-through cut): the outgoing element accelerates
  // toward the viewer while blur+dim peak exactly at the hidden swap, and the incoming element
  // continues the same motion from behind, decelerating into the focal plane. inverse:true
  // moves AWAY from the viewer — reads as "arriving at" (payoff beats). Both sides share the
  // same peak blur (10px at text scale); blur rides the elements' own wrapper.
  zoomThrough: function(tl, outSel, inSel, o){ o=o||{};
    if (!FX.q(outSel).length || !FX.q(inSel).length) return;
    var at=o.at==null?1:o.at, px=o.blur==null?10:o.blur, inv=!!o.inverse;
    var d1=o.dur||0.2, d2=d1*1.8;
    tl.to(outSel, { scale:inv?0.8:1.2, filter:'blur('+px+'px)', duration:d1, ease:'power3.in' }, at)
      .to(outSel, { opacity:0.15, duration:d1, ease:'none' }, at)
      .set(outSel, { opacity:0 }, at+d1);
    tl.set(inSel, { opacity:0 }, 0);
    tl.fromTo(inSel, { scale:inv?1.25:0.8, opacity:0.15, filter:'blur('+px+'px)' },
      { scale:1, opacity:1, filter:'blur(0px)', duration:d2, ease:'power3.out' }, at+d1*0.85); },
  // sanctioned aliveness during a hold: a low-amplitude seeded positional jitter — keeps a
  // settled frame from feeling dead without the cheap "breathing scale" tell. Deterministic
  // (offsets come from rng at build time) and returns to rest.
  jitter: function(tl, sel, o){ o=o||{};
    var els=FX.q(sel); if(!els.length) return;
    var amp=o.amp==null?2.2:o.amp, at=o.at==null?0.6:o.at;
    var total=(o.total!=null?o.total:TD-at-0.15); if (total<0.8) return;
    var seg=o.seg||0.55, n=Math.max(2, Math.min(24, Math.floor(total/seg)));
    var kf=[]; for (var i=0;i<n-1;i++) kf.push({ x:(rng()*2-1)*amp, y:(rng()*2-1)*amp, duration:seg, ease:'sine.inOut' });
    kf.push({ x:0, y:0, duration:seg*0.7, ease:'sine.out' });
    tl.to(sel, { keyframes:kf }, at); },
  // zoom the camera INTO a non-centered element: scale about frame center + counter-translate
  // so the target lands centered (T = (C − e)·S). Measures ONCE at build time (legal — the
  // script body runs once); divide by the body zoom so 4K physical px become logical px.
  targetZoom: function(tl, sel, o){ o=o||{};
    var el=document.querySelector(sel); if(!el) return;
    var sc=o.scale==null?1.18:o.scale, at=o.at==null?0.5:o.at;
    var dur=o.dur||Math.max(1.0, ((o.until!=null?o.until:TD)-at));
    var z=(typeof S.zoom==='number'&&S.zoom>0)?S.zoom:1;
    var r=el.getBoundingClientRect(), W=S.w||window.innerWidth/z, H=S.h||window.innerHeight/z;
    var ex=(r.left+r.width/2)/z, ey=(r.top+r.height/2)/z;
    tl.to('.hf-cam', { scale:sc, x:(W/2-ex)*sc, y:(H/2-ey)*sc, duration:dur,
      ease:o.ease||'power2.inOut', transformOrigin:'50% 50%' }, at); },
  // rack focus: blur + dim the off-focus layer(s) so the focal element pops; optional release
  dofBlur: function(tl, sel, o){ o=o||{};
    var px=o.px==null?5:o.px, at=o.at==null?0.5:o.at, d=o.dur||0.6;
    tl.to(sel, { filter:'blur('+px+'px)', opacity:o.dim==null?0.6:o.dim, duration:d, ease:'power2.inOut' }, at);
    if (o.release!=null) tl.to(sel, { filter:'blur(0px)', opacity:1, duration:d, ease:'power2.inOut' }, o.release); },
  // fast entrance with a directional velocity streak: blur/skew peak at max speed, resolve at settle
  streakIn: function(tl, sel, o){ o=o||{};
    var at=o.at==null?0.2:o.at, from=o.from==null?260:o.from;
    tl.set(sel, { opacity:0 }, 0);
    tl.fromTo(sel, { x:from, opacity:0, skewX:from>0?-12:12, filter:'blur(6px)' },
      { x:0, opacity:1, skewX:0, filter:'blur(0px)', duration:edur(o.dur||0.5), ease:'expo.out' }, at); },
  // THE money-beat accent: a compression hit on the target + an expanding shock ring +
  // seeded sparks flying out. Ring/sparks are built ONCE at setup (positions measured then —
  // legal), all motion lives on tl. Use exactly once per scene, on the most important beat.
  impact: function(tl, sel, o){ o=o||{};
    var el=document.querySelector(sel); if(!el) return;
    var at=o.at==null?1:o.at, col=o.color||'#FFFFFF';
    tl.fromTo(sel,{scale:1},{scale:o.hit==null?1.07:o.hit,duration:0.13,ease:'power3.in'},at)
      .to(sel,{scale:1,duration:0.55,ease:'power3.out'},at+0.13);
    var z=(typeof S.zoom==='number'&&S.zoom>0)?S.zoom:1;
    var r=el.getBoundingClientRect(),cx=(r.left+r.width/2)/z,cy=(r.top+r.height/2)/z;
    var host=document.querySelector('.hf-near')||el.parentElement||document.body;
    var ring=document.createElement('div');
    ring.style.cssText='position:absolute;left:'+cx+'px;top:'+cy+'px;width:60px;height:60px;margin:-30px 0 0 -30px;border:3px solid '+col+';border-radius:50%;opacity:0;pointer-events:none';
    host.appendChild(ring);
    tl.fromTo(ring,{opacity:0.75,scale:0.4},{opacity:0,scale:o.ring==null?5.5:o.ring,duration:0.75,ease:'power2.out'},at+0.05);
    var n=o.sparks==null?7:o.sparks;
    for (var i=0;i<n;i++){
      var ang=rng()*6.2832, dist=(o.dist==null?150:o.dist)*(0.65+rng()*0.7);
      var s=document.createElement('div');
      s.style.cssText='position:absolute;left:'+cx+'px;top:'+cy+'px;width:7px;height:7px;border-radius:2px;background:'+col+';opacity:0;pointer-events:none';
      host.appendChild(s);
      tl.fromTo(s,{x:0,y:0,opacity:0.9,scale:1,rotation:rng()*90},
        {x:Math.cos(ang)*dist,y:Math.sin(ang)*dist,opacity:0,scale:0.3,rotation:'+='+Math.round(90+rng()*180),duration:0.55+rng()*0.35,ease:'power3.out'},at+0.05);
    } },
  // spin an SVG part about its OWN bbox center (svgOrigin) — CSS transform-origin misplaces
  // thin shapes (fill-box coords). For clock hands, fan blades, orbiting dots, radar sweeps.
  iconSpin: function(tl, sel, o){ o=o||{};
    var els=FX.q(sel);
    for (var i=0;i<els.length;i++){ var el=els[i], bb;
      try { bb=el.getBBox(); } catch(e){ continue; }
      var at=o.at==null?0.6:o.at, d=o.dur||2.2;
      tl.to(el, { rotation:o.rot==null?360:o.rot, svgOrigin:(bb.x+bb.width/2)+' '+(bb.y+bb.height/2),
        duration:d, repeat:o.repeat==null?Math.max(0, Math.floor((TD-at)/d)-1):o.repeat, ease:o.ease||'none' }, at);
    } },
  // scale breathing (glow stays in CSS — tweening the filter would clobber drop-shadow classes)
  pulseGlow: function(tl, sel, o){ o=o||{}; var d=o.dur||1.4;
    tl.to(sel, { scale:o.scale==null?1.06:o.scale, duration:d, yoyo:true,
      repeat:o.repeat==null?Math.max(1, Math.ceil((o.total||TD)/d)-1):o.repeat, ease:'sine.inOut' }, o.at==null?0.5:o.at); },
  // grid-aware stagger entrance for groups of chips/cards
  staggerGrid: function(tl, sel, o){ o=o||{}; if(!FX.q(sel).length) return;
    tl.from(sel, { opacity:0, scale:o.from==null?0.5:o.from, duration:o.dur||0.5, ease:'back.out(1.8)',
      stagger:{ each:o.each||0.05, grid:'auto', from:o.origin||'center' } }, o.at||0.2); },
  // ---- voice-sync helpers: read the narration's word timings straight from S.captions ----
  // flat word list [{start,end,word}] of the whole scene
  allWords: function(){ var out=[], cues=S.captions||[];
    for (var i=0;i<cues.length;i++){ var ws=cues[i].words||[]; for (var j=0;j<ws.length;j++) out.push((TSCALE===1&&!S.tplWarp)?ws[j]:{start:R2A(ws[j].start),end:R2A(ws[j].end),word:ws[j].word}); }
    return out; },
  // n accent times picked from long/number words with a minimum gap, LEAD before the word
  // lands; falls back to even spacing when the scene carries no captions. Pure fn of S.
  accents: function(n, o){ o=o||{}; var GAP=o.gap==null?1.2:o.gap, LEAD=0.12, d=TD;
    var u0=Math.min(0.8, d*0.12), u1=d-Math.min(0.9, d*0.14);
    var even=[]; for (var e=0;e<n;e++) even.push(+(u0+((e+0.5)*(u1-u0))/n).toFixed(2));
    var ws=FX.allWords(); if(!ws.length||n<1) return even;
    var scored=[]; for (var i=0;i<ws.length;i++){ var s=String(ws[i].word||'').replace(/[^0-9A-Za-zÀ-ỹ]/g,'');
      if (s.length<2) continue; scored.push({ t:Math.max(0.15, ws[i].start-LEAD), sc:s.length+(/[0-9]/.test(s)?8:0) }); }
    scored.sort(function(a,b){ return b.sc-a.sc || a.t-b.t; });
    var picked=[];
    for (var k=0;k<scored.length && picked.length<n;k++){ var c=scored[k];
      if (c.t<u0||c.t>u1) continue;
      var ok=true; for (var p=0;p<picked.length;p++) if (Math.abs(picked[p]-c.t)<GAP){ ok=false; break; }
      if (ok) picked.push(c.t); }
    for (var f=0;f<even.length && picked.length<n;f++){ var t=even[f];
      var ok2=true; for (var q=0;q<picked.length;q++) if (Math.abs(picked[q]-t)<GAP*0.6){ ok2=false; break; }
      if (ok2) picked.push(t); }
    picked.sort(function(a,b){ return a-b; });
    return picked; },
  // duration-adaptive phase map so a 3s and a 12s scene both feel authored
  phases: function(){ var d=TD;
    return { intro: Math.min(0.9, d*0.15), outroStart: d - Math.min(0.9, d*0.14), dur: d }; },
  // distribute elements across the narration's beats: element i enters on accent i and
  // (unless keep:true) exits before the next enters — a beat-synced FX.beat fan-out
  schedule: function(tl, sel, o){ o=o||{};
    var els = typeof sel==='string' ? Array.prototype.slice.call(FX.q(sel)) : sel;
    if (!els.length) return;
    var ts = FX.accents(els.length, o), ph = FX.phases();
    for (var i=0;i<els.length;i++){
      var t0 = ts[i]!=null ? ts[i] : ph.intro + (i*(ph.outroStart-ph.intro))/els.length;
      var t1 = o.keep ? ph.dur-0.1
        : Math.min(ph.dur-0.1, (i+1<els.length && ts[i+1]!=null) ? ts[i+1]+0.15 : ph.dur-0.1);
      FX.beat(tl, els[i], t0, Math.max(t0+0.6, t1), { 'in': o['in']||'rise', out: o.keep?'none':(o.out||'fade'), y: o.y, drift: o.drift });
    } },
  // full beat lifecycle: hidden from t=0, entrance at t0, micro-drift hold, exit before t1.
  // in: 'rise'|'pop'|'carrier'|'glitch'|'flip'   out: 'fade'|'whip'|'flip'|'blur'|'none'
  beat: function(tl, sel, t0, t1, o){ o=o||{};
    var hold = Math.max(0.45, (t1==null?t0+1.6:t1) - t0);
    // Cinema pacing: entrances land between 0.45–0.8s (sub-0.35s flashes read as jitter);
    // only very tight holds compress below the floor.
    var inD = Math.max(Math.min(0.45, hold*0.5), Math.min(0.8, hold*0.45));
    var outD = Math.min(0.5, hold*0.28);
    var outAt = t0 + hold - outD;
    tl.set(sel, { opacity:0 }, 0);
    if (o['in'] === 'glitch') {
      tl.set(sel, { x:-12, skewX:7 }, 0)
        .to(sel, { keyframes:[ { opacity:1, x:9, skewX:-5, duration:inD*0.3 }, { x:-6, skewX:3, duration:inD*0.25 },
          { x:0, skewX:0, opacity:1, duration:inD*0.45 } ] }, t0);
    } else if (o['in'] === 'carrier') {
      tl.fromTo(sel, { x:(o.from==null?300:o.from)*(o.dir||1), opacity:0 }, { x:0, opacity:1, duration:inD, ease:o.ease||'expo.out' }, t0);
    } else if (o['in'] === 'pop') {
      // smooth-beats-bouncy: pass ease:'power3.out' for the doctrine settle; the back.out(1.5)
      // default stays for template compatibility and the one deliberate playful accent
      tl.fromTo(sel, { scale:0.55, opacity:0 }, { scale:1, opacity:1, duration:inD, ease:o.ease||'back.out(1.5)' }, t0);
    } else if (o['in'] === 'flip') {
      tl.fromTo(sel, { rotationX:-86, opacity:0, transformPerspective:620 }, { rotationX:0, opacity:1, duration:inD, ease:o.ease||'power2.out' }, t0);
    } else {
      tl.fromTo(sel, { y:o.y==null?46:o.y, opacity:0 }, { y:0, opacity:1, duration:inD, ease:o.ease||'power3.out' }, t0);
    }
    if (o.drift !== false && hold > 1.1) {
      tl.to(sel, { y:'-=6', duration:Math.min(1.2,(hold-inD-outD)/2), yoyo:true, repeat:1, ease:'sine.inOut' }, t0+inD);
    }
    if (o.out === 'settle') {
      // persistent composition: the element STAYS after its beat — eased down to a calm
      // supporting state so the next beat can take focus without the screen ever emptying
      tl.to(sel, { scale:0.94, opacity:o.dim==null?0.72:o.dim, duration:Math.min(0.6, outD+0.2), ease:'power2.inOut' }, outAt);
    } else if (o.out === 'whip') {
      tl.to(sel, { x:-40, duration:outD*0.4, ease:'power2.out' }, outAt - outD*0.4)
        .to(sel, { x:o.exitX==null?480:o.exitX, opacity:0, skewX:-8, duration:outD, ease:'power3.in' }, outAt);
    } else if (o.out === 'flip') {
      tl.to(sel, { rotationX:86, opacity:0, transformPerspective:620, duration:outD, ease:'power2.in' }, outAt);
    } else if (o.out === 'blur') {
      tl.to(sel, { scale:1.14, opacity:0, filter:'blur(8px)', duration:outD, ease:'power2.in' }, outAt);
    } else if (o.out !== 'none') {
      tl.to(sel, { opacity:0, y:-18, duration:outD, ease:'power1.in' }, outAt);
    } },
};
`;

// Prepend the FX runtime to a template's script body.
export function fx(scriptBody) {
  return FX_SRC + '\n' + scriptBody;
}
