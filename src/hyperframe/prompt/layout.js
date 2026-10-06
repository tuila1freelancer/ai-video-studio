// Layout doctrine: ratio class, the reference app's hard-threshold tables (P38/P39) and the per-ratio distribution rules with the zone budget (P41).

// P38 (reference-parity layout): the reference app does NOT balance layout with prose — it
// injects EXACT px thresholds per ratio and MANDATES using them directly in code, plus per-ratio
// distribution rules. That concreteness is what keeps its frames balanced and non-center-clumped.
// We emit the same, computed from the real canvas so any aspect gets correct bounds. The caption
// band matches the validate.js geometry gate (bottom ~20%).
export function ratioClass(w, h) {
  const r = w / h;
  if (r >= 1.12) return '16:9'; // any landscape → wide-frame rules
  if (r >= 0.9) return '1:1';
  if (r >= 0.72) return '4:5';
  return '9:16';
}
// P39 (raw-GSAP reference port): the reference app injects HARDCODED INTEGER threshold TABLES per
// aspect ratio — not formulas — and mandates using them verbatim. That concreteness is most of why
// its frames land balanced. We ship the SAME integer tables (at the reference resolutions the values
// are byte-identical; a non-standard canvas scales them proportionally so any size stays correct).
const REF_THRESHOLDS = {
  '16:9': { rw: 1920, rh: 1080, side: 90, top: 70, bottom: 90, textW: 980, heroW: 920, cardMin: 520, cardMax: 760, subjectH: 450, textBlockH: 300, safeCW: 1320, safeCH: 620, gap: 80 },
  '9:16': { rw: 1080, rh: 1920, side: 70, top: 90, bottom: 130, textW: 830, heroW: 810, cardMin: 620, cardMax: 780, subjectH: 990, textBlockH: 360, safeCW: 760, safeCH: 980, gap: 36 },
  '1:1': { rw: 1080, rh: 1080, side: 70, top: 70, bottom: 90, textW: 760, heroW: 730, cardMin: 520, cardMax: 700, subjectH: 700, textBlockH: 280, safeCW: 740, safeCH: 740, gap: 32 },
  '4:5': { rw: 1080, rh: 1350, side: 65, top: 60, bottom: 105, textW: 790, heroW: 760, cardMin: 600, cardMax: 820, subjectH: 760, textBlockH: 300, safeCW: 780, safeCH: 760, gap: 34 },
};
export function viewportBlock(w, h, captionsOn) {
  const cls = ratioClass(w, h);
  const T = REF_THRESHOLDS[cls] || REF_THRESHOLDS['16:9'];
  const sx = w / T.rw, sy = h / T.rh; // 1.0 at the reference resolution; scales any other canvas
  const X = (v) => Math.round(v * sx), Y = (v) => Math.round(v * sy);
  const sideP = X(T.side), topP = Y(T.top), bottomP = Y(T.bottom);
  const contentMaxY = h - bottomP;
  const lowerThirdY = Math.round(h * 0.807); // matches the validate.js caption-band geometry gate
  const inset = Math.max(6, Math.round(Math.min(sx, sy) * 10)); // reference #content inset:10px
  return [
    `VIEWPORT — hard layout thresholds for THIS ${w}x${h}px canvas (${cls}). USE THESE EXACT VALUES DIRECTLY in your CSS/JS — do NOT estimate:`,
    `- SIDE_PADDING=${sideP}px · TOP_PADDING=${topP}px · BOTTOM_PADDING=${bottomP}px — nothing may sit outside x=[${sideP}..${w - sideP}] or y=[${topP}..${contentMaxY}].`,
    `- SAFE_CENTER_W=${X(T.safeCW)}px · SAFE_CENTER_H=${Y(T.safeCH)}px — a FOOTPRINT CEILING for ONE construction, NOT the box the composition lives in (every point inside the padding line is legal ground) · SPLIT_GAP=${X(T.gap)}px minimum between side-by-side blocks.`,
    `- TEXT_MAX_W=${X(T.textW)}px (any single text block) · TEXT_BLOCK_MAX_H=${Y(T.textBlockH)}px (no taller vertical text stack).`,
    `- HERO_MAX_W=${X(T.heroW)}px × SUBJECT_MAX_H=${Y(T.subjectH)}px (the hero construction; leave room for its counterweight).`,
    `- CARD_MIN_W=${X(T.cardMin)}px · CARD_MAX_W=${X(T.cardMax)}px (any panel/card).`,
    // Evenness outranks subtitle avoidance. The band is no longer a
    // no-go zone that evicts a third of the frame and pushes every composition upward — only the
    // BIGGEST readable text stays out of it; structure, panels and ambience may live there.
    captionsOn
      ? `- LOWER_THIRD_Y=${lowerThirdY}px: karaoke subtitles run below this line. Keep the PRIMARY headline and any long label above it, but the band is still yours for structure, panels, charts, ambience and short labels — do NOT leave the bottom of the frame empty.`
      : `- Subtitles are OFF — use the full height down to y=${contentMaxY}px (still keep the ${topP}px / ${bottomP}px margins).`,
    `- CONTENT is inset ${inset}px from every edge. Put every element in a container with explicit top/left/width/height OR flex/grid — never vague values that overflow. Nothing touches the edge of the safe zone. These numbers are MAXIMA AND MARGINS — how big one block may be and how near an edge it may sit; they never nominate a destination. If a SIZE conflicts with your concept, THE THRESHOLDS WIN; if you have read one as a reason to move the composition inward, you have misread a maximum as a target.`,
    `- The page body is EXACTLY ${w}x${h}px and is upscaled LOSSLESSLY to output; never assume any other resolution.`,
  ].join('\n');
}

