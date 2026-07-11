// One-click platform exports from a finished master. Same-aspect exports are a fast
// remux (+faststart) or a fade-out trim when the platform caps duration; a different
// aspect is delegated to the repurpose machine (full no-crop re-render) — this module
// never silently crops or squeezes the picture.
import { existsSync } from 'node:fs';
import { join, dirname, basename, extname } from 'node:path';
import * as DB from '../db/index.js';
import { ffmpeg, probeDuration } from '../media/ffmpeg.js';

export const EXPORT_PRESETS = {
  youtube: { label: 'YouTube (16:9)', ar: '16:9', maxDur: null, suffix: 'youtube' },
  shorts: { label: 'YouTube Shorts (9:16 ≤60s)', ar: '9:16', maxDur: 60, suffix: 'shorts' },
  tiktok: { label: 'TikTok (9:16 ≤60s)', ar: '9:16', maxDur: 60, suffix: 'tiktok' },
  reels: { label: 'Instagram Reels (9:16 ≤90s)', ar: '9:16', maxDur: 90, suffix: 'reels' },
};

/**
 * @returns {path, trimmed} on success, or {needsRepurpose, targetAr} / {needsTrim, duration,
 *   maxDur} when the caller must confirm the heavier/lossy step first. Never starts a
 *   pipeline by itself.
 */
export async function exportForPlatform(projectId, presetId, { allowTrim = false } = {}) {
  const preset = EXPORT_PRESETS[presetId];
  if (!preset) { const e = new Error(`preset không hỗ trợ: ${presetId}`); e.status = 400; throw e; }
  const project = DB.getProject(projectId);
  if (!project) { const e = new Error('project not found'); e.status = 404; throw e; }
  if (!project.video_path || !existsSync(project.video_path)) {
    const e = new Error('video final chưa tồn tại — render/ghép xong đã rồi export'); e.status = 400; throw e;
  }
  if (project.aspect_ratio !== preset.ar) return { needsRepurpose: true, targetAr: preset.ar };

  const dur = await probeDuration(project.video_path);
  const needsTrim = preset.maxDur && dur > preset.maxDur + 0.5;
  if (needsTrim && !allowTrim) return { needsTrim: true, duration: +dur.toFixed(1), maxDur: preset.maxDur };

  const src = project.video_path;
  const out = join(dirname(src), `${basename(src, extname(src))}_${preset.suffix}.mp4`);
  if (needsTrim) {
    const t = preset.maxDur;
    const fadeAt = Math.max(0, t - 0.6).toFixed(2);
    await ffmpeg(['-i', src, '-t', String(t),
      '-vf', `fade=t=out:st=${fadeAt}:d=0.6`, '-af', `afade=t=out:st=${fadeAt}:d=0.6`,
      '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out]);
  } else {
    // stream copy: the master's quality untouched, moov up front for instant web playback
    await ffmpeg(['-i', src, '-c', 'copy', '-movflags', '+faststart', out]);
  }
  return { path: out, trimmed: !!needsTrim, preset: preset.label };
}
