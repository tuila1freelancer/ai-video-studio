// A real caption background, drawn as a shape instead of borrowed from the border.
//
// ASS has one background: `BorderStyle: 3`, an "opaque box" painted by the outline machinery. It
// gives a single padding value for all four sides, square corners only, and — because libass draws
// one box per override RUN — a translucent one seams at every word boundary, which karaoke creates
// by definition. All three limits were confirmed on rendered frames, not read off the format.
//
// So the box stops being a border. ASS drawing mode (`{\p1}` + `m`/`l`/`b` commands) can draw any
// filled path, which buys independent padding per side, a real corner radius, its own fill opacity
// and its own border colour — one shape per cue, so nothing seams.
//
// The price is that a shape has to be given a SIZE, and ASS cannot measure text. Chrome can, using
// the very font file that is about to be staged into the burn's `fontsdir`, so the measurement and
// the render agree on the typeface by construction. Two rules keep them agreeing on everything
// else: the caption is positioned explicitly with `\pos` rather than left to libass's margin
// arithmetic, and it is never allowed to wrap (`WrapStyle: 2` + our own line breaks), because a
// line the measurement did not know about is a box the text hangs out of.
import { getBrowser, chromeAvailable } from '../media/puppeteer.js';
import { assAlpha, toAssColor } from './color.js';

/**
 * A rounded rectangle in ASS drawing commands, top-left at 0,0.
 *
 * The corners are cubic beziers with both control points ON the corner. That is the standard
 * approximation and it is very slightly tighter than a true quarter-circle — invisible at any
 * radius a caption uses, and it keeps the path to four curves.
 */
export function roundedRectPath(w, h, radius) {
  const r = Math.max(0, Math.min(Math.round(radius), Math.floor(Math.min(w, h) / 2)));
  if (!r) return `m 0 0 l ${w} 0 l ${w} ${h} l 0 ${h}`;
  return [
    `m ${r} 0`, `l ${w - r} 0`, `b ${w} 0 ${w} 0 ${w} ${r}`,
    `l ${w} ${h - r}`, `b ${w} ${h} ${w} ${h} ${w - r} ${h}`,
    `l ${r} ${h}`, `b 0 ${h} 0 ${h} 0 ${h - r}`,
    `l 0 ${r}`, `b 0 0 0 0 ${r} 0`,
  ].join(' ');
}

/**
 * Where the caption sits, in absolute frame pixels, for a given measured line.
 *
 * `\pos` with `\an` puts the anchor point exactly here, so the box and the text are placed from
 * the SAME number and cannot drift apart. Vertical is a distance from the bottom, matching what
 * every existing project renders.
 */
export function captionAnchor(style, { w, h }) {
  const marginH = Math.round(w * ((style.marginHPct != null ? style.marginHPct / 100 : style.marginPct) ?? 0.06));
  const y = Math.round(h - h * ((style.marginVPct ?? style.bottomPct ?? 12) / 100));
  const an = style.alignH ?? 2;
  const x = an === 1 ? marginH : an === 3 ? w - marginH : Math.round(w / 2);
  return { x, y, an, marginH };
}

/**
 * The body of the `{\p1}` drawing event for one cue's background — overrides and path, no
 * Dialogue wrapper, so the caller keeps ownership of timing and layer.
 *
 * `\an7` because a shape has no baseline to align to: the path's own 0,0 lands on the position
 * given. The anchor is the same one the text uses, so the two cannot drift apart.
 */
export function boxDrawing(style, metric, size) {
  const box = style.box;
  if (!box || !metric || !(metric.width > 0)) return null;
  const { x, y, an } = captionAnchor(style, size);
  const bw = Math.round(metric.width + box.padding.left + box.padding.right);
  const bh = Math.round(metric.height + box.padding.top + box.padding.bottom);
  // the text is anchored bottom-{left,centre,right}; the box hangs off the same point
  const left = an === 1 ? x - box.padding.left : an === 3 ? x - bw + box.padding.right : Math.round(x - bw / 2);
  const top = y - Math.round(metric.height) - box.padding.top;
  const border = box.borderWidth > 0 && box.borderColor
    ? `\\bord${box.borderWidth}\\3c${toAssColor(box.borderColor)}\\3a&H00&`
    : '\\bord0';
  return `{\\an7\\pos(${left},${top})\\c${toAssColor(box.color)}\\1a${assAlpha(box.opacity)}`
    + `${border}\\shad0\\p1}${roundedRectPath(bw, bh, box.radius)}{\\p0}`;
}

