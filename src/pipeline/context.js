// The shared context threaded through every pipeline stage. Built once by the orchestrator
// from the project row; stages read what they need and re-fetch scenes from the DB themselves.
import * as DB from '../db/index.js';
import { ratioToSize } from '../util/util.js';
import { aiSettingsFor } from '../core/config.js';
import { budgetState } from '../core/budget.js';
import { logger } from '../util/log.js';
import { resolveOutputDir } from './helpers.js';

import { tp } from '../i18n/t.js';
/**
 * @typedef {object} PipelineContext
 * @property {string} projectId
 * @property {object} project           the project row (mutable — B2 sets .title/.outputDir)
 * @property {object} config            project.config
 * @property {{w:number,h:number}} size resolved from aspect ratio
 * @property {string} dir               project working dir
 * @property {object} channel           owning channel row
 * @property {object} ai                per-channel AI settings (llm/tts/subtitle/imageGen)
 * @property {boolean} resume           whether this run resumes an interrupted project
 */

/**
 * Build the pipeline context for a project.
 * @param {string} projectId @param {{resume?:boolean}} [opts]
 * @returns {PipelineContext}
 * @throws {Error} when the project does not exist
 */
export function buildContext(projectId, { resume = false } = {}) {
  const project = DB.getProject(projectId);
  if (!project) throw new Error('project not found');
  let config = project.config || {};
  const dir = DB.projectDirFor(projectId);
  const channel = DB.channelOf(projectId);
  project.outputDir = resolveOutputDir(projectId, config, dir);
  let ai = aiSettingsFor(channel);

  // Budget guardrail — a PER-VIDEO decision made once per run: at the cap, downgrade to the
  // existing free paths (llm off → offlineScript/heuristic planner; tts pinned to the free
  // edge→say chain via the same explicit-override lane a user's per-video pick uses).
  const budget = budgetState(projectId);
  if (budget.capped) {
    logger.warn(tp`💸 Chạm trần ngân sách ($${budget.spent.toFixed(2)}/$${budget.cap}) — lần chạy này dùng chế độ miễn phí`, { projectId });
    ai = { ...ai, llm: { ...(ai.llm || {}), enabled: false } };
    config = { ...config, tts: { ...(config.tts || {}), provider: 'edge', voice: 'auto' } };
  }

  return {
    projectId, project, config,
    size: ratioToSize(project.aspect_ratio),
    dir, channel,
    ai,
    resume,
    budget,
  };
}
