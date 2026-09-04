// Scene rendering (B6) + final concat/mix (B7) with ffmpeg.
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ffmpeg, ffmpegAss, probeDuration, probeImageSize, probeFrameRate } from '../media/ffmpeg.js';
import { logoRect } from '../media/logo-overlay.js';
import { perimeterExpr, WM_SPEEDS } from '../media/watermark.js';
import { planOffsets, programCues, XFADE_DUR } from '../subtitles/timeline.js';
import { buildAss, cueText } from '../subtitles/ass.js';
import { measureCaptions } from '../subtitles/box.js';
import { concatFingerprint, needsVideoFilter, planConcat, tierLog } from './concat-plan.js';
import { ratioToSize, newId } from '../util/util.js';
import { m, tp } from '../i18n/t.js';

const FPS = 30; // fallback only — the real rate is probed off the clips

// ---- Transition planning (motion doctrine: every boundary FLOWS — a short dip through black is
// the default hand-off, while one HERO transition still punches above it) ----
// Returns one entry per clip boundary: { type: 'cut'|'fade'|'fadeblack'|'zoomin', dur }.
// Role-driven when the art director stamped [ROLE] briefs (P4): the transition INTO a payoff
// scene is a zoom-through ('zoomin'); every other boundary dips, a touch longer at the structural
// ones (intro, chapter-break, cta, outro) than at an ordinary hand-off, so the shape of the video
// is still legible. Videos with no roles anywhere keep a single uniform dip. See planTransitions
// for why a dip and not a dissolve — it was measured on real adjacent clips, not chosen by taste.
const ROLE_RE = /\[ROLE\]\s*(\w+)/i;
// User-pickable transition styles (P43). 'auto' keeps the storytelling doctrine below — the
// default, and still the best answer — but the owner can now name one look for the whole video
// the way the reference app lets him, or 'varied' to rotate deterministically. Every value is a
// real ffmpeg xfade transition, verified against the vendored build.
/**
 * Ceiling on the xfade graph, in clips.
 *
 * It used to be 24, on the reasoning that "deep xfade chains keep every input decoder open →
 * unstable for very long videos". Measured on this machine with 192 real clips (801s of 1080×1920)
 * the full coupled xfade+acrossfade graph runs in 77s at a 2.6 GB peak and exits clean — there is
 * no instability to protect against. What the cap did instead was silently disable transitions on
 * every long-form video this app makes: 29 of 39 finished projects are over 24 clips, so the plan
 * was computed, fingerprinted and charged for, and then never rendered.
 *
 * This is now a backstop far above any real video rather than a working limit, and it lives here
 * alone — the copies that had drifted into the SFX offsets, the QC duration and the SRT export are
 * gone, each replaced by planOffsets, which is right whether or not the graph runs.
 */
export const MAX_GRAPH_CLIPS = 400;

export const TRANSITION_STYLES = ['auto', 'fade', 'dissolve', 'slideleft', 'circlecrop', 'circleopen', 'smoothleft', 'zoomin', 'pixelize', 'radial', 'wipeleft', 'varied', 'none'];
const VARIED_CYCLE = ['fade', 'dissolve', 'slideleft', 'circleopen', 'smoothleft', 'zoomin'];

/**
 * The scene-boundary doctrine.
 *
 * The default hand-off is a short DIP THROUGH BLACK rather than a cross-dissolve, and that is a
 * measured choice, not a taste. Rendering real adjacent clips and sampling across the blend:
 *
 *   fade @ 0.2   indistinguishable from a hard cut — both sides share the same radial-gradient
 *                stage (harness.js), so the only thing dissolving is text
 *   fade @ 0.6   WORSE. The clip ends on a held climax (the codegen prompt requires it: "the scene
 *                must END full, not fade to nothing") and the next one is already 0.35–0.5s into
 *                its entrances, so the midpoint is two headlines superimposed — the exact "text on
 *                top of text" the prompt calls an instant fail. Longer is not smoother here.
 *   fadeblack    the only clean middle, because black is a state neither side owns.
 *
 * 0.45 is the ceiling, also measured. Leading silence in a clip is 0.19–0.20s and programCues puts
 * the incoming scene's first cue at `starts[i+1]`, i.e. 0.19s into the window; past 0.45 the dark
 * point drifts under that cue and the video shows a bright caption floating on black.
 *
 * The real cure for a muddy dissolve is upstream — content leaving the frame before the cut, which
 * is what the hand-off ramp does for newly rendered clips. This is what is available to a video
 * that can only be re-joined.
 */
