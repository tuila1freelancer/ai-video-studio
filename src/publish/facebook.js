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
  if (!id || !token) throw new Error('Cần Page ID và Page Access Token');
  const url = `${GRAPH}/${encodeURIComponent(id)}?fields=id,name&access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Không xác thực được Page: ${await graphError(res)}`);
  const page = await res.json();
  saveCfg({ pageId: id, pageToken: token, pageName: String(page.name || '') });
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
  if (!start.ok) throw new Error(`Khởi tạo upload thất bại: ${await graphError(start)}`);
  const { video_id: videoId } = await start.json();
  if (!videoId) throw new Error('Facebook không trả về video_id ở phase start');

  onLog(`⬆ Đang tải reel lên (${(statSync(videoPath).size / 1e6).toFixed(1)} MB)…`);
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
  if (!put.ok) throw new Error(`Tải video thất bại: ${await graphError(put)}`);
  if ((await put.json().catch(() => ({}))).success === false) throw new Error('Tải video thất bại (success=false)');

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
  if (!fin.ok) throw new Error(`Hoàn tất reel thất bại: ${await graphError(fin)}`);
  return { videoId: String(videoId), url: `https://www.facebook.com/reel/${videoId}` };
}

/** Feed lane: one multipart POST. */
async function uploadFeedVideo({ pageId, token, videoPath, title, description, scheduledAt, onLog }) {
  onLog(`⬆ Đang tải video lên feed Trang (${(statSync(videoPath).size / 1e6).toFixed(1)} MB)…`);
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
  if (!res.ok) throw new Error(`Đăng video thất bại: ${await graphError(res)}`);
  const out = await res.json().catch(() => ({}));
  if (!out.id) throw new Error('Facebook không trả về video id');
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
  if (!res.ok) throw new Error(`Bình luận thất bại: ${await graphError(res)}`);
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
  if (!connected()) throw new Error('Chưa kết nối Facebook Page — vào Cài đặt → Đăng video');
  const hashtags = (tags || []).map((t) => `#${String(t).replace(/^#/, '').replace(/\s+/g, '')}`).join(' ');
  const body = [description, hashtags].filter(Boolean).join('\n\n').slice(0, 5000);
  // Staging: a non-public request schedules instead of going live. Facebook requires a
  // scheduled time at least 10 minutes in the future.
  const when = scheduledAt || (privacy === 'public' ? null : Math.floor(Date.now() / 1000) + 15 * 60);
  const vertical = /^(9:16|4:5)$/.test(String(aspectRatio));
  const args = { pageId: c.pageId, token: c.pageToken, videoPath, title, description: body, scheduledAt: when, onLog };
  const out = vertical ? await uploadReel(args) : await uploadFeedVideo(args);
  logger.info(`Facebook: ${when ? 'đã lên lịch' : 'đã đăng'} ${vertical ? 'reel' : 'video'} ${out.videoId}`);
  if (firstComment) {
    try { await comment(out.videoId, firstComment); onLog('💬 Đã đăng bình luận đầu tiên'); }
    catch (e) { logger.warn(`Facebook first comment: ${e.message}`); }
  }
  return { ...out, scheduled: !!when, pageName: c.pageName || '' };
}

export default {
  id: 'facebook', name: 'Facebook Page', configured, connected, connect, disconnect, comment, upload,
};
