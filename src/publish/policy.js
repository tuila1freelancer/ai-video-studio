// What a channel allows to be published, and by whom.
//
// Auto-publish has always staged as `private` unless told otherwise, which is the right default and
// not a policy. A channel running unattended needs the rest of one: how public a video may go, how
// many may go a day, whether the verdict must pass first, and which hours are its own.
//
// Everything here refuses; nothing here publishes.
import { channelOf, publishCountSince } from '../db/index.js';
import { apiError } from '../core/api-codes.js';
import { quotaAllowsUpload } from './quota.js';
import { m } from '../i18n/t.js';

const PRIVACY_ORDER = ['private', 'unlisted', 'public'];

/** @param {object} channel @returns {{maxPrivacy:string, perDay:number, requireVerdict:boolean, hours:number[]}} */
export function publishPolicy(channel) {
  const p = channel?.config?.publishPolicy || {};
  return {
    maxPrivacy: PRIVACY_ORDER.includes(p.maxPrivacy) ? p.maxPrivacy : 'public',
    perDay: Math.max(0, +p.perDay || 0),
    requireVerdict: p.requireVerdict === true,
    hours: Array.isArray(p.hours) ? p.hours.map(Number).filter((h) => h >= 0 && h <= 23) : [],
    dailyUnits: +p.dailyUnits || undefined,
  };
}

/** A privacy the policy permits: asking for more than the ceiling gets the ceiling, not a refusal. */
export function clampPrivacy(asked, policy) {
  const want = PRIVACY_ORDER.includes(asked) ? asked : 'private';
  const ceiling = PRIVACY_ORDER.indexOf(policy.maxPrivacy);
  return PRIVACY_ORDER[Math.min(PRIVACY_ORDER.indexOf(want), ceiling)];
}

const startOfDay = (now = Date.now()) => {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

/**
 * Decide whether this upload may happen, and at what privacy.
 *
 * @param {{projectId:string, platform?:string, privacy?:string, force?:boolean,
 *          verdict?:{publishable:boolean, reasons:object[]}|null, now?:number}} req
 * @returns {{privacy:string, policy:object, quota:object}}
 * @throws an apiError with a code an agent can branch on
 */
export function assertPublishAllowed({ projectId, platform = 'youtube', privacy = 'private', force = false, verdict = null, now = Date.now() }) {
  const channel = channelOf(projectId);
  const policy = publishPolicy(channel);

  if (policy.hours.length && !policy.hours.includes(new Date(now).getHours())) {
    throw apiError('publish_outside_window', m('ngoài khung giờ đăng của kênh'), 409);
  }
  if (policy.perDay > 0) {
    const today = publishCountSince(channel?.id, startOfDay(now), platform);
    if (today >= policy.perDay) throw apiError('publish_daily_cap', m('đã đủ số video đăng trong ngày của kênh'), 409);
  }
  // force is the owner's override, and it is recorded rather than silent (the caller journals it).
  if (policy.requireVerdict && verdict && verdict.publishable === false && !force) {
    const err = apiError('verdict_failed', m('video chưa đạt kiểm định — chưa thể đăng'), 409);
    err.reasons = verdict.reasons;
    throw err;
  }
  const quota = platform === 'youtube' ? quotaAllowsUpload(channel?.id, { dailyUnits: policy.dailyUnits }) : { ok: true };
  if (!quota.ok) throw apiError('publish_quota_exhausted', m('hết hạn mức API của nền tảng trong ngày'), 429);

  return { privacy: clampPrivacy(privacy, policy), policy, quota };
}
