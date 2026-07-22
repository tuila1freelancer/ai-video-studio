// Scene rendering (B6) + final concat/mix (B7) with ffmpeg.
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ffmpeg, ffmpegAss, probeDuration, probeImageSize } from '../media/ffmpeg.js';
import { logoRect } from '../media/logo-overlay.js';
import { perimeterExpr, WM_SPEEDS } from '../media/watermark.js';
import { ratioToSize, newId } from '../util/util.js';

const FPS = 30;

// ---- Transition planning (motion doctrine: every boundary FLOWS — a short smooth dissolve
// is the default hand-off, while 1-2 prominent HERO transitions still punch above it so they
// keep their impact) ----
// Returns one entry per clip boundary: { type: 'cut'|'fade'|'fadeblack'|'zoomin', dur }.
// Role-driven when the art director stamped [ROLE] briefs (P4): the transition INTO a
// payoff scene is a zoom-through ('zoomin'), INTO a cta scene / the outro card a clean
// 'fadeblack', INTO a chapter-break a 'fade'; every OTHER boundary is a short softDur dissolve
// — smooth, never a jarring hard cut, yet clearly gentler than the 0.45-0.5s hero moments so
// those still stand out. Videos with no roles anywhere (template/image modes, older projects)
// keep the legacy uniform fade the owner's "smooth transitions" always produced.
const ROLE_RE = /\[ROLE\]\s*(\w+)/i;
export function planTransitions({ scenes, clipCount, nIntro = 0, nOutro = 0, legacyDur = 0.5, softDur = 0.2 }) {
  const n = Math.max(0, clipCount - 1);
  const roles = scenes.map((s) => (ROLE_RE.exec(s.visual_prompt || '')?.[1] || '').toLowerCase());
  const anyRole = roles.some(Boolean);
  const plan = [];
  let zoomLeft = 1; // at most ONE zoom-through hero transition per video
  for (let b = 0; b < n; b++) {
    const inClip = b + 1; // boundary b sits between clips b and b+1
    const sceneIdx = inClip - nIntro; // index into `scenes` of the INCOMING clip
    if (!anyRole) { plan.push({ type: 'fade', dur: legacyDur }); continue; }
    if (inClip >= nIntro + scenes.length) { plan.push({ type: 'fadeblack', dur: 0.5 }); continue; } // into the outro card
    if (sceneIdx < 0) { plan.push({ type: 'fade', dur: 0.4 }); continue; } // out of the intro card
    const sc = scenes[sceneIdx];
    if (sc?.template === 'chapter-break') { plan.push({ type: 'fade', dur: 0.4 }); continue; }
    const role = roles[sceneIdx];
    if (role === 'payoff' && zoomLeft > 0) { zoomLeft--; plan.push({ type: 'zoomin', dur: 0.45 }); continue; }
    if (role === 'cta') { plan.push({ type: 'fadeblack', dur: 0.5 }); continue; }
    plan.push({ type: 'fade', dur: softDur }); // smooth hand-off — hero transitions above still punch
  }
  return plan;
}
export function transitionLoss(plan, uptoBoundary = Infinity) {
  return (plan || []).slice(0, uptoBoundary).reduce((a, t) => a + (t.type === 'cut' ? 0 : t.dur), 0);
}

