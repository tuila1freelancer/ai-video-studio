// Per-video budget guardrail. settings.budget = { perVideoUsd: number|null }.
// Consulted ONCE per run (per-video decision, not per-scene): when a project's estimated
// spend has reached the cap, the pipeline context downgrades to the EXISTING free paths —
// llm disabled (generateScript → offlineScript, planner heuristics) and tts pinned to the
// free edge→say chain. No new provider switches are invented (P7's contract intact:
// the pin rides the same explicit-override lane a user's per-video pick uses).
import { channelSpendSince, getSetting, usageForProject } from '../db/index.js';

export function budgetSettings() {
  const b = getSetting('budget', {}) || {};
  return {
    perVideoUsd: +b.perVideoUsd || 0,
    perChannelDayUsd: +b.perChannelDayUsd || 0,
    perChannelDayVideos: +b.perChannelDayVideos || 0,
    // Off by default: the existing behaviour is to DOWNGRADE at the cap, and turning a soft
    // guardrail into a hard stop must be something the owner asked for.
    hardStop: b.hardStop === true,
  };
}

export function budgetState(projectId) {
  const cap = budgetSettings().perVideoUsd;
  if (cap <= 0) return { capped: false, cap: 0, spent: 0 };
  const spent = usageForProject(projectId)?.estCost || 0;
  return { capped: spent >= cap, cap, spent };
}

/** Local midnight — a daily cap the owner can reason about, not a rolling 24 hours. */
function startOfDay(now = Date.now()) {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * Every cap at once, with what has been spent against it.
 * @param {{projectId?:string|null, channelId?:string|null, now?:number}} where
 */
export function spendState({ projectId = null, channelId = null, now = Date.now() } = {}) {
  const caps = budgetSettings();
  const day = channelId ? channelSpendSince(channelId, startOfDay(now)) : { usd: 0, videos: 0 };
  const video = projectId ? (usageForProject(projectId)?.estCost || 0) : 0;
  const over = [];
  if (caps.perVideoUsd > 0 && video >= caps.perVideoUsd) over.push('video_usd');
  if (caps.perChannelDayUsd > 0 && day.usd >= caps.perChannelDayUsd) over.push('channel_day_usd');
  if (caps.perChannelDayVideos > 0 && day.videos >= caps.perChannelDayVideos) over.push('channel_day_videos');
  return { caps, spent: { videoUsd: video, dayUsd: day.usd, dayVideos: day.videos }, over, hardStop: caps.hardStop };
}
