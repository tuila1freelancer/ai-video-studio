// Media file serving: the allowlisted /file lane (P15), its downscaled /thumb twin, and
// /media/download, which brings a remote image or video local so a scene stays self-contained.
import { createWriteStream, existsSync, statSync, unlinkSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { join, resolve, extname, basename } from 'node:path';
import { DIRS } from '../../config/paths.js';
import { newId } from '../../util/util.js';
import { m, tp } from '../../i18n/t.js';
import { inAllowedRoots } from '../services/file-access.js';
import { thumbFor, thumbWidth } from '../services/thumb-cache.js';
import { DOWNLOAD_MAX_BYTES } from '../../core/constants.js';

/** @param {import('express').Router} r */
export function mount(r) {
  r.get('/file', (req, res) => {
    // String(): `?path=a&path=b` is an array, and resolve() throws on one.
    const p = resolve(String(req.query.path || ''));
    if (!inAllowedRoots(p)) return res.status(403).json({ error: 'forbidden' });
    if (!existsSync(p) || !statSync(p).isFile()) return res.status(404).json({ error: 'not found' });
    // NO maxAge here: previews/renders overwrite the SAME path, so the browser must
    // revalidate (etag 304 — ~1ms on loopback) or regenerated frames would show stale.
    res.sendFile(p);
  });
  // The same file, downscaled for a card. Cacheable: the query carries a version the UI derives
  // from the row's updated_at, so a re-rendered thumbnail gets a new URL.
  r.get('/thumb', async (req, res) => {
    const p = resolve(String(req.query.path || ''));
    if (!inAllowedRoots(p)) return res.status(403).json({ error: 'forbidden' });
    if (!existsSync(p) || !statSync(p).isFile()) return res.status(404).json({ error: 'not found' });
    const small = await thumbFor(p, thumbWidth(req.query.w));
    res.set('Cache-Control', 'private, max-age=86400');
    res.sendFile(small || p);
  });

  // Bring a remote image/video into the project (P40 — reference `/media/download`). An image
  // search result is a URL on someone else's server; a scene must be self-contained and offline,
  // so the file is fetched ONCE into uploads and everything downstream works with a local path.
  r.post('/media/download', async (req, res) => {
    try {
      const url = String(req.body?.url || '').trim();
      if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'cần URL http(s)' });
      const resp = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(60000) });
      if (!resp.ok) return res.status(400).json({ error: tp`tải về lỗi HTTP ${resp.status}` });
      const type = (resp.headers.get('content-type') || '').toLowerCase();
      if (!/^(image|video)\//.test(type)) {
        return res.status(400).json({ error: tp`không phải ảnh/video (${type || m('không rõ')})` });
      }
      const declared = Number(resp.headers.get('content-length') || 0);
      if (declared > DOWNLOAD_MAX_BYTES) return res.status(400).json({ error: tp`file quá lớn (${Math.round(declared / 1048576)} MB)` });
      const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'video/mp4': '.mp4', 'video/quicktime': '.mov' };
      const ext = EXT[type.split(';')[0]] || extname(new URL(url).pathname) || '.bin';
      const out = join(DIRS.uploads, `${newId('dl')}${ext}`);
      // Streamed to disk with a running total: a lying Content-Length cannot fill memory or the disk.
      let size = 0;
      const reader = Readable.fromWeb(resp.body);
      reader.on('data', (chunk) => { size += chunk.length; if (size > DOWNLOAD_MAX_BYTES) reader.destroy(new Error('file quá lớn')); });
      try { await pipeline(reader, createWriteStream(out)); } catch (e) { try { unlinkSync(out); } catch { /* not created */ } throw e; }
      if (!size) { unlinkSync(out); return res.status(400).json({ error: 'file rỗng' }); }
      res.json({ path: out, name: basename(out), size, type });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
}
