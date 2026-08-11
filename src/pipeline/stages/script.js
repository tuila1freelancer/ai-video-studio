// B2 — SCRIPT. Generate (or, on resume, reuse) the scene script for a project.
// Default path is the MASTER SCRIPT ENGINE (src/content/master-script.js): one master prompt
// turns a topic / a detailed owner script / a pasted scenes JSON / a fetched article (URL
// input → mode 'source': a NEW script FROM the material, never a polish of it) into the
// canonical scenes JSON, whose per-scene 8-bracket visuals feed HyperFrame codegen directly
// (the separate direction pass skips scenes that already carry [MAIN FOCUS]). The
// config.scriptEngine:'legacy' escape hatch keeps the original generateScript path.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as DB from '../../db/index.js';
import { normalizeAssets } from '../brand-assets.js';
import { logger } from '../../util/log.js';
import { generateScript } from '../../providers/llm.js';
import { generateMasterScenes, scenesJsonFromRows } from '../../content/master-script.js';
import { resolveGuide } from '../../styleguide/index.js';
import { fetchLink } from '../../providers/fetchlink.js';
import { withRetry } from '../../util/retry.js';
import { checkStop, notStopped } from '../stop.js';
import { step, op, retryHook } from '../progress.js';

/** @param {import('../context.js').PipelineContext} ctx */
export async function runScript(ctx) {
  const { projectId, project, config, ai, channel, resume, dir } = ctx;
  let scenes = DB.getScenes(projectId);
  if (!resume || scenes.length === 0) {
    step(projectId, 'b2', 'running', 'Tạo kịch bản');
    DB.updateProject(projectId, { current_step: 'b2' });
    op(projectId, 'Đang tạo kịch bản…');
    // The source article: what the owner PULLED and looked at in the Studio wins over a fresh
    // fetch. They may have edited it, the page may have changed since, and re-fetching would
    // quietly write the video from something they never saw. A pasted link with no visit to the
    // button still works — that is the second branch.
    let fetched = null;
    const saved = config.sourceDoc;
    if (String(saved?.text || '').trim()) {
      fetched = { title: saved.title || '', text: String(saved.text).trim(), url: saved.url || '', images: [] };
      op(projectId, `🔗 Viết từ tư liệu đã lấy (${fetched.text.length} ký tự)`);
    } else if (project.input_type === 'url') {
      try {
        fetched = await fetchLink(project.topic.trim().split(/\s+/)[0]);
        op(projectId, `🔗 Đã lấy ${fetched.chars} ký tự từ link${fetched.truncated ? ' (bài dài — đã cắt ở mức engine đọc được)' : ''}`);
      } catch (e) { logger.warn(`Lấy nội dung link lỗi: ${e.message}`, { projectId }); }
    }
    // Show Bible: channel persona + anti-repeat ledger, injected additively into the prompt
    const memory = channel ? DB.getChannelMemory(channel.id) : null;
    // Master engine owns EVERY input shape. A fetched article rides along as `source`
    // (mode 'source': write a NEW script from the material — an article is research to
    // write from, not the owner's wording to preserve, so it never takes the polish path).
    const useMaster = config.scriptEngine !== 'legacy';
    const script = await withRetry(
      () => (useMaster
        ? generateMasterScenes({
          input: project.topic, source: fetched, config, ai, memory, guide: resolveGuide(config),
          // Normalized (P40): the UI pushes bare paths / file URLs, the engine needs {name,path}
          // — an un-normalized string list made the master script assign names nothing could resolve.
          assets: normalizeAssets(config.assets),
          onLog: (m) => logger.info(m, { projectId }),
        })
        : generateScript({ topic: project.topic, inputType: project.input_type, fetched, config, ai, memory })),
      { tries: 2, label: 'b2 script', onRetry: retryHook(projectId, 'b2'), fatal: notStopped },
    );
    // P34: an explicit owner-picked title (assistant click-title) beats the engine's own — and so
    // does a name typed into the topbar, which sets metadata.titleLocked. A project the owner has
    // named must never be renamed underneath them, least of all by a regenerated script.
    const named = project.metadata?.titleLocked === true;
    project.title = named
      ? project.title
      : (config.titleOverride || script.title || project.title || '').trim() || project.title;
    // A regenerated script replaces the whole storyboard — any previous scene-gate approval
    // covered scenes that no longer exist, so it must be revoked (P17: the gate can never
    // silently auto-spend on a never-reviewed storyboard).
    DB.updateProject(projectId, { title: project.title, scenes_approved_at: null });
    scenes = DB.replaceScenes(projectId, script.scenes);
    // Master extras — the thumbnail {title,prompt} rides in project.metadata (runMetadata
    // merges around it), and any gate warnings surface in the progress feed.
    if (script.thumbnail) {
      const md = DB.getProject(projectId).metadata || {};
      DB.updateProject(projectId, { metadata: { ...md, thumbnail: script.thumbnail } });
    }
    if (script.warnings?.length) {
      op(projectId, `🧹 Kịch bản: đã tự sửa ${script.warnings.length} lỗi định dạng (${[...new Set(script.warnings.map((w) => w.code))].join(', ')})`);
    }
    // Canonical scenes.json artifact (factory format) next to the project's other outputs.
    // The DB stays the source of truth — the export route rebuilds from rows on demand.
    try {
      writeFileSync(join(dir, 'scenes.json'), `${JSON.stringify(scenesJsonFromRows(DB.getProject(projectId), scenes), null, 2)}\n`);
    } catch (e) { logger.warn(`Không lưu được scenes.json: ${e.message}`, { projectId }); }
    logger.info(`📜 Kịch bản: ${scenes.length} cảnh${useMaster ? ` (engine master, chế độ ${script.mode || 'n/a'})` : ''}`, { projectId, stage: 'b2' });
    step(projectId, 'b2', 'done', `${scenes.length} cảnh`);
  } else {
    step(projectId, 'b2', 'done', `${scenes.length} cảnh`);
  }
  checkStop(projectId);
}
