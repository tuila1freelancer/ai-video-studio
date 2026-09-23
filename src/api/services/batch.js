// Batch queue: many topics → create one project each, then run them sequentially in the
// background (one video at a time), broadcasting 'batch-done' when the whole queue finishes.
import * as DB from '../../db/index.js';
import { hub } from '../../ws/hub.js';
import { logger } from '../../util/log.js';
import { detectInputType } from '../../util/util.js';
import { resolveProjectConfig } from '../../core/config.js';
import * as Pipeline from '../../pipeline/queue.js';
import { coded } from '../../core/errors.js';

import { m, tp } from '../../i18n/t.js';
/**
 * @param {{topics?:string[], config?:object, channelId?:string}} req
 * @returns {{projects:string[], count:number}}
 * @throws {Error} with .status=400 when no valid topic is present
 */
export function startBatch({ topics = [], config = {}, channelId = null } = {}) {
  const clean = topics.map((t) => String(t || '').trim()).filter((t) => t.length > 3);
  if (!clean.length) { const e = coded(new Error(m('không có chủ đề hợp lệ')), 'config.bad-input'); e.status = 400; throw e; }
  const batchChannel = DB.getChannel(channelId || DB.activeChannelId());
  const batchConfig = resolveProjectConfig({
    channel: batchChannel, preset: DB.defaultPresetFor(batchChannel?.id), request: config,
  });
  const created = clean.map((topic) => {
    const p = DB.createProject({
      // P34: an assistant-picked click title is display metadata — it names the project,
      // while the researched topic below stays the script engine's input
      title: (batchConfig.titleOverride || topic.split(/[.!?…\n]/)[0] || topic).slice(0, 64),
      topic, inputType: detectInputType(topic),
      aspectRatio: batchConfig.aspectRatio || '9:16',
      config: batchConfig, channelId: batchChannel?.id,
    });
    DB.projectDirFor(p.id);
    return p;
  });
  if (DB.getSetting('queue', {})?.durable !== false) {
    // Durable path: N ledger rows sharing one batch_id. The scheduler serializes jobs of a
    // batch (one video at a time, as before) and broadcasts batch-done when the last one
    // settles — and unlike the old fire-and-forget IIFE, a crash no longer strands the rest.
    const batchId = `batch_${Date.now().toString(36)}`;
    for (const p of created) Pipeline.enqueueBatchItem(p.id, batchId);
  } else {
    // legacy fallback: sequential background run — one video at a time
    (async () => {
      for (const p of created) {
        try { await Pipeline.startProject(p.id); }
        catch (e) { logger.error(tp`Hàng loạt: mục lỗi (${e.message})`, { projectId: p.id }); }
      }
      hub.broadcast({ type: 'batch-done', count: created.length });
    })();
  }
  return { projects: created.map((p) => p.id), count: created.length };
}
