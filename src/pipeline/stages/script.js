// B2 — SCRIPT. Generate (or, on resume, reuse) the scene script for a project.
import * as DB from '../../db/index.js';
import { logger } from '../../util/log.js';
import { generateScript } from '../../providers/llm.js';
import { fetchLink } from '../../providers/fetchlink.js';
import { withRetry } from '../../util/retry.js';
import { checkStop, notStopped } from '../stop.js';
import { step, op, retryHook } from '../progress.js';

/** @param {import('../context.js').PipelineContext} ctx */
export async function runScript(ctx) {
  const { projectId, project, config, ai, channel, resume } = ctx;
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
    const script = await withRetry(
      () => generateScript({ topic: project.topic, inputType: project.input_type, fetched, config, ai, memory }),
      { tries: 2, label: 'b2 script', onRetry: retryHook(projectId, 'b2'), fatal: notStopped },
    );
    project.title = (script.title || project.title || '').trim() || project.title;
    // A regenerated script replaces the whole storyboard — any previous scene-gate approval
    // covered scenes that no longer exist, so it must be revoked (P17: the gate can never
    // silently auto-spend on a never-reviewed storyboard).
    DB.updateProject(projectId, { title: project.title, scenes_approved_at: null });
    scenes = DB.replaceScenes(projectId, script.scenes);
    logger.info(`Script: ${scenes.length} scenes`, { projectId });
    step(projectId, 'b2', 'done', `${scenes.length} cảnh`);
  } else {
    step(projectId, 'b2', 'done', `${scenes.length} cảnh`);
  }
  checkStop(projectId);
}
