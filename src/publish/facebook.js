// Facebook Page publisher (P40) — the reference app's only publish target, ported onto our
// existing publisher contract so it sits beside YouTube instead of replacing it.
//
// Auth is a PAGE ACCESS TOKEN the owner pastes in (Meta's Graph API Explorer or their own app),
// not an OAuth dance: the reference works the same way, and it keeps us out of app-review
// territory for a desktop tool. The token lives in settings.publish.facebook.pageToken and is
// masked at every egress by the *Token key-suffix rule (P14).
//
// Two shapes, chosen by the video's own aspect ratio:
//   • vertical (9:16 / 4:5) → REELS: POST /{page}/video_reels upload_phase=start → PUT the bytes
//     to rupload.facebook.com → upload_phase=finish (PUBLISHED or SCHEDULED).
//   • everything else → a normal feed video: multipart POST /{page}/videos.
// Both accept a scheduled_publish_time, which is how the reference schedules a post.
import { readFileSync, statSync } from 'node:fs';
import { getSetting, setSetting } from '../db/index.js';
import { logger } from '../util/log.js';

import { m, tp } from '../i18n/t.js';
const VERSION = 'v23.0';
const GRAPH = `https://graph.facebook.com/${VERSION}`;
const RUPLOAD = `https://rupload.facebook.com/video-upload/${VERSION}`;

function cfg() { return getSetting('publish', {})?.facebook || {}; }
function saveCfg(patch) {
  const all = getSetting('publish', {}) || {};
  setSetting('publish', { ...all, facebook: { ...(all.facebook || {}), ...patch } });
}

export function configured() { return !!cfg().pageId; }
export function connected() { return !!(cfg().pageId && cfg().pageToken); }

/**
 * Every Page the owner has connected. A Page token EXPIRES, and with a single-slot config a
 * silent expiry looks like "publishing is broken" — a registry lets each Page carry its own
 * token and its own expiry so the UI can say which one went stale (P42).
 */
export function listPages() {
  const c = cfg();
  const pages = Array.isArray(c.pages) ? c.pages : [];
  // the single-slot config from before the registry keeps working: it IS the active page
  if (!pages.length && c.pageId) return [{ id: c.pageId, name: c.pageName || '', active: true, expiresAt: c.expiresAt || null }];
  return pages.map((p) => ({ id: p.id, name: p.name || '', active: p.id === c.pageId, expiresAt: p.expiresAt || null }));
}

function savePage(page) {
  const c = cfg();
  const pages = (Array.isArray(c.pages) ? c.pages : []).filter((p) => p.id !== page.id);
  pages.push(page);
  saveCfg({ pages, pageId: page.id, pageToken: page.token, pageName: page.name, expiresAt: page.expiresAt || null });
}

export function selectPage(pageId) {
  const c = cfg();
  const hit = (Array.isArray(c.pages) ? c.pages : []).find((p) => p.id === String(pageId));
  if (!hit) throw new Error(m('chưa kết nối Page này'));
  saveCfg({ pageId: hit.id, pageToken: hit.token, pageName: hit.name, expiresAt: hit.expiresAt || null });
  return { pageId: hit.id, pageName: hit.name };
}

export function removePage(pageId) {
  const c = cfg();
  const pages = (Array.isArray(c.pages) ? c.pages : []).filter((p) => p.id !== String(pageId));
  const next = pages[0] || null;
  saveCfg({ pages, pageId: next?.id || '', pageToken: next?.token || '', pageName: next?.name || '', expiresAt: next?.expiresAt || null });
  return { ok: true, remaining: pages.length };
}

