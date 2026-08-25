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

// Layout budgets, ported from the reference app. The old prompt asked for percentages ("headline
// >=55% of the width") and the model reinterpreted them differently every run — two good designs
// and two collisions out of four. The reference hands the model ABSOLUTE PIXEL ceilings per ratio
// and tells it to use them directly, which is why its output is consistent.
const THUMB_LAYOUT = {
  '9:16': {
    w: 1080, h: 1920, label: 'dọc, TikTok/Reels',
    sidePadding: 70, topPadding: 90, bottomPadding: 130, textMaxW: 830, heroMaxW: 810,
    cardMinW: 620, cardMaxW: 780, subjectMaxH: 990, textBlockMaxH: 360,
    safeCenterW: 760, safeCenterH: 980, splitGap: 36,
    rules: `RULE RIÊNG CHO 9:16 (dọc cao, ưu tiên mobile-first):
• Focal area: cột giữa màn hình, bố cục xếp dọc; tránh layout quá ngang.
• Hero text/number: width tối đa {{HERO_MAX_W}}px; căn giữa hoặc lệch rất nhẹ.
• Card/mockup: width {{CARD_MIN_W}}px đến {{CARD_MAX_W}}px; không full ngang trừ background.
• Nếu có 2 cột: chỉ dùng khi mỗi cột hẹp, tổng width tối đa 84%; ưu tiên stack dọc hơn split ngang.
• Không đặt subject quan trọng sát mép trên/dưới; headroom tối thiểu {{TOP_PADDING}}px, side padding tối thiểu {{SIDE_PADDING}}px.
• Với vật thể cao: chiều cao tối đa {{SUBJECT_MAX_H}}px.`,
  },
  '16:9': {
    w: 1920, h: 1080, label: 'ngang, YouTube',
    sidePadding: 90, topPadding: 70, bottomPadding: 90, textMaxW: 980, heroMaxW: 920,
    cardMinW: 520, cardMaxW: 760, subjectMaxH: 450, textBlockMaxH: 300,
    safeCenterW: 1320, safeCenterH: 620, splitGap: 80,
    rules: `RULE RIÊNG CHO 16:9 (ngang rộng, cinematic):
• Focal area: vùng trung tâm hơi lệch trái/phải; tận dụng chiều ngang cho split layout.
• Hero text/number: width tối đa {{HERO_MAX_W}}px; tránh kéo quá dài thành một dòng khó đọc.
• Cho phép 2 cột rõ ràng hoặc bố cục 60/40, mỗi khối phải có khoảng thở tối thiểu {{SPLIT_GAP}}px.
• Text block không cao quá {{TEXT_BLOCK_MAX_H}}px; không stack dọc quá dài.
• Các element phụ trải ngang, không dồn hết vào trung tâm như 9:16.
• Giữ outer padding tối thiểu {{SIDE_PADDING}}px; không nhồi kín sát mép.`,
  },
  '1:1': {
    w: 1080, h: 1080, label: 'vuông',
    sidePadding: 70, topPadding: 70, bottomPadding: 90, textMaxW: 760, heroMaxW: 730,
    cardMinW: 520, cardMaxW: 700, subjectMaxH: 700, textBlockMaxH: 280,
    safeCenterW: 740, safeCenterH: 740, splitGap: 32,
    rules: `RULE RIÊNG CHO 1:1 (vuông, cân bằng tuyệt đối):
• Focal area: trung tâm khung; ưu tiên bố cục đối xứng, một hero cộng một nhãn.
• Hero text/number: width tối đa {{HERO_MAX_W}}px; text block không quá {{TEXT_BLOCK_MAX_H}}px.
• Asset chính nằm trong khối an toàn {{SAFE_CENTER_W}}px × {{SAFE_CENTER_H}}px ở giữa frame.
• Nếu dùng card/list: tối đa 3 item, mỗi item to và thoáng.
• Giữ khoảng thở {{SIDE_PADDING}}px mỗi cạnh để tránh cảm giác chật.`,
  },
  '4:5': {
    w: 1080, h: 1350, label: 'portrait feed',
    sidePadding: 65, topPadding: 60, bottomPadding: 105, textMaxW: 790, heroMaxW: 760,
    cardMinW: 600, cardMaxW: 820, subjectMaxH: 760, textBlockMaxH: 300,
    safeCenterW: 780, safeCenterH: 760, splitGap: 34,
    rules: `RULE RIÊNG CHO 4:5 (portrait cân bằng giữa feed và mobile):
• Focal area: trung tâm hơi cao hơn giữa khung; bố cục dọc nhưng đỡ cực đoan hơn 9:16.
• Hero text/number: width tối đa {{HERO_MAX_W}}px; có thể dùng 2 tầng text ngắn.
• Card/ảnh: width {{CARD_MIN_W}}px đến {{CARD_MAX_W}}px; tránh asset quá cao chiếm hết frame.
• Đáy subject chính dừng trên lower third; không để text nằm sát đáy.
• Padding trái/phải tối thiểu {{SIDE_PADDING}}px, padding trên tối thiểu {{TOP_PADDING}}px.`,
  },
};

