// Channels and their named presets.
import { mkdirSync } from 'node:fs';
import { moveFile } from '../../util/fs.js';
import { join, extname } from 'node:path';
import * as DB from '../../db/index.js';
import { newId } from '../../util/util.js';
import { applyMaskedUpdate } from '../../core/config.js';
import { WEB_SAFE, toPng } from '../services/image-convert.js';

import { maskChannel, upload } from '../helpers.js';
import { saveSubtitleDefaults } from '../services/subtitle-defaults.js';
import { normalizeGuide } from '../../styleguide/index.js';
import { revealInFileManager } from '../../util/open-external.js';
import { isHeadless, refuseHeadless } from '../../core/headless.js';

/** @param {import('express').Router} r */
export function mount(r) {
  // ---- channels ----
  r.get('/channels', (req, res) => {
    res.json({ channels: DB.listChannels().map(maskChannel), active: DB.activeChannelId() });
  });
  r.post('/channels', (req, res) => {
    try {
      const { name, rootDir, config } = req.body || {};
      if (!name || !name.trim()) return res.status(400).json({ error: 'thiếu tên kênh' });
      res.json({ channel: maskChannel(DB.createChannel({ name: name.trim(), rootDir, config })) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  r.put('/channels/:id', (req, res) => {
    try {
      const saved = DB.getChannel(req.params.id);
      if (!saved) return res.status(404).json({ error: 'not found' });
      const fields = { ...(req.body || {}) };
      if (fields.config) fields.config = applyMaskedUpdate(saved.config || {}, fields.config);
      res.json({ channel: maskChannel(DB.updateChannel(req.params.id, fields)) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  r.delete('/channels/:id', (req, res) => {
    try { DB.deleteChannel(req.params.id); res.json({ ok: true }); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });
  // The channel's subtitle look, saved as it is edited so the next video of that channel starts
  // with it. A narrow door on purpose: the panel calls this on every change, and only subtitle
  // keys with usable values get through (services/subtitle-defaults.js).
  r.put('/channels/:id/subtitle-defaults', async (req, res) => {
    try {
      const { channel, preset, saved } = saveSubtitleDefaults(req.params.id, req.body?.config || {});
      res.json({ channel: maskChannel(channel), presetUpdated: !!preset, saved });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  // Persistent brand kit: save a style guide as the CHANNEL's canonical guide — every new
  // project inherits it through the config merge (resolveProjectConfig → resolveGuide).
  // normalizeGuide runs server-side, so the WCAG contrast lock is enforced at save time.
  r.post('/channels/:id/style-guide', async (req, res) => {
    const ch = DB.getChannel(req.params.id);
    if (!ch) return res.status(404).json({ error: 'not found' });
    const guide = normalizeGuide(req.body?.guide || {});
    const config = { ...(ch.config || {}), hyperframe: { ...(ch.config?.hyperframe || {}), guide } };
    DB.updateChannel(ch.id, { config });
    res.json({ ok: true, guide });
  });

  // Show Bible: user-editable channel context + the anti-repeat topic ledger
  r.get('/channels/:id/memory', (req, res) => {
    if (!DB.getChannel(req.params.id)) return res.status(404).json({ error: 'not found' });
    res.json(DB.getChannelMemory(req.params.id));
  });
  r.put('/channels/:id/memory', (req, res) => {
    if (!DB.getChannel(req.params.id)) return res.status(404).json({ error: 'not found' });
    res.json(DB.setChannelBible(req.params.id, req.body?.bible || ''));
  });

  r.post('/channels/:id/activate', (req, res) => {
    DB.setActiveChannel(req.params.id);
    res.json({ ok: true, active: DB.activeChannelId() });
  });
  r.post('/channels/:id/open', async (req, res) => {
    const ch = DB.getChannel(req.params.id);
    if (!ch) return res.status(404).json({ error: 'not found' });
    if (isHeadless()) refuseHeadless(ch.root_dir);
    revealInFileManager(ch.root_dir);
    res.json({ ok: true, dir: ch.root_dir });
  });
  // logo/brand asset upload → <channel root>/library/logo/
  r.post('/channels/:id/brand-logo', upload.single('file'), async (req, res) => {
    try {
      const ch = DB.getChannel(req.params.id);
      if (!ch) return res.status(404).json({ error: 'not found' });
      if (!req.file) return res.status(400).json({ error: 'thiếu file' });
      const ext = (extname(req.file.originalname || '') || '.png').toLowerCase();
      const dir = join(ch.root_dir, 'library', 'logo');
      mkdirSync(dir, { recursive: true });
      // A macOS user's logo is very often a HEIC (screenshot / iPhone photo) or a GIF, and the
      // file picker offers image/* — so refusing them read as "upload is broken". Anything the
      // renderer cannot use directly is CONVERTED to PNG instead of rejected.
      if (WEB_SAFE.has(ext)) {
        const dest = join(dir, `${newId('logo')}${ext}`);
        moveFile(req.file.path, dest);
        return res.json({ path: dest, url: `/api/file?path=${encodeURIComponent(dest)}` });
      }
      const dest = join(dir, `${newId('logo')}.png`);
      await toPng(req.file.path, dest, ext);
      res.json({ path: dest, url: `/api/file?path=${encodeURIComponent(dest)}`, converted: ext.replace('.', '').toUpperCase() });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ---- channel presets (named output configs) ----
  r.get('/channels/:id/presets', (req, res) => {
    res.json({ presets: DB.listPresets(req.params.id) });
  });
  r.post('/channels/:id/presets', (req, res) => {
    try {
      const { name, config, isDefault } = req.body || {};
      if (!DB.getChannel(req.params.id)) return res.status(404).json({ error: 'kênh không tồn tại' });
      res.json({ preset: DB.createPreset({ channelId: req.params.id, name, config, isDefault }) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  r.put('/presets/:id', (req, res) => {
    const p = DB.updatePreset(req.params.id, req.body || {});
    if (!p) return res.status(404).json({ error: 'not found' });
    res.json({ preset: p });
  });
  r.delete('/presets/:id', (req, res) => { DB.deletePreset(req.params.id); res.json({ ok: true }); });
}