/**
 * Measure every distinct caption line through Chrome, with the burn's own font file.
 *
 * One page for the whole video: the cost is a single Chrome page load against fifteen minutes of
 * concat, and it happens before the encode starts so a failure is cheap.
 *
 * Line breaking happens HERE rather than in libass. A drawn box is sized from a measurement, so
 * libass reflowing the text into a second line would leave the box fitting a line that no longer
 * exists — hence `WrapStyle: 2` and our own breaks. Doing it during the measurement is also the
 * only place that can break on real pixel width instead of a character count.
 *
 * @param {string[]} texts the exact strings that will be burned (after text case)
 * @param {object} style output of burnStyleFrom
 * @param {string|null} fontFile the .ttf/.otf already resolved for the burn
 * @param {{w:number,h:number}} size the real output frame
 * @returns {Promise<Map<string,{width:number,height:number,breakAfter:number[]}>>}
 */
export async function measureCaptions(texts, style, fontFile, size) {
  const wanted = [...new Set(texts.filter((t) => t && t.trim()))];
  if (!wanted.length) return new Map();
  if (!chromeAvailable()) {
    throw new Error('cần Chrome để đo bề rộng chữ cho khung nền phụ đề — hãy tắt "Khung nền" '
      + 'trong phần Phụ đề, hoặc cài Chrome.');
  }
  const { marginH } = captionAnchor(style, size);
  const pad = (style.box?.padding?.left || 0) + (style.box?.padding?.right || 0);
  const limits = {
    maxWidth: Math.max(120, size.w - marginH * 2 - pad),
    maxChars: style.maxChars || 0,
    maxLines: Math.max(1, style.maxLines || 3),
    scaleX: (style.scaleX ?? 100) / 100,
  };
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 2200, height: 400, deviceScaleFactor: 1 });
    const css = [
      fontFile ? `@font-face{font-family:BurnFace;src:url('file://${fontFile}')}` : '',
      'body{margin:0;background:#000}',
      'span.m{display:inline-block;white-space:pre;font-family:BurnFace,sans-serif;'
        + `font-size:${style.fontSizePx}px;line-height:1;`
        + `font-weight:${style.weight || 800};`
        + `${style.italic ? 'font-style:italic;' : ''}`
        + `${style.letterSpacing ? `letter-spacing:${style.letterSpacing}px;` : ''}}`,
    ].join('\n');
    await page.setContent(`<style>${css}</style><body></body>`, { waitUntil: 'load', timeout: 20000 });
    const raw = await page.evaluate(async (texts_, lim) => {
      try { if (document.fonts?.ready) await document.fonts.ready; } catch { /* ignore */ }
      const span = document.createElement('span');
      span.className = 'm';
      document.body.appendChild(span);
      const measure = (s) => { span.textContent = s; return span.getBoundingClientRect(); };
      const out = [];
      for (const text of texts_) {
        const words = text.split(' ');
        // greedy fill: keep adding words while the line still fits, then break. ASS ScaleX
        // stretches glyphs after layout, so the budget shrinks by the same factor.
        const budget = lim.maxWidth / lim.scaleX;
        const lines = [];
        const breakAfter = [];
        let cur = [];
        words.forEach((word, i) => {
          const next = [...cur, word];
          const tooWide = measure(next.join(' ')).width > budget;
          const tooLong = lim.maxChars > 0 && next.join(' ').length > lim.maxChars;
          if (cur.length && (tooWide || tooLong) && lines.length + 1 < lim.maxLines) {
            lines.push(cur.join(' '));
            breakAfter.push(i - 1);
            cur = [word];
          } else {
            cur = next;
          }
        });
        if (cur.length) lines.push(cur.join(' '));
        const rects = lines.map((l) => measure(l));
        out.push({
          text,
          width: Math.max(...rects.map((r) => r.width)),
          height: rects.reduce((a, r) => a + r.height, 0),
          breakAfter,
        });
      }
      span.remove();
      return out;
    }, wanted, limits);
    // ASS ScaleX/Y stretch the glyphs AFTER layout, so they multiply the measurement rather than
    // being expressible in the CSS above.
    const sx = limits.scaleX;
    const sy = (style.scaleY ?? 100) / 100;
    return new Map(raw.map((m) => [m.text, {
      width: m.width * sx,
      height: m.height * sy,
      breakAfter: m.breakAfter,
    }]));
  } finally {
    await page.close().catch(() => {});
  }
}
