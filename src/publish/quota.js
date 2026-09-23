// What a day of publishing costs the platform's own budget.
//
// YouTube's Data API gives a project 10,000 units a day and charges 1,600 for a single
// videos.insert — about six uploads. Nothing here counted them, so the seventh upload of a busy day
// failed with a 403 the pipeline read as "publishing is broken". Counting them lets the refusal say
// the true thing, before the upload rather than after.
import { channelSpendSince, recordUsageRow } from '../db/index.js';

/** Unit costs, from the platform's published table. */
export const UNITS = { 'videos.insert': 1600, 'thumbnails.set': 50, 'videos.update': 50, 'videos.list': 1 };

/** The daily allowance a project gets by default. Overridable per channel. */
export const DAILY_UNITS = 10_000;

const startOfDay = (now = Date.now()) => {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

/** Record units against the usage ledger, where every other cost already lives. */
export function recordQuota({ projectId = null, channelId = null, platform = 'youtube', operation, units = 0 }) {
  recordUsageRow({
    projectId, channelId, kind: 'quota', provider: platform, model: operation,
    credits: units || UNITS[operation] || 0,
  });
}

/** Units this channel has spent on a platform today, and what is left. */
export function quotaToday(channelId, { dailyUnits = DAILY_UNITS, now = Date.now() } = {}) {
  const used = channelSpendSince(channelId, startOfDay(now)).credits || 0;
  return { used, limit: dailyUnits, left: Math.max(0, dailyUnits - used) };
}

/** Is there room for one more upload (insert + thumbnail) today? */
export function quotaAllowsUpload(channelId, opts = {}) {
  const need = UNITS['videos.insert'] + UNITS['thumbnails.set'];
  const { left, used, limit } = quotaToday(channelId, opts);
  return { ok: left >= need, need, left, used, limit };
}