/** Vietnamese diacritics need room: 1.35, not the 1.08 our shell used to ship. */
const TEXT_METRICS = { lineHeight: 1.35, paddingTop: '0.15em' };

/** The layout entry whose shape is closest to the canvas actually being rendered. */
export function layoutFor({ w, h }) {
  const r = w / h;
  let best = null, bestGap = Infinity;
  for (const [key, L] of Object.entries(THUMB_LAYOUT)) {
    const gap = Math.abs(Math.log(r / (L.w / L.h)));
    if (gap < bestGap) { bestGap = gap; best = { key, ...L }; }
  }
  return best;
}

/** Substitute the {{…}} budget placeholders in a ratio's rule block. */
function layoutBlock(L) {
  const rules = L.rules
    .replaceAll('{{SIDE_PADDING}}', L.sidePadding).replaceAll('{{TOP_PADDING}}', L.topPadding)
    .replaceAll('{{BOTTOM_PADDING}}', L.bottomPadding).replaceAll('{{TEXT_MAX_W}}', L.textMaxW)
    .replaceAll('{{HERO_MAX_W}}', L.heroMaxW).replaceAll('{{CARD_MIN_W}}', L.cardMinW)
    .replaceAll('{{CARD_MAX_W}}', L.cardMaxW).replaceAll('{{SUBJECT_MAX_H}}', L.subjectMaxH)
    .replaceAll('{{TEXT_BLOCK_MAX_H}}', L.textBlockMaxH).replaceAll('{{SAFE_CENTER_W}}', L.safeCenterW)
    .replaceAll('{{SAFE_CENTER_H}}', L.safeCenterH).replaceAll('{{SPLIT_GAP}}', L.splitGap);
  return `TỈ LỆ KHUNG HÌNH HIỆN TẠI: ${L.label} (${L.w}×${L.h})
Các ngưỡng bố cục số cứng — PHẢI ưu tiên dùng trực tiếp trong code:
• side padding ${L.sidePadding}px · top ${L.topPadding}px · bottom ${L.bottomPadding}px
• text rộng tối đa ${L.textMaxW}px · hero rộng tối đa ${L.heroMaxW}px
• card ${L.cardMinW}–${L.cardMaxW}px · subject cao tối đa ${L.subjectMaxH}px
• text block cao tối đa ${L.textBlockMaxH}px · vùng an toàn giữa ${L.safeCenterW}×${L.safeCenterH}px
• khoảng cách khi chia cột tối thiểu ${L.splitGap}px

${rules}`;
}

