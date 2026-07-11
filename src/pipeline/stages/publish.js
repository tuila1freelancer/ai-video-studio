// B9 — PUBLISH (opt-in). Runs only when config.autoPublish === true AND the platform is
// connected. Auto-publish ALWAYS stages as 'private' unless config.publishPrivacy says
// otherwise explicitly — the pipeline never puts content in public on its own. Best-effort
// like metadata: failure is recorded + logged, never blocks status:done.
import { existsSync } from 'node:fs';
import * as DB from '../../db/index.js';
import { hub } from '../../ws/hub.js';
import { logger } from '../../util/log.js';
import { getPublisher } from '../../publish/index.js';
import { op } from '../progress.js';

/** @param {import('../context.js').PipelineContext} ctx */
export async function runPublish(ctx) {
  const { projectId, config } = ctx;
  if (config.autoPublish !== true) return;
  const platform = config.publishPlatform || 'youtube';
  const project = DB.getProject(projectId);
  if (!project?.video_path || !existsSync(project.video_path)) return;
  let pub;
  try { pub = getPublisher(platform); } catch (e) { logger.warn(`publish: ${e.message}`, { projectId }); return; }
  if (!pub.connected()) { logger.warn(`publish: ${platform} chưa kết nối OAuth — bỏ qua B9`, { projectId }); return; }

  const privacy = ['private', 'unlisted', 'public'].includes(config.publishPrivacy) ? config.publishPrivacy : 'private';
  const md = project.metadata || {};
  const recId = DB.recordPublish({ projectId, platform, privacy });
  op(projectId, `📤 Đăng ${platform} (${privacy})…`);
  try {
    const r = await pub.upload({
      videoPath: project.video_path,
      title: md.title || project.title,
      description: md.description || '',
      tags: (md.platforms?.youtube?.tags || md.hashtags || []).map((t) => String(t).replace(/^#/, '')),
      privacy,
      thumbPath: project.thumb_path && existsSync(project.thumb_path) ? project.thumb_path : null,
    });
    DB.settlePublish(recId, { status: 'done', videoId: r.videoId, url: r.url });
    op(projectId, `📤 Đã đăng (${r.privacy}): ${r.url}`);
    hub.toProject(projectId, { type: 'published', platform, url: r.url, privacy: r.privacy });
  } catch (e) {
    DB.settlePublish(recId, { status: 'error', error: e.message });
    logger.warn(`publish failed: ${e.message}`, { projectId });
    op(projectId, `⚠️ Đăng ${platform} lỗi: ${String(e.message).slice(0, 120)} — video vẫn ở máy`);
  }
}
