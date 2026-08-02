// Thumbnail builders (run in every mode) + the data-URI helper they share. The per-scene
// background / poster / Ken-Burns lane was removed with the `image` visual mode (P36); only
// the designed thumbnail compositions survive here (finalize builds a thumbnail for every video).
import { existsSync, readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { screenshotHtml, chromeAvailable } from '../media/puppeteer.js';
import { escapeHtml } from '../util/util.js';

// Embed an image as a data: URI — Chrome blocks file:// resources in setContent pages.
function dataUri(path) {
  if (!path || !existsSync(path)) return '';
  try {
    const ext = (extname(path).slice(1) || 'jpeg').toLowerCase();
    const mime = ext === 'png' ? 'image/png' : (ext === 'webp' ? 'image/webp' : 'image/jpeg');
    return `data:${mime};base64,${readFileSync(path).toString('base64')}`;
  } catch { return ''; }
}

// Premium thumbnail: best image + bold title overlay. opts.guide (HyperFrame style guide)
// keys the colors to the video's locked palette so the thumbnail matches the video.
// opts.variant varies the composition for the A/B thumbnail lab:
//   0 = bottom-left + accent bar (the classic)  1 = centered giant hook  2 = top kicker band
export async function buildThumbnail(title, imgPath, size, outPath, opts = {}) {
  if (!chromeAvailable()) return null;
  if ((opts.variant || 0) > 0) return buildThumbnailAlt(title, imgPath, size, outPath, opts);
  const w = size.w, h = size.h;
  const g = opts.guide || null;
  const bgc = g?.palette?.bg || '#0b1220';
  const bgc2 = g?.palette?.bg2 || '#1e3a8a';
  const ink = g?.palette?.ink || '#fff';
  const accent = g?.palette?.accents?.[0] || '#f7b500';
  const uri = dataUri(imgPath);
  const bg = uri
    ? `background:linear-gradient(0deg, ${bgc}EB 4%, ${bgc}1A 55%), url('${uri}') center/cover;`
    : `background:radial-gradient(120% 120% at 30% 20%, ${bgc2}, ${bgc});`;
  const glow = g ? `,0 0 42px ${accent}66` : '';
  const html = `<!doctype html><html><head><meta charset='utf-8'><style>
  *{margin:0;padding:0;box-sizing:border-box}html,body{width:${w}px;height:${h}px;overflow:hidden;background:${bgc};font-family:-apple-system,Helvetica,Arial,sans-serif}
  .s{position:relative;width:${w}px;height:${h}px;${bg}display:flex;align-items:flex-end;padding:${Math.round(h*0.07)}px ${Math.round(w*0.07)}px}
  .t{color:${ink};font-size:${Math.round(w*0.075)}px;font-weight:900;line-height:1.1;overflow:visible;padding-top:0.15em;text-shadow:0 4px 24px #000${glow};letter-spacing:-.02em}
  .a{position:absolute;left:${Math.round(w*0.07)}px;bottom:${Math.round(h*0.07)}px;width:${Math.round(w*0.1)}px;height:8px;border-radius:4px;background:${accent};transform:translateY(${Math.round(h*0.06)}px)}
  </style></head><body><div class='s'><div class='a'></div><div class='t'>${escapeHtml((title||'').slice(0,70))}</div></div></body></html>`;
  try { return await screenshotHtml(html, { w, h, outPath }); } catch { return null; }
}

// Alt thumbnail compositions (variants 1..2) for the A/B lab — same palette discipline.
async function buildThumbnailAlt(title, imgPath, size, outPath, opts = {}) {
  const w = size.w, h = size.h;
  const g = opts.guide || null;
  const bgc = g?.palette?.bg || '#0b1220';
  const ink = g?.palette?.ink || '#fff';
  const accent = g?.palette?.accents?.[(opts.variant || 1) % 3] || '#f7b500';
  const uri = dataUri(imgPath);
  const t = escapeHtml((title || '').slice(0, 70));
  const centered = (opts.variant || 1) === 1;
  const body = centered
    ? `<div class='s' style="justify-content:center;align-items:center;text-align:center">
        <div class='t' style="font-size:${Math.round(w * 0.09)}px;max-width:86%">${t}</div></div>`
    : `<div class='s' style="align-items:flex-start">
        <div class='kick' style="background:${accent};color:${bgc}">${escapeHtml((title || '').split(/\s+/).slice(0, 3).join(' ').toUpperCase())}</div>
        <div class='t' style="font-size:${Math.round(w * 0.068)}px;margin-top:${Math.round(h * 0.02)}px">${t}</div></div>`;
  const html = `<!doctype html><html><head><meta charset='utf-8'><style>
  *{margin:0;padding:0;box-sizing:border-box}html,body{width:${w}px;height:${h}px;overflow:hidden;background:${bgc};font-family:-apple-system,Helvetica,Arial,sans-serif}
  .s{position:relative;width:${w}px;height:${h}px;display:flex;flex-direction:column;padding:${Math.round(h * 0.08)}px ${Math.round(w * 0.06)}px;
    ${uri ? `background:linear-gradient(0deg, ${bgc}E6 8%, ${bgc}30 60%), url('${uri}') center/cover;` : `background:radial-gradient(120% 120% at 30% 20%, ${g?.palette?.bg2 || '#1e3a8a'}, ${bgc});`}}
  .t{color:${ink};font-weight:900;line-height:1.08;letter-spacing:-.02em;text-shadow:0 4px 26px #000,0 0 44px ${accent}55}
  .kick{display:inline-block;align-self:flex-start;font-weight:900;font-size:${Math.round(w * 0.028)}px;letter-spacing:.14em;padding:.35em .8em;border-radius:6px}
  </style></head><body>${body}</body></html>`;
  try { return await screenshotHtml(html, { w, h, outPath }); } catch { return null; }
}

// (buildThumbnailVariants was removed in P40: finalize now walks the variants itself so each
// one can try the AI design first and fall back to buildThumbnail(variant) individually.)

