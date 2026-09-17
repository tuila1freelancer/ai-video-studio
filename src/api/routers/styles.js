// Named styles (scene, metadata, subtitle) and logo presets, all rows of the shared styles table.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as DB from '../../db/index.js';
import { inAllowedRoots } from '../services/file-access.js';
import { safeJson } from '../../util/util.js';

/** @param {import('express').Router} r */
export function mount(r) {
  // ---- styles ----
  r.get('/styles', (req, res) => res.json({ styles: DB.listStyles(req.query.kind || 'scene') }));
  // name/kind/prompt only: a client-supplied builtin:1 would make the row undeletable.
  r.post('/styles', (req, res) => {
    const { name, kind, prompt } = req.body || {};
    if (!name || !kind) return res.status(400).json({ error: 'thiếu tên hoặc loại style' });
    res.json({ style: DB.createStyle({ name: String(name), kind: String(kind), prompt: prompt == null ? '' : String(prompt) }) });
  });
  r.delete('/styles/:id', (req, res) => { DB.deleteStyle(req.params.id); res.json({ ok: true }); });

  // Logo presets (P42 — reference `/logo-presets*`): a named, reusable {logo file + placement}.
  // Stored as rows in the shared `styles` table (kind 'logo', payload JSON in `prompt`), the same
  // way named SEO styles work — no new table, and a preset is portable across channels.
  r.get('/logo-presets', (req, res) => {
    const presets = (DB.listStyles('logo') || []).map((row) => ({
      id: row.id, name: row.name, ...(safeJson(row.prompt, null) || {}),
    })).filter((x) => x.assetPath);
    res.json({ presets });
  });
  r.post('/logo-presets', (req, res) => {
    const name = String(req.body?.name || '').trim();
    const assetPath = String(req.body?.assetPath || '').trim();
    if (!name || !assetPath) return res.status(400).json({ error: 'cần tên và file logo' });
    if (!inAllowedRoots(resolve(assetPath)) || !existsSync(assetPath)) return res.status(400).json({ error: 'file logo không hợp lệ' });
    // geometry travels with the file — applying a preset must restore WHERE it sat, not just which image
    const g = req.body?.placement || {};
    const payload = {
      assetPath,
      placement: {
        cxPct: Number.isFinite(+g.cxPct) ? +g.cxPct : 0.92,
        cyPct: Number.isFinite(+g.cyPct) ? +g.cyPct : 0.06,
        wPct: Number.isFinite(+g.wPct) ? +g.wPct : 0.085,
        opacity: Number.isFinite(+g.opacity) ? +g.opacity : 0.9,
      },
    };
    res.json({ preset: { ...DB.createStyle({ name, kind: 'logo', prompt: JSON.stringify(payload) }), ...payload } });
  });
  r.delete('/logo-presets/:id', (req, res) => { DB.deleteStyle(req.params.id); res.json({ ok: true }); });
  // Apply a preset into the ACTIVE channel's brand kit — a saved preset is worthless if nothing
  // can put it back (P42). Restores the file AND where it sat.
  r.post('/logo-presets/:id/apply', (req, res) => {
    const row = (DB.listStyles('logo') || []).find((x) => x.id === req.params.id);
    const payload = row && safeJson(row.prompt, null);
    if (!payload?.assetPath) return res.status(404).json({ error: 'không tìm thấy preset' });
    if (!existsSync(payload.assetPath)) return res.status(400).json({ error: 'file logo của preset không còn trên đĩa' });
    const ch = DB.getChannel(req.body?.channelId || DB.activeChannelId());
    if (!ch) return res.status(404).json({ error: 'không có kênh đang hoạt động' });
    const bk = ch.config?.brandKit || {};
    const cfg = {
      ...(ch.config || {}),
      brandKit: {
        ...bk,
        logo: { ...(bk.logo || {}), assetPath: payload.assetPath },
        finalOverlay: { enabled: true, ...payload.placement },
      },
    };
    DB.updateChannel(ch.id, { config: cfg });
    res.json({ ok: true, channelId: ch.id, ...payload });
  });
  r.patch('/styles/:id', (req, res) => {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'tên không hợp lệ' });
    const row = DB.renameStyle(req.params.id, name);
    if (!row) return res.status(404).json({ error: 'không tìm thấy' });
    res.json({ style: row });
  });
}
