// Projects: CRUD, export history, variants, QC scan, change plans, frame preview, restart, footprint, typeset repair, deletion.
import { existsSync, statSync } from 'node:fs';
import * as DB from '../../db/index.js';
import { logger } from '../../util/log.js';
import { detectInputType } from '../../util/util.js';
import * as Pipeline from '../../pipeline/queue.js';
import { resolveProjectConfig } from '../../core/config.js';
import { tp } from '../../i18n/t.js';
import { projectOwnedFiles, purgeProjectFiles } from '../services/project-files.js';
import { qcScan } from '../services/qc-scan.js';
import { planChanges } from '../services/change-plan.js';
import { framePreview } from '../services/frame-preview.js';
import { normalizeAssets } from '../../pipeline/brand-assets.js';
import { atRiskScenes } from '../../pipeline/typeset-scan.js';
import { channelFor, channelIdFor } from '../channel-scope.js';

/** List, create, read, update, versions, variants, QC, pending changes. */
function mountProjects(r) {
  // ---- projects ----
  // Summaries only (no config/metadata): the list never reads them and they were 97% of the bytes.
  r.get('/projects', (req, res) => {
    const channel = channelIdFor(req);
    let list = DB.listProjectSummaries(channel);
    const cat = req.query.category;
    if (cat === 'short') list = list.filter((p) => ['9:16', '4:5', '1:1'].includes(p.aspect_ratio));
    else if (cat === 'landscape') list = list.filter((p) => p.aspect_ratio === '16:9');
    res.json({ projects: list });
  });
  r.post('/projects', (req, res) => {
    const { topic = '', config: reqConfig = {}, clientRef = null } = req.body || {};
    const inputType = detectInputType(topic);
    // layered config: channel defaults → default preset → request overrides
    const channel = channelFor(req);
    // The agent's own reference for this request: a retry after a timeout finds the first project
    // instead of making a second one (and paying for it twice).
    const already = clientRef ? DB.projectByClientRef(channel?.id, clientRef) : null;
    if (already) return res.json({ project: already, reused: true });
    const config = resolveProjectConfig({ channel, preset: DB.defaultPresetFor(channel?.id), request: reqConfig });
    const aspectRatio = config.aspectRatio || '9:16';
    const title = (config.title || topic || 'Dự án mới').slice(0, 80) || 'Dự án mới';
    const p = DB.createProject({ title, topic, inputType, aspectRatio, config, channelId: channel?.id, clientRef });
    DB.projectDirFor(p.id);
    logger.info(tp`🆕 Đã tạo dự án (kênh ${channel?.name || 'Default'})`, { projectId: p.id });
    res.json({ project: p });
  });
  // ?scenes=lite drops the generated page from every row (the interface's list view); ?scenes=0
  // returns the project alone. The full shape stays the default — the CLI scripts read props.html.
  r.get('/projects/:id', (req, res) => {
    const p = DB.getProject(req.params.id);
    if (!p) return res.status(404).json({ error: 'not found' });
    const mode = String(req.query.scenes || 'full');
    if (mode === '0') return res.json({ project: p });
    const scenes = DB.getScenes(p.id);
    res.json({ project: p, scenes: mode === 'lite' ? scenes.map(DB.liteScene) : scenes });
  });
  // Only what the interface edits: status, video_path and the scene-gate stamp belong to the
  // pipeline (P17's approval has exactly one writer, the approve-scenes route).
  const EDITABLE = ['title', 'topic', 'aspect_ratio', 'config', 'metadata'];
  r.put('/projects/:id', (req, res) => {
    const p = DB.getProject(req.params.id);
    if (!p) return res.status(404).json({ error: 'not found' });
    const fields = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => EDITABLE.includes(k)));
    res.json({ project: DB.updateProject(p.id, fields) });
  });
  // ---- export history ----
  // Every past version of every video has always been on disk; nothing indexed it. That is the
  // difference between "I could go back if I had to" and "I dare not try anything".
  r.get('/projects/:id/versions', (req, res) => {
    try { res.json({ versions: DB.listRenders(req.params.id) }); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });

  // Go back: restore that export's config AND point the project at its file. The newer file is
  // left on disk and still listed — going back is not a deletion.
  r.post('/projects/:id/versions/:vid/restore', (req, res) => {
    try {
      const v = DB.getRender(req.params.vid);
      if (!v || v.project_id !== req.params.id) return res.status(404).json({ error: 'not found' });
      if (!v.path || !existsSync(v.path)) return res.status(400).json({ error: 'file của phiên bản này không còn trên đĩa' });
      DB.updateProject(req.params.id, { config: v.config, video_path: v.path, thumb_path: v.thumb || null });
      res.json({ ok: true, version: v });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // A second deliverable from the same clips — no logo, no music, different music. Because
  // every one of those lives in the concat, a variant costs one join and nothing else.
  r.post('/projects/:id/export-variant', async (req, res) => {
    try {
      const p = DB.getProject(req.params.id);
      if (!p) return res.status(404).json({ error: 'not found' });
      const name = String(req.body?.name || 'Bản khác').slice(0, 60);
      const overrides = req.body?.config || {};
      const md = p.metadata || {};
      const variants = [...(md.variants || []).filter((v) => v.name !== name), { name, config: overrides, at: Date.now() }];
      DB.updateProject(p.id, { metadata: { ...md, variants } });
      // run it with the overrides layered on, WITHOUT saving them as the project's config —
      // a variant is a second output, not a change of mind
      Pipeline.renderProject(p.id, { mode: 'concat', configOverrides: overrides, variantName: name })
        .catch((e) => logger.error(e.message, { projectId: p.id }));
      res.json({ ok: true, name, variants });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // Read the finished project back and report what a human would not catch — above all whether
  // the clip on disk still matches the design in the database. It reports; it never edits.
  r.get('/projects/:id/qc-scan', async (req, res) => {
    try {
      res.json(qcScan(req.params.id));
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // What would this edit cost? The fingerprints have always known which scenes a config change
  // invalidates; nobody asked them before the owner committed. Changing a subtitle font either
  // took a minute or an hour and the only way to find out was to start it.
  r.post('/projects/:id/plan-changes', async (req, res) => {
    try {
      res.json(planChanges(req.params.id, req.body?.config || {}));
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // Save the config and run exactly the work the plan named — no more.
  r.post('/projects/:id/apply-changes', async (req, res) => {
    try {
      const p = DB.getProject(req.params.id);
      if (!p) return res.status(404).json({ error: 'not found' });
      const plan = planChanges(p.id, req.body?.config || {});
      if (!plan.items.length) return res.json({ ok: true, plan, started: false });
      DB.updateProject(p.id, { config: { ...(p.config || {}), ...(req.body?.config || {}) } });
      // 'all' rather than a scene subset when clips are stale: renderOnly's subset mode skips the
      // join, and a half-applied change is worse than a slower one.
      Pipeline.renderProject(p.id, { mode: plan.mode === 'concat' ? 'concat' : 'all' })
        .catch((e) => logger.error(e.message, { projectId: p.id }));
      res.json({ ok: true, plan, started: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
}

/** Frame preview, asset copy, restart. */
function mountProjectEdits(r) {
  // One real frame with the pending logo / subtitle settings applied through the REAL final
  // pipeline. About a second, against fifteen minutes of re-concatenating to find out a badge
  // was four pixels too high.
  r.get('/projects/:id/frame-preview', async (req, res) => {
    try {
      let overrides = {};
      if (req.query.cfg) {
        try { overrides = JSON.parse(String(req.query.cfg)); } catch { overrides = {}; }
      }
      const { buffer, t, note } = await framePreview(req.params.id, { t: +req.query.t || 1.5, overrides });
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Preview-At', String(t));
      if (note) res.setHeader('X-Preview-Note', encodeURIComponent(note));
      res.send(buffer);
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // Reuse another project's assets (P42 — reference `/projects/:id/copy-assets-from/:sourceId`).
  // The files are shared by PATH, not copied: both projects then point at the same media, which
  // is what the owner means by "use the same pictures" and costs no disk.
  r.post('/projects/:id/copy-assets-from/:sourceId', async (req, res) => {
    try {
      const p = DB.getProject(req.params.id), src = DB.getProject(req.params.sourceId);
      if (!p || !src) return res.status(404).json({ error: 'not found' });
      const from = normalizeAssets(src.config?.assets).filter((a) => existsSync(a.path));
      if (!from.length) return res.status(400).json({ error: 'dự án nguồn không có asset nào còn trên đĩa' });
      const have = new Set(normalizeAssets(p.config?.assets).map((a) => a.path));
      const merged = [...normalizeAssets(p.config?.assets), ...from.filter((a) => !have.has(a.path))];
      DB.updateProject(p.id, { config: { ...(p.config || {}), assets: merged } });
      res.json({ ok: true, added: merged.length - have.size, total: merged.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  // Restart from scratch (P42 — reference `/projects/:id/restart`): same topic and config, all
  // generated work discarded. Deliberately a NEW project rather than an in-place wipe, so the
  // previous attempt stays on disk to compare against and nothing is destroyed by one click.
  r.post('/projects/:id/restart', async (req, res) => {
    try {
      const p = DB.getProject(req.params.id);
      if (!p) return res.status(404).json({ error: 'not found' });
      const cfg = { ...(p.config || {}), ...(req.body?.config || {}) };
      const fresh = DB.createProject({
        title: p.title, topic: p.topic, inputType: p.input_type,
        aspectRatio: cfg.aspectRatio || p.aspect_ratio, config: cfg, channelId: p.channel_id,
      });
      Pipeline.startProject(fresh.id).catch((e) => logger.error(`restart failed: ${e.message}`, { projectId: fresh.id }));
      res.json({ projectId: fresh.id, status: 'running' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
}

/** Footprint, typesetting repair, deletion. */
function mountProjectMaintenance(r) {
  /**
   * What disappears if this project is deleted — asked BEFORE the confirmation is shown.
   *
   * Deleting always removes the files now (owner's call), so the dialog has to name them. A
   * dialog that says "xoá dự án?" while quietly taking 4 GB of 4K clips is not a confirmation.
   */
  r.get('/projects/:id/footprint', (req, res) => {
    const p = DB.getProject(req.params.id);
    if (!p) return res.status(404).json({ error: 'not found' });
    const scenes = DB.getScenes(p.id);
    const files = projectOwnedFiles(p, scenes);
    let bytes = 0;
    for (const f of files) { try { bytes += statSync(f).size; } catch { /* already gone */ } }
    res.json({
      title: p.title, status: p.status, scenes: scenes.length,
      clips: scenes.filter((s) => s.video_path && existsSync(s.video_path)).length,
      hasVideo: !!(p.video_path && existsSync(p.video_path)),
      covers: (p.metadata?.covers || []).filter((c) => c?.path && existsSync(c.path)).length,
      dir: DB.projectDirFor(p.id), files: files.length, bytes,
    });
  });

  /**
   * Which clips of this project were typeset before the Vietnamese repair existed?
   *
   * `__fitVietnamese` fixes the page at render time and nothing re-renders on its own, so a
   * finished video keeps its broken clips until something asks for them again. The answer is
   * derived from the stored scene code, so it names the SCENES rather than condemning the video:
   * 773 of 1331 finished scenes needed the repair, and re-rendering only those is 42% less work.
   */
  r.get('/projects/:id/typeset-scan', async (req, res) => {
    const p = DB.getProject(req.params.id);
    if (!p) return res.status(404).json({ error: 'not found' });
    const scenes = DB.getScenes(p.id);
    const at = atRiskScenes(scenes);
    res.json({ title: p.title, scenes: scenes.length, atRisk: at.length, items: at });
  });

  // Re-render exactly those clips and join. `join: true` because the subset mode normally stops
  // at the clips — leaving the video on disk a mix of repaired and unrepaired ones.
  r.post('/projects/:id/repair-typeset', async (req, res) => {
    const p = DB.getProject(req.params.id);
    if (!p) return res.status(404).json({ error: 'not found' });
    if (['running', 'queued'].includes(p.status)) return res.status(409).json({ error: 'đang chạy' });
    const at = atRiskScenes(DB.getScenes(p.id));
    if (!at.length) return res.json({ ok: true, atRisk: 0, started: false });
    // `thumbnailAi: false` for THIS run only (configOverrides is never written back): finalize
    // redesigns the thumbnail and all six platform covers on every join, which on a repair means
    // paying the LLM to replace artwork the owner may already have uploaded — measured at ~$0.09
    // and 7 calls per video. Redrawing the clips must not redesign the cover.
    Pipeline.renderProject(p.id, {
      mode: 'scenes', sceneIds: at.map((x) => x.id), alsoJoin: true,
      configOverrides: { thumbnailAi: false },
    }).catch((e) => logger.error(e.message, { projectId: p.id }));
    res.json({ ok: true, atRisk: at.length, started: true });
  });

  r.delete('/projects/:id', (req, res) => {
    const p = DB.getProject(req.params.id);
    if (!p) return res.json({ ok: true, removed: 0 }); // already gone is the outcome asked for
    const removed = purgeProjectFiles(p);
    DB.deleteProject(p.id);
    logger.info(tp`🗑 Đã xoá dự án "${p.title}" — ${removed.files} file, ${(removed.bytes / 1048576).toFixed(0)} MB`, { projectId: p.id });
    res.json({ ok: true, ...removed });
  });

  r.delete('/projects', (req, res) => {
    // Consistent with the single delete: "xoá" means the files go too.
    let files = 0;
    let bytes = 0;
    for (const p of DB.listProjects(channelIdFor(req)) || []) {
      const r2 = purgeProjectFiles(p);
      files += r2.files; bytes += r2.bytes;
    }
    DB.deleteAllProjects();
    res.json({ ok: true, files, bytes });
  });
}

/** @param {import('express').Router} r */
export function mount(r) {
  mountProjects(r);
  mountProjectEdits(r);
  mountProjectMaintenance(r);
}
