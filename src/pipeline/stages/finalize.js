// B7 concat/mix + B8 content quality gate. Repairs missing clips, appends intro/outro, mixes
// BGM + chapter-transition SFX, concatenates, then QC-decodes the finished video: any
// scene-attributable defect (black frame, dead air, missing audio) triggers ONE repair cycle
// (re-render those scenes → concat + QC again). The report always lands in qc_report.json.
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as DB from '../../db/index.js';
import { logger } from '../../util/log.js';
import { renderAnimationScene } from '../../animation/index.js';
import { resolveGuide } from '../../styleguide/index.js';
import { buildThumbnail } from '../visuals.js';
import { generateThumbnailImage } from '../thumbnail-codegen.js';
import { llmEnabled } from '../../providers/llm.js';
import { concatScenes, planTransitions, transitionLoss } from '../render.js';
import { qcFinalVideo } from '../qc.js';
import { masterAudio } from '../../media/master.js';
import { makeAmbientBed, probeDuration, makeWhoosh, makeSfxBed, hasDrawtext } from '../../media/ffmpeg.js';
import { resolveFinalOverlay } from '../../media/logo-overlay.js';
import { resolveWatermark, watermarkFont } from '../../media/watermark.js';
import { planSoundDesign, usableLibrary } from '../../audio/sound-design.js';
import { withRetry } from '../../util/retry.js';
import { step, op, retryHook, progressPlan } from '../progress.js';
import { resolveOutputDir } from '../helpers.js';

/**
 * @param {string} projectId
 * @param {{dir:string, size:{w:number,h:number}, config:object}} opts
 */
