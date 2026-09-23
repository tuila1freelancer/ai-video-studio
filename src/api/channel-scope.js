// Which channel a request works in.
//
// The app has an ACTIVE channel because one person is looking at one window. Two agents are not one
// person: with the active channel as the only answer, "create a video" from agent A and "switch
// channel" from agent B interleave into a video filed under the wrong channel, and nothing on the
// client side can prevent it. So every creation path asks this instead, and the active channel is
// demoted to what it always really was — the default for the window.
import * as DB from '../db/index.js';
import { tokenHasChannel } from '../db/index.js';
import { apiError } from '../core/api-codes.js';
import { m } from '../i18n/t.js';

/** The channel the caller named, in any of the three places it may say so. */
export function askedChannelId(req) {
  const asked = req?.body?.channelId ?? req?.query?.channel ?? req?.headers?.['x-avs-channel'];
  return String(asked ?? '').trim() || null;
}

/**
 * The channel row this request belongs to.
 *
 * Order: what the caller named → the token's own first channel → the active channel. A token bound
 * to channels may never reach another one, named or defaulted.
 *
 * @param {import('express').Request} req
 * @returns {object} the channel row
 */
export function channelFor(req) {
  const asked = askedChannelId(req);
  if (asked) {
    const found = DB.getChannel(asked);
    if (!found) throw apiError('channel_not_found', m('kênh không tồn tại'), 404);
    if (!tokenHasChannel(req?.token, found.id)) throw apiError('channel_denied', m('token không được phép dùng kênh này'), 403);
    return found;
  }
  const bound = req?.token?.channelIds?.[0];
  const fallback = bound ? DB.getChannel(bound) : null;
  return fallback || DB.getChannel(DB.activeChannelId());
}

/** The id alone, for the routes that only filter by it. */
export function channelIdFor(req) {
  return channelFor(req)?.id || null;
}
