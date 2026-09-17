// The filtergraph, one builder per lane. Each takes the graph state — the ffmpeg args so far,
// the filter chain, and the current video/audio labels — and leaves it one lane further along.
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { probeImageSize } from '../../media/ffmpeg.js';
import { logoRect } from '../../media/logo-overlay.js';
import { perimeterExpr, WM_SPEEDS } from '../../media/watermark.js';
import { newId } from '../../util/util.js';

/** @typedef {{args:string[], fc:string[], vbase:string, abase:string, nextIdx:number, useAssBinary:boolean}} Graph */

/** @returns {Graph} */
export function newGraph() {
  return { args: [], fc: [], vbase: '', abase: '', nextIdx: 0, useAssBinary: false };
}

/** The clips themselves: audio-only remux, xfade/concat graph, or the concat demuxer. */
export function chainClips(g, { sceneVideos, tier, prevPath, useGraph, plan, durs, TD, dir }) {
  const { args, fc } = g; let { vbase, abase, nextIdx } = g;
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
        // `qsin` on the way out, no fade at all on the way in.
        //
        // acrossfade defaults to linear (`tri`) on both sides, which is amplitude-linear and so
        // dips about 3 dB in power at the midpoint on uncorrelated material — audible as a sag at
        // every join. `qsin` is the equal-power pair (in² + out² = 1).
        //
        // The incoming side gets `nofade` because the material is asymmetric: the outgoing clip
        // ends in silence (a 400–650ms breath pad, measured 0.68–0.93s of real trailing silence)
        // while the incoming clip starts speaking almost immediately — measured leading silence is
        // only 0.19–0.20s. Fading it up meant every hero boundary chewed 200–300ms off the first
        // words of the next scene. Entering at full level over its own silence is what a hard cut
        // already does, so there is no click to introduce.
        fc.push(`[${prevA}][${i}:a]acrossfade=d=${d.toFixed(3)}:c1=qsin:c2=nofade[ax${i}]`);
        acc += durs[i] - d;
      }
      prevV = `vx${i}`; prevA = `ax${i}`;
    }
    vbase = `[${prevV}]`; abase = `[${prevA}]`;
  } else {
    args.push('-f', 'concat', '-safe', '0', '-i', clipList());
    nextIdx = 1; vbase = '[0:v]'; abase = '[0:a]';
  }
  Object.assign(g, { vbase, abase, nextIdx });
}

/** BGM under a sidechain duck, then the SFX bed. */
export function mixAudio(g, { bgmPath, bgmVol, sfxPath }) {
  const { args, fc } = g; let { abase, nextIdx } = g;
  if (bgmPath && existsSync(bgmPath)) {
    // Sidechain ducking: the voice bus keys a compressor on the BGM, so music breathes up
    // in pauses and tucks itself under narration — replaces the old fixed 0.13 mix level.
    // normalize=0 keeps the (already scene-normalized, P9) voice level intact; the master
    // pass (media/master.js) owns the final -16 LUFS.
    args.push('-stream_loop', '-1', '-i', bgmPath);
    fc.push(`${abase}asplit=2[vmain][vkey]`);
    // pre-duck BGM level: 0.24 with no plan; a sound-design plan picks inside 0.14–0.28.
    // Raised from 0.11/0.22 on 2026-08-26 — measured, the old level sat at −45 dBFS in the
    // gaps, which is present on a meter and absent to the ear.
    // Library tracks fade to −70 dB at the tail, so every -stream_loop seam is a hole; when a
    // narration pause lands on one the mix drops to silence (measured: 0.8 s at −62 dB).
    // Drop anything 12 dB under the bed's level before looping, and the seam closes.
    fc.push(`[${nextIdx}:a]silenceremove=stop_periods=-1:stop_duration=0.15:stop_threshold=-32dB,`
      + `volume=${(Number.isFinite(+bgmVol) && +bgmVol > 0 ? +bgmVol : 0.24).toFixed(2)}[bg0]`,
      `[bg0][vkey]sidechaincompress=threshold=0.02:ratio=10:attack=60:release=550[bgd]`,
      `[vmain][bgd]amix=inputs=2:duration=first:normalize=0:dropout_transition=2[amx]`);
    abase = '[amx]'; nextIdx++;
  }
  if (sfxPath && existsSync(sfxPath)) {
    // transition-whoosh bed (already timed to the cut) — louder than BGM, under the voice;
    // deliberately NOT ducked: whooshes land at chapter breaks where narration pauses
    args.push('-i', sfxPath);
    fc.push(`[${nextIdx}:a]volume=0.9[sfx]`, `${abase}[sfx]amix=inputs=2:duration=first:normalize=0:dropout_transition=2[asx]`);
    abase = '[asx]'; nextIdx++;
  }
  Object.assign(g, { abase, nextIdx });
}

