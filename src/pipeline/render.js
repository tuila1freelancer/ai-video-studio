// Scene rendering (B6) + final concat/mix (B7) with ffmpeg.
import { writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ffmpeg, ffmpegAss, probeDuration, makeSilence } from '../media/ffmpeg.js';
import { buildKaraokeAss } from './srt.js';
import { buildSceneBackground, buildTitleCard } from './visuals.js';
import { ratioToSize, newId } from '../util/util.js';
import { VENDOR_DIR } from '../config/paths.js';

// Vendored TTFs so libass can burn the preset font families (Montserrat, Oswald, …).
const FONTS_DIR = join(VENDOR_DIR, 'fonts', 'ttf');

const FPS = 30;

// Escape a filesystem path for use inside an ffmpeg filtergraph (subtitles= option).
function escFilter(p) { return p.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'"); }

// Varied Ken-Burns: slow push-in toward a focal point that changes per scene (no per-frame jitter).
function motionFor(idx) {
  const P = [
    { z: 'min(1.0+0.0012*on,1.16)', x: 'iw/2-(iw/zoom/2)', y: 'ih/2-(ih/zoom/2)' },
    { z: 'min(1.0+0.0010*on,1.15)', x: 'iw/2-(iw/zoom/2)', y: 'ih*0.30-(ih/zoom/2)' },
    { z: 'min(1.0+0.0011*on,1.16)', x: 'iw*0.68-(iw/zoom/2)', y: 'ih/2-(ih/zoom/2)' },
    { z: 'min(1.0+0.0010*on,1.15)', x: 'iw/2-(iw/zoom/2)', y: 'ih*0.70-(ih/zoom/2)' },
    { z: 'min(1.0+0.0011*on,1.16)', x: 'iw*0.32-(iw/zoom/2)', y: 'ih/2-(ih/zoom/2)' },
  ];
  return P[(idx || 0) % P.length];
}

// Render a single scene → mp4. Returns { path, duration }.
export async function renderScene(scene, project, { dir, size, subtitleStyle, renderMode, onLog }) {
  const d = Math.max(1.5, scene.duration || (await probeDuration(scene.audio_path)) || project.config?.sceneDuration || 6);
  const frames = Math.round(d * FPS);

  // 1) background image (poster or provided)
  let bg = scene.image_path && existsSync(scene.image_path) ? scene.image_path : null;
  if (!bg) bg = await buildSceneBackground(scene, project, size, { dir, mode: renderMode === 'gradient' ? 'gradient' : 'html' });

  // 2) audio
  let audio = scene.audio_path && existsSync(scene.audio_path) ? scene.audio_path : null;
  if (!audio) { audio = join(dir, `silence_${scene.idx}.m4a`); await makeSilence(audio, d); }

  // 3) subtitle ASS (karaoke), per-scene timing
  let assPath = null;
  if (subtitleStyle && subtitleStyle.enabled !== false && scene.srt_json && scene.srt_json.length) {
    assPath = join(dir, `sub_${scene.idx}_${newId('')}.ass`);
    writeFileSync(assPath, buildKaraokeAss(scene.srt_json, subtitleStyle, size));
  }

  const out = join(dir, `scene_${String(scene.idx).padStart(3, '0')}.mp4`);
  const ow = size.w, oh = size.h;
  const m = motionFor(scene.idx);
  // Ken-Burns: cover-scale 1.35×, varied push-in, then optional subtitle burn.
  let vf = `scale=${Math.round(ow * 1.35)}:${Math.round(oh * 1.35)}:force_original_aspect_ratio=increase,`
    + `crop=${Math.round(ow * 1.35)}:${Math.round(oh * 1.35)},`
    + `zoompan=z='${m.z}':x='${m.x}':y='${m.y}':d=${frames}:s=${ow}x${oh}:fps=${FPS},`
    + `format=yuv420p`;
  if (assPath) {
    vf += `,subtitles=filename='${escFilter(assPath)}'`;
    if (existsSync(FONTS_DIR)) vf += `:fontsdir='${escFilter(FONTS_DIR)}'`;
  }

  // subtitles= needs libass — only use the (slower) libass build when actually burning subs
  const runner = assPath ? ffmpegAss : ffmpeg;
  await runner([
    '-loop', '1', '-i', bg,
    '-i', audio,
    '-filter_complex', `[0:v]${vf}[v]`,
    '-map', '[v]', '-map', '1:a',
    '-t', String(d),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(FPS),
    '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-ac', '2',
    '-movflags', '+faststart', out,
  ], { onLog });

  return { path: out, duration: d };
}

// Final assembly (B7): concat scene clips, mix BGM, overlay logo, make thumbnail.
export async function concatScenes(sceneVideos, project, { dir, size, bgmPath, sfxPath, logo, transitions, onLog }) {
  if (!sceneVideos.length) throw new Error('Không có cảnh nào để ghép');
  const ow = size.w, oh = size.h;

  // Durations + total (xfade overlaps shorten the timeline). xfade only for moderate counts
  // (deep xfade chains keep every input decoder open → unstable for very long videos).
  const TD = 0.5;
  const durs = [];
  for (const v of sceneVideos) durs.push(await probeDuration(v));
  const useXfade = transitions && sceneVideos.length > 1 && sceneVideos.length <= 24;
  const total = durs.reduce((a, b) => a + b, 0) - (useXfade ? TD * (sceneVideos.length - 1) : 0);
  const fadeOut = Math.max(0.2, total - 0.6);

  const slug = (project.title || 'video').replace(/[^\p{L}\p{N}\- ]/gu, '').replace(/\s+/g, '_').slice(0, 40) || 'video';
  const finalOut = join(project.outputDir || dir, `${slug}_${newId('')}.mp4`);

  // Single pass: (xfade | concat-demuxer) → BGM mix → logo → fades + loudnorm → encode.
  const args = [];
  const fc = [];
  let vbase, abase, nextIdx;
  if (useXfade) {
    sceneVideos.forEach((v) => args.push('-i', v));
    nextIdx = sceneVideos.length;
    let prevV = '0:v', prevA = '0:a', offset = durs[0] - TD;
    for (let i = 1; i < sceneVideos.length; i++) {
      fc.push(`[${prevV}][${i}:v]xfade=transition=fade:duration=${TD}:offset=${offset.toFixed(3)}[vx${i}]`);
      fc.push(`[${prevA}][${i}:a]acrossfade=d=${TD}[ax${i}]`);
      prevV = `vx${i}`; prevA = `ax${i}`; offset += durs[i] - TD;
    }
    vbase = `[${prevV}]`; abase = `[${prevA}]`;
  } else {
    const listFile = join(dir, `list_${newId('')}.txt`);
    writeFileSync(listFile, sceneVideos.map((v) => `file '${v.replace(/'/g, "'\\''")}'`).join('\n'));
    args.push('-f', 'concat', '-safe', '0', '-i', listFile);
    nextIdx = 1; vbase = '[0:v]'; abase = '[0:a]';
  }
  if (bgmPath && existsSync(bgmPath)) {
    args.push('-stream_loop', '-1', '-i', bgmPath);
    fc.push(`[${nextIdx}:a]volume=0.13[bg]`, `${abase}[bg]amix=inputs=2:duration=first:dropout_transition=2[amx]`);
    abase = '[amx]'; nextIdx++;
  }
  if (sfxPath && existsSync(sfxPath)) {
    // transition-whoosh bed (already timed to the cut) — louder than BGM, under the voice
    args.push('-i', sfxPath);
    fc.push(`[${nextIdx}:a]volume=0.75[sfx]`, `${abase}[sfx]amix=inputs=2:duration=first:dropout_transition=2[asx]`);
    abase = '[asx]'; nextIdx++;
  }
  if (logo && logo.path && existsSync(logo.path)) {
    args.push('-i', logo.path);
    const lw = Math.round((logo.size || 110) * (oh / 1080));
    const pos = logoPos(logo.position || 'br', ow, oh, lw);
    fc.push(`[${nextIdx}:v]scale=${lw}:-1[lg]`, `${vbase}[lg]overlay=${pos}[vov]`);
    vbase = '[vov]'; nextIdx++;
  }
  fc.push(`${vbase}fade=t=in:st=0:d=0.5,fade=t=out:st=${fadeOut.toFixed(2)}:d=0.6[vout]`);
  fc.push(`${abase}loudnorm=I=-16:TP=-1.5:LRA=11,afade=t=in:st=0:d=0.4,afade=t=out:st=${fadeOut.toFixed(2)}:d=0.6[aout]`);
  args.push('-filter_complex', fc.join(';'), '-map', '[vout]', '-map', '[aout]', '-t', total.toFixed(2),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(FPS),
    '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-ac', '2', '-movflags', '+faststart', finalOut);
  await ffmpeg(args, { onLog });

  const thumb = join(project.outputDir || dir, `thumb_${newId('')}.jpg`);
  await ffmpeg(['-ss', String(Math.min(1.5, total / 2)), '-i', finalOut, '-frames:v', '1', '-q:v', '3', thumb]);
  return { path: finalOut, thumb, duration: total };
}

// Render an intro/outro title card clip (same codec params as scenes so concat is clean).
export async function renderCard(title, subtitle, { dir, size, bgImage, duration = 2.6, idx = 0, onLog } = {}) {
  const ow = size.w, oh = size.h, frames = Math.round(duration * FPS);
  const img = await buildTitleCard(title, subtitle, size, dir, bgImage);
  const silence = join(dir, `cardsil_${newId('')}.m4a`);
  await makeSilence(silence, duration);
  const out = join(dir, `card_${idx}_${newId('')}.mp4`);
  const vf = `scale=${Math.round(ow * 1.25)}:${Math.round(oh * 1.25)}:force_original_aspect_ratio=increase,`
    + `crop=${Math.round(ow * 1.25)}:${Math.round(oh * 1.25)},`
    + `zoompan=z='min(1.0+0.0011*on,1.12)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${ow}x${oh}:fps=${FPS},`
    + `format=yuv420p,fade=t=in:st=0:d=0.4,fade=t=out:st=${Math.max(0.1, duration - 0.5).toFixed(2)}:d=0.5`;
  await ffmpeg(['-loop', '1', '-i', img, '-i', silence, '-filter_complex', `[0:v]${vf}[v]`,
    '-map', '[v]', '-map', '1:a', '-t', String(duration),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(FPS),
    '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-ac', '2', '-movflags', '+faststart', out], { onLog });
  return out;
}

function logoPos(pos, ow, oh, lw, m = 40) {
  // Free positioning: {xPct,yPct} = element CENTER as a fraction of the frame (brand kit).
  if (pos && typeof pos === 'object' && Number.isFinite(+pos.xPct) && Number.isFinite(+pos.yPct)) {
    const x = Math.min(1, Math.max(0, +pos.xPct)), y = Math.min(1, Math.max(0, +pos.yPct));
    return `min(max(0\\,W*${x.toFixed(4)}-w/2)\\,W-w):min(max(0\\,H*${y.toFixed(4)}-h/2)\\,H-h)`;
  }
  switch (pos) {
    case 'tl': return `${m}:${m}`;
    case 'tr': return `W-w-${m}:${m}`;
    case 'bl': return `${m}:H-h-${m}`;
    case 'c': return `(W-w)/2:(H-h)/2`;
    case 'br':
    default: return `W-w-${m}:H-h-${m}`;
  }
}

export { ratioToSize };
