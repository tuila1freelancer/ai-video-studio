// YouTube publisher — OAuth 2.0 loopback + Data API v3 resumable upload.
// Tokens live in settings.publish.youtube and are covered by maskSecrets by key suffix
// (*Token / *Secret — P14); they never reach the client unmasked. Uploads DEFAULT to
// privacy 'private' (staging): publishing publicly is always an explicit user choice.
import { createReadStream, statSync } from 'node:fs';
import { getSetting, setSetting } from '../db/index.js';
import { logger } from '../util/log.js';

const OAUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube';

function cfg() { return getSetting('publish', {})?.youtube || {}; }
function saveCfg(patch) {
  const all = getSetting('publish', {}) || {};
  setSetting('publish', { ...all, youtube: { ...(all.youtube || {}), ...patch } });
}

export function configured() { return !!(cfg().clientId && cfg().clientSecret); }
export function connected() { return !!cfg().refreshToken; }

/** Loopback consent URL — the redirect lands on our own 127.0.0.1 server. */
export function authUrl({ clientId, clientSecret, redirectUri }) {
  if (clientId && clientSecret) saveCfg({ clientId, clientSecret });
  const c = cfg();
  if (!c.clientId) throw new Error('Chưa có OAuth Client ID (tạo tại console.cloud.google.com, loại "Desktop app")');
  const q = new URLSearchParams({
    client_id: c.clientId, redirect_uri: redirectUri, response_type: 'code',
    scope: SCOPE, access_type: 'offline', prompt: 'consent',
  });
  return `${OAUTH}?${q}`;
}

export async function exchangeCode(code, redirectUri) {
  const c = cfg();
  const res = await fetch(TOKEN, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: c.clientId, client_secret: c.clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
  });
  if (!res.ok) throw new Error(`OAuth exchange ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const d = await res.json();
  saveCfg({ accessToken: d.access_token, refreshToken: d.refresh_token || cfg().refreshToken, expiry: Date.now() + (d.expires_in || 3600) * 1000 });
  return true;
}

async function accessToken() {
  const c = cfg();
  if (!c.refreshToken) throw new Error('YouTube chưa kết nối — chạy bước cấp quyền OAuth trước');
  if (c.accessToken && c.expiry && Date.now() < c.expiry - 60000) return c.accessToken;
  const res = await fetch(TOKEN, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ refresh_token: c.refreshToken, client_id: c.clientId, client_secret: c.clientSecret, grant_type: 'refresh_token' }),
  });
  if (!res.ok) throw new Error(`OAuth refresh ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const d = await res.json();
  saveCfg({ accessToken: d.access_token, expiry: Date.now() + (d.expires_in || 3600) * 1000 });
  return d.access_token;
}

/**
 * Resumable upload. metadata: {title, description, tags, privacy} — privacy defaults to
 * 'private' (staging); 'public' must be passed explicitly by the caller.
 */
export async function upload({ videoPath, title, description = '', tags = [], privacy = 'private', thumbPath = null, scheduledAt = null }) {
  const token = await accessToken();
  const size = statSync(videoPath).size;
  const body = {
    snippet: { title: String(title || 'Video').slice(0, 100), description: String(description).slice(0, 4900), tags: tags.slice(0, 30), categoryId: '27' },
    // Scheduled publishing (P40): YouTube only honours publishAt on a PRIVATE video — it flips
    // to public itself at that moment. scheduledAt is unix seconds, the same unit the Facebook
    // lane takes, so the caller does not have to remember two conventions.
    status: {
      privacyStatus: scheduledAt ? 'private' : (['private', 'unlisted', 'public'].includes(privacy) ? privacy : 'private'),
      selfDeclaredMadeForKids: false,
      ...(scheduledAt ? { publishAt: new Date(scheduledAt * 1000).toISOString() } : {}),
    },
  };
  const init = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Length': String(size), 'X-Upload-Content-Type': 'video/mp4',
    },
    body: JSON.stringify(body),
  });
  if (!init.ok) throw new Error(`YouTube init ${init.status}: ${(await init.text()).slice(0, 300)}`);
  const location = init.headers.get('location');
  if (!location) throw new Error('YouTube: thiếu resumable upload URL');
  const put = await fetch(location, {
    method: 'PUT',
    headers: { 'Content-Length': String(size), 'Content-Type': 'video/mp4' },
    body: createReadStream(videoPath),
    duplex: 'half', // Node fetch requires this for streaming request bodies
  });
  if (!put.ok) throw new Error(`YouTube upload ${put.status}: ${(await put.text()).slice(0, 300)}`);
  const video = await put.json();
  if (thumbPath) {
    try {
      const tSize = statSync(thumbPath).size;
      await fetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${video.id}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/jpeg', 'Content-Length': String(tSize) },
        body: createReadStream(thumbPath), duplex: 'half',
      });
    } catch (e) { logger.warn(`youtube thumbnail: ${e.message}`); }
  }
  return { videoId: video.id, url: `https://youtu.be/${video.id}`, privacy: body.status.privacyStatus, scheduled: !!scheduledAt };
}

export default { id: 'youtube', name: 'YouTube', configured, connected, authUrl, exchangeCode, upload };
