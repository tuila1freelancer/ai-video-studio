// Packaging: the AI-designed thumbnail (P40), its A/B variants and the per-platform cover set.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import * as DB from '../../db/index.js';
import { logger } from '../../util/log.js';
import { resolveGuide } from '../../styleguide/index.js';
import { buildThumbnail } from '../visuals.js';
import { generateThumbnailImage } from '../thumbnail-codegen.js';
import { llmEnabled } from '../../providers/llm.js';
import { checkStop } from '../stop.js';
import { op } from '../progress.js';
import { resolveLang } from '../../util/lang.js';
import { orientationOf } from '../../publish/platforms.js';
import { m, tp } from '../../i18n/t.js';

/**
 * @param {{projectId:string, project:object, config:object, size:{w:number,h:number}, scenes:object[], res:object, firstImg:string|undefined, visualMode:string}} args
 * @returns {Promise<string|null>} the thumbnail path for the project row
 */
export async function packageCovers({ projectId, project, config, size, scenes, res, firstImg, visualMode }) {
  // Thumbnail. P40 (reference parity): the AI DESIGNS a static HTML page and Chrome shoots it,
  // so the result is a real composition instead of a title bar over a frame. It is packaging,
  // not the video — an unusable reply silently falls back to the deterministic builders that
  // shipped before, which also cover a project with no LLM configured.
  // config.thumbVariants (1-3) renders extra A/B compositions (thumb_*_v1.jpg, _v2.jpg).
  checkStop(projectId); // an AI thumbnail is an LLM call plus a Chrome shot, up to three times
  let thumb = res.thumb;
  // A re-mix is not a new video. When the join kept the picture (audio-only or skip) and a cover
  // already exists, designing a fresh one throws away the one the owner chose — it happened on an
  // audio repair and the replacement was worse. Packaging follows the picture, not the soundtrack.
  const keepCover = (res.tier === 'audio' || res.tier === 'skip')
    && !!project.thumb_path && existsSync(project.thumb_path);
  if (keepCover) { thumb = project.thumb_path; op(projectId, m('🖼 Giữ nguyên ảnh bìa — lần ghép này chỉ đổi phần tiếng')); }
  try {
    const guide = visualMode === 'hyperframe' ? resolveGuide(config) : null;
    const nVar = keepCover ? 0 : Math.max(1, Math.min(3, parseInt(config.thumbVariants, 10) || 3));
    // The master script's thumbnail title (short, mobile-readable, written FOR the thumb)
    // beats the long video title when present.
    const thumbTitle = (project.metadata?.thumbnail?.title || project.title || '').trim() || project.title;
    const base = join(project.outputDir, `thumb_${Date.now()}.jpg`);
    const pathFor = (v) => base.replace(/(\.\w+)$/, v === 0 ? '$1' : `_v${v}$1`);
    const thumbAi = DB.aiSettings();
    // A thumbnail is codegen, not chat: the same finding that governs scene visuals applies here —
    // the design is only as good as the model writing the markup. Route it to the codegen model
    // (per-video override first, then the channel's), never the general chat model.
    const thumbLlm = thumbAi.llm
      ? { ...thumbAi.llm, model: config.thumbnailModel || config.hyperframe?.model || thumbAi.llm.codegenModel || thumbAi.llm.model }
      : thumbAi.llm;
    // The owner's own pictures are offered to the thumbnail designer too (P40) — the same
    // {{asset:NAME}} contract the scenes use, so there is only one convention to learn.
    const { normalizeAssets } = await import('../brand-assets.js');
    const { heroMediaUri } = await import('../../util/asset-uri.js');
    const thumbMedia = normalizeAssets(config.assets).slice(0, 4)
      .map((a) => ({ name: a.name, uri: heroMediaUri(a.path) })).filter((m) => m.uri);
    const aiOn = config.thumbnailAi !== false && llmEnabled(thumbLlm);
    const made = [];
    let thumbHtml = null;
    for (let v = 0; v < nVar; v++) {
      checkStop(projectId);
      const outPath = pathFor(v);
      const ai = aiOn ? await generateThumbnailImage({
        title: project.title, hook: thumbTitle, prompt: project.metadata?.thumbnail?.prompt || '',
        guide, size: nVar > 1 ? { w: 1280, h: 720 } : size, outPath,
        language: resolveLang(config, scenes),
        variant: v, media: thumbMedia, llm: thumbLlm, onLog: (m) => logger.info(m, { projectId, stage: 'b7' }),
      }) : null;
      // Keep the markup of the FIRST design: the owner can edit and re-render it later without
      // paying for another generation (POST /projects/:id/thumbnail/regen with { html }).
      if (v === 0 && ai?.fragment) thumbHtml = ai.fragment;
      const p = ai?.path || await buildThumbnail(thumbTitle, firstImg, nVar > 1 ? { w: 1280, h: 720 } : size, outPath, { guide, variant: v });
      if (p) {
        made.push(p);
        // Each variant is a version the owner can come back to. Without this row the other two
        // designs are just orphan files in the output folder with no way to pick them.
        try {
          DB.addThumbnail({
            projectId, path: p, html: ai?.fragment || null,
            source: ai ? 'ai' : 'template', composition: v,
          });
        } catch { /* a bookkeeping failure must never fail the render */ }
      }
    }
    if (made[0]) thumb = made[0];
    if (thumbHtml) {
      const md = DB.getProject(projectId).metadata || {};
      DB.updateProject(projectId, { metadata: { ...md, thumbnail: { ...(md.thumbnail || {}), html: thumbHtml } } });
    }
    if (made.length > 1) op(projectId, tp`🖼️ Đã tạo ${made.length} biến thể thumbnail (A/B) trong thư mục xuất`);

    // ---- cover art at every platform's real pixels ----
    // A video is posted in more places than it is shot for: a 9:16 video still needs a 1280×720
    // card for YouTube, and a 16:9 one still needs a 1080×1920 cover for Shorts. One design per
    // ORIENTATION (a 16:9 layout re-shot at 9:16 becomes a strip across the middle), then every
    // canvas of that orientation re-shot from it — so at most three generations, not seven.
    if (aiOn && !keepCover && config.platformCovers !== false) {
      checkStop(projectId);
      const { COVER_SIZES } = await import('../../publish/platforms.js');
      const { generateCoverSet } = await import('../thumbnail-codegen.js');
      const outDir = project.outputDir;
      // reuse the design just made for the video's own orientation instead of paying for it twice
      const seed = thumbHtml ? { [orientationOf(size)]: thumbHtml } : {};
      const { covers } = await generateCoverSet({
        title: project.title, hook: thumbTitle, prompt: project.metadata?.thumbnail?.prompt || '',
        guide, sizes: COVER_SIZES, outDir, baseName: 'cover',
        language: resolveLang(config, scenes), media: thumbMedia, llm: thumbLlm,
        fragments: seed, onLog: (m) => op(projectId, m),
      });
      if (covers.length) {
        const md2 = DB.getProject(projectId).metadata || {};
        DB.updateProject(projectId, { metadata: { ...md2, covers } });
        op(projectId, tp`🖼️ Ảnh bìa cho ${covers.length} khổ: ${covers.map((c) => c.label).join(' · ')}`);
      }
    }
  } catch (e) {
    if (e.stopped) throw e; // packaging may fail silently; a stop may not — but never unexplained
    logger.warn(tp`Ảnh bìa/thumbnail AI lỗi — giữ bản cơ bản: ${e.message}`, { projectId, stage: 'b7' });
  }
  return thumb;
}
