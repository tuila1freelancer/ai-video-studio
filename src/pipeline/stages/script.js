// B2 — SCRIPT. Generate (or, on resume, reuse) the scene script for a project.
// Default path is the MASTER SCRIPT ENGINE (src/content/master-script.js): one master prompt
// turns a topic / a detailed owner script / a pasted scenes JSON into the canonical scenes
// JSON, whose per-scene 8-bracket visuals feed HyperFrame codegen directly (the separate
// direction pass skips scenes that already carry [MAIN FOCUS]). URL inputs and the
// config.scriptEngine:'legacy' escape hatch keep the original generateScript path.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as DB from '../../db/index.js';
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
    let fetched = null;
    if (project.input_type === 'url') {
      try { fetched = await fetchLink(project.topic.trim().split(/\s+/)[0]); } catch (e) { logger.warn(`fetch-link: ${e.message}`, { projectId }); }
    }
    // Show Bible: channel persona + anti-repeat ledger, injected additively into the prompt
    const memory = channel ? DB.getChannelMemory(channel.id) : null;
    // Master engine owns text/json inputs; URL content keeps the legacy rewrite doctrine
    // (an article is source MATERIAL to write from, not the owner's wording to preserve).
    const useMaster = config.scriptEngine !== 'legacy' && project.input_type !== 'url';
    const script = await withRetry(
      () => (useMaster
        ? generateMasterScenes({
          input: project.topic, config, ai, memory, guide: resolveGuide(config),
          onLog: (m) => logger.info(m, { projectId }),
        })
        : generateScript({ topic: project.topic, inputType: project.input_type, fetched, config, ai, memory })),
      { tries: 2, label: 'b2 script', onRetry: retryHook(projectId, 'b2'), fatal: notStopped },
    );
    project.title = (script.title || project.title || '').trim() || project.title;
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
    } catch (e) { logger.warn(`scenes.json artifact: ${e.message}`, { projectId }); }
    logger.info(`Script: ${scenes.length} scenes${useMaster ? ` (master engine, mode ${script.mode || 'n/a'})` : ''}`, { projectId });
    step(projectId, 'b2', 'done', `${scenes.length} cảnh`);
  } else {
    step(projectId, 'b2', 'done', `${scenes.length} cảnh`);
  }
  checkStop(projectId);
}
