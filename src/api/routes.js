// All REST routes.
import express from 'express';
import multer from 'multer';
import { existsSync, statSync, mkdirSync, unlinkSync, renameSync } from 'node:fs';
import { join, resolve, extname, basename } from 'node:path';
import * as DB from '../db/index.js';
import { DIRS, PATHS, depStatus } from '../config/paths.js';
import { logger } from '../util/log.js';
import { detectInputType, newId, ratioToSize, wordCount } from '../util/util.js';
import { fetchLink } from '../providers/fetchlink.js';
import { imageSearch } from '../providers/imagesearch.js';
import { generateMetadata } from '../providers/llm.js';
import * as Pipeline from '../pipeline/queue.js';
import { resolveProjectConfig, maskSecrets, applyMaskedUpdate } from '../core/config.js';
import { inAllowedRoots } from './services/file-access.js';
import { synthPreview } from './services/voice-preview.js';
import { startBatch } from './services/batch.js';
import { getVoiceCatalog } from './services/voice-catalog.js';

const upload = multer({ dest: DIRS.uploads, limits: { fileSize: 512 * 1024 * 1024 } });

export function mountRoutes(app, { version }) {
  const r = express.Router();

  r.get('/health', (req, res) => {
    res.json({ ok: true, version, deps: depStatus(), paths: {
      ffmpeg: PATHS.ffmpeg, whisper: !!PATHS.whisperCli, chrome: !!PATHS.chrome, say: !!PATHS.say,
    } });
  });

  // ---- settings ----
  // Secrets are masked '••' on EVERY egress (recursive — covers nested tts.providers.*.apiKey)
  // and a masked round-trip on ingest keeps the saved value. Never ship raw keys to the client.
  r.get('/settings', (req, res) => {
    res.json({ settings: maskSecrets(DB.aiSettings()) });
  });
  r.put('/settings', (req, res) => {
    const next = applyMaskedUpdate(DB.aiSettings(), req.body || {});
    DB.setSetting('ai', next);
    res.json({ ok: true });
  });

  // ---- voice catalog (normalized, cached) ----
  r.get('/voices', async (req, res) => {
    try {
      res.json(await getVoiceCatalog(req.query || {}));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ---- voice preview (synth once, cache forever) ----
  r.post('/voices/preview', async (req, res) => {
    try {
      res.json(await synthPreview(req.body || {}));
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // ---- subtitle preset catalog for the UI gallery ----
  r.get('/subtitle-presets', async (req, res) => {
    const { SUBTITLE_PRESETS } = await import('../subtitles/presets.js');
    res.json({ presets: SUBTITLE_PRESETS.map(({ id, name, fontStack, weight, activeColor, baseColor, effect, textCase, boxBg }) =>
      ({ id, name, fontStack, weight, activeColor, baseColor, effect, textCase, boxBg })) });
  });

  // ---- provider connection test (dynamic config draft from UI) ----
  r.post('/voices/test', async (req, res) => {
    try {
      const { provider: pid, cfg = {} } = req.body || {};
      const { getProvider, providerConfig } = await import('../providers/voice/index.js');
      const prov = getProvider(pid);
      // merge masked/unchanged fields from saved settings (same contract as PUT /settings)
      const saved = providerConfig(DB.aiSettings().tts, pid);
      res.json(await prov.testConnection(applyMaskedUpdate(saved, cfg)));
    } catch (e) { res.json({ ok: false, message: e.message }); }
  });

  // ---- styles ----
  r.get('/styles', (req, res) => res.json({ styles: DB.listStyles(req.query.kind || 'scene') }));
  r.post('/styles', (req, res) => res.json({ style: DB.createStyle({ ...req.body }) }));
  r.delete('/styles/:id', (req, res) => { DB.deleteStyle(req.params.id); res.json({ ok: true }); });

  // ---- channels ----
  // Secrets (per-channel AI keys) are masked on every egress and a '••' round-trip
  // on ingest keeps the saved value — same contract as /settings.
  const maskChannel = (ch) => ch && { ...ch, config: maskSecrets(ch.config || {}) };
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
  r.post('/channels/:id/activate', (req, res) => {
    DB.setActiveChannel(req.params.id);
    res.json({ ok: true, active: DB.activeChannelId() });
  });
  r.post('/channels/:id/open', async (req, res) => {
    const ch = DB.getChannel(req.params.id);
    if (!ch) return res.status(404).json({ error: 'not found' });
    const { execFile } = await import('node:child_process');
    execFile('open', [ch.root_dir], () => {});
    res.json({ ok: true });
  });
  // logo/brand asset upload → <channel root>/library/logo/
  r.post('/channels/:id/brand-logo', upload.single('file'), (req, res) => {
    try {
      const ch = DB.getChannel(req.params.id);
      if (!ch) return res.status(404).json({ error: 'not found' });
      if (!req.file) return res.status(400).json({ error: 'thiếu file' });
      const ext = (extname(req.file.originalname || '') || '.png').toLowerCase();
      if (!['.png', '.jpg', '.jpeg', '.webp', '.svg'].includes(ext)) return res.status(400).json({ error: 'chỉ nhận ảnh png/jpg/webp/svg' });
      const dir = join(ch.root_dir, 'library', 'logo');
      mkdirSync(dir, { recursive: true });
      const dest = join(dir, `${newId('logo')}${ext}`);
      renameSync(req.file.path, dest);
      res.json({ path: dest, url: `/api/file?path=${encodeURIComponent(dest)}` });
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

  // ---- projects ----
  r.get('/projects', (req, res) => {
    const channel = req.query.channel || DB.activeChannelId();
    let list = DB.listProjects(channel);
    const cat = req.query.category;
    if (cat === 'short') list = list.filter((p) => ['9:16', '4:5', '1:1'].includes(p.aspect_ratio));
    else if (cat === 'landscape') list = list.filter((p) => p.aspect_ratio === '16:9');
    res.json({ projects: list });
  });
  r.post('/projects', (req, res) => {
    const { topic = '', config: reqConfig = {} } = req.body || {};
    const inputType = detectInputType(topic);
    // layered config: channel defaults → default preset → request overrides
    const channel = DB.getChannel(DB.activeChannelId());
    const config = resolveProjectConfig({ channel, preset: DB.defaultPresetFor(channel?.id), request: reqConfig });
    const aspectRatio = config.aspectRatio || '9:16';
    const title = (config.title || topic || 'Dự án mới').slice(0, 80) || 'Dự án mới';
    const p = DB.createProject({ title, topic, inputType, aspectRatio, config, channelId: channel?.id });
    DB.projectDirFor(p.id);
    logger.info(`Project created ${p.id} (kênh ${channel?.name || 'Default'})`, { projectId: p.id });
    res.json({ project: p });
  });
  r.get('/projects/:id', (req, res) => {
    const p = DB.getProject(req.params.id);
    if (!p) return res.status(404).json({ error: 'not found' });
    res.json({ project: p, scenes: DB.getScenes(p.id) });
  });
  r.put('/projects/:id', (req, res) => {
    const p = DB.getProject(req.params.id);
    if (!p) return res.status(404).json({ error: 'not found' });
    res.json({ project: DB.updateProject(p.id, req.body || {}) });
  });
  r.delete('/projects/:id', (req, res) => { DB.deleteProject(req.params.id); res.json({ ok: true }); });
  r.delete('/projects', (req, res) => { DB.deleteAllProjects(); res.json({ ok: true }); });

  // ---- full-video SRT export (all scene cues shifted to the FINAL video timeline) ----
  // Accounts for the image-mode intro card and per-junction xfade overlaps, so exported
  // cues match the finished file instead of drifting late on long transitions videos.
  r.get('/projects/:id/srt', async (req, res) => {
    const p = DB.getProject(req.params.id);
    if (!p) return res.status(404).json({ error: 'not found' });
    const { buildSrt, shiftCues } = await import('../pipeline/srt.js');
    const cfg = p.config || {};
    const scenes = DB.getScenes(p.id);
    const visualMode = cfg.visualMode || 'animation';
    const introDur = visualMode === 'image' && cfg.intro !== false ? 2.6 : 0;
    // clip list mirrors finalize: [intro card?] scenes… (outro comes after all cues)
    const clipCount = scenes.length + (introDur ? 1 : 0)
      + (visualMode !== 'image' ? (cfg.outro !== false ? 1 : 0) : (cfg.outro !== false ? 1 : 0));
    const TD = 0.5;
    const useXfade = cfg.transitions === true && clipCount > 1 && clipCount <= 24;
    let acc = introDur; // scene 0 starts after the intro card (if any)
    let ordinal = introDur ? 1 : 0; // this scene's index in the clip list
    const all = [];
    for (const sc of scenes) {
      const d = Math.max(1.5, sc.duration || (cfg.sceneDuration || 6));
      const start = acc - (useXfade ? TD * ordinal : 0);
      if (Array.isArray(sc.srt_json)) all.push(...shiftCues(sc.srt_json, Math.max(0, start)));
      acc += d; ordinal++;
    }
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="subtitles.srt"`);
    res.send(buildSrt(all));
  });

  // ---- batch queue: multiple topics → run sequentially on their own ----
  r.post('/batch', (req, res) => {
    try {
      const { projects, count } = startBatch(req.body || {});
      res.json({ ok: true, projects, count });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // ---- pipeline control ----
  r.post('/projects/:id/start', async (req, res) => {
    const p = DB.getProject(req.params.id);
    if (!p) return res.status(404).json({ error: 'not found' });
    if (req.body && req.body.config) DB.updateProject(p.id, { config: { ...p.config, ...req.body.config } });
    Pipeline.startProject(p.id).catch((e) => logger.error(`start failed: ${e.message}`, { projectId: p.id }));
    res.json({ ok: true, status: 'running' });
  });
  r.post('/projects/:id/stop', (req, res) => { Pipeline.stopProject(req.params.id); res.json({ ok: true }); });
  r.post('/projects/:id/resume', (req, res) => {
    Pipeline.startProject(req.params.id, { resume: true }).catch((e) => logger.error(e.message, { projectId: req.params.id }));
    res.json({ ok: true });
  });
  r.post('/projects/:id/render', async (req, res) => {
    const { mode = 'all', sceneIds = [] } = req.body || {};
    Pipeline.renderProject(req.params.id, { mode, sceneIds }).catch((e) => logger.error(e.message, { projectId: req.params.id }));
    res.json({ ok: true });
  });

  // ---- self-serve diagnostics bundle (masked, P14) ----
  r.get('/projects/:id/diagnostics', async (req, res) => {
    try {
      const { buildDiagnostics } = await import('../pipeline/diagnostics.js');
      res.json(buildDiagnostics(req.params.id));
    } catch (e) { res.status(e.message === 'project not found' ? 404 : 500).json({ error: e.message }); }
  });

  // ---- usage / cost meter (estimates, labeled "ước tính") ----
  r.get('/usage', (req, res) => {
    if (req.query.projectId) return res.json({ usage: DB.usageForProject(String(req.query.projectId)) });
    res.json({ summary: DB.usageSummary({ limit: Math.min(100, parseInt(req.query.limit, 10) || 30) }) });
  });

  // ---- durable job queue (run history + cancel) ----
  r.get('/jobs', (req, res) => {
    res.json({ jobs: DB.listJobs({ limit: Math.min(200, parseInt(req.query.limit, 10) || 50) }) });
  });
  r.get('/projects/:id/jobs', (req, res) => {
    res.json({ jobs: DB.listJobs({ projectId: req.params.id, limit: 50 }) });
  });
  r.post('/jobs/:id/cancel', (req, res) => {
    const n = DB.cancelJob(req.params.id); // queued only — a running job stops via /stop
    res.json({ ok: true, cancelled: n > 0 });
  });

  // ---- animation mode ----
  r.get('/animation/templates', async (req, res) => {
    const { listTemplates } = await import('../animation/index.js');
    res.json({ templates: listTemplates() });
  });

  // ---- HyperFrame: style presets + AI-designed style guide ----
  r.get('/hyperframe/presets', async (req, res) => {
    const { HF_PRESETS } = await import('../styleguide/index.js');
    res.json({ presets: HF_PRESETS });
  });
  r.post('/hyperframe/styleguide', async (req, res) => {
    try {
      const { generateStyleGuide } = await import('../styleguide/index.js');
      const { aiSettingsFor } = await import('../core/config.js');
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
      const { buildSceneHtml } = await import('../animation/index.js');
      const audioUrl = sc.audio_path && existsSync(sc.audio_path)
        ? `/api/file?path=${encodeURIComponent(sc.audio_path)}` : null;
      const html = buildSceneHtml(sc, p, p.config || {}, {
        live: true, liveAudioUrl: audioUrl,
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
      const { previewSceneFrame } = await import('../animation/index.js');
      const out = join(DB.projectDirFor(p.id), 'render', `scene_${String(sc.idx).padStart(3, '0')}_preview.jpg`);
      await previewSceneFrame(sc, p, p.config || {}, { outPath: out });
      DB.updateScene(sc.id, { image_path: out });
      res.json({ image: `/api/file?path=${encodeURIComponent(out)}` });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ---- scenes ----
  r.put('/scenes/:id', (req, res) => {
    // Edit-aware invalidation: a USER edit through this route marks downstream artifacts
    // stale, so the next resume/render redoes exactly the touched scene (content-hash
    // resume then keeps everything else). Pipeline stages write via DB directly.
    const body = { ...(req.body || {}) };
    const before = DB.getScene(req.params.id);
    if (!before) return res.status(404).json({ error: 'not found' });
    const changed = (k) => k in body && JSON.stringify(body[k]) !== JSON.stringify(before[k]);
    if (changed('voice_text')) {
      // new narration → old audio, captions and clip are all stale
      body.audio_path = null; body.srt_json = null; body.srt_path = null; body.video_path = null;
      body.fp = { ...(before.fp || {}), tts: null, render: null };
    } else if (changed('visual_prompt') || changed('template') || changed('props') || changed('srt_json')) {
      body.video_path = null; // visuals/captions changed → clip is stale (audio still good)
      body.fp = { ...(before.fp || {}), render: null, ...(changed('visual_prompt') ? { img: null } : {}) };
    }
    res.json({ scene: DB.updateScene(req.params.id, body) });
  });
  r.post('/scenes/:id/regen-voice', (req, res) => {
    Pipeline.regenScene(req.params.id, 'voice').catch((e) => logger.error(e.message));
    res.json({ ok: true });
  });
  r.post('/scenes/:id/regen-html', (req, res) => {
    Pipeline.regenScene(req.params.id, 'html').catch((e) => logger.error(e.message));
    res.json({ ok: true });
  });

  // ---- helpers: fetch link / image search / metadata ----
  r.post('/fetch-link', async (req, res) => {
    try { res.json(await fetchLink(req.body.url)); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  r.post('/image-search', async (req, res) => {
    try { res.json(await imageSearch(req.body.query || req.body.topic, req.body.count || 6)); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  r.post('/metadata', async (req, res) => {
    try {
      const p = DB.getProject(req.body.projectId);
      const md = await generateMetadata(p, req.body.stylePrompt);
      if (p) DB.updateProject(p.id, { metadata: md });
      res.json({ metadata: md });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ---- library ----
  r.get('/library/:kind', (req, res) => {
    res.json({ items: DB.listLibrary(req.params.kind, req.query.brand), brands: DB.brandFolders() });
  });
  r.post('/library/:kind', upload.array('files'), (req, res) => {
    const kind = req.params.kind;
    const brand = req.body.brand || 'Default';
    const names = [].concat(req.body.names || []);
    const dest = kind === 'brand' ? join(DIRS.brand, brand) : DIRS[kind];
    mkdirSync(dest, { recursive: true });
    const items = (req.files || []).map((f, i) => {
      const wantName = (Array.isArray(names) ? names[i] : names) || '';
      const ext = extname(f.originalname) || '';
      const finalName = (wantName ? wantName.replace(/[^\w.\- ]/g, '') : basename(f.originalname, ext)) + ext;
      const finalPath = join(dest, `${Date.now()}_${i}_${finalName}`);
      renameSync(f.path, finalPath);
      return DB.addLibrary({ kind, brandFolder: brand, name: finalName, filename: basename(finalPath), path: finalPath, size: f.size });
    });
    res.json({ items });
  });
  r.delete('/library/:id', (req, res) => {
    const row = DB.deleteLibrary(req.params.id);
    if (row && row.path && existsSync(row.path)) { try { unlinkSync(row.path); } catch { /* ignore */ } }
    res.json({ ok: true });
  });

  // ---- generic uploads (assets/logo) ----
  r.post('/upload', upload.array('files'), (req, res) => {
    const out = (req.files || []).map((f) => {
      const ext = extname(f.originalname) || '';
      const finalPath = join(DIRS.uploads, `${newId('u')}${ext}`);
      renameSync(f.path, finalPath);
      return { name: f.originalname, path: finalPath, size: f.size };
    });
    res.json({ files: out });
  });

  // ---- brand gen ----
  r.post('/brandgen', upload.single('image'), async (req, res) => {
    try { res.json(await Pipeline.brandGen(req.body, req.file)); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ---- internal media file serving (data/ + every registered channel root; guard in services/file-access) ----
  r.get('/file', (req, res) => {
    const p = resolve(req.query.path || '');
    if (!inAllowedRoots(p)) return res.status(403).json({ error: 'forbidden' });
    if (!existsSync(p) || !statSync(p).isFile()) return res.status(404).json({ error: 'not found' });
    // NO maxAge here: previews/renders overwrite the SAME path, so the browser must
    // revalidate (etag 304 — ~1ms on loopback) or regenerated frames would show stale.
    res.sendFile(p);
  });

  // ---- edit video: quick cut ----
  r.post('/edit-cut', async (req, res) => {
    try {
      const { path: inPath, start = 0, end = 10 } = req.body || {};
      const src = resolve(inPath || '');
      if (!inAllowedRoots(src) || !existsSync(src)) return res.status(400).json({ error: 'file không hợp lệ' });
      const dur = Math.max(0.5, (+end) - (+start));
      const out = join(DIRS.uploads, `${newId('cut')}.mp4`);
      const { ffmpeg } = await import('../media/ffmpeg.js');
      await ffmpeg(['-ss', String(start), '-i', src, '-t', String(dur),
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-movflags', '+faststart', out]);
      res.json({ path: out });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // duration estimate helper used by the UI
  r.post('/estimate', (req, res) => {
    const { videoDuration = 60, sceneDuration = 7 } = req.body || {};
    const scenes = Math.max(1, Math.round(videoDuration / sceneDuration));
    const wordsPerScene = Math.round(sceneDuration * 2.6);
    res.json({ scenes, wordsPerScene, size: ratioToSize(req.body.aspectRatio || '9:16') });
  });

  app.use('/api', r);
}
