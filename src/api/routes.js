// All REST routes.
import express from 'express';
import multer from 'multer';
import { existsSync, statSync, mkdirSync, unlinkSync, renameSync } from 'node:fs';
import { join, resolve, extname, basename } from 'node:path';
import * as DB from '../db/index.js';
import { hub } from '../ws/hub.js';
import { DIRS, PATHS, depStatus } from '../config/paths.js';
import { logger } from '../util/log.js';
import { detectInputType, newId, ratioToSize, wordCount } from '../util/util.js';
import { fetchLink } from '../providers/fetchlink.js';
import { imageSearch } from '../providers/imagesearch.js';
import { generateMetadata, wordsForSlot } from '../providers/llm.js';
import * as Pipeline from '../pipeline/queue.js';
import { resolveProjectConfig, maskSecrets, applyMaskedUpdate, ttsOverrideFor } from '../core/config.js';
import { estimateCost } from '../core/pricing.js';
import { resolveVoiceTarget } from '../providers/tts.js';
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
  // Persistent brand kit: save a style guide as the CHANNEL's canonical guide — every new
  // project inherits it through the config merge (resolveProjectConfig → resolveGuide).
  // normalizeGuide runs server-side, so the WCAG contrast lock is enforced at save time.
  r.post('/channels/:id/style-guide', async (req, res) => {
    const ch = DB.getChannel(req.params.id);
    if (!ch) return res.status(404).json({ error: 'not found' });
    const { normalizeGuide } = await import('../styleguide/index.js');
    const guide = normalizeGuide(req.body?.guide || {});
    const config = { ...(ch.config || {}), hyperframe: { ...(ch.config?.hyperframe || {}), guide } };
    DB.updateChannel(ch.id, { config });
    res.json({ ok: true, guide });
  });

  // Show Bible: owner-editable channel context + the anti-repeat topic ledger
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

  // ---- canonical scenes JSON export (factory format; DB is the source of truth) ----
  r.get('/projects/:id/scenes-json', async (req, res) => {
    const p = DB.getProject(req.params.id);
    if (!p) return res.status(404).json({ error: 'not found' });
    const { scenesJsonFromRows } = await import('../content/master-script.js');
    const json = scenesJsonFromRows(p, DB.getScenes(p.id));
    const name = String(p.title || 'video').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'video';
    if (req.query.download === '1') res.setHeader('Content-Disposition', `attachment; filename="${name}-scenes.json"`);
    res.json(json);
  });

  // ---- full-video SRT export (all scene cues shifted to the FINAL video timeline) ----
  // Accounts for the image-mode intro card and per-junction xfade overlaps, so exported
  // cues match the finished file instead of drifting late on long transitions videos.
  r.get('/projects/:id/srt', async (req, res) => {
    const p = DB.getProject(req.params.id);
    if (!p) return res.status(404).json({ error: 'not found' });
    const { buildSrt, shiftCues } = await import('../pipeline/srt.js');
    const cfg = p.config || {};
    const scenes = DB.getScenes(p.id);
    // clip list mirrors finalize: the script's scenes and nothing else (P31 — no cards)
    const clipCount = scenes.length;
    const TD = 0.5;
    const useXfade = cfg.transitions === true && clipCount > 1 && clipCount <= 24;
    let acc = 0;
    let ordinal = 0; // this scene's index in the clip list
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
  // Scene gate continue: the owner's EXPLICIT "scenes look good — voice + render" click.
  // Stamps scenes_approved_at (durable: a crash/auto-resume after this never re-holds) and
  // resumes the run past the gate into TTS. This is the ONLY writer of the stamp — nothing
  // automated ever sets it, so the gate can never auto-spend TTS credits.
  r.post('/projects/:id/approve-scenes', (req, res) => {
    const p = DB.getProject(req.params.id);
    if (!p) return res.status(404).json({ error: 'not found' });
    // Only a project actually holding at the gate may be approved — stamping any other
    // status would permanently disarm a gate the owner never saw.
    if (p.status !== 'scenes') return res.status(409).json({ error: 'dự án không ở bước duyệt cảnh' });
    DB.updateProject(p.id, { scenes_approved_at: Date.now() });
    Pipeline.startProject(p.id, { resume: true }).catch((e) => logger.error(e.message, { projectId: p.id }));
    res.json({ ok: true });
  });
  // Voice cost preview for the gate CTA: characters still to be synthesized + the resolved
  // provider. LarVoice bills ~1 credit/char (opaque credits — USD only for metered providers).
  r.get('/projects/:id/voice-estimate', (req, res) => {
    const p = DB.getProject(req.params.id);
    if (!p) return res.status(404).json({ error: 'not found' });
    const pending = DB.getScenes(p.id).filter((s) => !s.audio_path);
    const chars = pending.reduce((a, s) => a + String(s.voice_text || '').trim().length, 0);
    const ch = p.channel_id ? DB.getChannel(p.channel_id) : null;
    const o = ttsOverrideFor(ch, p.config);
    const s = { ...(DB.aiSettings().tts || {}), ...(o || {}) };
    const lang = (p.config?.language && p.config.language !== 'auto') ? p.config.language : 'vi';
    // the REAL synthesis resolver — the cost line must never disagree with what will be billed
    const { pid: provider } = resolveVoiceTarget(s, lang, o);
    res.json({ chars, scenes: pending.length, provider,
      credits: provider === 'larvoice' ? chars : null,
      usd: estimateCost({ kind: 'tts', provider, chars }) || null });
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

  // ---- trend autopilot + content calendar + ops dashboard ----
  // assistant preferences (trend packs, custom feeds, notify) — no secrets in this subtree
  r.get('/assistant/settings', (req, res) => res.json({ assistant: DB.getSetting('assistant', {}) || {} }));
  r.put('/assistant/settings', (req, res) => {
    const cur = DB.getSetting('assistant', {}) || {};
    const b = req.body || {};
    const next = { ...cur };
    if (Array.isArray(b.packs)) next.packs = b.packs.map(String).slice(0, 10);
    if (Array.isArray(b.feeds)) {
      next.feeds = b.feeds
        .filter((f) => f && /^https?:\/\//i.test(f.url || ''))
        .map((f) => ({ url: String(f.url).slice(0, 300), label: String(f.label || '').slice(0, 40) }))
        .slice(0, 12);
    }
    if (typeof b.notify === 'boolean') next.notify = b.notify;
    DB.setSetting('assistant', next);
    res.json({ ok: true, assistant: next });
  });
  r.post('/topics/suggest', async (req, res) => {
    try {
      const { suggestTopics } = await import('./services/topic-autopilot.js');
      const channel = DB.getChannel(DB.activeChannelId());
      const { aiSettingsFor } = await import('../core/config.js');
      // trend sources: global assistant settings, overridable per channel (config.assistant)
      const globalSrc = DB.getSetting('assistant', {}) || {};
      const chSrc = channel?.config?.assistant || {};
      const sources = { packs: chSrc.packs || globalSrc.packs || [], feeds: chSrc.feeds || globalSrc.feeds || [] };
      res.json(await suggestTopics({ channelId: channel?.id, niche: String(req.body?.niche || ''), count: Math.min(12, parseInt(req.body?.count, 10) || 8), ai: aiSettingsFor(channel), sources }));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  // suggestion history + owner decisions (accept is the ONLY route that starts a pipeline,
  // and only for the explicitly clicked suggestion)
  r.get('/topics/history', (req, res) => {
    const channel = DB.getChannel(DB.activeChannelId());
    res.json({ suggestions: DB.listSuggestions({
      channelId: req.query.all ? null : channel?.id,
      status: req.query.status || null,
      q: String(req.query.q || ''),
      limit: parseInt(req.query.limit, 10) || 200,
      before: req.query.before || null,
    }) });
  });
  r.post('/topics/:id/accept', async (req, res) => {
    try {
      const { acceptSuggestion } = await import('./services/assistant.js');
      res.json({ ok: true, ...acceptSuggestion(req.params.id, { config: req.body?.config || {}, title: req.body?.title || null }) });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  r.post('/topics/:id/schedule', async (req, res) => {
    try {
      const { scheduleSuggestion } = await import('./services/assistant.js');
      res.json({ ok: true, ...scheduleSuggestion(req.params.id, { dueAt: +req.body?.dueAt, config: req.body?.config || {}, title: req.body?.title || null }) });
    } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
  });
  r.post('/topics/:id/dismiss', (req, res) => res.json({ ok: DB.setSuggestionStatus(req.params.id, 'dismissed') > 0 }));
  r.post('/topics/:id/restore', (req, res) => res.json({ ok: DB.setSuggestionStatus(req.params.id, 'suggested') > 0 }));
  // mini-series: LLM designs N connected episodes → persisted as pending suggestions (data only)
  r.post('/topics/series', async (req, res) => {
    try {
      const { buildSeries } = await import('./services/assistant.js');
      const channel = DB.getChannel(DB.activeChannelId());
      const { aiSettingsFor } = await import('../core/config.js');
      res.json({ ok: true, ...(await buildSeries({
        suggestionId: req.body?.suggestionId || null,
        seed: req.body?.seed || '',
        episodes: req.body?.episodes,
        ai: aiSettingsFor(channel),
      })) });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  r.get('/calendar', (req, res) => res.json({ slots: DB.listSlots() }));
  r.post('/calendar', (req, res) => {
    try {
      const channel = DB.getChannel(DB.activeChannelId());
      res.json({ slot: DB.addSlot({ channelId: channel?.id || null, topic: req.body?.topic, config: req.body?.config || {}, dueAt: +req.body?.dueAt }) });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  r.delete('/calendar/:id', (req, res) => {
    const ok = DB.cancelSlot(req.params.id) > 0;
    if (ok) { try { DB.restoreSuggestionBySlot(req.params.id); } catch { /* linkage is best-effort */ } }
    res.json({ ok });
  });
  r.put('/calendar/:id', (req, res) => {
    try {
      const fields = {};
      if (req.body?.config !== undefined) fields.config = req.body.config;
      if (req.body?.dueAt !== undefined) fields.dueAt = +req.body.dueAt;
      res.json({ ok: DB.updateSlot(req.params.id, fields) > 0 });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  // recurring planning templates — inert windows; they never create projects by themselves
  r.get('/calendar/recurrences', (req, res) => {
    res.json({ recurrences: DB.listRecurrences(DB.activeChannelId()) });
  });
  r.post('/calendar/recurrences', (req, res) => {
    try {
      res.json({ recurrence: DB.addRecurrence({
        channelId: DB.activeChannelId(),
        weekday: req.body?.weekday, time: req.body?.time, config: req.body?.config || {},
      }) });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  r.delete('/calendar/recurrences/:id', (req, res) => res.json({ ok: DB.deleteRecurrence(req.params.id) > 0 }));
  // plan-my-week: fill the coming days with pending suggestions — SLOTS only, owner-confirmed
  r.post('/calendar/plan', async (req, res) => {
    try {
      const { planWeek } = await import('./services/assistant.js');
      const b = req.body || {};
      res.json({ ok: true, ...planWeek({
        days: Math.min(31, parseInt(b.days, 10) || 7),
        perDay: Math.min(5, parseInt(b.perDay, 10) || 1),
        times: Array.isArray(b.times) && b.times.length ? b.times.map(String) : ['08:00'],
        config: b.config || {},
        topicIds: Array.isArray(b.topicIds) && b.topicIds.length ? b.topicIds : null,
      }) });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  r.get('/dashboard', (req, res) => {
    const projects = DB.listProjects();
    const byStatus = projects.reduce((a, p) => { a[p.status] = (a[p.status] || 0) + 1; return a; }, {});
    // 7-day production pulse (local-midnight buckets, oldest first)
    const now = new Date();
    const day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6).getTime();
    const bucket = (ts) => Math.min(6, Math.max(0, Math.floor((ts - day0) / 864e5)));
    const week = { createdByDay: Array(7).fill(0), doneByDay: Array(7).fill(0) };
    for (const p of projects) {
      if (p.created_at >= day0) week.createdByDay[bucket(p.created_at)]++;
      if (p.status === 'done' && p.updated_at >= day0) week.doneByDay[bucket(p.updated_at)]++;
    }
    // 30-day suggestion funnel — how many assistant ideas became videos
    const since30 = Date.now() - 30 * 864e5;
    const funnel = { suggested: 0, accepted: 0, scheduled: 0, dismissed: 0 };
    for (const s of DB.listSuggestions({ limit: 500 })) {
      if (s.created_at >= since30 && funnel[s.status] !== undefined) funnel[s.status]++;
    }
    const upcoming = DB.listSlots({ includeDone: false }).slice(0, 5);
    res.json({
      projects: { total: projects.length, byStatus },
      jobs: DB.listJobs({ limit: 20 }),
      usage: DB.usageSummary({ limit: 10 }),
      calendar: DB.listSlots({ includeDone: false }).slice(0, 10),
      week, funnel, upcoming,
    });
  });

  // ---- publisher (B9 scaffold): OAuth loopback + manual publish (staging default) ----
  r.get('/publish/status', async (req, res) => {
    const { publisherStatus } = await import('../publish/index.js');
    res.json({ platforms: publisherStatus() });
  });
  r.post('/publish/youtube/auth-url', async (req, res) => {
    try {
      const { getPublisher } = await import('../publish/index.js');
      const redirectUri = `${req.protocol}://${req.get('host')}/api/publish/youtube/callback`;
      res.json({ url: getPublisher('youtube').authUrl({ clientId: req.body?.clientId, clientSecret: req.body?.clientSecret, redirectUri }) });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  r.get('/publish/youtube/callback', async (req, res) => {
    try {
      const { getPublisher } = await import('../publish/index.js');
      const redirectUri = `${req.protocol}://${req.get('host')}/api/publish/youtube/callback`;
      await getPublisher('youtube').exchangeCode(String(req.query.code || ''), redirectUri);
      res.send('<meta charset="utf-8"><body style="font-family:sans-serif;background:#0b1020;color:#eaf2ff;display:grid;place-items:center;height:100vh"><div>✅ Đã kết nối YouTube — bạn có thể đóng tab này.</div></body>');
    } catch (e) { res.status(400).send(`OAuth lỗi: ${e.message}`); }
  });
  // Manual publish — an EXPLICIT user action; privacy defaults to 'private' (staging)
  r.post('/projects/:id/publish', async (req, res) => {
    try {
      const p = DB.getProject(req.params.id);
      if (!p) return res.status(404).json({ error: 'not found' });
      if (!p.video_path || !existsSync(p.video_path)) return res.status(400).json({ error: 'video chưa render xong' });
      const { getPublisher } = await import('../publish/index.js');
      const pub = getPublisher(req.body?.platform || 'youtube');
      if (!pub.connected()) return res.status(400).json({ error: 'chưa kết nối OAuth — vào Cài đặt → Đăng video' });
      const privacy = ['private', 'unlisted', 'public'].includes(req.body?.privacy) ? req.body.privacy : 'private';
      const md = p.metadata || {};
      const recId = DB.recordPublish({ projectId: p.id, platform: pub.id, privacy });
      const out = await pub.upload({
        videoPath: p.video_path, title: md.title || p.title, description: md.description || '',
        tags: (md.platforms?.youtube?.tags || md.hashtags || []).map((t) => String(t).replace(/^#/, '')),
        privacy, thumbPath: p.thumb_path && existsSync(p.thumb_path) ? p.thumb_path : null,
      });
      DB.settlePublish(recId, { status: 'done', videoId: out.videoId, url: out.url });
      res.json({ ok: true, ...out });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  r.get('/projects/:id/publishes', (req, res) => res.json({ publishes: DB.listPublishes(req.params.id) }));

  // ---- multi-aspect repurposing (16:9 <-> 9:16, no crop — full reflow re-render) ----
  // one-click platform exports (fast remux / confirmed fade-trim; aspect mismatch →
  // the caller runs the existing repurpose flow)
  r.get('/export/presets', async (req, res) => {
    const { EXPORT_PRESETS } = await import('../pipeline/export-presets.js');
    res.json({ presets: Object.entries(EXPORT_PRESETS).map(([id, p]) => ({ id, ...p })) });
  });
  r.post('/projects/:id/export', async (req, res) => {
    try {
      const { exportForPlatform } = await import('../pipeline/export-presets.js');
      res.json(await exportForPlatform(req.params.id, req.body?.preset, { allowTrim: !!req.body?.allowTrim }));
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  r.post('/projects/:id/repurpose', async (req, res) => {
    try {
      const { repurposeProject } = await import('../pipeline/repurpose.js');
      const out = await repurposeProject(req.params.id, { aspectRatio: req.body?.aspectRatio });
      // start the derived render as a resume run: voice/captions are already attached,
      // so only visuals-for-dropped-scenes + the full re-render actually execute
      Pipeline.startProject(out.project.id, { resume: true }).catch((e) => logger.error(e.message, { projectId: out.project.id }));
      res.json(out);
    } catch (e) { res.status(400).json({ error: e.message }); }
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
      const { previewSceneFrame } = await import('../animation/index.js');
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
      const { createHash } = await import('node:crypto');
      const dir = join(DB.projectDirFor(p.id), 'contact');
      mkdirSync(dir, { recursive: true });
      const sig = createHash('md5').update(JSON.stringify(scenes.map((s) =>
        [s.id, s.video_path || '', s.status, s.duration, s.template || '']))).digest('hex').slice(0, 10);
      const out = join(dir, `sheet-${sig}.jpg`);
      if (!existsSync(out) || req.query.fresh) {
        const { ffmpeg } = await import('../media/ffmpeg.js');
        const { previewSceneFrame } = await import('../animation/index.js');
        for (let i = 0; i < scenes.length; i++) {
          const sc = scenes[i];
          const frame = join(dir, `f-${String(i).padStart(3, '0')}.jpg`);
          const mid = Math.max(0.4, (sc.duration || 6) / 2);
          if (sc.video_path && existsSync(sc.video_path)) {
            await ffmpeg(['-ss', String(mid), '-i', sc.video_path, '-frames:v', '1', '-q:v', '4', frame]);
          } else {
            await previewSceneFrame(sc, p, p.config || {}, { outPath: frame, t: mid });
          }
        }
        const cols = scenes.length <= 4 ? 2 : scenes.length <= 9 ? 3 : 4;
        // tile pads any short final row with the background color, so cols×rows never has to
        // match the scene count exactly
        await ffmpeg(['-framerate', '1', '-i', join(dir, 'f-%03d.jpg'), '-vf',
          `scale=480:-2,tile=${cols}x${Math.ceil(scenes.length / cols)}:padding=6:color=0x0B0B12`,
          '-frames:v', '1', '-q:v', '4', out]);
      }
      res.sendFile(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Scene Studio: the scene's EFFECTIVE template source for the direct-HTML editor
  r.get('/scenes/:id/template-source', async (req, res) => {
    try {
      const sc = DB.getScene(req.params.id);
      if (!sc) return res.status(404).json({ error: 'not found' });
      const p = DB.getProject(sc.project_id);
      const { sceneTemplateSource } = await import('../animation/index.js');
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
      const { previewSceneFrame } = await import('../animation/index.js');
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
      const { editSceneByPrompt } = await import('./services/edit-scene.js');
      const r2 = await editSceneByPrompt(req.params.id, req.body?.prompt);
      if (!r2.ok) return res.status(422).json(r2);
      const sc = DB.getScene(req.params.id);
      const p = DB.getProject(sc.project_id);
      const { previewSceneFrame } = await import('../animation/index.js');
      const out = join(DB.projectDirFor(p.id), 'render', `scene_${String(sc.idx).padStart(3, '0')}_preview.jpg`);
      try {
        await previewSceneFrame(sc, p, p.config || {}, { outPath: out });
        DB.updateScene(sc.id, { image_path: out });
      } catch { /* preview is best-effort — the edit itself is already persisted */ }
      hub.toProject(p.id, { type: 'scene', sceneId: sc.id, idx: sc.idx, status: 'html', image: `/api/file?path=${encodeURIComponent(out)}` });
      res.json({ ...r2, image: `/api/file?path=${encodeURIComponent(out)}` });
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
    // Cue-schema validation (P11): srt_json feeds karaoke AND hyperframe beat extraction —
    // a malformed edit must be rejected here, never persisted.
    if ('srt_json' in body && body.srt_json != null) {
      const cues = body.srt_json;
      const ok = Array.isArray(cues) && cues.every((c) => c && Number.isFinite(+c.start) && Number.isFinite(+c.end)
        && +c.end > +c.start && typeof c.text === 'string'
        && Array.isArray(c.words) && c.words.every((w) => w && Number.isFinite(+w.start) && Number.isFinite(+w.end) && typeof w.word === 'string'));
      if (!ok) return res.status(400).json({ error: 'srt_json sai cấu trúc cue ({start,end,text,words[]})' });
    }
    const changed = (k) => k in body && JSON.stringify(body[k]) !== JSON.stringify(before[k]);
    // props.audio (per-scene SFX) is mixed at the CONCAT stage, never baked into the clip —
    // an audio-only props edit must not stale the rendered clip
    const strip = (pr) => { const { audio, ...rest } = pr || {}; return rest; };
    const visualPropsChanged = changed('props')
      && JSON.stringify(strip(body.props)) !== JSON.stringify(strip(before.props));
    if (changed('voice_text')) {
      // new narration → old audio, captions and clip are all stale
      body.audio_path = null; body.srt_json = null; body.srt_path = null; body.video_path = null;
      body.fp = { ...(before.fp || {}), tts: null, render: null };
    } else if (changed('visual_prompt') || changed('template') || visualPropsChanged || changed('srt_json')) {
      body.video_path = null; // visuals/captions changed → clip is stale (audio still good)
      body.fp = { ...(before.fp || {}), render: null, ...(changed('visual_prompt') ? { img: null } : {}) };
    }
    res.json({ scene: DB.updateScene(req.params.id, body) });
  });
  // ---- timeline waveform lane (read-only; peaks are numbers, not file contents) ----
  r.get('/scenes/:id/waveform', async (req, res) => {
    try {
      const sc = DB.getScene(req.params.id);
      if (!sc) return res.status(404).json({ error: 'not found' });
      if (!sc.audio_path || !existsSync(sc.audio_path)) return res.json({ peaks: [], duration: sc.duration || 0 });
      const { audioPeaks } = await import('../media/waveform.js');
      res.json(await audioPeaks(sc.audio_path, { buckets: Math.min(1000, parseInt(req.query.buckets, 10) || 240) }));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ---- multi-take history ----
  r.get('/scenes/:id/takes', (req, res) => {
    if (!DB.getScene(req.params.id)) return res.status(404).json({ error: 'not found' });
    res.json({ takes: DB.listTakes(req.params.id, req.query.kind || null) });
  });
  r.post('/takes/:id/activate', (req, res) => {
    try {
      const scene = DB.activateTake(req.params.id);
      hub.toProject(scene.project_id, { type: 'scene', sceneId: scene.id, idx: scene.idx, status: scene.status });
      res.json({ scene });
    } catch (e) { res.status(404).json({ error: e.message }); }
  });

  // Re-time the captions to the CURRENT script text on the EXISTING audio (align engine —
  // no re-synthesis, no cost). Used by the subtitle studio's "resync" action.
  r.post('/scenes/:id/resync-subs', async (req, res) => {
    try {
      const sc = DB.getScene(req.params.id);
      if (!sc) return res.status(404).json({ error: 'not found' });
      if (!sc.audio_path || !existsSync(sc.audio_path)) return res.status(400).json({ error: 'cảnh chưa có audio' });
      const p = DB.getProject(sc.project_id);
      const { buildSubtitles } = await import('../providers/subtitle.js');
      const channel = DB.channelOf(p.id);
      const { aiSettingsFor } = await import('../core/config.js');
      const lang = (p.config || {}).language;
      const padMs = /[ạảãàáâậầấẩẫăắằẳẵặđ]/i.test(sc.voice_text || '') ? 650 : 400;
      const speechDur = Math.max(0.3, (sc.duration || 0) - padMs / 1000);
      const sub = await buildSubtitles(sc.audio_path, sc.voice_text || '', speechDur, { language: lang, engine: aiSettingsFor(channel).subtitle?.engine });
      const scene = DB.updateScene(sc.id, { srt_json: sub.cues, video_path: null }); // captions changed → clip stale
      res.json({ scene });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ---- per-scene review gate (rough-cut player chips) ----
  r.post('/scenes/:id/review', (req, res) => {
    const sc = DB.getScene(req.params.id);
    if (!sc) return res.status(404).json({ error: 'not found' });
    try {
      const review = DB.setSceneReview(sc.id, sc.project_id, { status: req.body?.status, note: req.body?.note });
      hub.toProject(sc.project_id, { type: 'review', sceneId: sc.id, idx: sc.idx, status: review.status });
      res.json({ review });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  r.get('/projects/:id/reviews', (req, res) => res.json({ reviews: DB.listReviews(req.params.id) }));

  // Awaited on purpose: callers (Scene Studio, grid buttons) treat the response as "the
  // new take is ready" — fire-and-forget here made the UI lie and let an immediate
  // per-scene render race the still-running regen (clip then re-nulled moments later).
  r.post('/scenes/:id/regen-voice', async (req, res) => {
    try {
      await Pipeline.regenScene(req.params.id, 'voice');
      res.json({ ok: true, scene: DB.getScene(req.params.id) });
    } catch (e) { logger.error(e.message); res.status(500).json({ error: e.message }); }
  });
  r.post('/scenes/:id/regen-html', async (req, res) => {
    try {
      await Pipeline.regenScene(req.params.id, 'html');
      res.json({ ok: true, scene: DB.getScene(req.params.id) });
    } catch (e) { logger.error(e.message); res.status(500).json({ error: e.message }); }
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
    // unknown kind would join(undefined) → raw 500 with a stack trace; refuse cleanly
    if (!['brand', 'bgm', 'sfx', 'font'].includes(kind)) {
      for (const f of req.files || []) { try { unlinkSync(f.path); } catch { /* temp cleanup */ } }
      return res.status(400).json({ error: `loại thư viện không hỗ trợ: ${kind}` });
    }
    if (kind === 'font') {
      const badFile = (req.files || []).find((f) => !/\.(ttf|otf|woff2?)$/i.test(f.originalname));
      if (badFile) {
        for (const f of req.files || []) { try { unlinkSync(f.path); } catch { /* temp cleanup */ } }
        return res.status(400).json({ error: `font chỉ nhận .ttf/.otf/.woff/.woff2 — "${badFile.originalname}" không hợp lệ` });
      }
    }
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

  // Template gallery: a LIVE self-playing demo page per template (same harness the renderer
  // uses). Superset demo props feed every template; the page auto-loops via rAF over __seek.
  r.get('/templates/:id/preview-html', async (req, res) => {
    try {
      const { buildSceneHtml } = await import('../animation/index.js');
      const ar = ['9:16', '16:9', '1:1', '4:5'].includes(req.query.ar) ? req.query.ar : '9:16';
      const demoProps = {
        heading: 'Tăng trưởng kênh', sub: 'Mỗi ngày một video tốt hơn', label: 'DEMO', hud: 'DEMO',
        text: 'Nội dung minh hoạ cho template', keyword: 'BỨT PHÁ', keywords: ['TỐC ĐỘ', 'CHẤT LƯỢNG'],
        value: 87, number: 87, unit: '%',
        items: ['Ý tưởng', 'Kịch bản', 'Render'], steps: ['Chuẩn bị', 'Sản xuất', 'Xuất bản'],
        left: { title: 'Trước', items: ['Chậm', 'Thủ công'] }, right: { title: 'Sau', items: ['Nhanh', 'Tự động'] },
        messages: [{ from: 'user', text: 'Video mới đâu?' }, { from: 'bot', text: 'Đang render! 🎬' }],
        criteria: [{ name: 'Tốc độ', score: 9 }, { name: 'Chất lượng', score: 8 }],
        bars: [{ label: 'Trước', value: 40 }, { label: 'Sau', value: 90 }],
        lines: ['$ avs render', '▸ scene 1/3…', '✓ done in 27s'], title: 'Chương mới',
        nodes: ['Video', 'Ý tưởng', 'Âm thanh', 'Hình ảnh'],
      };
      const scene = { idx: 2, voice_text: 'Nội dung minh hoạ', srt_json: [], template: req.params.id, props: demoProps, duration: 6 };
      let html = buildSceneHtml(scene, { aspect_ratio: ar, title: 'Template demo' },
        { visualMode: 'animation', theme: 'neon-tech', enableSubtitles: false }, { durationOverride: 6 });
      html = html.replace('</body>', `<script>addEventListener('load',async()=>{try{await __init();
        const t0=performance.now();(function loop(){__seek(((performance.now()-t0)/1000)%6);requestAnimationFrame(loop)})()}catch(e){}})<\/script></body>`);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } catch (e) { res.status(500).send(e.message); }
  });

  // Brand fonts: every family the owner can pick (vendored Vietnamese-safe set + uploads)
  r.get('/fonts/families', async (req, res) => {
    try {
      const { fontFamilies } = await import('../animation/userfonts.js');
      res.json(fontFamilies());
    } catch (e) { res.status(500).json({ error: e.message }); }
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

  // ---- brand gen (P27 — reference-app clone; prompts verbatim, ×10 no-fallback) ----
  r.get('/brands', (req, res) => res.json({ brands: DB.brandFolders() }));
  r.post('/brands', async (req, res) => {
    try {
      const { createBrand } = await import('./services/brand-gen.js');
      res.json(createBrand(req.body?.name));
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  r.post('/brandgen/emotions', async (req, res) => {
    try {
      const { generateEmotions } = await import('./services/brand-gen.js');
      res.json({ ok: true, ...(await generateEmotions(req.body || {})) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  r.post('/brandgen/generate', upload.single('image'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'Thiếu ảnh tham chiếu' });
      const { generateBrandAsset } = await import('./services/brand-gen.js');
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
      const { copyToBrand } = await import('./services/brand-gen.js');
      res.json(copyToBrand(req.body || {}));
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  // provider list mutations live server-side: a masked-key array round-trip via PUT
  // /settings would clobber real keys (arrays replace wholesale in applyMaskedUpdate)
  r.post('/brandgen/providers', async (req, res) => {
    try {
      const { addEditProvider } = await import('./services/brand-gen.js');
      res.json(addEditProvider(req.body || {}));
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  r.delete('/brandgen/providers/:id', async (req, res) => {
    try {
      const { removeEditProvider } = await import('./services/brand-gen.js');
      res.json(removeEditProvider(req.params.id));
    } catch (e) { res.status(400).json({ error: e.message }); }
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
    const { videoDuration = 60, sceneDuration = 7, language } = req.body || {};
    const scenes = Math.max(1, Math.round(videoDuration / sceneDuration));
    // same formula the script generator budgets with — the UI estimate must never disagree
    const wordsPerScene = wordsForSlot(sceneDuration, (language && language !== 'auto') ? language : 'vi');
    res.json({ scenes, wordsPerScene, size: ratioToSize(req.body.aspectRatio || '9:16') });
  });

  app.use('/api', r);
}