/** Is this Page's token still good, and for how long? Graph tells us via debug_token. */
export async function checkToken(pageId) {
  const c = cfg();
  const page = (Array.isArray(c.pages) ? c.pages : []).find((p) => p.id === String(pageId))
    || (c.pageId === String(pageId) ? { id: c.pageId, token: c.pageToken, name: c.pageName } : null);
  if (!page?.token) throw new Error(m('chưa kết nối Page này'));
  const url = `${GRAPH}/debug_token?input_token=${encodeURIComponent(page.token)}&access_token=${encodeURIComponent(page.token)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(tp`Không kiểm tra được token: ${await graphError(res)}`);
  const d = (await res.json())?.data || {};
  // expires_at 0 means "never" — a long-lived Page token derived from a long-lived user token
  const expiresAt = d.expires_at ? d.expires_at * 1000 : null;
  return {
    pageId: page.id, valid: !!d.is_valid, neverExpires: d.expires_at === 0,
    expiresAt, daysLeft: expiresAt ? Math.round((expiresAt - Date.now()) / 86400000) : null,
    scopes: d.scopes || [],
  };
}

/**
 * Trade a short-lived token for a long-lived one (Graph `fb_exchange_token`), then re-derive the
 * PAGE token from it so the Page keeps publishing. Needs the app id/secret of whichever Meta app
 * issued the token — without them Facebook simply refuses, so we say that instead of guessing.
 */
export async function extendToken({ appId, appSecret, pageId } = {}) {
  const c = cfg();
  const id = String(pageId || c.pageId || '');
  const page = (Array.isArray(c.pages) ? c.pages : []).find((p) => p.id === id)
    || (c.pageId === id ? { id, token: c.pageToken, name: c.pageName } : null);
  if (!page?.token) throw new Error(m('chưa kết nối Page này'));
  const aid = String(appId || c.appId || '').trim(), sec = String(appSecret || c.appSecret || '').trim();
  if (!aid || !sec) throw new Error(m('cần App ID + App Secret của app Meta đã cấp token này'));
  const q = new URLSearchParams({ grant_type: 'fb_exchange_token', client_id: aid, client_secret: sec, fb_exchange_token: page.token });
  const res = await fetch(`${GRAPH}/oauth/access_token?${q}`, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(tp`Gia hạn thất bại: ${await graphError(res)}`);
  const long = (await res.json())?.access_token;
  if (!long) throw new Error(m('Facebook không trả về token dài hạn'));
  // re-derive the PAGE token from the long-lived USER token
  const accRes = await fetch(`${GRAPH}/${encodeURIComponent(id)}?fields=access_token,name&access_token=${encodeURIComponent(long)}`, { signal: AbortSignal.timeout(15000) });
  const acc = accRes.ok ? await accRes.json() : {};
  const token = acc.access_token || long;
  saveCfg({ appId: aid, appSecret: sec });
  savePage({ id, name: acc.name || page.name || '', token, expiresAt: null });
  return { pageId: id, extended: true, pageName: acc.name || page.name || '' };
}

/** Graph errors carry the useful message in a nested envelope — surface it, not "HTTP 400". */
async function graphError(res) {
  try {
    const j = await res.json();
    return j?.error?.message || `HTTP ${res.status}`;
  } catch { return `HTTP ${res.status}`; }
}

/**
 * Verify a token+page pair and remember it. Returns the Page's real name, which is the only
 * honest confirmation that the token belongs to the page the owner thinks it does.
 */
export async function connect({ pageId, pageToken } = {}) {
  const id = String(pageId || cfg().pageId || '').trim();
  const token = String(pageToken || cfg().pageToken || '').trim();
  if (!id || !token) throw new Error(m('Cần Page ID và Page Access Token'));
  const url = `${GRAPH}/${encodeURIComponent(id)}?fields=id,name&access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(tp`Không xác thực được Page: ${await graphError(res)}`);
  const page = await res.json();
  savePage({ id, name: String(page.name || ''), token, expiresAt: null });
  return { pageId: id, pageName: String(page.name || '') };
}

export function disconnect() {
  saveCfg({ pageToken: '', pageName: '' });
  return { ok: true };
}