export async function finalize(projectId, { dir, size, config }) {
  step(projectId, 'b7', 'running', 'Ghép & mix');
  DB.updateProject(projectId, { current_step: 'b7' });
  const project = DB.getProject(projectId);
  project.outputDir = resolveOutputDir(projectId, config, dir);
  const renderDir = join(dir, 'render');
  const all = DB.getScenes(projectId).sort((a, b) => a.idx - b.idx);
  const missing = all.filter((s) => !(s.video_path && existsSync(s.video_path)));
  if (missing.length) {
    // Never silently drop scenes from the final cut — repair them here.
    op(projectId, `🩹 ${missing.length} cảnh thiếu clip — render bù trước khi ghép…`);
    logger.warn(`Ghép video: ${missing.length} cảnh thiếu clip — đang render bù`, { projectId, stage: 'b7' });
    const pp = progressPlan(all, config);
    for (const sc of missing) {
      const r = await renderAnimationScene(sc, project, config, {
        dir: renderDir, progressStart: pp.offsets[sc.idx] || 0, progressTotal: pp.total, total: all.length,
      });
      DB.updateScene(sc.id, { video_path: r.path, duration: r.duration, status: 'rendered', error: null });
    }
  }
  const scenes = DB.getScenes(projectId).filter((s) => s.video_path && existsSync(s.video_path)).sort((a, b) => a.idx - b.idx);
  const clips = scenes.map((s) => s.video_path);
  const firstImg = scenes.find((s) => s.image_path && existsSync(s.image_path))?.image_path;
  const visualMode = config.visualMode || 'hyperframe';

  // No synthetic intro/outro cards (P31, owner order 2026-07-18 — reference-app parity):
  // the video is the SCRIPT's scenes and nothing else. The master script already ends on a
  // narrated closing-CTA scene whose HTML the codegen LLM designs like every other scene —
  // exactly how the reference sessions work (their clip count == scene count). The old
  // hardcoded farewell card made every video end identically.

  // Doctrine transition plan (P5): hard cuts by default, role-driven hero transitions.
  // Computed BEFORE the SFX bed and QC so their timelines account for xfade overlaps exactly.
  const transPlan = config.transitions === true && clips.length > 1
    ? planTransitions({ scenes, clipCount: clips.length, nIntro: 0, nOutro: 0, style: config.transitionStyle || 'auto' })
    : null;
  // cumulative xfade loss BEFORE scene k's clip starts (clip index == scene order now)
  const lossBeforeScene = (k) => (transPlan ? transitionLoss(transPlan, k) : 0);

  // Whole-video logo stamp (P26): the ONLY logo lane — burned once at concat in every
  // visual mode (the per-scene smart/always logo lane was removed by owner order).
  // Legacy configs saved before the stamp existed (placement smart/always + a logo, no
  // finalOverlay key) migrate here so nobody's logo silently disappears: the old per-scene
  // geometry (sizePct = % of min-dim, center position) maps onto the stamp fractions.
  const fov = resolveFinalOverlay(config.brandKit?.finalOverlay);
  const bkLogo = config.brandKit?.logo?.assetPath;
  if (bkLogo && !config.logo?.path) {
    if (fov) {
      config.logo = { path: bkLogo, ...fov };
    } else if (config.brandKit.finalOverlay === undefined && config.brandKit.placement && config.brandKit.placement !== 'off') {
      const bl = config.brandKit.logo;
      const minD = Math.min(size.w, size.h);
      config.logo = {
        path: bkLogo,
        cxPct: bl.position?.xPct ?? 0.92, cyPct: bl.position?.yPct ?? 0.06,
        wPct: Math.min(0.45, Math.max(0.02, ((bl.sizePct || 8.5) / 100) * (minD / size.w))),
        opacity: bl.opacity ?? 0.9,
      };
    }
  }
  // Copyright watermark (P28): slow perimeter drift, logo or channel name, whole program.
  // Source degrades sensibly (name without a usable font → logo; logo missing → name).
  const wm = resolveWatermark(config.brandKit?.watermark);
  if (wm && !config.watermark) {
    const text = String(config.brandKit?.channelName || '').trim();
    const font = watermarkFont();
    const canText = !!(text && font && await hasDrawtext()); // text lane needs freetype
    if (wm.source === 'logo' && bkLogo) config.watermark = { ...wm, path: bkLogo };
    else if (canText) config.watermark = { ...wm, text, fontFile: font };
    else if (bkLogo) config.watermark = { ...wm, path: bkLogo };
    else logger.warn('watermark bật nhưng không có logo lẫn tên kênh khả dụng — bỏ qua', { projectId });
  }

  op(projectId, '✂️ Ghép & mix…');
  const expectDur = scenes.reduce((a, s) => a + (s.duration || 0), 0);

  // LLM sound design (reference-app parity, toggle config.soundDesign): ONE call picks a
  // BGM from the owner's library and places SFX by the cue sheet. Anything short of a
  // valid plan (offline, empty library, bad reply) → sdPlan stays null and the
  // deterministic legacy audio below ships unchanged.
  let sdPlan = null;
  if (config.soundDesign !== false && expectDur > 0) {
    try {
      const ai = DB.aiSettings();
      sdPlan = await planSoundDesign({
        scenes, lossBeforeScene,
        bgm: usableLibrary(DB.listLibrary('bgm')), sfx: usableLibrary(DB.listLibrary('sfx')),
        total: expectDur, title: project.title || project.topic || '', lang: config.language || 'vi',
        llm: ai.llm, onLog: (m) => op(projectId, `🎼 ${m}`),
      });
    } catch (e) { logger.warn(`sound design: ${e.message} — dùng audio mặc định`, { projectId }); sdPlan = null; }
  }

  // BGM: LLM plan → user-selected file → auto ambient bed (cached per project)
  let bgmPath = null;
  if (sdPlan?.bgmPath && existsSync(sdPlan.bgmPath)) bgmPath = sdPlan.bgmPath;
  else if (config.bgmPath && existsSync(config.bgmPath)) bgmPath = config.bgmPath;
  else if (config.autoBgm !== false) {
    op(projectId, '🎵 Tạo nhạc nền…');
    bgmPath = join(renderDir, 'bgm_bed.m4a');
    if (!existsSync(bgmPath)) { try { await makeAmbientBed(bgmPath, 45); } catch { bgmPath = null; } }
  }

  // SFX bed: LLM-planned events (when present) + the owner's per-scene picks from Scene
  // Studio (scene.props.audio = {sfx, sfxGain, sfxAt} — an explicit pick always plays) +
  // auto whooshes on chapter transitions (autoSfx gate; skipped when the LLM plan owns
  // emphasis). Any failure just skips SFX.
  let sfxPath = null;
  if (expectDur > 0) {
    let t = 0; const events = [];
    scenes.forEach((s, k) => {
      // event times land on the FINAL timeline: material time minus the xfade overlap
      // consumed by every transition before this scene's clip
      const start = Math.max(0, t - lossBeforeScene(k));
      if (!sdPlan && config.autoSfx !== false && s.template === 'chapter-break' && start > 0.5) events.push({ at: start });
      const au = s.props?.audio;
      if (au?.sfx && existsSync(au.sfx)) {
        events.push({ at: Math.max(0, start + (Number.isFinite(+au.sfxAt) ? +au.sfxAt : 0)), src: au.sfx, gain: +au.sfxGain || 0 });
      }
      t += s.duration || 0;
    });
    for (const e of sdPlan?.events || []) events.push(e);
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
      dir: renderDir, size, bgmPath, sfxPath, logo: config.logo, watermark: config.watermark,
      bgmVol: sdPlan?.bgmVol,
      transitions: transPlan || false, onLog: (s) => logger.debug(s, { projectId }),
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

  // ---- B8: final integrity gate — a cheap stream/duration check on the joined video.
  // P38: the heavy per-frame QC (black/white-frame + dead-air scanning, scene-attributable
  // re-render, and visual quality-tier surfacing) is REMOVED — the owner dropped the "cảnh lỗi"
  // QC as redundant, and the reference app ships none of it. A broken JOIN still surfaces here.
  if (config.qcGate !== false) {
    op(projectId, '🔬 Kiểm tra video thành phẩm (stream + thời lượng)…');
    // expected FINAL duration = scene material − xfade overlaps (no synthetic cards, P31)
    const xfadeLoss = transPlan && clips.length <= 24 ? transitionLoss(transPlan) : 0;
    const qc = await qcFinalVideo(res.path, { expectDur: expectDur - xfadeLoss, tolerancePct: 8 });
    writeFileSync(join(dir, 'qc_report.json'), JSON.stringify({
      ...qc,
      loudness: { lufs: mastered.lufs, truePeak: mastered.truePeak, corrected: mastered.corrected },
      at: new Date().toISOString(),
    }, null, 2));
    if (!qc.ok) {
      logger.warn(`QC: ${qc.issues.length} vấn đề (${qc.issues.map((i) => i.type).join(', ')})`, { projectId });
      op(projectId, `⚠️ Video có ${qc.issues.length} cảnh báo tính toàn vẹn (xem qc_report.json) — vẫn được xuất`);
    } else {
      op(projectId, '✅ Video hợp lệ: đủ stream, thời lượng khớp');
    }
  }

  // Thumbnail. P40 (reference parity): the AI DESIGNS a static HTML page and Chrome shoots it,
  // so the result is a real composition instead of a title bar over a frame. It is packaging,
  // not the video — an unusable reply silently falls back to the deterministic builders that
  // shipped before, which also cover a project with no LLM configured.
  // config.thumbVariants (1-3) renders extra A/B compositions (thumb_*_v1.jpg, _v2.jpg).
  let thumb = res.thumb;
  try {
    const guide = visualMode === 'hyperframe' ? resolveGuide(config) : null;
    const nVar = Math.max(1, Math.min(3, parseInt(config.thumbVariants, 10) || 1));
    // The master script's thumbnail title (short, mobile-readable, written FOR the thumb)
    // beats the long video title when present.
    const thumbTitle = (project.metadata?.thumbnail?.title || project.title || '').trim() || project.title;
    const base = join(project.outputDir, `thumb_${Date.now()}.jpg`);
    const pathFor = (v) => base.replace(/(\.\w+)$/, v === 0 ? '$1' : `_v${v}$1`);
    const thumbAi = DB.aiSettings();
    // The owner's own pictures are offered to the thumbnail designer too (P40) — the same
    // {{asset:NAME}} contract the scenes use, so there is only one convention to learn.
    const { normalizeAssets } = await import('../brand-assets.js');
    const { heroMediaUri } = await import('../../util/asset-uri.js');
    const thumbMedia = normalizeAssets(config.assets).slice(0, 4)
      .map((a) => ({ name: a.name, uri: heroMediaUri(a.path) })).filter((m) => m.uri);
    const aiOn = config.thumbnailAi !== false && llmEnabled(thumbAi.llm);
    const made = [];
    let thumbHtml = null;
    for (let v = 0; v < nVar; v++) {
      const outPath = pathFor(v);
      const ai = aiOn ? await generateThumbnailImage({
        title: project.title, hook: thumbTitle, prompt: project.metadata?.thumbnail?.prompt || '',
        guide, size: nVar > 1 ? { w: 1280, h: 720 } : size, outPath,
        language: config.language && config.language !== 'auto' ? config.language : 'vi',
        variant: v, media: thumbMedia, llm: thumbAi.llm, onLog: (m) => logger.info(m, { projectId, stage: 'b7' }),
      }) : null;
      // Keep the markup of the FIRST design: the owner can edit and re-render it later without
      // paying for another generation (POST /projects/:id/thumbnail/regen with { html }).
      if (v === 0 && ai?.fragment) thumbHtml = ai.fragment;
      const p = ai?.path || await buildThumbnail(thumbTitle, firstImg, nVar > 1 ? { w: 1280, h: 720 } : size, outPath, { guide, variant: v });
      if (p) made.push(p);
    }
    if (made[0]) thumb = made[0];
    if (thumbHtml) {
      const md = DB.getProject(projectId).metadata || {};
      DB.updateProject(projectId, { metadata: { ...md, thumbnail: { ...(md.thumbnail || {}), html: thumbHtml } } });
    }
    if (made.length > 1) op(projectId, `🖼️ Đã tạo ${made.length} biến thể thumbnail (A/B) trong thư mục xuất`);
  } catch { /* keep basic */ }

  DB.updateProject(projectId, { video_path: res.path, thumb_path: thumb, current_step: 'b7' });
  step(projectId, 'b7', 'done', `${Math.round(res.duration)}s`);
  return res;
}