// Final assembly (B7): concat scene clips, mix BGM, overlay logo, make thumbnail.
// `transitions` is either a plan array from planTransitions (selective, doctrine mode) or
// boolean true (legacy uniform fade at every boundary).
export async function concatScenes(sceneVideos, project, { dir, size, bgmPath, sfxPath, logo, watermark, transitions, onLog, bgmVol }) {
  if (!sceneVideos.length) throw new Error('Không có cảnh nào để ghép');
  const ow = size.w, oh = size.h;

  // Durations + total (xfade overlaps shorten the timeline). xfade only for moderate counts
  // (deep xfade chains keep every input decoder open → unstable for very long videos).
  const TD = 0.5;
  const durs = [];
  for (const v of sceneVideos) durs.push(await probeDuration(v));
  const plan = Array.isArray(transitions)
    ? transitions.slice(0, sceneVideos.length - 1)
    : (transitions ? sceneVideos.map(() => ({ type: 'fade', dur: TD })).slice(0, sceneVideos.length - 1) : null);
  const anyBlend = !!plan && plan.some((t) => t.type !== 'cut');
  const useGraph = anyBlend && sceneVideos.length > 1 && sceneVideos.length <= 24;
  const total = durs.reduce((a, b) => a + b, 0) - (useGraph ? transitionLoss(plan) : 0);
  const fadeOut = Math.max(0.2, total - 0.6);

  const slug = (project.title || 'video').replace(/[^\p{L}\p{N}\- ]/gu, '').replace(/\s+/g, '_').slice(0, 40) || 'video';
  const finalOut = join(project.outputDir || dir, `${slug}_${newId('')}.mp4`);

  // Single pass: (selective xfade/concat graph | concat-demuxer) → BGM mix → logo → fades → encode.
  const args = [];
  const fc = [];
  let vbase, abase, nextIdx;
  if (useGraph) {
    sceneVideos.forEach((v) => args.push('-i', v));
    nextIdx = sceneVideos.length;
    // settb=AVTB on every video branch: xfade refuses mismatched timebases, and the concat
    // filter re-times its output to 1/1000000 while raw mp4 streams sit at 1/15360.
    fc.push('[0:v]settb=AVTB[vn0]');
    for (let i = 1; i < sceneVideos.length; i++) fc.push(`[${i}:v]settb=AVTB[vn${i}]`);
    let prevV = 'vn0', prevA = '0:a', acc = durs[0]; // acc = running duration of the assembled chain
    for (let i = 1; i < sceneVideos.length; i++) {
      const tr = plan[i - 1] || { type: 'cut', dur: 0 };
      if (tr.type === 'cut') {
        // hard cut: the concat FILTER (inputs share codec/fps/size by construction)
        fc.push(`[${prevV}][${prevA}][vn${i}][${i}:a]concat=n=2:v=1:a=1[vc${i}][ax${i}]`);
        fc.push(`[vc${i}]settb=AVTB[vx${i}]`);
        acc += durs[i];
      } else {
        const d = Math.min(tr.dur || TD, Math.max(0.2, durs[i] - 0.2), Math.max(0.2, acc - 0.2));
        fc.push(`[${prevV}][vn${i}]xfade=transition=${tr.type}:duration=${d.toFixed(3)}:offset=${(acc - d).toFixed(3)}[vx${i}]`);
        fc.push(`[${prevA}][${i}:a]acrossfade=d=${d.toFixed(3)}[ax${i}]`);
        acc += durs[i] - d;
      }
      prevV = `vx${i}`; prevA = `ax${i}`;
    }
    vbase = `[${prevV}]`; abase = `[${prevA}]`;
  } else {
    const listFile = join(dir, `list_${newId('')}.txt`);
    writeFileSync(listFile, sceneVideos.map((v) => `file '${v.replace(/'/g, "'\\''")}'`).join('\n'));
    args.push('-f', 'concat', '-safe', '0', '-i', listFile);
    nextIdx = 1; vbase = '[0:v]'; abase = '[0:a]';
  }
  if (bgmPath && existsSync(bgmPath)) {
    // Sidechain ducking: the voice bus keys a compressor on the BGM, so music breathes up
    // in pauses and tucks itself under narration — replaces the old fixed 0.13 mix level.
    // normalize=0 keeps the (already scene-normalized, P9) voice level intact; the master
    // pass (media/master.js) owns the final -16 LUFS.
    args.push('-stream_loop', '-1', '-i', bgmPath);
    fc.push(`${abase}asplit=2[vmain][vkey]`);
    // pre-duck BGM level: 0.22 legacy default; an LLM sound-design plan may lower it
    // (its 0.06–0.18 range) — the sidechain still breathes it under narration either way
    fc.push(`[${nextIdx}:a]volume=${(Number.isFinite(+bgmVol) && +bgmVol > 0 ? +bgmVol : 0.22).toFixed(2)}[bg0]`,
      `[bg0][vkey]sidechaincompress=threshold=0.02:ratio=10:attack=60:release=550[bgd]`,
      `[vmain][bgd]amix=inputs=2:duration=first:normalize=0:dropout_transition=2[amx]`);
    abase = '[amx]'; nextIdx++;
  }
  if (sfxPath && existsSync(sfxPath)) {
    // transition-whoosh bed (already timed to the cut) — louder than BGM, under the voice;
    // deliberately NOT ducked: whooshes land at chapter breaks where narration pauses
    args.push('-i', sfxPath);
    fc.push(`[${nextIdx}:a]volume=0.75[sfx]`, `${abase}[sfx]amix=inputs=2:duration=first:normalize=0:dropout_transition=2[asx]`);
    abase = '[asx]'; nextIdx++;
  }
  if (logo && logo.path && existsSync(logo.path)) {
    args.push('-i', logo.path);
    if (Number.isFinite(+logo.wPct)) {
      // P26 WYSIWYG shape {cxPct,cyPct,wPct,opacity}: logoRect computes the SAME integers the
      // Brand Kit preview shows — literal scale + overlay coordinates, no runtime expressions.
      const isz = await probeImageSize(logo.path);
      const rect = logoRect(logo, { W: ow, H: oh, logoW: isz?.w || 1, logoH: isz?.h || 1 });
      const op = Math.min(1, Math.max(0.2, Number.isFinite(+logo.opacity) ? +logo.opacity : 0.9));
      fc.push(`[${nextIdx}:v]scale=${rect.lw}:${rect.lh}:flags=lanczos,format=rgba,colorchannelmixer=aa=${op.toFixed(2)}[lg]`,
        `${vbase}[lg]overlay=${rect.x}:${rect.y}[vov]`);
    } else {
      // legacy shape {size(px@1080), position('br'|{xPct,yPct})} — old configs keep rendering
      const lw = Math.round((logo.size || 110) * (oh / 1080));
      const pos = logoPos(logo.position || 'br', ow, oh, lw);
      fc.push(`[${nextIdx}:v]scale=${lw}:-1[lg]`, `${vbase}[lg]overlay=${pos}[vov]`);
    }
    vbase = '[vov]'; nextIdx++;
  }
  // Copyright watermark (P28): logo image or channel-name text drifting slowly around the
  // perimeter — pure t-based expressions from perimeterExpr, the same path the Brand Kit
  // preview animates. Applied to the assembled program, so it covers outro + transitions.
  // The text lane needs drawtext (freetype) — homebrew builds often lack it, so that lane
  // routes the WHOLE encode through the libass-capable binary (ffmpegAss).
  let useAssBinary = false;
  if (watermark && (watermark.path || (watermark.text && watermark.fontFile))) {
    const wm = watermark;
    const period = WM_SPEEDS[wm.speed] || WM_SPEEDS.slow;
    const marginPx = Math.round(Math.min(ow, oh) * (wm.marginPct ?? 0.02));
    const op = Math.min(0.8, Math.max(0.1, Number.isFinite(+wm.opacity) ? +wm.opacity : 0.35));
    if (wm.path && existsSync(wm.path)) {
      args.push('-i', wm.path);
      const wpx = Math.max(16, Math.round((wm.wPct ?? 0.06) * ow));
      const { x, y } = perimeterExpr({ period, marginPx }); // overlay vars W/H/w/h
      fc.push(`[${nextIdx}:v]scale=${wpx}:-1:flags=lanczos,format=rgba,colorchannelmixer=aa=${op.toFixed(2)}[wm]`,
        `${vbase}[wm]overlay=x='${x}':y='${y}'[vwm]`);
      vbase = '[vwm]'; nextIdx++;
    } else {
      const fs = Math.max(14, Math.round(oh * (wm.hPct ?? 0.028)));
      // textfile= dodges the whole drawtext escaping minefield (colons/quotes/percent)
      const tf = join(dir, `wm_${newId('')}.txt`);
      writeFileSync(tf, String(wm.text));
      const { x, y } = perimeterExpr({ varW: 'w', varH: 'h', varw: 'tw', varh: 'th', period, marginPx });
      fc.push(`${vbase}drawtext=fontfile='${wm.fontFile}':textfile='${tf}':fontsize=${fs}`
        + `:fontcolor=white@${op.toFixed(2)}:borderw=${Math.max(1, Math.round(fs * 0.07))}`
        + `:bordercolor=black@${(op * 0.85).toFixed(2)}:x='${x}':y='${y}'[vwm]`);
      vbase = '[vwm]';
      useAssBinary = true;
    }
  }
  fc.push(`${vbase}fade=t=in:st=0:d=0.5,fade=t=out:st=${fadeOut.toFixed(2)}:d=0.6[vout]`);
  // No loudnorm here anymore: stacking a dynamic normalizer on the mix caused pumping.
  // The measured two-pass master (finalize → masterAudio) sets -16 LUFS on the finished file.
  fc.push(`${abase}alimiter=limit=0.891:level=false,afade=t=in:st=0:d=0.4,afade=t=out:st=${fadeOut.toFixed(2)}:d=0.6[aout]`);
  args.push('-filter_complex', fc.join(';'), '-map', '[vout]', '-map', '[aout]', '-t', total.toFixed(2),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(FPS),
    '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-ac', '2', '-movflags', '+faststart', finalOut);
  await (useAssBinary ? ffmpegAss : ffmpeg)(args, { onLog });

  const thumb = join(project.outputDir || dir, `thumb_${newId('')}.jpg`);
  await ffmpeg(['-ss', String(Math.min(1.5, total / 2)), '-i', finalOut, '-frames:v', '1', '-q:v', '3', thumb]);
  return { path: finalOut, thumb, duration: total };
}

// (renderCard — the hardcoded intro/outro title-card clip — was removed with the synthetic
// card lane, P31: the program is the script's scenes only, like the reference app.)

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