export function planTransitions({ scenes, clipCount, nIntro = 0, nOutro = 0, legacyDur = 0.4, softDur = 0.35, style = 'auto' }) {
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
    if (!anyRole) { plan.push({ type: 'fadeblack', dur: legacyDur }); continue; }
    if (inClip >= nIntro + scenes.length) { plan.push({ type: 'fadeblack', dur: 0.45 }); continue; } // into the outro card
    if (sceneIdx < 0) { plan.push({ type: 'fadeblack', dur: 0.45 }); continue; } // out of the intro card
    const sc = scenes[sceneIdx];
    if (sc?.template === 'chapter-break') { plan.push({ type: 'fadeblack', dur: 0.45 }); continue; }
    const role = roles[sceneIdx];
    if (role === 'payoff' && zoomLeft > 0) { zoomLeft--; plan.push({ type: 'zoomin', dur: 0.45 }); continue; }
    if (role === 'cta') { plan.push({ type: 'fadeblack', dur: 0.45 }); continue; }
    plan.push({ type: 'fadeblack', dur: softDur }); // clean hand-off — the hero zoom above still punches
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
  // Forwarded straight to the encoder so a stop can end the join instead of waiting it out.
  signal = undefined,
}) {
  if (!sceneVideos.length) throw new Error(m('Không có cảnh nào để ghép'));
  const ow = size.w, oh = size.h;

  // The frame an overlay lands on is whatever the CLIPS are — not what the caller believes.
  //
  // `size` is the LOGICAL 1080-class canvas the scenes were authored in (ratioToSize). A project
  // with `resolutionScale: 2` renders its clips at 3840×2160, and nothing below rescales them, so
  // the finished file is 4K while every caller still hands this function 1920×1080. logoRect then
  // computed half the width at half the fraction: measured on a finished 4K video, a stamp stored
  // at cx=0.936 (top right) was drawn at cx=0.468 — the middle of the frame — and the rect
  // predicted from the 1080 space framed it exactly. The edit-video lane is worse still: it
  // composites onto the owner's own footage, whose size is nobody's ratio.
  //
  // Captions deliberately keep using `size`. An ASS document declares its own PlayRes and libass
  // scales that space onto the frame, so the 1080-class coordinates render identically at 4K;
  // moving them would rewrite every project's `assText` digest for no visible change at all.
  const probed = await probeImageSize(sceneVideos[0]);
  const fw = probed?.w || ow, fh = probed?.h || oh;
  // Same reason as the frame size above: re-encoding at a constant 30 threw away every frame of
  // a 60fps project without saying so, and the fps control in the UI quietly did nothing.
  const ffps = (await probeFrameRate(sceneVideos[0])) || FPS;

  // Durations + timeline.
  const TD = XFADE_DUR;
  const durs = [];
  for (const v of sceneVideos) durs.push(await probeDuration(v));
  const plan = Array.isArray(transitions)
    ? transitions.slice(0, sceneVideos.length - 1)
    : (transitions ? sceneVideos.map(() => ({ type: 'fade', dur: TD })).slice(0, sceneVideos.length - 1) : null);
  const anyBlend = !!plan && plan.some((t) => t.type !== 'cut');
  const useGraph = anyBlend && sceneVideos.length > 1 && sceneVideos.length <= MAX_GRAPH_CLIPS;
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
      // A drawn caption background has to be given a size, and ASS cannot measure text. This is
      // the only place that can measure the RIGHT strings — the cues exist here and nowhere
      // earlier — and it still runs before the encode, so a failure costs nothing.
      const metrics = subtitles.style.box
        ? await measureCaptions(cues.map((c) => cueText(c, subtitles.style)), subtitles.style,
          subtitles.fontFile || null, { w: ow, h: oh })
        : null;
      const text = buildAss(cues, subtitles.style, { w: ow, h: oh }, metrics);
      const path = join(dir, `subs_${newId('')}.ass`);
      writeFileSync(path, text, 'utf8');
      ass = { text, path, fontsDir: subtitles.fontsDir || null, shaping: subtitles.shaping || null };
      (onNote || onLog)?.(tp`💬 In ${cues.length} dòng phụ đề lên video (font ${subtitles.style.font})`);
    }
  }

  // How little work will do? See pipeline/concat-plan.js — the file on disk plus the fingerprint
  // that produced it decide whether this is a full encode, a stream copy, an audio-only remux,
  // or nothing at all.
  const assText = ass?.text || null;
  // The EFFECTIVE plan, not the requested one. A plan the graph will not execute must not move the
  // fingerprint: while the clip cap was in force, changing the transition style on a long video
  // moved fp.video, dropped the tier to `encode`, and bought the owner a full re-encode whose
  // output was pixel-identical. The fingerprint has to describe the video that will actually be
  // made, so anything gating the graph has to gate the hash too.
  const effPlan = useGraph ? plan : null;
  const fp = concatFingerprint({
    clips: sceneVideos, size, frame: { w: fw, h: fh }, fps: ffps, transitions: effPlan, logo, watermark,
    assText, masterFade, encoder, bgmPath, sfxPath, bgmVol,
  });
  const videoFilter = needsVideoFilter({ logo, watermark, assText, transitions: effPlan, masterFade });
  const { tier, why } = planConcat({ fp, prev: prevFp, prevPath, videoFilter, allowSkip });
  (onNote || onLog)?.(`${tierLog(tier)} — ${why}`);
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
    fc.push(`[${nextIdx}:a]volume=${(Number.isFinite(+bgmVol) && +bgmVol > 0 ? +bgmVol : 0.24).toFixed(2)}[bg0]`,
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
  // Copyright watermark (P28): logo image or channel-name text drifting slowly around the
  // perimeter — pure t-based expressions from perimeterExpr, the same path the Brand Kit
  // preview animates. Applied to the assembled program, so it covers outro + transitions.
  // The text lane needs drawtext (freetype) — homebrew builds often lack it, so that lane
  // routes the WHOLE encode through the libass-capable binary (ffmpegAss).
  let useAssBinary = false;
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
  else args.push('-map', '[vout]', ...videoCodecArgs(encoder, ffps));
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
  const label = copyVideo ? (tier === 'audio' ? m('🔊 Trộn lại âm thanh') : m('⚡ Sao chép video')) : m('🎞 Mã hoá video hoàn chỉnh');
  const note = onNote || onLog;
  // The bracketing lines carry no percentage, so they DO reach the journal — the ticker shows
  // the live count, the journal keeps the record of what ran and how long it took.
  note?.(`${label} — ${sceneVideos.length} clip · ${Math.round(cut)}s${ass ? ` · ${m('có phụ đề in trực tiếp')}` : ''}`);
  const t0 = Date.now();
  await (useAssBinary ? ffmpegAss : ffmpeg)(args, {
    signal,
    onLog: ffProgress(cut, (pct) => note?.(`${label} · ${pct}%`), onLog),
  });
  note?.(tp`✅ Ghép xong sau ${Math.round((Date.now() - t0) / 1000)}s → ${finalOut.split('/').pop()}`);

  const thumb = join(project.outputDir || dir, `thumb_${newId('')}.jpg`);
  await ffmpeg(['-ss', String(Math.min(1.5, total / 2)), '-i', finalOut, '-frames:v', '1', '-q:v', '3', thumb], { signal });
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
function videoCodecArgs(encoder, fps = FPS) {
  const preset = encoder === 'fast' ? 'veryfast' : 'medium';
  return ['-c:v', 'libx264', '-preset', preset, '-crf', '18', '-profile:v', 'high', '-level', '4.0', '-pix_fmt', 'yuv420p', '-r', String(fps)];
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