const SYS = `Create a STATIC HTML thumbnail rendered once by Chrome headless.

THIS IS A STATIC THUMBNAIL IMAGE, NOT A VIDEO SCENE.

REQUIREMENTS:
• Static layout, captured as one JPEG image.
• NO animation, NO gsap, NO anime.js, NO setTimeout, NO @keyframes.
• Strong composition, readable, high contrast, ONE subject, large clear text.
• Fonts ONLY: "Be Vietnam Pro", "Oswald", "JetBrains Mono". NO other fonts.
• All text: class="txt" (line-height:${TEXT_METRICS.lineHeight};overflow:visible;padding-top:${TEXT_METRICS.paddingTop}).
• NO overflow:hidden on text containers — Vietnamese diacritics get clipped.
• EVERY word on the image is Vietnamese — including labels inside panels, badges and mock UI.
  NO English technical strings ("NEXT_TOKEN_PREDICTION", "Input:", "Output", "Loading"): the viewers are
  Vietnamese beginners. Only product names stay as-is (ChatGPT, Gemini, Claude).

OUTPUT: ONLY the markup that goes INSIDE #content — a fragment, not a document. Start with a <style> block, then your HTML elements. No <!DOCTYPE>, no <html>, no <body>, no markdown fence, no explanation.`;

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
  const inset = Math.round(Math.min(w, h) * 0.012); // reference uses a 10px inset, not 4.5%
  // GEOMETRY IS INLINE, NOT IN THE STYLESHEET. The fragment's own <style> is parsed AFTER ours,
  // so a model that writes `#content { position: relative }` — a reasonable thing to write, and
  // one really did — would beat a head rule, collapse the box to height:0 (its children are all
  // absolute) and render a solid black image. An inline style outranks any author rule, so the
  // model can restyle the canvas (background, font, radius) but never move or collapse it.
  // overflow VISIBLE, like the reference: hidden clips Vietnamese diacritics at the box edge.
  const box = `position:absolute;top:${inset}px;left:${inset}px;right:${inset}px;bottom:${inset}px;overflow:visible`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${fontsCss()}
${userFontsCss()}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${w}px;height:${h}px;overflow:hidden;background:${p.bg || '#0b1220'}}
body{font-family:${f.display || 'Be Vietnam Pro'},Arial,sans-serif;color:${p.ink || '#fff'};-webkit-font-smoothing:antialiased}
.txt{display:block;line-height:1.35;overflow:visible;padding-top:0.15em;padding-bottom:0.05em}
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
  const inset = Math.round(Math.min(w, h) * 0.012); // reference uses a 10px inset, not 4.5%
  const L = layoutFor({ w, h });
  const user = `THUMBNAIL CANVAS: ${w}×${h}px. Fragment renders inside #content, inset ${inset}px on every side.

Tiêu đề video: "${String(title || '').trim().slice(0, 160)}"
${hook ? `Câu móc đã viết sẵn cho ảnh bìa (dùng đúng chữ này, hoặc siết gọn hơn — không tự nghĩ thông điệp khác): "${String(hook).trim().slice(0, 120)}"\n` : ''}${prompt ? `Định hướng mỹ thuật: ${String(prompt).trim().slice(0, 400)}\n` : ''}
LAYOUT PARAMS:
${layoutBlock(L)}

BẢNG MÀU KHOÁ CỨNG: bg ${p.bg || '#0b1220'} · bg2 ${p.bg2 || '#1e3a8a'} · ink ${p.ink || '#ffffff'} · muted ${p.muted || '#94a3b8'} · nhấn ${(p.accents || ['#f7b500']).join(' ')}
FONT KHOÁ CỨNG: hiển thị "${f.display || 'Be Vietnam Pro'}" · tiêu đề lớn có thể dùng "Oswald" · mono "JetBrains Mono"
NGÔN NGỮ: mọi chữ nhìn thấy phải bằng ${language === 'vi' ? 'tiếng Việt, đúng dấu' : language}. Không dùng ngôn ngữ khác.
${variant > 0 ? `Đây là phương án số ${variant + 1} — bố cục phải KHÁC HẲN các phương án trước, đừng lặp lại cùng một cách sắp xếp.\n` : ''}${assetBlock(media)}
Trả về CHỈ khối <style> và phần markup.`;

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
