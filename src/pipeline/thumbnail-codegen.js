// LLM-authored HTML thumbnail (P40) — reference-app parity.
//
// The reference app asks its model for a full STATIC HTML page and screenshots it headless,
// which is why its thumbnails are compositions rather than "title over a photo". We do the same,
// with two differences that make it safe here:
//   • the page is sanitized and re-shelled by US (our vendored fonts, the locked palette, the
//     exact canvas), so a model can style but never break out of the frame or reach the network;
//   • a failure is NOT loud — a thumbnail is packaging, not the video, so an unusable reply falls
//     back to the deterministic composition builder that shipped before this feature.
import { chat, llmEnabled } from '../providers/llm.js';
import { screenshotHtml, chromeAvailable } from '../media/puppeteer.js';
import { fontsCss } from '../animation/harness.js';
import { userFontsCss } from '../animation/userfonts.js';

// Composition briefs for the A/B lab — one per variant, so three thumbnails differ by DESIGN
// rather than by a random re-roll of the same idea.
const COMPOSITIONS = [
  'Bottom-weighted: a huge headline anchored low-left over a rich graphic field, with one accent rule and generous air above.',
  'Centre punch: one enormous centred hook phrase, radial light behind it, the supporting element small and off to one side.',
  'Split frame: a bold kicker band across the top, the headline in the lower two-thirds, and a strong graphic block occupying the opposite half.',
];

const SYS = `You design VIDEO THUMBNAILS as a single static HTML page rendered once by headless Chrome into one image.

THIS IS A STILL IMAGE, NOT A SCENE. No animation, no <script>, no GSAP, no @keyframes, no setTimeout — anything that moves is wrong here.

WHAT MAKES A THUMBNAIL WORK (obey all of it):
- ONE idea, readable at 120px wide on a phone. Big type, brutal contrast, a single focal subject.
- The headline is 3–6 words, in the video's language, spelled and accented correctly. It is NOT the full title — it is the hook.
- Build a real composition with CSS: gradients, glows, blurred light blobs, geometric blocks, thick rules, inline SVG, layered panels. Depth comes from overlapping shapes and shadows.
- Every pixel of text must sit inside the safe area you are given, never touching an edge, never clipped, never overlapping other text.
- Use ONLY the locked palette and the locked fonts you are given, plus white/black/transparent.
- No stock-photo look, no lorem, no watermarks, no fake UI chrome, no English decoration text on a Vietnamese thumbnail.

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
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${fontsCss()}
${userFontsCss()}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${w}px;height:${h}px;overflow:hidden;background:${p.bg || '#0b1220'}}
body{font-family:${f.display || 'Be Vietnam Pro'},Arial,sans-serif;color:${p.ink || '#fff'};-webkit-font-smoothing:antialiased}
#stage{position:relative;width:${w}px;height:${h}px;overflow:hidden;background:${p.bg || '#0b1220'}}
#content{position:absolute;inset:${Math.round(Math.min(w, h) * 0.045)}px;overflow:hidden}
.txt{display:block;line-height:1.08;overflow:visible;padding-top:.12em;padding-bottom:.06em}
</style></head><body><div id="stage"><div id="content">${fragment}</div></div></body></html>`;
}

/**
 * Rasterize a thumbnail FRAGMENT (already sanitized or hand-edited) through our own shell.
 * Split out so the owner can re-render an edited design without paying for another generation.
 * @returns {Promise<string|null>} the written image path.
 */
export async function renderThumbnailFragment(fragment, { guide, size, outPath, media = [] } = {}) {
  if (!chromeAvailable()) return null;
  const clean = sanitizeThumbFragment(fragment);
  if (clean.length < 40) return null;
  const w = size?.w || 1280, h = size?.h || 720;
  return screenshotHtml(shell(applyThumbAssets(clean, media), { w, h, guide }), { w, h, outPath });
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
 * Design one thumbnail with the LLM and rasterize it.
 * @returns {Promise<{path,fragment}|null>} the written image + the markup that produced it (kept
 *   so the owner can edit and re-render it), or null when unavailable/unusable.
 */
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
    const path = await screenshotHtml(shell(applyThumbAssets(fragment, media), { w, h, guide }), { w, h, outPath });
    onLog(`thumbnail AI: đã dựng bản ${variant + 1}`);
    return { path, fragment };
  } catch (e) {
    onLog(`thumbnail AI: bỏ qua (${e.message.slice(0, 120)})`);
    return null;
  }
}
