// The in-page runtime, part 3: __init (fonts, animations, the paused GSAP timeline), the
// real↔authored time warp, __seek(t), and the live preview loop the browser uses.
export const RUNTIME_SEEK = `
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
    try { window.__fitMarks(); } catch(e){}
    try { window.__fitText(); } catch(e){}
    try { window.__fitMarks(); } catch(e){}
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
