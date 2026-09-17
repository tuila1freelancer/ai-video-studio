// The in-page runtime, part 1: seek hooks, the seeded rng, the background canvas, caption
// karaoke and the progress bar — every layer a pure function of t. Continued in
// runtime-typeset.js and runtime-seek.js; runtime.js concatenates the three into one script.
export const HANDOFF = `
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

export const RUNTIME_CORE = `
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
      capEl.innerHTML = ci < 0 ? '' : cues[ci].words.map((w,j)=>'<span class="capw" data-j="'+j+'">'+w.word.replace(/&/g,'&amp;').replace(/</g,'&lt;')+'</span>').join(S.capJoin != null ? S.capJoin : ' ');
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
`;
