// The in-page runtime, part 2: the deterministic typesetting fixers (__fitMarks, __fitText,
// __safeZone, __margins, __deoverlap) that run before a frame is ever captured.
export const RUNTIME_TYPESET = `
  // Combining-mark typesetting repair — runs before AND after __fitText, and is idempotent.
  //
  // A capital carrying a stacked mark reaches up to 44% higher above the baseline than a Latin
  // capital (measured on every vendored face), so a line-height tuned for Latin leaves the mark
  // OUTSIDE the line box. Vietnamese is where this was found, but nothing about the repair is
  // Vietnamese: every number below comes from measureText on the element's OWN font, so a
  // Devanagari matra, a Thai tone stack and an Arabic harakat are measured the same way. Only
  // the trigger was Vietnamese, and that is the one thing changed here. Three things then go wrong and all three shipped: background-clip:text
  // paints only inside the box, so the mark is never painted at all; two lines collide, because
  // the box is shorter than the ink; an overflow:hidden wrapper cuts the mark off.
  //
  // Every number comes from the element's OWN resolved font via measureText, never a constant:
  // the safe line-height runs from 1.18 (Anton) to 1.41 (Nunito).
  // Any combining mark, in any script: Vietnamese tone marks after NFD, Devanagari matras, Thai
  // tone stacks, Arabic harakat, Hebrew niqqud. CJK has none and needs no repair.
  var MARKED = /\\p{M}/u;
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

  window.__fitMarks = () => {
    const leaves = [];
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const t = n.nodeValue;
      if (!t || !t.trim()) continue;
      // NFD so Vietnamese precomposed letters expose their marks; Thai and Devanagari marks are
      // never precomposed and match either way.
      if (!MARKED.test(t.normalize('NFD'))) continue;
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
`;
