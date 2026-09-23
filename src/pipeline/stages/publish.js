// B9 — PUBLISH (opt-in). Runs only when config.autoPublish === true AND the platform is
// connected. Auto-publish ALWAYS stages as 'private' unless config.publishPrivacy says
// otherwise explicitly — the pipeline never puts content in public on its own. Best-effort
// like metadata: failure is recorded + logged, never blocks status:done.
import { existsSync } from 'node:fs';
import * as DB from '../../db/index.js';
import { hub } from '../../ws/hub.js';
import { logger } from '../../util/log.js';
import { getPublisher } from '../../publish/index.js';
import { notifyWebhooks } from '../../ops/webhooks.js';
import { assertPublishAllowed, publishPolicy } from '../../publish/policy.js';
import { recordQuota } from '../../publish/quota.js';
import { op } from '../progress.js';

import { tp } from '../../i18n/t.js';
/** @param {import('../context.js').PipelineContext} ctx */
export async function runPublish(ctx) {
  const { projectId, config } = ctx;
  if (config.autoPublish !== true) return;
  const platform = config.publishPlatform || 'youtube';
  const project = DB.getProject(projectId);
  if (!project?.video_path || !existsSync(project.video_path)) return;
  let pub;
  try { pub = getPublisher(platform); } catch (e) { logger.warn(tp`Đăng video: ${e.message}`, { projectId, kind: 'publish' }); return; }
  if (!pub.connected()) { logger.warn(tp`Đăng video: ${platform} chưa kết nối OAuth — bỏ qua B9`, { projectId, kind: 'publish' }); return; }

  // The channel's rules apply to the unattended path FIRST — this is the one nobody is watching.
  // The verdict is asked with expectDone:false: this IS the run that just produced the file.
  let privacy;
  try {
    const policy = publishPolicy(DB.channelOf(projectId));
    const verdict = policy.requireVerdict
      ? await (await import('../../api/services/verdict.js')).projectVerdict(projectId, { vision: false, expectDone: false })
      : null;
    ({ privacy } = assertPublishAllowed({ projectId, platform, privacy: config.publishPrivacy, verdict }));
  } catch (e) {
    logger.warn(tp`Đăng video: ${e.message} — bỏ qua B9`, { projectId, kind: 'publish' });
    op(projectId, tp`⏭ Chưa đăng: ${e.message}`);
    return;
  }
  const md = project.metadata || {};
  const recId = DB.recordPublish({ projectId, platform, privacy });
  op(projectId, tp`📤 Đăng ${platform} (${privacy})…`);
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
    recordQuota({ projectId, channelId: project.channel_id, platform, operation: 'videos.insert' });
    logger.info(tp`📤 Đã đăng ${platform} (${r.privacy}): ${r.url}`, { projectId, kind: 'publish', jlevel: 'success' });
    op(projectId, tp`📤 Đã đăng (${r.privacy}): ${r.url}`);
    hub.toProject(projectId, { type: 'published', platform, url: r.url, privacy: r.privacy });
    notifyWebhooks('project.published', { projectId, platform, url: r.url, privacy: r.privacy });
  } catch (e) {
    DB.settlePublish(recId, { status: 'error', error: e.message });
    logger.warn(tp`Đăng ${platform} thất bại: ${e.message}`, { projectId, kind: 'publish' });
    op(projectId, tp`⚠️ Đăng ${platform} lỗi: ${String(e.message).slice(0, 120)} — video vẫn ở máy`);
  }
}
