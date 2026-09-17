// Persisted provider usage — one row per metered call, attributed to project/channel.
// Written by core/metering.js (the util/usage.js subscriber); read by the usage API,
// the live $/video stream, and the budget guardrail.
import db, { stmt } from '../connection.js';
import { newId } from '../../util/util.js';

const _ins = db.prepare(`INSERT INTO provider_usage
  (id,project_id,channel_id,kind,provider,model,prompt_tokens,completion_tokens,chars,credits,est_cost,at)
  VALUES (@id,@project_id,@channel_id,@kind,@provider,@model,@prompt_tokens,@completion_tokens,@chars,@credits,@est_cost,@at)`);

export function recordUsageRow({ projectId = null, channelId = null, kind, provider = null, model = null,
  promptTokens = 0, completionTokens = 0, chars = 0, credits = 0, estCost = 0 }) {
  _ins.run({
    id: newId('u'), project_id: projectId, channel_id: channelId, kind,
    provider, model,
    prompt_tokens: promptTokens | 0, completion_tokens: completionTokens | 0,
    chars: chars | 0, credits: +credits || 0, est_cost: +estCost || 0, at: Date.now(),
  });
}

/** Aggregate for one project: totals + estimated USD (the budget guardrail's input). */
export function usageForProject(projectId) {
  return stmt(`SELECT
      COUNT(*) calls,
      COALESCE(SUM(prompt_tokens),0) promptTokens,
      COALESCE(SUM(completion_tokens),0) completionTokens,
      COALESCE(SUM(chars),0) chars,
      COALESCE(SUM(credits),0) credits,
      COALESCE(SUM(est_cost),0) estCost
    FROM provider_usage WHERE project_id=?`).get(projectId);
}

/** Recent per-project rollup for the usage API/dashboard. */
export function usageSummary({ limit = 30 } = {}) {
  return stmt(`SELECT project_id projectId, channel_id channelId,
      COUNT(*) calls,
      COALESCE(SUM(prompt_tokens),0) promptTokens,
      COALESCE(SUM(completion_tokens),0) completionTokens,
      COALESCE(SUM(chars),0) chars,
      COALESCE(SUM(est_cost),0) estCost,
      MAX(at) lastAt
    FROM provider_usage GROUP BY project_id ORDER BY lastAt DESC LIMIT ?`).all(limit);
}
