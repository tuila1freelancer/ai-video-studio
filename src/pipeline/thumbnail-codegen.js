// LLM-authored HTML thumbnail (P40) — reference-app parity.
//
// The reference app asks its model for a full STATIC HTML page and screenshots it headless,
// which is why its thumbnails are compositions rather than "title over a photo". We do the same,
// with two differences that make it safe here:
//   • the page is sanitized and re-shelled by US (our vendored fonts, the locked palette, the
//     exact canvas), so a model can style but never break out of the frame or reach the network;
//   • a failure is NOT loud — a thumbnail is packaging, not the video, so an unusable reply falls
//     back to the deterministic composition builder that shipped before this feature.
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { chat, llmEnabled } from '../providers/llm.js';
import { screenshotHtml, chromeAvailable } from '../media/puppeteer.js';

/**
 * Cover art is captured at DOUBLE the platform's own pixels.
 *
 * Every platform re-encodes what it is given, and the sharpest result comes from handing it more
 * detail than it will keep: 2560×1440 downscaled to 1280×720 by YouTube beats 1280×720 re-encoded
 * in place, because the resampling has real subpixel data to work from instead of the artefacts of
 * a single-resolution rasterisation.
 *
 * It is a DEVICE scale, not a layout scale — the design is still laid out in the platform's own
 * coordinate space, so an inset of 4.5% is still 4.5% and a 96px headline is still 96 authored px.
 * Doubling the viewport instead would halve the relative size of everything the model wrote.
 *
 * 2 and not 3: at 2× a JPEG lands around 0.4–0.9 MB, comfortably inside YouTube's 2 MB ceiling,
 * and Chrome paints one capture in about the same time. 3× buys detail no platform keeps and files
 * that get refused.
 */
export const COVER_SCALE = 2;

/** Bytes on disk, or null — the panel warns when a cover is over a platform's upload ceiling. */
const statSize = (p) => { try { return statSync(p).size; } catch { return null; } };
import { fontsCss } from '../animation/harness.js';
import { userFontsCss } from '../animation/userfonts.js';
import { orientationOf } from '../publish/platforms.js';

// Composition briefs for the A/B lab — one per variant, so three thumbnails differ by DESIGN
// rather than by a random re-roll of the same idea.
const COMPOSITIONS = [
  'Bottom-weighted: a huge headline anchored low-left over a rich graphic field, with one accent rule and generous air above.',
  'Centre punch: one enormous centred hook phrase, radial light behind it, the supporting element small and off to one side.',
  'Split frame: a bold kicker band across the top, the headline in the lower two-thirds, and a strong graphic block occupying the opposite half.',
  'Before/after: one hard vertical seam down the middle — left side muted, cluttered, cool; right side accent-lit, clean, ordered. Headline straddles the seam.',
  'Giant numeral: one enormous number bleeding off the top-right edge at low opacity, the headline tucked into the negative space it leaves.',
  'Forbidden mark: a thick accent circle-with-slash sitting over the wrong thing, headline filling the opposite half.',
  'Arrow focus: a heavy accent arrow driving from the headline into one highlighted detail, everything else dimmed back.',
  'Chat frame: two stylised chat bubbles — a short bad question, a wall of reply — with the headline above them.',
  'Two-column compare: two labelled panels side by side, one accent-lit and one muted, headline as a band across the top.',
  'Spotlight object: a single small glowing focal object dead centre with deep vignette, the headline wrapping around it in two lines.',
  'Diagonal band: the headline riding a strong diagonal accent band across the frame, graphic texture behind it.',
  'Stacked words: three words stacked as three full-width lines, each line a different weight and colour, filling most of the canvas.',
];