/** Reels lane: start → bytes → finish. Vertical video only (Facebook rejects landscape reels). */
async function uploadReel({ pageId, token, videoPath, description, scheduledAt, onLog }) {
  const start = await fetch(`${GRAPH}/${encodeURIComponent(pageId)}/video_reels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ upload_phase: 'start', access_token: token }),
    signal: AbortSignal.timeout(30000),
  });
  if (!start.ok) throw new Error(tp`Khởi tạo upload thất bại: ${await graphError(start)}`);
  const { video_id: videoId } = await start.json();
  if (!videoId) throw new Error(m('Facebook không trả về video_id ở phase start'));

  onLog(tp`⬆ Đang tải reel lên (${(statSync(videoPath).size / 1e6).toFixed(1)} MB)…`);
  const bytes = readFileSync(videoPath);
  const put = await fetch(`${RUPLOAD}/${encodeURIComponent(videoId)}`, {
    method: 'POST',
    headers: {
      Authorization: `OAuth ${token}`,
      offset: '0',
      file_size: String(bytes.length),
      'Content-Type': 'application/octet-stream',
    },
    body: bytes,
    signal: AbortSignal.timeout(600000),
  });
  if (!put.ok) throw new Error(tp`Tải video thất bại: ${await graphError(put)}`);
  if ((await put.json().catch(() => ({}))).success === false) throw new Error(m('Tải video thất bại (success=false)'));

  const finishBody = new URLSearchParams({
    upload_phase: 'finish', access_token: token, video_id: String(videoId),
    video_state: scheduledAt ? 'SCHEDULED' : 'PUBLISHED',
  });
  if (description) finishBody.set('description', description);
  if (scheduledAt) finishBody.set('scheduled_publish_time', String(scheduledAt));
  const fin = await fetch(`${GRAPH}/${encodeURIComponent(pageId)}/video_reels`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: finishBody, signal: AbortSignal.timeout(60000),
  });
  if (!fin.ok) throw new Error(tp`Hoàn tất reel thất bại: ${await graphError(fin)}`);
  return { videoId: String(videoId), url: `https://www.facebook.com/reel/${videoId}` };
}

/** Feed lane: one multipart POST. */
async function uploadFeedVideo({ pageId, token, videoPath, title, description, scheduledAt, onLog }) {
  onLog(tp`⬆ Đang tải video lên feed Trang (${(statSync(videoPath).size / 1e6).toFixed(1)} MB)…`);
  const form = new FormData();
  form.append('access_token', token);
  if (description) form.append('description', description);
  if (title) form.append('title', title);
  if (scheduledAt) {
    form.append('published', 'false');
    form.append('scheduled_publish_time', String(scheduledAt));
  } else {
    form.append('published', 'true');
  }
  form.append('source', new Blob([readFileSync(videoPath)], { type: 'video/mp4' }), 'video.mp4');
  const res = await fetch(`${GRAPH}/${encodeURIComponent(pageId)}/videos`, {
    method: 'POST', body: form, signal: AbortSignal.timeout(600000),
  });
  if (!res.ok) throw new Error(tp`Đăng video thất bại: ${await graphError(res)}`);
  const out = await res.json().catch(() => ({}));
  if (!out.id) throw new Error(m('Facebook không trả về video id'));
  return { videoId: String(out.id), url: `https://www.facebook.com/${out.id}` };
}

/** Optional first comment — the reference's way of pinning a link without hurting reach. */
export async function comment(objectId, message) {
  const c = cfg();
  if (!c.pageToken || !objectId || !message) return { ok: false };
  const res = await fetch(`${GRAPH}/${encodeURIComponent(objectId)}/comments`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ message, access_token: c.pageToken }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(tp`Bình luận thất bại: ${await graphError(res)}`);
  return { ok: true, id: (await res.json().catch(() => ({}))).id || '' };
}

/**
 * Publish a finished video to the connected Page.
 * `privacy` follows the shared publisher contract: anything other than 'public' is staged as a
 * SCHEDULED post ~10 minutes out rather than going live, so the default is never an instant
 * public post — matching the YouTube lane's 'private' default.
 */
export async function upload({
  videoPath, title = '', description = '', tags = [], privacy = 'private',
  scheduledAt = null, firstComment = '', aspectRatio = '', onLog = () => {},
} = {}) {
  const c = cfg();
  if (!connected()) throw new Error(m('Chưa kết nối Facebook Page — vào Cài đặt → Đăng video'));
  const hashtags = (tags || []).map((t) => `#${String(t).replace(/^#/, '').replace(/\s+/g, '')}`).join(' ');
  const body = [description, hashtags].filter(Boolean).join('\n\n').slice(0, 5000);
  // Staging: a non-public request schedules instead of going live. Facebook requires a
  // scheduled time at least 10 minutes in the future.
  const when = scheduledAt || (privacy === 'public' ? null : Math.floor(Date.now() / 1000) + 15 * 60);
  const vertical = /^(9:16|4:5)$/.test(String(aspectRatio));
  const args = { pageId: c.pageId, token: c.pageToken, videoPath, title, description: body, scheduledAt: when, onLog };
  const out = vertical ? await uploadReel(args) : await uploadFeedVideo(args);
  // i18n-exempt: logger.info carries no projectId, so this line never leaves the terminal (util/log.js).
  logger.info(`Facebook: ${when ? 'đã lên lịch' : 'đã đăng'} ${vertical ? 'reel' : 'video'} ${out.videoId}`);
  if (firstComment) {
    try { await comment(out.videoId, firstComment); onLog(m('💬 Đã đăng bình luận đầu tiên')); }
    catch (e) { logger.warn(`Facebook first comment: ${e.message}`); }
  }
  return { ...out, scheduled: !!when, pageName: c.pageName || '' };
}

export default {
  id: 'facebook', name: 'Facebook Page', configured, connected, connect, disconnect, comment, upload,
  listPages, selectPage, removePage, checkToken, extendToken,
};
