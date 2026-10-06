// Uploads, brand folders and brand-asset generation (P27).
import { existsSync, unlinkSync, renameSync, readdirSync, rmSync } from 'node:fs';
import { moveFile } from '../../util/fs.js';
import { join, resolve, extname } from 'node:path';
import * as DB from '../../db/index.js';
import { DIRS } from '../../config/paths.js';
import { newId } from '../../util/util.js';

import { upload } from '../helpers.js';
import { brandFolders } from '../../pipeline/brand-assets.js';
import { createBrand, generateEmotions, generateBrandAsset, copyToBrand, addEditProvider, removeEditProvider } from '../services/brand-gen.js';

/** @param {import('express').Router} r */
export function mount(r) {
  // ---- generic uploads (assets/logo) ----
  r.post('/upload', upload.array('files'), (req, res) => {
    const out = (req.files || []).map((f) => {
      const ext = extname(f.originalname) || '';
      const finalPath = join(DIRS.uploads, `${newId('u')}${ext}`);
      moveFile(f.path, finalPath);
      return { name: f.originalname, path: finalPath, size: f.size };
    });
    res.json({ files: out });
  });

  // ---- brand gen (P27 — reference-app clone; prompts verbatim, ×10 no-fallback) ----
  r.get('/brands', async (req, res) => {
    // Folders on disk count too — the user may simply have made one in Finder (P40).
    res.json({ brands: brandFolders() });
  });
  // Brand folder rename / delete (P42 — reference PUT /brands/rename, DELETE /brands/:name).
  // Both are destructive, so both are pinned INSIDE the brand library and refuse 'Default':
  // a traversal or a typo must never be able to reach anything else on the machine.
  const brandDirOf = (name) => {
    const clean = String(name || '').replace(/[\/\\]/g, '').replace(/\.\./g, '').trim();
    if (!clean || clean === 'Default') return null;
    const dir = join(DIRS.brand, clean);
    return resolve(dir).startsWith(resolve(DIRS.brand) + '/') ? { clean, dir } : null;
  };
  r.put('/brands/rename', (req, res) => {
    const from = brandDirOf(req.body?.from), to = brandDirOf(req.body?.to);
    if (!from || !to) return res.status(400).json({ error: 'tên không hợp lệ (không đổi được thư mục Default)' });
    if (!existsSync(from.dir)) return res.status(404).json({ error: 'không tìm thấy thư mục' });
    if (existsSync(to.dir)) return res.status(400).json({ error: 'tên mới đã tồn tại' });
    renameSync(from.dir, to.dir);
    DB.renameBrandFolder(from.clean, to.clean); // keep the library rows pointing at the same art
    res.json({ ok: true, from: from.clean, to: to.clean });
  });
  r.delete('/brands/:name', (req, res) => {
    const b = brandDirOf(req.params.name);
    if (!b) return res.status(400).json({ error: 'không xoá được thư mục Default' });
    if (!existsSync(b.dir)) return res.status(404).json({ error: 'không tìm thấy thư mục' });
    // say what is about to go: the caller must pass the count back to confirm it read this
    const files = readdirSync(b.dir).filter((f) => !f.startsWith('.'));
    if (req.query.confirm !== String(files.length)) {
      return res.status(409).json({ error: 'cần xác nhận', files: files.length, confirmWith: String(files.length) });
    }
    rmSync(b.dir, { recursive: true, force: true });
    DB.deleteBrandFolder(b.clean);
    res.json({ ok: true, deleted: files.length });
  });
  r.post('/brands', async (req, res) => {
    try {
      res.json(createBrand(req.body?.name));
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  r.post('/brandgen/emotions', async (req, res) => {
    try {
      res.json({ ok: true, ...(await generateEmotions(req.body || {})) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  r.post('/brandgen/generate', upload.single('image'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'Thiếu ảnh tham chiếu' });
      const out = await generateBrandAsset({
        imagePath: req.file.path, characterName: req.body?.characterName,
        emotion: req.body?.emotion, brand: req.body?.brand, style: req.body?.style,
      });
      res.json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
    finally { if (req.file) { try { unlinkSync(req.file.path); } catch { /* temp cleanup */ } } }
  });
  r.post('/brandgen/copy', async (req, res) => {
    try {
      res.json(copyToBrand(req.body || {}));
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  // provider list mutations live server-side: a masked-key array round-trip via PUT
  // /settings would clobber real keys (arrays replace wholesale in applyMaskedUpdate)
  r.post('/brandgen/providers', async (req, res) => {
    try {
      res.json(addEditProvider(req.body || {}));
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  r.delete('/brandgen/providers/:id', async (req, res) => {
    try {
      res.json(removeEditProvider(req.params.id));
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
}