const SYS = `You design VIDEO THUMBNAILS as a single static HTML page rendered once by headless Chrome into one image.

THIS IS A STILL IMAGE, NOT A SCENE. No animation, no <script>, no GSAP, no @keyframes, no setTimeout — anything that moves is wrong here.

RULE 1 — TWO ZONES THAT NEVER TOUCH.
Before writing any CSS, split the canvas into a TEXT ZONE and an ART ZONE and keep every element strictly inside its own zone. Pick ONE split:
  (a) vertical: text 55% of one side, art 45% of the other
  (b) horizontal: text the lower 45%, art the upper 55% (or inverted)
The only thing allowed to cross the boundary is a soft background wash — gradients, blurred light blobs, a faint grid. Any SOLID shape, icon, card, badge, chart or illustration landing on top of the headline is a FAILED thumbnail. Build the split with CSS grid or flex, never by stacking absolutely-positioned boxes and hoping they miss each other.

RULE 2 — IT MUST SURVIVE BEING RESHOT AT ANOTHER SHAPE.
The same markup is re-photographed at several aspect ratios. Size and place everything in %, vw/vh, fr, clamp() and flex — never fixed px offsets, never negative margins, never position:absolute with hard top/left numbers for anything that carries meaning. A layout that only works at one ratio is wrong.

RULE 3 — WHAT ACTUALLY MAKES SOMEONE CLICK.
A thumbnail is not a title card; it promises a payoff in one glance.
- Show the TENSION or the RESULT, not the topic. "before vs after", "the wrong way crossed out", "the one thing you missed" beat a neutral illustration every time.
- ONE focal point. The eye lands in one place, then reads the headline. Two competing focal points read as noise.
- The headline is 3-6 words — a HOOK, not the video title: curiosity, a number, a warning, or a promise.
- Emotion beats information. A face, a red circle-slash, a giant arrow, a stark comparison do work a diagram cannot.

RULE 4 — SIZE AND LEGIBILITY.
- Readable at 120px wide on a phone. Squint: if the headline is not the first thing you read, start over.
- The headline spans at least 55% of the canvas WIDTH and at least 30% of its HEIGHT. It is by far the LARGEST thing in the frame — if the art competes with it for size, the art is too big.
- At most TWO small supporting text elements besides the headline. Zero is better than two.
- Text never touches an edge, is never clipped, never overlaps other text.

RULE 4b — THE ART ZONE MUST MEAN SOMETHING.
Whatever fills the art zone has to be recognisable in half a second and has to be ABOUT this video.
- ONE identifiable object or symbol, drawn large: a face, a phone, a brain, a lock, a crossed-out thing, a giant arrow, a huge number, a before/after pair.
- BANNED: grey rounded bars, skeleton/wireframe placeholders, empty cards, abstract rectangles, loading-state mockups, decorative dot grids as the subject. Those read as an unfinished page, not as a picture — they are worse than leaving the zone empty.
- If you cannot think of a meaningful object, make the headline fill the whole frame instead. A pure-type thumbnail beats a thumbnail with filler art.

RULE 5 — BANNED OUTRIGHT.
- Technical or English decoration labels: no "NEXT_TOKEN_P", no "VECTOR_SPACE 12,288 DIMS", no "PROB: 0.98", no "TOKEN_01", no "WEIGHTS", no fake telemetry, no code identifiers, no floating micro-badges of jargon. The audience is a beginner; jargon pushes them away.
- Small print that is not plain Vietnamese a newcomer understands.
- Stock-photo look, lorem, watermarks, fake browser or app chrome.
- Colours and fonts outside the locked palette and fonts given (white/black/transparent always allowed).

CHECK YOUR OWN WORK BEFORE REPLYING.
1. Does any solid element sit on top of the headline? Move it into the art zone.
2. Is the headline at least 55% of the width and the largest thing in frame? Make it bigger.
2b. Is the art a recognisable object, or is it grey bars and empty cards? If it is filler, delete it and let the type fill the frame.
3. Any English or technical label? Delete it.
4. Would this hold together if the frame were 20% taller? Convert fixed offsets to relative units.
5. Squinting, is there exactly ONE focal point? Remove the competing one.

Build real depth with CSS — gradients, glows, blurred light blobs, geometric blocks, thick rules, inline SVG, layered panels — but keep those layers inside the art zone.

OUTPUT: ONLY the markup that goes INSIDE the stage — a fragment, not a document. Start with a <style> block containing your CSS, then your HTML elements. No <!DOCTYPE>, no <html>, no <head>, no <body>, no markdown fence, no explanation.`;

