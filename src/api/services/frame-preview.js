// One real frame, through the real final pipeline.
//
// Checking a logo used to mean re-concatenating the whole video and watching it: fifteen minutes
// to find out a badge was four pixels too high. Extracting a single frame and putting the stamp
// on it with the SAME arithmetic the concat uses answers the same question in about a second.
//
// The word that matters is "same". This is not a mock-up: the logo goes through
// resolveConcatLogo + logoRect, exactly what pipeline/render.js calls, and the subtitle goes
// through burnStyleFrom + buildAss + libass with the same fontsdir the burn would use. If the
// typeface shows up here, it will show up in the video, because it is the same code path
// answering the same question. That is what makes it worth trusting enough to skip the render.
import { existsSync, writeFileSync, readFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import * as DB from '../../db/index.js';
import { ffmpeg, ffmpegAss, probeDuration, probeImageSize } from '../../media/ffmpeg.js';
import { resolveConcatLogo, logoRect } from '../../media/logo-overlay.js';
import { burnStyleFrom } from '../../subtitles/presets.js';
import { buildAss } from '../../subtitles/ass.js';
import { sceneCues, shiftCues } from '../../subtitles/timeline.js';
import { prepareBurnFontDir, shapingFor, isSystemFamily } from '../../fonts/files.js';
import { themeFromGuide, resolveGuide } from '../../styleguide/index.js';
import { ratioToSize, newId } from '../../util/util.js';
import { resolveLang } from '../../util/lang.js';

const ffQuote = (p) => `'${String(p).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/** Which scene is on screen at `t`, using the timeline the concat actually assembled. */
function sceneAt(project, scenes, t) {
  const tl = project.metadata?.timeline;
  if (Array.isArray(tl) && tl.length) {
    const hit = tl.find((s) => t >= s.start && t < s.end) || tl[tl.length - 1];
    return { row: scenes.find((s) => s.id === hit.sceneId) || scenes[0], start: hit.start };
  }
  // No stored timeline (a project finished before this existed): fall back to cumulative
  // durations and accept that a video with crossfades will be off by the overlaps. Better a
  // slightly-off caption in a preview than no preview at all — and the next concat writes the
  // real timeline.
  let acc = 0;
  for (const s of scenes) {
    const d = s.duration || 0;
    if (t < acc + d) return { row: s, start: acc };
    acc += d;
  }
  return { row: scenes[scenes.length - 1], start: Math.max(0, acc - (scenes[scenes.length - 1]?.duration || 0)) };
}

/**
 * @param {string} projectId
 * @param {{t?:number, overrides?:object}} opts `overrides` is a config patch — the panel's live
 *   values, before anything is saved, so the owner sees the change they are still making.
 * @returns {Promise<{buffer:Buffer, t:number, note:string|null}>}
 */
export async function framePreview(projectId, { t = 1.5, overrides = {} } = {}) {
  const project = DB.getProject(projectId);
  if (!project) throw new Error('project not found');
  const config = { ...(project.config || {}), ...overrides };
  const size = ratioToSize(project.aspect_ratio);
  const scenes = DB.getScenes(projectId).filter((s) => s.video_path && existsSync(s.video_path)).sort((a, b) => a.idx - b.idx);

  // Prefer the finished video: it is what the owner is actually looking at. A project still in
  // progress previews on the scene clip covering that moment instead.
  const finished = project.video_path && existsSync(project.video_path) ? project.video_path : null;
  if (!finished && !scenes.length) throw new Error('chưa có cảnh nào đã render để xem thử');
  const { row: scene, start } = sceneAt(project, scenes, t);
  const source = finished || scene.video_path;
  const seek = finished ? t : Math.max(0, t - start);
  const dur = (await probeDuration(source)) || 0;
  const at = Math.max(0, Math.min(seek, Math.max(0, dur - 0.05)));

  const dir = join(DB.projectDirFor(projectId), 'render');
  mkdirSync(dir, { recursive: true });
  const out = join(dir, `frame_${newId('')}.png`);
  const args = ['-ss', at.toFixed(3), '-i', source];
  const fc = [];
  let vbase = '[0:v]';
  let nextIdx = 1;
  let note = null;
  let useAss = false;
  const cleanup = [];

  // ---- subtitle, drawn from the cue really spoken at this moment ----
  if (config.enableSubtitles !== false && config.subtitleLane === 'final') {
    const theme = themeFromGuide(resolveGuide(config));
    const style = burnStyleFrom(config, theme, size);
    let fontsDir = null;
    try {
      ({ fontsDir } = prepareBurnFontDir(style.font, style.weight, dir));
    } catch (e) {
      // A preview must never be the thing that stops the owner working. It does have to say so:
      // a preview drawn in a substitute font is exactly the lie this feature exists to prevent.
      note = e.message;
    }
    if (!note || isSystemFamily(style.font)) {
      const abs = shiftCues(sceneCues(scene, config), start);
      const cue = abs.find((c) => t >= c.start && t <= c.end) || abs[0];
      if (cue) {
        // re-time the cue onto a fresh zero: input seeking restarts the timestamps
        const off = cue.start;
        const local = {
          ...cue, start: 0, end: cue.end - off,
          words: (cue.words || []).map((w) => ({ ...w, start: w.start - off, end: w.end - off })),
        };
        const path = join(dir, `frame_${newId('')}.ass`);
        writeFileSync(path, buildAss([local], style, { w: size.w, h: size.h }), 'utf8');
        cleanup.push(path);
        const shaping = shapingFor(resolveLang(config, scenes));
        fc.push(`${vbase}setpts=PTS-STARTPTS,ass=filename=${ffQuote(path)}`
          + `${fontsDir ? `:fontsdir=${ffQuote(fontsDir)}` : ''}${shaping ? `:shaping=${shaping}` : ''}[vsub]`);
        vbase = '[vsub]';
        useAss = true;
        // seek to the middle of the cue's own window so a karaoke frame is not caught mid-blank
        args[1] = Math.max(0, at + Math.min(0.3, (cue.end - cue.start) / 2)).toFixed(3);
      }
    }
  }

  // ---- logo, through the arithmetic the concat uses ----
  const logo = resolveConcatLogo(config, size);
  if (logo?.path && existsSync(logo.path) && Number.isFinite(+logo.wPct)) {
    args.push('-i', logo.path);
    const isz = await probeImageSize(logo.path);
    const rect = logoRect(logo, { W: size.w, H: size.h, logoW: isz?.w || 1, logoH: isz?.h || 1 });
    const op = Math.min(1, Math.max(0.2, Number.isFinite(+logo.opacity) ? +logo.opacity : 0.9));
    fc.push(`[${nextIdx}:v]scale=${rect.lw}:${rect.lh}:flags=lanczos,format=rgba,colorchannelmixer=aa=${op.toFixed(2)}[lg]`,
      `${vbase}[lg]overlay=${rect.x}:${rect.y}[vov]`);
    vbase = '[vov]';
    nextIdx++;
  }

  if (fc.length) args.push('-filter_complex', fc.join(';'), '-map', vbase);
  args.push('-frames:v', '1', '-y', out);
  await (useAss ? ffmpegAss : ffmpeg)(args);
  const buffer = readFileSync(out);
  for (const f of [out, ...cleanup]) { try { unlinkSync(f); } catch { /* temp file */ } }
  return { buffer, t: at, note };
}
