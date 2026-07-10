// The shared context threaded through every pipeline stage. Built once by the orchestrator
// from the project row; stages read what they need and re-fetch scenes from the DB themselves.
import * as DB from '../db/index.js';
import { ratioToSize } from '../util/util.js';
import { aiSettingsFor } from '../core/config.js';
import { resolveOutputDir } from './helpers.js';

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
  const config = project.config || {};
  const dir = DB.projectDirFor(projectId);
  const channel = DB.channelOf(projectId);
  project.outputDir = resolveOutputDir(projectId, config, dir);
  return {
    projectId, project, config,
    size: ratioToSize(project.aspect_ratio),
    dir, channel,
    ai: aiSettingsFor(channel), // per-channel AI overrides (llm/tts/subtitle/imageGen)
    resume,
  };
}