/**
 * Swap `{{asset:NAME}}` placeholders for the resolved data URIs, then strip any that stayed
 * unresolved (and the <img> around them) so a hallucinated name can never 404 the render.
 * Same contract as the scene lane's applyAssetMedia, so the model only has to learn one.
 */
export function applyThumbAssets(fragment, media = []) {
  let html = String(fragment || '');
  for (const a of media) {
    if (!a?.name || !a?.uri) continue;
    const re = new RegExp(`\\{\\{\\s*asset\\s*:\\s*${a.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\}\\}`, 'gi');
    html = html.replace(re, a.uri);
  }
  return html.replace(/<img\b[^>]*\{\{\s*asset\s*:[^}]*\}\}[^>]*>/gi, '').replace(/\{\{\s*asset\s*:[^}]*\}\}/gi, '');
}

/** Strip anything that could animate, execute, or fetch — a thumbnail is one static paint. */
export function sanitizeThumbFragment(raw) {
  let s = String(raw || '').trim();
  s = s.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/i, '');            // stray fence
  s = s.replace(/<!DOCTYPE[^>]*>/gi, '')
    .replace(/<\/?(?:html|head|body)\b[^>]*>/gi, '')                      // full doc → fragment
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<(?:iframe|object|embed|link|meta)\b[^>]*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')        // inline handlers
    .replace(/@import[^;]+;/gi, '')
    .replace(/(?:src|href)\s*=\s*["'](?:https?:)?\/\/[^"']*["']/gi, '')   // external resources (a data: URI is local — kept)
    .replace(/url\(\s*["']?(?:https?:)?\/\/[^)]*\)/gi, 'none')
    .replace(/animation\s*:[^;"}]*/gi, '')                                // no motion in a still
    .replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/gi, '');
  return s.trim();
}

function shell(fragment, { w, h, guide }) {
  const p = guide?.palette || {};
  const f = guide?.fonts || {};
  const inset = Math.round(Math.min(w, h) * 0.045);
  // GEOMETRY IS INLINE, NOT IN THE STYLESHEET. The fragment's own <style> is parsed AFTER ours,
  // so a model that writes `#content { position: relative }` — a reasonable thing to write, and
  // one really did — would beat a head rule, collapse the box to height:0 (its children are all
  // absolute) and render a solid black image. An inline style outranks any author rule, so the
  // model can restyle the canvas (background, font, radius) but never move or collapse it.
  const box = `position:absolute;top:${inset}px;left:${inset}px;right:${inset}px;bottom:${inset}px;overflow:hidden`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${fontsCss()}
${userFontsCss()}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${w}px;height:${h}px;overflow:hidden;background:${p.bg || '#0b1220'}}
body{font-family:${f.display || 'Be Vietnam Pro'},Arial,sans-serif;color:${p.ink || '#fff'};-webkit-font-smoothing:antialiased}
.txt{display:block;line-height:1.08;overflow:visible;padding-top:.12em;padding-bottom:.06em}
</style></head><body><div id="stage" style="position:relative;width:${w}px;height:${h}px;overflow:hidden;background:${p.bg || '#0b1220'}"><div id="content" style="${box}">${fragment}</div></div></body></html>`;
}

/**
 * Rasterize a thumbnail FRAGMENT (already sanitized or hand-edited) through our own shell.
 * Split out so the owner can re-render an edited design without paying for another generation.
 * @returns {Promise<string|null>} the written image path.
 */
export async function renderThumbnailFragment(fragment, { guide, size, outPath, media = [], scale = COVER_SCALE } = {}) {
  if (!chromeAvailable()) return null;
  const clean = sanitizeThumbFragment(fragment);
  if (clean.length < 40) return null;
  const w = size?.w || 1280, h = size?.h || 720;
  return screenshotHtml(shell(applyThumbAssets(clean, media), { w, h, guide }), { w, h, outPath, scale });
}

/** The owner's own pictures, offered to the model by NAME (P40 — it was text+CSS only before). */
function assetBlock(media = []) {
  const list = (media || []).filter((m) => m?.name && m?.uri);
  if (!list.length) return '';
  return `\nOWNER'S PICTURES you may use (reference one with the placeholder EXACTLY as written — never invent a src):
${list.map((m) => `- {{asset:${m.name}}}`).join('\n')}
Use at most ONE, as the focal subject or a background layer under a dark gradient — the headline must stay the loudest thing in the frame. Ignore them entirely if a pure graphic composition is stronger.`;
}

/**
 * Edit an EXISTING thumbnail design by instruction (P42), e.g. "làm tiêu đề to hơn và đổi sang
 * vàng, giữ nguyên phần còn lại". Re-designing from scratch loses everything the owner liked;
 * this returns the same markup with only the requested change applied.
 * @returns {Promise<string|null>} the edited fragment, or null when unusable.
 */
export async function editThumbnailFragment(fragment, instruction, { guide, llm = null, onLog = () => {} } = {}) {
  const current = sanitizeThumbFragment(fragment);
  const want = String(instruction || '').trim();
  if (!current || !want || !llmEnabled(llm)) return null;
  const p = guide?.palette || {};
  try {
    const reply = await chat([
      { role: 'system', content: `${SYS}\n\nYOU ARE EDITING an existing thumbnail, not designing a new one. Apply ONLY what is asked and change nothing else — same structure, same elements, same wording, same positions, except where the instruction requires otherwise. Return the COMPLETE edited fragment (style block + markup), never a diff and never a fragment of it.` },
      { role: 'user', content: `LOCKED PALETTE: bg ${p.bg || '#0b1220'} · ink ${p.ink || '#ffffff'} · accents ${(p.accents || ['#f7b500']).join(' ')}

CURRENT THUMBNAIL:
${current}

CHANGE REQUESTED: ${want}

Reply with ONLY the complete edited <style> block and markup.` },
    ], { temperature: 0.35, maxTokens: 4000, llm });
    const next = sanitizeThumbFragment(reply);
    // a reply that collapsed the design is a failed edit, not an edit worth shipping
    if (next.length < Math.max(80, current.length * 0.4)) { onLog('thumbnail edit: reply quá ngắn — giữ bản cũ'); return null; }
    return next;
  } catch (e) { onLog(`thumbnail edit: bỏ qua (${e.message.slice(0, 120)})`); return null; }
}

/**
 * Design one thumbnail with the LLM and rasterize it.
 * @returns {Promise<{path,fragment}|null>} the written image + the markup that produced it (kept
 *   so the owner can edit and re-render it), or null when unavailable/unusable.
 */
/**
 * Cover art at every size a platform asks for.
 *
 * One AI design PER ORIENTATION, then every canvas re-shot from the design that matches it. A
 * layout authored for 1280×720 does not survive being re-rendered at 1080×1920 — the headline
 * that filled the frame becomes a strip across the middle — so sharing one design across
 * orientations is not an option. Sharing one design across sizes of the SAME orientation is,
 * because the fragment is ordinary CSS and 1200×630 is 1280×720 with slightly different slack.
 *
 * That is three generations at most, and usually two: a video only ever needs the orientations
 * its platforms actually use.
 *
 * @param {object[]} sizes entries from publish/platforms.js COVER_SIZES
 * @returns {Promise<{covers:object[], fragments:object}>} covers carry `{id,label,w,h,path}`
 */
export async function generateCoverSet({
  title, hook = '', prompt = '', guide, sizes, outDir, baseName = 'cover',
  language = 'vi', media = [], llm = null, fragments = {}, onLog = () => {},
} = {}) {
  const wanted = (sizes || []).filter((s) => s && s.w > 0 && s.h > 0);
  if (!wanted.length) return { covers: [], fragments };
  const byOrient = new Map();
  for (const s of wanted) {
    const o = s.orient || orientationOf(s);
    if (!byOrient.has(o)) byOrient.set(o, []);
    byOrient.get(o).push(s);
  }
  const covers = [];
  const frags = { ...fragments };
  for (const [orient, group] of byOrient) {
    // the biggest canvas of the group is what the design is authored against, so every smaller
    // re-shoot is scaling DOWN — text that fits the largest fits the rest
    const lead = group.slice().sort((a, b) => b.w * b.h - a.w * a.h)[0];
    if (!frags[orient]) {
      onLog(`🖼 Thiết kế ảnh bìa ${orient} (${lead.w}×${lead.h})…`);
      const made = await generateThumbnailImage({
        title, hook, prompt, guide, size: { w: lead.w, h: lead.h },
        outPath: join(outDir, `${baseName}_${orient}.jpg`), language, media, llm, onLog,
      });
      if (!made?.fragment) { onLog(`⚠ Không thiết kế được ảnh bìa ${orient} — bỏ qua nhóm này`); continue; }
      frags[orient] = made.fragment;
    }
    for (const s of group) {
      const outPath = join(outDir, `${baseName}_${s.id}.jpg`);
      try {
        await renderThumbnailFragment(frags[orient], { guide, size: { w: s.w, h: s.h }, outPath, media });
        // `w`/`h` stay the PLATFORM spec — that is what the design was authored for and what the
        // owner recognises. `px` is what is actually on disk, so the panel can say "2560×1440
        // (2× của 1280×720)" instead of quietly disagreeing with the file.
        covers.push({
          id: s.id, label: s.label, w: s.w, h: s.h, orient, path: outPath,
          scale: COVER_SCALE, px: { w: s.w * COVER_SCALE, h: s.h * COVER_SCALE },
          bytes: statSize(outPath),
        });
      } catch (e) { onLog(`⚠ Ảnh bìa ${s.label}: ${e.message}`); }
    }
  }
  return { covers, fragments: frags };
}

export async function generateThumbnailImage({
  title, hook = '', prompt = '', guide, size, outPath, language = 'vi', variant = 0, media = [], llm = null, onLog = () => {},
} = {}) {
  if (!chromeAvailable() || !llmEnabled(llm)) return null;
  const w = size?.w || 1280, h = size?.h || 720;
  const p = guide?.palette || {};
  const f = guide?.fonts || {};
  const inset = Math.round(Math.min(w, h) * 0.045);
  const user = `THUMBNAIL CANVAS: ${w}×${h}px. Your fragment renders inside #content, which is inset ${inset}px on every side — treat that box as the FULL usable area and keep text a further ~4% away from its edges.

VIDEO TITLE: "${String(title || '').trim().slice(0, 160)}"
${hook ? `HOOK ALREADY WRITTEN FOR THE THUMBNAIL (use this wording, or tighten it — do not invent a different message): "${String(hook).trim().slice(0, 120)}"\n` : ''}${prompt ? `ART DIRECTION: ${String(prompt).trim().slice(0, 400)}\n` : ''}
LOCKED PALETTE: bg ${p.bg || '#0b1220'} · bg2 ${p.bg2 || '#1e3a8a'} · ink ${p.ink || '#ffffff'} · muted ${p.muted || '#94a3b8'} · accents ${(p.accents || ['#f7b500']).join(' ')}
LOCKED FONTS: display ${f.display || 'Be Vietnam Pro'} · body ${f.body || 'Be Vietnam Pro'} · mono ${f.mono || 'JetBrains Mono'}
LANGUAGE: every visible character must be in ${language === 'vi' ? 'Vietnamese, with correct diacritics' : language}.

COMPOSITION FOR THIS ONE: ${COMPOSITIONS[variant % COMPOSITIONS.length]}
${assetBlock(media)}
Reply with ONLY the <style> block and the markup.`;

  try {
    const reply = await chat([
      { role: 'system', content: SYS },
      { role: 'user', content: user },
    ], { temperature: 0.9, maxTokens: 4000, llm });
    const fragment = sanitizeThumbFragment(reply);
    if (fragment.length < 80) { onLog('thumbnail AI: reply quá ngắn — dùng bản dựng sẵn'); return null; }
    const path = await screenshotHtml(shell(applyThumbAssets(fragment, media), { w, h, guide }), { w, h, outPath, scale: COVER_SCALE });
    onLog(`thumbnail AI: đã dựng bản ${variant + 1}`);
    return { path, fragment };
  } catch (e) {
    onLog(`thumbnail AI: bỏ qua (${e.message.slice(0, 120)})`);
    return null;
  }
}