// Per-ratio distribution rules (reference-app parity: its RULES_FOR_<ratio> blocks). A weak
// model's default gravity is center-stack; these push the composition to fill the frame's real
// shape — a wide frame spreads horizontally, a tall frame stacks in reading order.
export function ratioRulesBlock(w, h) {
  const cls = ratioClass(w, h);
  // Each branch turns master rule #2's zone budget into the quota for THIS shape, then shows one
  // legal worked map with its arithmetic spelled out. The map is a PATTERN to reason from, never
  // coordinates to copy — every branch says so, or every scene would land on identical numbers.
  if (cls === '16:9') {
    return `LAYOUT FOR 16:9 (wide, cinematic) — THE ZONE BUDGET FOR THIS CANVAS:
- QUOTA: ≥7 of the 9 zones anchored · TL TR BL BR each ≥1 · every row ≥2 · every column ≥2 · MC ≤1.
- THE WIDTH DOES THE READING: your three biggest masses sit in three DIFFERENT COLUMNS — an off-centre hero, a real counterweight across ≥SPLIT_GAP, and a third mass — never all in one row. Two clear columns or a 60/40 split are encouraged; the hero stays ≤HERO_MAX_W so it never becomes one long hard-to-read line.
- A wide frame with everything on the centre axis is the #1 amateur tell — it wastes the shape it was cut for.
- WORKED MAP (a legal PATTERN — reuse the ARITHMETIC, invent your own numbers, shift every value by ≥6% and never repeat a left% or a top%): TL kicker 15/17 · TC headline 50/13 · TR legend 84/19 · ML hero keyword 30/46 · MR instrument card 74/44 · BL axis + scale 19/78 · BC tick rail 50/88 · BR stat readout 82/74 → 8/9 zones · corners 4/4 · rows 3/2/3 · cols 3/2/3 · MC 0. LEGAL.`;
  }
  if (cls === '9:16') {
    return `LAYOUT FOR 9:16 (tall, mobile-first) — THE ZONE BUDGET FOR THIS CANVAS:
- QUOTA: all THREE ROWS anchored with ≥2 anchors EACH · TL TR BL BR each ≥1 · ≥7 of the 9 zones · MC ≤1. A card at CARD_MIN_W–CARD_MAX_W centred at 50% already spans all three columns, so on this shape the ROWS are what you must earn.
- THE HEIGHT DOES THE READING: your three biggest masses sit in three DIFFERENT ROWS — top, middle, bottom, in narration order — never all in one column. Keep the hero ≤SUBJECT_MAX_H so one mass never swallows two rows.
- WORK THE MARGINS: a tall frame starves its corners worst. A kicker top-left, an icon or unit top-right, an index rail down one side and a small readout at a bottom corner cost nothing and pay four zones.
- WORKED MAP (a legal PATTERN — reuse the ARITHMETIC, invent your own numbers, shift every value by ≥6% and never repeat a left% or a top%): TL kicker 18/10 · TR icon 82/12 · hero keyword 50/34 spanning L-C-R · MR side rail 88/46 · BL step label 19/72 · BC support card 50/80 spanning L-C-R · BR stat 82/88 → rows 2/2/3 · corners 4/4 · MC 0. LEGAL.`;
  }
  if (cls === '1:1') {
    return `LAYOUT FOR 1:1 (square) — THE ZONE BUDGET FOR THIS CANVAS:
- QUOTA: ≥7 of the 9 zones anchored · all FOUR corners ≥1 · every row ≥2 · every column ≥2 · MC ≤1.
- Symmetry is the shape's gift and its trap: balance DIAGONALLY (an accent in one corner answered across the frame) instead of mirroring left/right, or every scene comes out the same.
- WORKED MAP (a legal PATTERN — reuse the ARITHMETIC, invent your own numbers, shift every value by ≥6% and never repeat a left% or a top%): TL bracket 16/16 · TC kicker 50/12 · TR ghost numeral 84/18 · ML label pair 17/50 · MR instrument 80/47 · BL tick rail 18/82 · BC hero keyword 50/72 · BR unit 84/84 → 8/9 zones · corners 4/4 · MC 0. LEGAL.`;
  }
  return `LAYOUT FOR 4:5 (portrait) — THE ZONE BUDGET FOR THIS CANVAS:
- QUOTA: ≥7 of the 9 zones anchored · all FOUR corners ≥1 · every row ≥2 · every column ≥2 · MC ≤1.
- Slightly TOP-HEAVY so the hero leads, but "top-heavy" means the hero sits above centre — it never means the bottom row is empty; a bare bottom third reads as a cropped mistake.
- WORKED MAP (a legal PATTERN — reuse the ARITHMETIC, invent your own numbers, shift every value by ≥6% and never repeat a left% or a top%): TL kicker 17/13 · TR icon 83/15 · ML hero keyword 44/33 · MR stat 82/44 · BL caption 19/76 · BC scale rail 50/86 · BR bracket 84/80 → rows 2/2/3 · corners 4/4 · MC 0. LEGAL.`;
}
