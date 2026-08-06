// Scene rendering (B6) + final concat/mix (B7) with ffmpeg.
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ffmpeg, ffmpegAss, probeDuration, probeImageSize } from '../media/ffmpeg.js';
import { logoRect } from '../media/logo-overlay.js';
import { perimeterExpr, WM_SPEEDS } from '../media/watermark.js';
import { planOffsets, programCues, XFADE_DUR } from '../subtitles/timeline.js';
import { buildAss } from '../subtitles/ass.js';
import { concatFingerprint, needsVideoFilter, planConcat, TIER_LOG } from './concat-plan.js';
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
// User-pickable transition styles (P43). 'auto' keeps the storytelling doctrine below — the
// default, and still the best answer — but the owner can now name one look for the whole video
// the way the reference app lets him, or 'varied' to rotate deterministically. Every value is a
// real ffmpeg xfade transition, verified against the vendored build.
export const TRANSITION_STYLES = ['auto', 'fade', 'dissolve', 'slideleft', 'circlecrop', 'circleopen', 'smoothleft', 'zoomin', 'pixelize', 'radial', 'wipeleft', 'varied', 'none'];
const VARIED_CYCLE = ['fade', 'dissolve', 'slideleft', 'circleopen', 'smoothleft', 'zoomin'];

export function planTransitions({ scenes, clipCount, nIntro = 0, nOutro = 0, legacyDur = 0.5, softDur = 0.2, style = 'auto' }) {
  const n = Math.max(0, clipCount - 1);
  // An explicit style overrides the role doctrine entirely: the owner asked for ONE look.
  if (style && style !== 'auto') {
    if (style === 'none') return Array.from({ length: n }, () => ({ type: 'cut', dur: 0 }));
    if (style === 'varied') {
      // deterministic rotation — the same video always cuts the same way
      return Array.from({ length: n }, (_, b) => ({ type: VARIED_CYCLE[b % VARIED_CYCLE.length], dur: 0.4 }));
    }
    if (TRANSITION_STYLES.includes(style)) return Array.from({ length: n }, () => ({ type: style, dur: 0.4 }));
  }
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
export async function concatScenes(sceneVideos, project, {
  dir, size, bgmPath, sfxPath, logo, watermark, transitions, onLog, onNote, bgmVol,
  subtitles = null, masterFade = true, encoder = 'quality',
  prevPath = null, prevFp = null, allowSkip = true,
}) {
  if (!sceneVideos.length) throw new Error('Không có cảnh nào để ghép');
  const ow = size.w, oh = size.h;

  // Durations + timeline. xfade only for moderate counts (deep xfade chains keep every input
  // decoder open → unstable for very long videos).
  const TD = XFADE_DUR;
  const durs = [];
  for (const v of sceneVideos) durs.push(await probeDuration(v));
  const plan = Array.isArray(transitions)
    ? transitions.slice(0, sceneVideos.length - 1)
    : (transitions ? sceneVideos.map(() => ({ type: 'fade', dur: TD })).slice(0, sceneVideos.length - 1) : null);
  const anyBlend = !!plan && plan.some((t) => t.type !== 'cut');
  const useGraph = anyBlend && sceneVideos.length > 1 && sceneVideos.length <= 24;
  // planOffsets replays this loop's own arithmetic, clamp included, so the caption timeline and
  // the video can never disagree. (transitionLoss sums the PLANNED fade lengths and ignores the
  // per-join clamp — close enough for a QC tolerance, not for placing a subtitle.)
  const { starts, total } = planOffsets(durs, useGraph ? plan : null);
  const fadeOut = Math.max(0.2, total - 0.6);

  const slug = (project.title || 'video').replace(/[^\p{L}\p{N}\- ]/gu, '').replace(/\s+/g, '_').slice(0, 40) || 'video';
  const finalOut = join(project.outputDir || dir, `${slug}_${newId('')}.mp4`);
  const timeline = starts.map((s, i) => ({ start: +s.toFixed(3), end: +(s + (durs[i] || 0)).toFixed(3) }));

  // Burned captions are built HERE rather than by the caller, because they need the offsets this
  // function has just computed. Anywhere else and the two would be free to disagree — which is
  // the drift this whole lane exists to avoid.
  let ass = null;
  if (subtitles?.style && subtitles.style.enabled !== false && subtitles.scenes?.length) {
    const cues = programCues(subtitles.scenes, starts, subtitles.config || {}, total);
    if (cues.length) {
      const text = buildAss(cues, subtitles.style, { w: ow, h: oh });
      const path = join(dir, `subs_${newId('')}.ass`);
      writeFileSync(path, text, 'utf8');
      ass = { text, path, fontsDir: subtitles.fontsDir || null, shaping: subtitles.shaping || null };
      (onNote || onLog)?.(`💬 In ${cues.length} dòng phụ đề lên video (font ${subtitles.style.font})`);
    }
  }

  // How little work will do? See pipeline/concat-plan.js — the file on disk plus the fingerprint
  // that produced it decide whether this is a full encode, a stream copy, an audio-only remux,
  // or nothing at all.
  const assText = ass?.text || null;
  const fp = concatFingerprint({
    clips: sceneVideos, size, fps: FPS, transitions: plan, logo, watermark, assText,
    masterFade, encoder, bgmPath, sfxPath, bgmVol,
  });
  const videoFilter = needsVideoFilter({ logo, watermark, assText, transitions: plan, masterFade });
  const { tier, why } = planConcat({ fp, prev: prevFp, prevPath, videoFilter, allowSkip });
  (onNote || onLog)?.(`${TIER_LOG[tier]} — ${why}`);
  if (tier === 'skip') {
    return { path: prevPath, thumb: project.thumb_path || null, duration: total, timeline, fp, tier };
  }

  // Single pass: (selective xfade/concat graph | concat-demuxer) → BGM mix → logo → fades → encode.
  const args = [];
  const fc = [];
  let vbase, abase, nextIdx;
  // Tiers 'audio' and 'copy' keep the video stream untouched, so neither builds a video graph.
  const copyVideo = tier === 'audio' || tier === 'copy';
  const clipList = () => {
    const listFile = join(dir, `list_${newId('')}.txt`);
    writeFileSync(listFile, sceneVideos.map((v) => `file '${v.replace(/'/g, "'\\''")}'`).join('\n'));
    return listFile;
  };
  if (tier === 'audio') {
    // The picture is already correct on disk — the only reason to open the clips at all is to
    // rebuild the mix. Input 0 supplies the video (copied), input 1 the scene audio.
    args.push('-i', prevPath, '-f', 'concat', '-safe', '0', '-i', clipList());
    nextIdx = 2; vbase = '[0:v]'; abase = '[1:a]';
  } else if (useGraph) {
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
    args.push('-f', 'concat', '-safe', '0', '-i', clipList());
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
  if (!copyVideo && logo && logo.path && existsSync(logo.path)) {
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
  if (!copyVideo && watermark && (watermark.path || (watermark.text && watermark.fontFile))) {
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
  // Burned captions (final-pass lane). Last video filter before the master fade, so the fade
  // takes the subtitles down with the picture instead of leaving them floating over black.
  // libass lives only in the vendored ffmpeg, so this flips the same binary switch the drawtext
  // watermark lane already uses.
  if (!copyVideo && ass?.path) {
    fc.push(`${vbase}ass=filename=${ffQuote(ass.path)}${ass.fontsDir ? `:fontsdir=${ffQuote(ass.fontsDir)}` : ''}`
      + `${ass.shaping ? `:shaping=${ass.shaping}` : ''}[vsub]`);
    vbase = '[vsub]';
    useAssBinary = true;
  }
  if (!copyVideo) {
    // The master fade is the ONE unconditional video filter, which is exactly what keeps the
    // stream-copy tier out of reach. Turning it off is therefore a real speed lever, not a
    // cosmetic preference — the change queue surfaces it as such.
    fc.push(masterFade !== false
      ? `${vbase}fade=t=in:st=0:d=0.5,fade=t=out:st=${fadeOut.toFixed(2)}:d=0.6[vout]`
      : `${vbase}null[vout]`);
  }
  // No loudnorm here anymore: stacking a dynamic normalizer on the mix caused pumping.
  // The measured two-pass master (finalize → masterAudio) sets -16 LUFS on the finished file.
  fc.push(`${abase}alimiter=limit=0.891:level=false,afade=t=in:st=0:d=0.4,afade=t=out:st=${fadeOut.toFixed(2)}:d=0.6[aout]`);
  const cut = copyVideo && tier === 'audio' ? (await probeDuration(prevPath)) || total : total;
  args.push('-filter_complex', fc.join(';'));
  if (copyVideo) args.push('-map', '0:v', '-c:v', 'copy');
  else args.push('-map', '[vout]', ...videoCodecArgs(encoder));
  args.push('-map', '[aout]', '-t', cut.toFixed(2),
    '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-ac', '2', '-movflags', '+faststart', finalOut);
  // The join is the longest single step in the app — up to a quarter of an hour on a full-length
  // video — and it said nothing at all while it ran, because the ffmpeg wrapper runs at
  // `-loglevel error`. "✂️ Ghép & mix…" and then silence is indistinguishable from a hang, which
  // is the whole reason the owner asked for a live processing log.
  //
  // `-progress pipe:1` makes ffmpeg write key=value blocks to stdout; `out_time_us` against the
  // programme duration is the percentage. They stay on the TICKER: progress.js deliberately keeps
  // `· NN%` lines out of the journal, or one join would write a hundred rows into it.
  args.unshift('-progress', 'pipe:1', '-nostats'); // global options must precede the inputs
  const label = copyVideo ? (tier === 'audio' ? '🔊 Trộn lại âm thanh' : '⚡ Sao chép video') : '🎞 Mã hoá video hoàn chỉnh';
  await (useAssBinary ? ffmpegAss : ffmpeg)(args, {
    onLog: ffProgress(cut, (pct) => (onNote || onLog)?.(`${label} · ${pct}%`), onLog),
  });

  const thumb = join(project.outputDir || dir, `thumb_${newId('')}.jpg`);
  await ffmpeg(['-ss', String(Math.min(1.5, total / 2)), '-i', finalOut, '-frames:v', '1', '-q:v', '3', thumb]);
  return { path: finalOut, thumb, duration: total, timeline, fp, tier };
}

/**
 * Turn ffmpeg's `-progress` stream into whole percentages.
 *
 * The stream is key=value lines in blocks, roughly twice a second; `out_time_us` is how far into
 * the OUTPUT it has written. Only forward movement is reported, and only when the whole number
 * changes, so a fifteen-minute encode emits at most a hundred lines instead of two thousand.
 * `N/A` appears in the first block or two and simply does not match.
 *
 * @param {number} total output duration in seconds
 * @param {(pct:number)=>void} onPct
 * @param {(chunk:string)=>void} [passthrough] the caller's own log sink, still fed everything
 */
export function ffProgress(total, onPct, passthrough) {
  let last = -1;
  return (chunk) => {
    passthrough?.(chunk);
    if (!(total > 0)) return;
    let us = null, m;
    const re = /out_time_us=(\d+)/g;
    while ((m = re.exec(chunk))) us = +m[1];
    if (us == null) return;
    // capped at 99: the file is not finished until ffmpeg exits, and reporting 100% while the
    // moov atom is still being written reads as a stall at the very end
    const pct = Math.max(0, Math.min(99, Math.round((us / 1e6) / total * 100)));
    if (pct > last) { last = pct; onPct(pct); }
  };
}

/**
 * Quote a path for a filtergraph option value. Inside single quotes ffmpeg treats `:` and `,`
 * as literals, which is the whole problem with passing a filesystem path to `ass=` unquoted.
 */
function ffQuote(p) {
  return `'${String(p).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/**
 * `quality` reproduces the reference app's master exactly (crf 18, preset medium, High@4.0) and
 * stays the default for anything the owner publishes.
 *
 * `fast` is the same encoder at the same CRF with a cheaper preset — NOT the hardware encoder,
 * which was the obvious guess and measured worse on every axis. On 158s of real 1080p scene
 * material from this app (M-series, 2026-08-06):
 *
 *   libx264 -preset medium -crf 18   38.4s   44.6 MB   baseline
 *   libx264 -preset veryfast -crf 18 21.8s   43.4 MB   SSIM 0.99952 vs baseline
 *   h264_videotoolbox -q:v 75        24.5s   54.7 MB   SSIM 0.99875 vs baseline
 *
 * VideoToolbox is slower than veryfast, 23% larger, and further from the reference — so there is
 * no configuration in which it wins here and it is not offered. Note the ceiling on all of this:
 * the stream-copy tier does the same job in 4.6s. Picking a cheaper encoder is worth 1.8×;
 * needing no encoder at all is worth 8×, which is why concat-plan.js matters more than this
 * function does.
 */
function videoCodecArgs(encoder) {
  const preset = encoder === 'fast' ? 'veryfast' : 'medium';
  return ['-c:v', 'libx264', '-preset', preset, '-crf', '18', '-profile:v', 'high', '-level', '4.0', '-pix_fmt', 'yuv420p', '-r', String(FPS)];
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
