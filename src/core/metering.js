// Cost meter: subscribes to the util/usage.js seam, attributes each event to the current
// run (util/run-context.js), estimates USD (core/pricing.js), persists the row and streams
// a live rolling total to the project's WS subscribers. Import once at boot (server.js).
import { onUsage } from '../util/usage.js';
import { currentRun } from '../util/run-context.js';
import { estimateCost } from './pricing.js';
import { recordUsageRow, usageForProject } from '../db/index.js';
import { hub } from '../ws/hub.js';
import { logger } from '../util/log.js';
import { jlog } from '../pipeline/journal.js';

// Journal throttle: a cost line only on meaningful growth — every call would flood P32.
const lastJournaled = new Map(); // projectId -> estCost at the last journal row

onUsage((kind, d) => {
  try {
    const { projectId = null, channelId = null } = currentRun();
    const estCost = estimateCost({ kind, provider: d.provider, model: d.model,
      promptTokens: d.promptTokens, completionTokens: d.completionTokens, chars: d.chars });
    recordUsageRow({
      projectId, channelId, kind, provider: d.provider || null, model: d.model || null,
      promptTokens: d.promptTokens || 0, completionTokens: d.completionTokens || 0,
      chars: d.chars || 0, credits: d.credits || 0, estCost,
    });
    if (projectId) {
      const agg = usageForProject(projectId);
      hub.toProject(projectId, { type: 'usage', projectId,
        estCost: +agg.estCost.toFixed(4), promptTokens: agg.promptTokens,
        completionTokens: agg.completionTokens, chars: agg.chars, calls: agg.calls });
      if (agg.estCost - (lastJournaled.get(projectId) || 0) >= 0.01) {
        lastJournaled.set(projectId, agg.estCost);
        jlog(projectId, { kind: 'usage', msg: `💸 Chi phí ước tính: $${agg.estCost.toFixed(2)} (${agg.calls} lượt gọi AI)`,
          data: { estCost: +agg.estCost.toFixed(4), calls: agg.calls } });
      }
    }
  } catch (e) {
    logger.warn(`metering: ${e.message}`); // metering must never break a provider call
  }
});
