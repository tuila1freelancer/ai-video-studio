// Build per-scene background visuals.
// Premium path: a real AI image (Pollinations, keyless) composed into a cinematic poster.
// Fallbacks: designed gradient "graphic" poster (Chrome) → flat ffmpeg gradient (no Chrome).
import { existsSync, readFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { screenshotHtml, chromeAvailable } from '../media/puppeteer.js';
import { makeGradientImage } from '../media/ffmpeg.js';
import { generateImage, imageGenEnabled, buildImagePrompt, buildImagePromptSmart, downloadImage } from '../providers/imagegen.js';
import { escapeHtml, newId } from '../util/util.js';

// Embed an image as a data: URI — Chrome blocks file:// resources in setContent pages.
function dataUri(path) {
  if (!path || !existsSync(path)) return '';
  try {
    const ext = (extname(path).slice(1) || 'jpeg').toLowerCase();
    const mime = ext === 'png' ? 'image/png' : (ext === 'webp' ? 'image/webp' : 'image/jpeg');
    return `data:${mime};base64,${readFileSync(path).toString('base64')}`;
  } catch { return ''; }
}

const THEMES = [
  { a: '#1e3a8a', b: '#0b1220', accent: '#60a5fa' },
  { a: '#7c2d12', b: '#1a1110', accent: '#fb923c' },
  { a: '#064e3b', b: '#06140f', accent: '#34d399' },
  { a: '#581c87', b: '#140d20', accent: '#c084fc' },
  { a: '#9d174d', b: '#1c0a14', accent: '#f472b6' },
  { a: '#155e75', b: '#07171d', accent: '#38bdf8' },
];

// Cinematic "photo mode" — real image fills the frame, minimal tasteful overlay.
function photoPosterHtml(scene, project, size, imgPath) {
  const w = size.w, h = size.h;
  const t = THEMES[(scene.idx || 0) % THEMES.length];
  const tag = escapeHtml((project.title || 'AI VIDEO').slice(0, 30));
  const uri = dataUri(imgPath);
  return `<!doctype html><html><head><meta charset='utf-8'><style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:${w}px;height:${h}px;overflow:hidden;background:#05070d}
  .stage{position:relative;width:${w}px;height:${h}px;
    background:#05070d url('${uri}') center/cover no-repeat}
  .top{position:absolute;inset:0;background:linear-gradient(180deg, rgba(3,6,15,.55) 0%, rgba(3,6,15,0) 22%)}
  .bot{position:absolute;inset:0;background:linear-gradient(0deg, rgba(3,6,15,.85) 0%, rgba(3,6,15,0) 34%)}
  .vig{position:absolute;inset:0;box-shadow:inset 0 0 ${Math.round(w*0.5)}px rgba(0,0,0,.55)}
  .tag{position:absolute;left:${Math.round(w*0.07)}px;top:${Math.round(h*0.055)}px;display:flex;align-items:center;gap:10px;
    color:#fff;font:800 ${Math.round(w*0.026)}px -apple-system,Helvetica,sans-serif;letter-spacing:.12em;text-transform:uppercase;text-shadow:0 2px 12px rgba(0,0,0,.7)}
  .tag .b{width:${Math.round(w*0.012)}px;height:${Math.round(w*0.05)}px;border-radius:3px;background:${t.accent}}
  </style></head><body><div class='stage'>
    <div class='top'></div><div class='bot'></div><div class='vig'></div>
    <div class='tag'><span class='b'></span>${tag}</div>
  </div></body></html>`;
}

// Designed "graphic mode" — used when no AI image (offline / disabled).
export function posterHtml(scene, project, size, opts = {}) {
  if (opts.imagePath && existsSync(opts.imagePath)) return photoPosterHtml(scene, project, size, opts.imagePath);
  const t = THEMES[(scene.idx || 0) % THEMES.length];
  const w = size.w, h = size.h;
  const keyword = (scene.keywords && scene.keywords[0]) || '';
  const heading = (scene.keywords && scene.keywords.length)
    ? scene.keywords.slice(0, 3).join(' · ')
    : (scene.visual_prompt || project.title || '').split(/\s+/).slice(0, 5).join(' ');
  const phrase = escapeHtml(heading.toUpperCase().slice(0, 42));
  const bigWord = escapeHtml((keyword || project.title || '').toUpperCase().slice(0, 18));
  const glow = `radial-gradient(60% 50% at 78% 12%, ${t.accent}55 0%, transparent 60%),`
    + `radial-gradient(70% 55% at 12% 92%, ${t.a}88 0%, transparent 60%),`
    + `radial-gradient(120% 120% at 25% 8%, ${t.a} 0%, ${t.b} 70%)`;
  return `<!doctype html><html><head><meta charset='utf-8'><style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:${w}px;height:${h}px;overflow:hidden;background:${t.b};font-family:-apple-system,Helvetica,Arial,sans-serif}
  .stage{position:relative;width:${w}px;height:${h}px;background:${glow}}
  .grid{position:absolute;inset:0;background-image:linear-gradient(${t.accent}1f 1px,transparent 1px),linear-gradient(90deg,${t.accent}1f 1px,transparent 1px);background-size:${Math.round(w / 14)}px ${Math.round(w / 14)}px;opacity:.5}
  .bigword{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:${Math.round(w * 0.2)}px;color:#fff;opacity:.05;letter-spacing:-.03em;white-space:nowrap;transform:rotate(-6deg)}
  .frame{position:absolute;inset:${Math.round(w * 0.05)}px;border:2px solid ${t.accent}44;border-radius:${Math.round(w * 0.03)}px}
  .tag{position:absolute;left:${Math.round(w * 0.09)}px;top:${Math.round(h * 0.08)}px;color:${t.accent};font-size:${Math.round(w * 0.028)}px;font-weight:800;letter-spacing:.22em;text-transform:uppercase}
  .phrase{position:absolute;left:${Math.round(w * 0.09)}px;right:${Math.round(w * 0.09)}px;top:${Math.round(h * 0.115)}px;color:#fff;font-size:${Math.round(w * 0.062)}px;font-weight:800;line-height:1.15;text-shadow:0 4px 24px rgba(0,0,0,.55);letter-spacing:-.01em}
  .dot{position:absolute;left:${Math.round(w * 0.09)}px;top:${Math.round(h * 0.21)}px;width:${Math.round(w * 0.12)}px;height:6px;border-radius:3px;background:${t.accent}}
  </style></head><body><div class='stage'>
    <div class='grid'></div><div class='bigword'>${bigWord}</div><div class='frame'></div>
    <div class='tag'>${escapeHtml((project.title || 'AI VIDEO').slice(0, 24))}</div>
    <div class='phrase'>${phrase}</div><div class='dot'></div>
  </div></body></html>`;
}

// Intro / outro title card.
export function titleCardHtml(title, subtitle, size, imgPath) {
  const w = size.w, h = size.h, t = THEMES[0];
  const uri = dataUri(imgPath);
  const bg = uri
    ? `background:linear-gradient(180deg, rgba(3,6,15,.62), rgba(3,6,15,.82)), url('${uri}') center/cover;`
    : `background:radial-gradient(120% 120% at 50% 18%, #1e3a8a 0%, #0b1220 72%);`;
  return `<!doctype html><html><head><meta charset='utf-8'><style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:${w}px;height:${h}px;overflow:hidden;background:#0b1220;font-family:-apple-system,Helvetica,Arial,sans-serif}
  .stage{position:relative;width:${w}px;height:${h}px;${bg}display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 ${Math.round(w*0.1)}px}
  .bar{width:${Math.round(w*0.16)}px;height:7px;border-radius:4px;background:${t.accent};margin-bottom:${Math.round(h*0.03)}px}
  .title{color:#fff;font-size:${Math.round(w*0.085)}px;font-weight:900;line-height:1.1;letter-spacing:-.02em;text-shadow:0 6px 36px rgba(0,0,0,.6)}
  .sub{color:#cbd5e1;font-size:${Math.round(w*0.04)}px;font-weight:600;margin-top:${Math.round(h*0.025)}px;letter-spacing:.05em}
  </style></head><body><div class='stage'><div class='bar'></div>
    <div class='title'>${escapeHtml(title || '')}</div>
    <div class='sub'>${escapeHtml(subtitle || '')}</div></div></body></html>`;
}

export async function buildTitleCard(title, subtitle, size, dir, imgPath) {
  const out = join(dir, `card_${newId('')}.png`);
  if (!chromeAvailable()) return makeGradientImage(out, { w: size.w, h: size.h, c1: '0x1e3a8a', c2: '0x0b1220' });
  try { return await screenshotHtml(titleCardHtml(title, subtitle, size, imgPath), { w: size.w, h: size.h, outPath: out }); }
  catch { return makeGradientImage(out, { w: size.w, h: size.h, c1: '0x1e3a8a', c2: '0x0b1220' }); }
}

// Premium thumbnail: best image + bold title overlay. opts.guide (HyperFrame style guide)
// keys the colors to the video's locked palette so the thumbnail matches the video.
export async function buildThumbnail(title, imgPath, size, outPath, opts = {}) {
  if (!chromeAvailable()) return null;
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

// Returns a PNG path sized w×h to be used as the motion source for a scene.
// opts.ai + opts.guide (optional): enable the LLM-polished, style-guide-locked prompt.
export async function buildSceneBackground(scene, project, size, opts = {}) {
  const out = join(opts.dir, `bg_${scene.idx}_${newId('')}.png`);

  // 0) A REMOTE image URL on the scene (image search / og:image fetch) is downloaded to a
  //    local file first — existsSync() can never see it, so it used to be silently ignored.
  let photo = null;
  if (/^https?:\/\//i.test(scene.image_path || '')) {
    try { photo = await downloadImage(scene.image_path, join(opts.dir, `dl_${scene.idx}_${newId('')}.jpg`)); }
    catch { photo = null; }
  }

  // 1) Try a real AI image (the premium path) when no usable image is present yet.
  if (!photo && opts.mode !== 'gradient' && opts.mode !== 'graphic' && imageGenEnabled() && !(scene.image_path && existsSync(scene.image_path))) {
    const imgOut = join(opts.dir, `ai_${scene.idx}_${newId('')}.jpg`);
    const prompt = opts.ai
      ? await buildImagePromptSmart(scene, { styleName: opts.styleName, guide: opts.guide, ai: opts.ai })
      : buildImagePrompt(scene, opts.styleName);
    const seed = (opts.consistent ? 700 : 0) + (scene.idx || 0) * 7 + 13;
    photo = await generateImage(prompt, { w: size.w, h: size.h, seed, outPath: imgOut });
  }
  // user-provided image takes priority if present
  if (scene.image_path && existsSync(scene.image_path) && opts.keepProvided) photo = scene.image_path;

  // 2) Compose a poster (photo mode if we have an image, graphic mode otherwise).
  if (chromeAvailable() && opts.mode !== 'gradient') {
    try {
      const html = posterHtml(scene, project, size, { imagePath: photo });
      return await screenshotHtml(html, { w: size.w, h: size.h, outPath: out });
    } catch { /* fall through */ }
  }
  // 3) No Chrome but we have a photo → use it directly (render will scale/crop).
  if (photo && existsSync(photo)) return photo;

  // 4) Flat gradient fallback.
  const t = THEMES[(scene.idx || 0) % THEMES.length];
  return makeGradientImage(out, { w: size.w, h: size.h, c1: '0x' + t.a.slice(1), c2: '0x' + t.b.slice(1) });
}
