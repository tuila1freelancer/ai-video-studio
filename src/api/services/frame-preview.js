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
import { buildAss, cueText } from '../../subtitles/ass.js';
import { measureCaptions } from '../../subtitles/box.js';
import { programCues } from '../../subtitles/timeline.js';
import { prepareBurnFontDir, shapingFor, isSystemFamily } from '../../fonts/files.js';
import { themeFromGuide, resolveGuide } from '../../styleguide/index.js';
import { ratioToSize, newId } from '../../util/util.js';
import { resolveLang } from '../../util/lang.js';

const ffQuote = (p) => `'${String(p).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Which scene is on screen at `t`, using the timeline the concat actually assembled. */
function sceneAt(project, scenes, t) {
  const tl = project.metadata?.timeline;
  if (Array.isArray(tl) && tl.length) {
    // The LAST window that contains `t`, not the first. Timeline windows OVERLAP by the crossfade
    // length (`start_{i+1} = acc - d`, planOffsets), and during that overlap the burn shows the
    // INCOMING scene's caption — programCues clamps the outgoing one at `starts[i+1]`. Taking the
    // first match would preview the outgoing scene's text for up to half a second at every join,
    // which is a whole different line from the one the video carries there.
    const hits = tl.filter((s) => t >= s.start && t < s.end);
    const hit = hits[hits.length - 1] || tl[tl.length - 1];
    return { row: scenes.find((s) => s.id === hit.sceneId), start: hit.start };
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
  // The brand kit is read LIVE from the channel at concat time (finalize.js), so a preview built
  // from the project's stored copy would stamp a logo the next join will not use.
  if (!config.brandKitOverride) {
    const live = DB.channelOf(projectId)?.config?.brandKit;
    if (live) config.brandKit = live;
  }
  const size = ratioToSize(project.aspect_ratio);
  const scenes = DB.getScenes(projectId).filter((s) => s.video_path && existsSync(s.video_path)).sort((a, b) => a.idx - b.idx);

  // Preview the BARE SCENE CLIP, never the finished video.
  //
  // On the final lane the clips are rendered without captions and the logo is stamped at concat
  // (animation/index.js captionsOff, render.js), so `project.video_path` ALREADY CARRIES BOTH.
  // Reading a frame from it and drawing the caption again put two subtitles on the screen — the
  // burned one and the one being previewed — which is exactly what the owner reported. The logo
  // was doubled too; it only looked fine because the two landed on the same pixels, so any change
  // to logo position or size showed two of them.
  //
  // The clip is also the only source that can answer the question being asked: it has no styling
  // baked in, so what gets drawn on it is the panel's live config and nothing else.
  const { row: scene, start } = sceneAt(project, scenes, t);
  const finished = project.video_path && existsSync(project.video_path) ? project.video_path : null;
  if (!scene && !finished) throw new Error('chưa có cảnh nào đã render để xem thử');
  // No clip for this moment — the clips were cleaned up, or this is a legacy project. Fall back to
  // the finished video and draw NOTHING on it: it is already stamped, and a second pass would lie.
  const bare = !!scene;
  const source = bare ? scene.video_path : finished;
  const seek = bare ? Math.max(0, t - start) : t;
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
  let shown = t;
  if (bare && config.enableSubtitles !== false && config.subtitleLane === 'final') {
    const theme = themeFromGuide(resolveGuide(config));
    const style = burnStyleFrom(config, theme, size);
    let fontsDir = null;
    let fontFile = null;
    try {
      ({ fontsDir, file: fontFile } = prepareBurnFontDir(style.font, style.weight, dir));
    } catch (e) {
      // A preview must never be the thing that stops the owner working. It does have to say so:
      // a preview drawn in a substitute font is exactly the lie this feature exists to prevent.
      note = e.message;
    }
    if (!note || isSystemFamily(style.font)) {
      // The scene's cues clamped to its own slot — the SAME function the burn uses. Reading the
      // raw cues instead let one overrunning its slot preview with more words than the video
      // carries, and (since the drawn box is measured from the text) a wider box with them.
      const cues = programCues([scene], [start], config, start + (scene.duration || dur));
      const live = cues.find((c) => t >= c.start && t <= c.end);
      // Nothing is spoken here. Rather than draw the scene's FIRST caption — which is what this
      // did, so a silent gap previewed a line that is nowhere near the playhead — move to the
      // nearest cue and say so. Showing an unrelated caption is worse than showing none.
      const near = live || cues.find((c) => c.end > t) || cues[cues.length - 1];
      if (!live && near) {
        shown = Math.min(near.start + 0.35, near.end - 0.01);
        note = note || `⏱ ${fmt(t)} không có phụ đề — đang xem tại ${fmt(shown)}`;
      }
      if (!near) note = note || 'cảnh này không có phụ đề';
      if (near) {
        const path = join(dir, `frame_${newId('')}.ass`);
        // the same measurement the burn does, or the preview would draw a box the video will not
        const metrics = style.box
          ? await measureCaptions(cues.map((c) => cueText(c, style)), style, fontFile, size)
          : null;
        writeFileSync(path, buildAss(cues, style, { w: size.w, h: size.h }, metrics), 'utf8');
        cleanup.push(path);
        const shaping = shapingFor(resolveLang(config, scenes));
        // Put the frame at its REAL program time instead of collapsing the cue to zero.
        //
        // `-ss` before `-i` rebases the decoded frame to ~0 and `setpts=PTS-STARTPTS` pinned it
        // exactly there, so libass was always asked to draw the cue in its OPENING state: karaoke
        // lit the first word whatever `t` was, progressive reveal showed a single word, and a
        // fade-in rendered the caption invisible. Offsetting the timestamp lets the cues keep
        // their own program times and libass answer for the real moment.
        fc.push(`${vbase}setpts=PTS-STARTPTS+${shown.toFixed(3)}/TB,ass=filename=${ffQuote(path)}`
          + `${fontsDir ? `:fontsdir=${ffQuote(fontsDir)}` : ''}${shaping ? `:shaping=${shaping}` : ''}[vsub]`);
        vbase = '[vsub]';
        useAss = true;
        // …and seek the SOURCE to match, clamped afterwards so a cue near the end cannot push the
        // seek past EOF (which decoded zero frames and surfaced as a 400).
        args[1] = Math.max(0, Math.min(at + (shown - t), Math.max(0, dur - 0.05))).toFixed(3);
      }
    }
  } else if (!bare) {
    note = 'khung này lấy từ video đã xuất — phụ đề và logo đã in sẵn, không xem trước thay đổi được';
  }

  // ---- logo, through the arithmetic the concat uses ----
  // Only onto a bare clip. The finished video already carries the stamp; overlaying a second one
  // was invisible while the geometry matched and produced two logos the moment it did not.
  const logo = bare ? resolveConcatLogo(config, size) : null;
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
  return { buffer, t: shown, note };
}
