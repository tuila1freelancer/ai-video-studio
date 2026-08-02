// Metadata — social title/description/hashtags + YouTube chapters from scene offsets.
// Best-effort: any failure is logged and swallowed (a video is never blocked on metadata).
import * as DB from '../../db/index.js';
import { logger } from '../../util/log.js';
import { generateMetadata } from '../../providers/llm.js';
import { withRetry } from '../../util/retry.js';
import { notStopped } from '../stop.js';
import { op } from '../progress.js';

/** @param {import('../context.js').PipelineContext} ctx */
export async function runMetadata(ctx) {
  const { projectId, config, ai } = ctx;
  try {
    op(projectId, '📊 Tạo metadata…');
    // config.metadataPrompt (channel/preset/request layered) = owner-defined SEO style
    // prompt prefix — the reference app's "metadata styles" as one config knob.
    // The narration is the only honest source for SEO: from a title alone the model invents tags
    // and promises the video never delivers (P40 audit finding). Send what the viewer will hear.
    const scs = DB.getScenes(projectId);
    const script = scs.map((s) => (s.voice_text || '').trim()).filter(Boolean).join('\n');
    const md = await withRetry(() => generateMetadata(DB.getProject(projectId), config?.metadataPrompt || null, { ai, script }),
      { tries: 2, label: 'metadata', fatal: notStopped });
    // YouTube chapters from scene offsets (≤ 14 markers, first at 00:00)
    const every = Math.max(1, Math.ceil(scs.length / 14));
    let acc = 0; const chapters = [];
    for (const sc of scs) {
      if (sc.idx % every === 0) {
        const mm = Math.floor(acc / 60), ss = Math.floor(acc % 60);
        const label = (sc.props && sc.props.heading) || (sc.voice_text || '').split(/[,.!?…]/)[0].slice(0, 48);
        chapters.push(`${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')} ${label}`);
      }
      acc += Math.max(1.5, sc.duration || config.sceneDuration || 6);
    }
    md.chapters = chapters;
    md.description = `${md.description || ''}\n\n📑 Chương:\n${chapters.join('\n')}`.trim();
    // merge, don't overwrite — B2 may have stored the master script's thumbnail {title,prompt}
    const prev = DB.getProject(projectId).metadata || {};
    DB.updateProject(projectId, { metadata: { ...prev, ...md } });
  } catch (e) { logger.warn(`Tạo metadata lỗi: ${e.message}`, { projectId }); }
}
