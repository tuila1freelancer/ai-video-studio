// B7 concat/mix + B8 content quality gate. Repairs missing clips, appends intro/outro, mixes
// BGM + chapter-transition SFX, concatenates, then QC-decodes the finished video: any
// scene-attributable defect (black frame, dead air, missing audio) triggers ONE repair cycle
// (re-render those scenes → concat + QC again). The report always lands in qc_report.json.
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as DB from '../../db/index.js';
import { logger } from '../../util/log.js';
import { renderAnimationScene, renderOutroScene } from '../../animation/index.js';
import { resolveGuide } from '../../styleguide/index.js';
import { buildThumbnail, buildThumbnailVariants } from '../visuals.js';
import { concatScenes, renderCard } from '../render.js';
import { qcFinalVideo } from '../qc.js';
import { masterAudio } from '../../media/master.js';
import { makeAmbientBed, probeDuration, makeWhoosh, makeSfxBed } from '../../media/ffmpeg.js';
import { withRetry } from '../../util/retry.js';
import { step, op, retryHook, progressPlan } from '../progress.js';
import { resolveOutputDir } from '../helpers.js';

/**
 * @param {string} projectId
 * @param {{dir:string, size:{w:number,h:number}, config:object, _qcAttempt?:number}} opts
 */
export async function finalize(projectId, { dir, size, config, _qcAttempt = 0 }) {
  step(projectId, 'b7', 'running', 'Ghép & mix');
  DB.updateProject(projectId, { current_step: 'b7' });
  const project = DB.getProject(projectId);
  project.outputDir = resolveOutputDir(projectId, config, dir);
  const renderDir = join(dir, 'render');
  const all = DB.getScenes(projectId).sort((a, b) => a.idx - b.idx);
  const missing = all.filter((s) => !(s.video_path && existsSync(s.video_path)));
  if (missing.length && (config.visualMode || 'animation') !== 'image') {
    // Never silently drop scenes from the final cut — repair them here.
    op(projectId, `🩹 ${missing.length} cảnh thiếu clip — render bù trước khi ghép…`);
    logger.warn(`finalize: ${missing.length} scenes missing clips — repairing`, { projectId });
    const pp = progressPlan(all, config);
    for (const sc of missing) {
      const r = await renderAnimationScene(sc, project, config, {
        dir: renderDir, progressStart: pp.offsets[sc.idx] || 0, progressTotal: pp.total, total: all.length,
      });
      DB.updateScene(sc.id, { video_path: r.path, duration: r.duration, status: 'rendered', error: null });
    }
  } else if (missing.length) {
    logger.warn(`finalize: ${missing.length} scenes missing clips (image mode) — concatenating the rest`, { projectId });
  }
  const scenes = DB.getScenes(projectId).filter((s) => s.video_path && existsSync(s.video_path)).sort((a, b) => a.idx - b.idx);
  let clips = scenes.map((s) => s.video_path);
  const firstImg = scenes.find((s) => s.image_path && existsSync(s.image_path))?.image_path;
  const lastImg = [...scenes].reverse().find((s) => s.image_path && existsSync(s.image_path))?.image_path;

  // Intro / outro
  const visualMode = config.visualMode || 'animation';
  if (visualMode !== 'image') {
    // intro = scene 0's hero-title template (already narrated); only a short outro is appended
    if (config.outro !== false) {
      op(projectId, '🎬 Tạo outro…');
      const pp = progressPlan(scenes, config);
      // end-screen cross-promo: surface the channel's most recent finished video.
      // Duration stays 2.6s — outroDur and QC expectDur (P6) remain in lockstep.
      let related = null;
      try {
        related = DB.listProjects().find((p2) => p2.id !== projectId && p2.channel_id === project.channel_id && p2.status === 'done')?.title || null;
      } catch { /* optional */ }
      const o = await renderOutroScene(project, config, { dir: renderDir, progressStart: pp.outroStart, progressTotal: pp.total, duration: 2.6, related });
      clips = [...clips, o.path];
    }
  } else {
    if (config.intro !== false) {
      op(projectId, '🎬 Tạo intro…');
      clips = [await renderCard(project.title, 'AI VIDEO STUDIO', { dir: renderDir, size, bgImage: firstImg, duration: 2.6, idx: 'intro' }), ...clips];
    }
    if (config.outro !== false) {
      op(projectId, '🎬 Tạo outro…');
      clips = [...clips, await renderCard('Cảm ơn đã xem ❤', 'Theo dõi để xem thêm', { dir: renderDir, size, bgImage: lastImg, duration: 2.4, idx: 'outro' })];
    }
  }

  // Image mode: brand-kit logo maps onto the legacy whole-video overlay. Animation/hyperframe
  // must NOT get this — their brand layer is already composited into every scene page.
  if (visualMode === 'image' && config.brandKit?.logo?.assetPath && !config.logo?.path) {
    const bl = config.brandKit.logo;
    config.logo = { path: bl.assetPath, size: Math.round((bl.sizePct || 8.5) * 10.8), position: bl.position };
  }

  // BGM: user-selected file, else an auto ambient bed (cached per project)
  let bgmPath = null;
  if (config.bgmPath && existsSync(config.bgmPath)) bgmPath = config.bgmPath;
  else if (config.autoBgm !== false) {
    op(projectId, '🎵 Tạo nhạc nền…');
    bgmPath = join(renderDir, 'bgm_bed.m4a');
    if (!existsSync(bgmPath)) { try { await makeAmbientBed(bgmPath, 45); } catch { bgmPath = null; } }
  }

  op(projectId, '✂️ Ghép & mix…');
  const expectDur = scenes.reduce((a, s) => a + (s.duration || 0), 0);

  // SFX bed: auto whooshes on chapter transitions (autoSfx gate) + the owner's per-scene
  // picks from Scene Studio (scene.props.audio = {sfx, sfxGain, sfxAt}) — an explicit pick
  // is not "auto", so it plays regardless of autoSfx. Any failure just skips SFX.
  let sfxPath = null;
  if (visualMode !== 'image' && expectDur > 0) {
    let t = 0; const events = [];
    for (const s of scenes) {
      if (config.autoSfx !== false && s.template === 'chapter-break' && t > 0.5) events.push({ at: t });
      const au = s.props?.audio;
      if (au?.sfx && existsSync(au.sfx)) {
        events.push({ at: Math.max(0, t + (Number.isFinite(+au.sfxAt) ? +au.sfxAt : 0)), src: au.sfx, gain: +au.sfxGain || 0 });
      }
      t += s.duration || 0;
    }
    if (events.length) {
      try {
        op(projectId, `🔊 Đặt ${events.length} SFX…`);
        const whoosh = join(renderDir, 'sfx_whoosh.m4a');
        if (events.some((e) => !e.src) && !existsSync(whoosh)) await makeWhoosh(whoosh);
        sfxPath = await makeSfxBed(join(renderDir, 'sfx_bed.m4a'), { events, whooshPath: whoosh, total: expectDur });
      } catch (e) { logger.warn(`sfx bed: ${e.message} — bỏ SFX`, { projectId }); sfxPath = null; }
    }
  }

  const res = await withRetry(async () => {
    const r = await concatScenes(clips, project, {
      dir: renderDir, size, bgmPath, sfxPath, logo: config.logo,
      transitions: config.transitions === true, onLog: (s) => logger.debug(s, { projectId }),
    });
    // Output must exist and cover the scene material (10% tolerance + transition losses).
    const got = await probeDuration(r.path);
    if (!got || got < Math.max(1, expectDur * 0.88 - 4)) {
      throw new Error(`video ghép ngắn bất thường (${Math.round(got || 0)}s / kỳ vọng ~${Math.round(expectDur)}s)`);
    }
    return r;
  }, { tries: 2, label: 'b7 concat', onRetry: retryHook(projectId, 'b7') });

  // Broadcast master (P9's -16 LUFS authority, relocated from the concat graph): measure
  // the mixed program, correct the AUDIO ONLY (-c:v copy — video is never re-encoded).
  let mastered = { lufs: null, truePeak: null, corrected: false };
  try {
    op(projectId, '🎚️ Master âm thanh chuẩn phát sóng (-16 LUFS)…');
    mastered = await masterAudio(res.path, { onLog: (s) => logger.debug(s, { projectId }) });
    if (mastered.corrected) op(projectId, `🎚️ Đã master: ${mastered.lufs?.toFixed(1)} LUFS · true-peak ${mastered.truePeak?.toFixed(1)} dB`);
  } catch (e) { logger.warn(`master: ${e.message} — giữ bản mix gốc`, { projectId }); }

  // ---- B8: content quality gate — decode the finished video and hunt visible defects
  // (black frames, dead air, missing audio). Scene-attributable defects get ONE repair
  // cycle: re-render exactly those scenes, then concat + QC again. The report always
  // lands in qc_report.json so a run is never silently "done" with known defects.
  if (config.qcGate !== false) {
    op(projectId, '🔬 QC video thành phẩm (black-frame / khoảng câm / thời lượng)…');
    let t0 = 0;
    const sceneSpans = scenes.map((s) => { const span = { idx: s.idx, t0, t1: t0 + (s.duration || 0) }; t0 = span.t1; return span; });
    // expected FINAL duration = scene material + intro/outro cards − xfade overlaps
    const outroDur = visualMode !== 'image'
      ? (config.outro !== false ? 2.6 : 0)
      : (config.intro !== false ? 2.6 : 0) + (config.outro !== false ? 2.4 : 0);
    const xfadeLoss = config.transitions === true && clips.length > 1 && clips.length <= 24 ? 0.5 * (clips.length - 1) : 0;
    const qc = await qcFinalVideo(res.path, { expectDur: expectDur + outroDur - xfadeLoss, sceneSpans, tolerancePct: 8, tailAllowance: outroDur });
    writeFileSync(join(dir, 'qc_report.json'), JSON.stringify({
      ...qc, loudness: { lufs: mastered.lufs, truePeak: mastered.truePeak, corrected: mastered.corrected },
      at: new Date().toISOString(), attempt: _qcAttempt,
    }, null, 2));
    if (!qc.ok) {
      const badIdx = [...new Set(qc.issues.map((i) => i.sceneIdx).filter((n) => n != null))];
      logger.warn(`QC: ${qc.issues.length} vấn đề (${qc.issues.map((i) => i.type).join(', ')}) — cảnh liên quan: ${badIdx.join(', ') || 'không xác định'}`, { projectId });
      if (badIdx.length && _qcAttempt < 1 && visualMode !== 'image') {
        op(projectId, `🩹 QC phát hiện lỗi ở ${badIdx.length} cảnh — render lại và ghép lại…`);
        const pp2 = progressPlan(all, config);
        for (const idx of badIdx) {
          const sc = all.find((s) => s.idx === idx);
          if (!sc) continue;
          const r2 = await renderAnimationScene(DB.getScene(sc.id), project, config, {
            dir: renderDir, progressStart: pp2.offsets[sc.idx] || 0, progressTotal: pp2.total, total: all.length,
          });
          DB.updateScene(sc.id, { video_path: r2.path, duration: r2.duration, status: 'rendered', error: null });
        }
        return finalize(projectId, { dir, size, config, _qcAttempt: 1 });
      }
      op(projectId, `⚠️ QC còn ${qc.issues.length} cảnh báo (xem qc_report.json) — video vẫn được xuất`);
    } else {
      op(projectId, '✅ QC đạt: không black-frame, không khoảng câm, thời lượng khớp');
    }
  }

  // Premium thumbnail (title over best image); keyed to the video's style guide in
  // hyperframe mode so it matches the video. config.thumbVariants (1-3) renders extra
  // A/B compositions next to it (thumb_*_v1.jpg, _v2.jpg) at YouTube 1280x720.
  let thumb = res.thumb;
  try {
    const guide = visualMode === 'hyperframe' ? resolveGuide(config) : null;
    const nVar = Math.max(1, Math.min(3, parseInt(config.thumbVariants, 10) || 1));
    if (nVar > 1) {
      const variants = await buildThumbnailVariants(project.title, firstImg, join(project.outputDir, `thumb_${Date.now()}.jpg`), { guide, count: nVar });
      if (variants[0]) thumb = variants[0];
      if (variants.length > 1) op(projectId, `🖼️ Đã tạo ${variants.length} biến thể thumbnail (A/B) trong thư mục xuất`);
    } else {
      const t = await buildThumbnail(project.title, firstImg, size, join(project.outputDir, `thumb_${Date.now()}.jpg`), { guide });
      if (t) thumb = t;
    }
  } catch { /* keep basic */ }

  DB.updateProject(projectId, { video_path: res.path, thumb_path: thumb, current_step: 'b7' });
  step(projectId, 'b7', 'done', `${Math.round(res.duration)}s`);
  return res;
}