/** Whole-video logo stamp (P26): the ONLY logo lane. */
export async function overlayLogo(g, { logo, fw, fh, copyVideo }) {
  const { args, fc } = g; let { vbase, nextIdx } = g;
  if (!copyVideo && logo && logo.path && existsSync(logo.path)) {
    args.push('-i', logo.path);
    if (Number.isFinite(+logo.wPct)) {
      // P26 WYSIWYG shape {cxPct,cyPct,wPct,opacity}: logoRect computes the SAME integers the
      // Brand Kit preview shows — literal scale + overlay coordinates, no runtime expressions.
      const isz = await probeImageSize(logo.path);
      const rect = logoRect(logo, { W: fw, H: fh, logoW: isz?.w || 1, logoH: isz?.h || 1 });
      const op = Math.min(1, Math.max(0.2, Number.isFinite(+logo.opacity) ? +logo.opacity : 0.9));
      fc.push(`[${nextIdx}:v]scale=${rect.lw}:${rect.lh}:flags=lanczos,format=rgba,colorchannelmixer=aa=${op.toFixed(2)}[lg]`,
        `${vbase}[lg]overlay=${rect.x}:${rect.y}[vov]`);
    } else {
      // legacy shape {size(px@1080), position('br'|{xPct,yPct})} — old configs keep rendering
      const lw = Math.round((logo.size || 110) * (fh / 1080));
      const pos = logoPos(logo.position || 'br', fw, fh, lw);
      fc.push(`[${nextIdx}:v]scale=${lw}:-1[lg]`, `${vbase}[lg]overlay=${pos}[vov]`);
    }
    vbase = '[vov]'; nextIdx++;
  }
  Object.assign(g, { vbase, nextIdx });
}

/** Copyright watermark (P28) — image or drawtext lane. */
export function overlayWatermark(g, { watermark, fw, fh, dir, copyVideo }) {
  const { args, fc } = g; let { vbase, nextIdx, useAssBinary } = g;
  // Copyright watermark (P28): logo image or channel-name text drifting slowly around the
  // perimeter — pure t-based expressions from perimeterExpr, the same path the Brand Kit
  // preview animates. Applied to the assembled program, so it covers outro + transitions.
  // The text lane needs drawtext (freetype) — homebrew builds often lack it, so that lane
  // routes the WHOLE encode through the libass-capable binary (ffmpegAss).
  if (!copyVideo && watermark && (watermark.path || (watermark.text && watermark.fontFile))) {
    const wm = watermark;
    const period = WM_SPEEDS[wm.speed] || WM_SPEEDS.slow;
    const marginPx = Math.round(Math.min(fw, fh) * (wm.marginPct ?? 0.02));
    const op = Math.min(0.8, Math.max(0.1, Number.isFinite(+wm.opacity) ? +wm.opacity : 0.35));
    if (wm.path && existsSync(wm.path)) {
      args.push('-i', wm.path);
      const wpx = Math.max(16, Math.round((wm.wPct ?? 0.06) * fw));
      const { x, y } = perimeterExpr({ period, marginPx }); // overlay vars W/H/w/h
      fc.push(`[${nextIdx}:v]scale=${wpx}:-1:flags=lanczos,format=rgba,colorchannelmixer=aa=${op.toFixed(2)}[wm]`,
        `${vbase}[wm]overlay=x='${x}':y='${y}'[vwm]`);
      vbase = '[vwm]'; nextIdx++;
    } else {
      const fs = Math.max(14, Math.round(fh * (wm.hPct ?? 0.028)));
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
  Object.assign(g, { vbase, nextIdx, useAssBinary });
}

/** Burned captions (final-pass lane), then the master fade. */
export function finishVideo(g, { ass, copyVideo, masterFade, fadeOut }) {
  const { fc, abase } = g; let { vbase, useAssBinary } = g;
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
  Object.assign(g, { vbase, useAssBinary });
}

/**
 * Quote a path for a filtergraph option value. Inside single quotes ffmpeg treats `:` and `,`
 * as literals, which is the whole problem with passing a filesystem path to `ass=` unquoted.
 */
function ffQuote(p) {
  return `'${String(p).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
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
