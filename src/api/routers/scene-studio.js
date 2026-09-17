// HyperFrame style presets and the scene studio: live preview page, preview frame, contact sheet, custom HTML and AI edits.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import * as DB from '../../db/index.js';
import { hub } from '../../ws/hub.js';
import { buildContactSheet } from '../services/contact-sheet.js';

/** @param {import('express').Router} r */
export function mount(r) {
  // ---- HyperFrame: style presets + AI-designed style guide ----
  r.get('/hyperframe/presets', async (req, res) => {
    const { HF_PRESETS } = await import('../../styleguide/index.js');
    res.json({ presets: HF_PRESETS });
  });
  r.post('/hyperframe/styleguide', async (req, res) => {
    try {
      const { generateStyleGuide } = await import('../../styleguide/index.js');
      const { aiSettingsFor } = await import('../../core/config.js');
      const ai = aiSettingsFor(DB.getChannel(DB.activeChannelId()));
      const out = await generateStyleGuide({
        topic: req.body?.topic || '', describe: req.body?.describe || '', llm: ai?.llm || null,
      });
      res.json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  // live animation preview (plays in an <iframe> with real motion + audio)
  r.get('/scenes/:id/anim-html', async (req, res) => {
    try {
      const sc = DB.getScene(req.params.id);
      if (!sc) return res.status(404).send('not found');
      const p = DB.getProject(sc.project_id);
      const { buildSceneHtml } = await import('../../animation/index.js');
      const audioUrl = sc.audio_path && existsSync(sc.audio_path)
        ? `/api/file?path=${encodeURIComponent(sc.audio_path)}` : null;
      // ?live=0: the rough-cut player drives __init/__seek itself — no tap-to-play overlay
      const html = buildSceneHtml(sc, p, p.config || {}, {
        live: req.query.live !== '0', liveAudioUrl: req.query.live !== '0' ? audioUrl : null,
        progressStart: 0, progressTotal: Math.max(1, sc.duration || 6),
        durationOverride: Math.max(1.5, sc.duration || 6),
      });
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } catch (e) { res.status(500).send(e.message); }
  });

  r.post('/scenes/:id/preview-frame', async (req, res) => {
    try {
      const sc = DB.getScene(req.params.id);
      if (!sc) return res.status(404).json({ error: 'not found' });
      const p = DB.getProject(sc.project_id);
      const { previewSceneFrame } = await import('../../animation/index.js');
      const out = join(DB.projectDirFor(p.id), 'render', `scene_${String(sc.idx).padStart(3, '0')}_preview.jpg`);
      await previewSceneFrame(sc, p, p.config || {}, { outPath: out });
      DB.updateScene(sc.id, { image_path: out });
      res.json({ image: `/api/file?path=${encodeURIComponent(out)}` });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // 📸 Contact sheet — the mid-frame of every scene tiled into one JPEG: approve the whole
  // storyboard at a glance at the scene gate, or eyeball the final render. Rendered clips
  // contribute their REAL frame; unrendered scenes render a live preview frame. Cached by a
  // scene-set signature (?fresh=1 forces a rebuild).
  r.get('/projects/:id/contact-sheet', async (req, res) => {
    try {
      const p = DB.getProject(req.params.id);
      if (!p) return res.status(404).json({ error: 'not found' });
      const scenes = DB.getScenes(p.id).filter((s) => s.template || s.image_path || s.video_path);
      if (!scenes.length) return res.status(400).json({ error: 'chưa có cảnh nào để chụp' });
      res.sendFile(await buildContactSheet(p, scenes, { fresh: !!req.query.fresh }));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Scene Studio: the scene's EFFECTIVE template source for the direct-HTML editor
  r.get('/scenes/:id/template-source', async (req, res) => {
    try {
      const sc = DB.getScene(req.params.id);
      if (!sc) return res.status(404).json({ error: 'not found' });
      const p = DB.getProject(sc.project_id);
      const { sceneTemplateSource } = await import('../../animation/index.js');
      res.json(sceneTemplateSource(sc, p, p.config || {}));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  // Scene Studio: apply (or reset) a direct edit of the scene's markup. Snapshots a take
  // first, invalidates the clip, refreshes the poster — chrome (captions/brand) untouched.
  r.post('/scenes/:id/custom-html', async (req, res) => {
    try {
      const sc = DB.getScene(req.params.id);
      if (!sc) return res.status(404).json({ error: 'not found' });
      const p = DB.getProject(sc.project_id);
      try { DB.snapshotTake(sc, 'visual'); } catch { /* history is best-effort */ }
      const props = { ...(sc.props || {}) };
      if (req.body?.reset) {
        delete props.__custom;
      } else {
        const html = typeof req.body?.html === 'string' ? req.body.html : null;
        if (html == null || !html.trim()) return res.status(400).json({ error: 'thiếu nội dung HTML' });
        props.__custom = { html, ...(typeof req.body?.css === 'string' && req.body.css.trim() ? { css: req.body.css } : {}) };
      }
      DB.updateScene(sc.id, { props, status: 'html', video_path: null, fp: { ...(sc.fp || {}), render: null } });
      const { previewSceneFrame } = await import('../../animation/index.js');
      const out = join(DB.projectDirFor(p.id), 'render', `scene_${String(sc.idx).padStart(3, '0')}_preview.jpg`);
      await previewSceneFrame(DB.getScene(sc.id), p, p.config || {}, { outPath: out });
      DB.updateScene(sc.id, { image_path: out });
      DB.snapshotTake(DB.getScene(sc.id), 'visual', { active: true });
      hub.toProject(p.id, { type: 'scene', sceneId: sc.id, idx: sc.idx, status: 'html', image: `/api/file?path=${encodeURIComponent(out)}` });
      res.json({ ok: true, hasCustom: !req.body?.reset, image: `/api/file?path=${encodeURIComponent(out)}` });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Edit-by-prompt (reference-app parity): a plain instruction rewrites the scene's current
  // effective source via ONE LLM call; the result passes the same lint/render gates as fresh
  // codegen, snapshots a take, and invalidates the clip. Bad edits are rejected with defects.
  r.post('/scenes/:id/edit-html', async (req, res) => {
    try {
      const { editSceneByPrompt } = await import('../../services/edit-scene.js');
      const r2 = await editSceneByPrompt(req.params.id, req.body?.prompt);
      if (!r2.ok) return res.status(422).json(r2);
      const sc = DB.getScene(req.params.id);
      const p = DB.getProject(sc.project_id);
      const { previewSceneFrame } = await import('../../animation/index.js');
      const out = join(DB.projectDirFor(p.id), 'render', `scene_${String(sc.idx).padStart(3, '0')}_preview.jpg`);
      try {
        await previewSceneFrame(sc, p, p.config || {}, { outPath: out });
        DB.updateScene(sc.id, { image_path: out });
      } catch { /* preview is best-effort — the edit itself is already persisted */ }
      hub.toProject(p.id, { type: 'scene', sceneId: sc.id, idx: sc.idx, status: 'html', image: `/api/file?path=${encodeURIComponent(out)}` });
      res.json({ ...r2, image: `/api/file?path=${encodeURIComponent(out)}` });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
}
