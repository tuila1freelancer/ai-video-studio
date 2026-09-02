// All REST routes.
import express from 'express';
import multer from 'multer';
import { existsSync, statSync, mkdirSync, unlinkSync, renameSync, writeFileSync, readdirSync, rmSync, copyFileSync } from 'node:fs';
import { join, resolve, extname, basename } from 'node:path';
import * as DB from '../db/index.js';
import db from '../db/index.js';
import { hub } from '../ws/hub.js';
import { DIRS, PATHS, depStatus } from '../config/paths.js';
import { logger } from '../util/log.js';
import { detectInputType, newId, ratioToSize, wordCount } from '../util/util.js';
import { fetchLink } from '../providers/fetchlink.js';
import { imageSearch } from '../providers/imagesearch.js';
import { generateMetadata, wordsForSlot, LANG_WPS } from '../providers/llm.js';
import * as Pipeline from '../pipeline/queue.js';
import { resolveProjectConfig, maskSecrets, applyMaskedUpdate, ttsOverrideFor } from '../core/config.js';
import { estimateCost } from '../core/pricing.js';
import { resolveVoiceTarget } from '../providers/tts.js';
import { inAllowedRoots } from './services/file-access.js';
import { synthPreview } from './services/voice-preview.js';
import { startBatch } from './services/batch.js';
import { getVoiceCatalog } from './services/voice-catalog.js';
import { resolveLang, declaredLang, detectLang, majorityLang, padMsFor, DEFAULT_LANG } from '../util/lang.js';
import { WEB_SAFE, toPng } from './services/image-convert.js';
import { licenseGate } from '../license/gate.js';
import { activate, publicStatus, refreshNow } from '../license/index.js';
import { adoptWithStoredSession, sessionAccount, signIn, signOut } from '../license/auth.js';
import { checkUpdate, downloadUrl } from '../license/update.js';

const upload = multer({ dest: DIRS.uploads, limits: { fileSize: 512 * 1024 * 1024 } });

/**
 * Keep `llm.accounts[preset]` in step with the provider currently in use, so switching to
 * another provider and back does not cost a trip to a dashboard for a fresh key.
 *
 * It happens HERE, after applyMaskedUpdate, because this is the only place a real key exists:
 * the panel only ever holds the masked 'ab12••' form. Two things have to be got right, and
 * both were bugs before they were code.
 *
 * 1. '••' means "keep the saved key" — but the SAVED one is whichever provider was active
 *    before this update, so resolving a masked key that way hands the newly chosen provider
 *    the previous one's key. It has to resolve against the account it was displayed from.
 * 2. The provider being left behind keeps its key only at the top level, which this update is
 *    about to overwrite. Snapshot it first or it is gone for good.
 */
export function syncLlmAccounts(prev, next, incoming) {
  const llm = next?.llm;
  if (!llm?.preset) return;
  const accounts = { ...(llm.accounts || {}) };

  // (1) the masked key on screen came from this provider's account, not from the top level
  const shown = prev?.llm?.accounts?.[llm.preset]?.apiKey;
  if (shown && typeof incoming?.apiKey === 'string' && incoming.apiKey.includes('••')) llm.apiKey = shown;
  const record = (id, from) => {
    const entry = { apiKey: from.apiKey || '', model: from.model || '', codegenModel: from.codegenModel || '' };
    // Only a custom endpoint owns its URL; every other one gets it from the catalogue, and
    // storing it back would make the entry permanently non-empty — so clearing a key could
    // then never actually forget the provider.
    if (id === 'custom') entry.baseUrl = from.baseUrl || '';
    if (entry.apiKey || entry.model || entry.baseUrl || entry.codegenModel) accounts[id] = entry;
    else delete accounts[id];
  };
  // (2) the provider being left behind, before the top level is overwritten. Skipped when the
  // panel already sent a real key for it, which means the owner edited it deliberately.
  const was = prev?.llm || {};
  if (was.preset && was.preset !== llm.preset && was.apiKey && !accounts[was.preset]?.apiKey) record(was.preset, was);
  record(llm.preset, llm);
  next.llm = { ...llm, accounts };
}

const safeJsonParse = (v) => { try { return JSON.parse(v); } catch { return null; } };

export function mountRoutes(app, { version }) {
  const r = express.Router();

  // FIRST, before any route: an unlicensed copy answers 403 everywhere except /health and
  // /license/*. Mounting it here rather than decorating routes means a route added tomorrow is
  // covered by default instead of by memory.
  r.use(licenseGate);

  r.get('/health', (req, res) => {
    res.json({ ok: true, version, deps: depStatus(), paths: {
      ffmpeg: PATHS.ffmpeg, whisper: !!PATHS.whisperCli, chrome: !!PATHS.chrome, say: !!PATHS.say,
    } });
  });

  // ---- license ----
  // Reachable while the app is locked: this is the door out of that state.
  r.get('/license/status', (req, res) => {
    res.json({ ...publicStatus(), account: sessionAccount() });
  });

  // Sign in with the store (Google) account; the licence follows automatically.
  r.post('/license/login', async (req, res) => {
    try {
      const result = await signIn();
      res.json({ ...publicStatus(), account: result.account, licenseFound: result.licenseFound });
    } catch (e) {
      res.status(e.statusCode || 500).json({ error: e.message });
    }
  });

  // Re-adopt a licence with the stored session (after an admin device reset).
  r.post('/license/relink', async (req, res) => {
    try {
      const licenseFound = await adoptWithStoredSession();
      res.json({ ...publicStatus(), account: sessionAccount(), licenseFound });
    } catch (e) {
      res.status(e.statusCode || 500).json({ error: e.message });
    }
  });

  r.post('/license/logout', (req, res) => {
    signOut();
    res.json({ ...publicStatus(), account: null });
  });

  r.post('/license/activate', async (req, res) => {
    try {
      await activate(req.body?.key);
      res.json(publicStatus());
    } catch (e) {
      res.status(e.statusCode || 500).json({ error: e.message });
    }
  });

  r.post('/license/refresh', async (req, res) => {
    try {
      await refreshNow();
      res.json(publicStatus());
    } catch (e) {
      res.status(e.statusCode || 500).json({ error: e.message });
    }
  });

  r.get('/license/update', async (req, res) => {
    try {
      res.json(await checkUpdate({ force: req.query.force === '1' }));
    } catch (e) {
      res.status(e.statusCode || 500).json({ error: e.message });
    }
  });

  r.post('/license/update/download', async (req, res) => {
    try {
      res.json(await downloadUrl({ versionId: req.body?.versionId }));
    } catch (e) {
      res.status(e.statusCode || 500).json({ error: e.message });
    }
  });

  // ---- settings ----
  // Secrets are masked '••' on EVERY egress (recursive — covers nested tts.providers.*.apiKey)
  // and a masked round-trip on ingest keeps the saved value. Never ship raw keys to the client.
  r.get('/settings', (req, res) => {
    res.json({ settings: maskSecrets(DB.aiSettings()) });
  });
  r.put('/settings', (req, res) => {
    const prev = DB.aiSettings();
    const next = applyMaskedUpdate(prev, req.body || {});
    syncLlmAccounts(prev, next, req.body?.llm);
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

  // Validate a custom OpenAI-compatible LLM endpoint before saving it (P42 — reference
  // `/test-custom-provider`). Sends the cheapest possible completion and reports what came back,
  // so a wrong base URL or a dead key surfaces here instead of mid-render.
  r.post('/llm/test', async (req, res) => {
    try {
      const { chat } = await import('../providers/llm.js');
      const { withPreset } = await import('../providers/llm-presets.js');
      const b = req.body || {};
      const saved = DB.aiSettings().llm || {};
      // Resolved through the preset BEFORE the guard: a local server ignores its key, so
      // demanding one here would refuse to test the one provider that needs no signup.
      const llm = withPreset({
        enabled: true,
        preset: b.preset || undefined,
        baseUrl: String(b.baseUrl || saved.baseUrl || '').trim(),
        // '••' is the masked round-trip value — it means "keep the saved key"
        apiKey: (!b.apiKey || String(b.apiKey).includes('••')) ? saved.apiKey : String(b.apiKey),
        model: String(b.model || saved.model || '').trim(),
      });
      if (!llm.baseUrl || !llm.apiKey) return res.status(400).json({ ok: false, message: 'thiếu Base URL hoặc API Key' });
      const t0 = Date.now();
      const reply = await chat([{ role: 'user', content: 'Reply with the single word: OK' }], { maxTokens: 8, temperature: 0, llm, timeoutMs: 30000 });
      res.json({ ok: true, model: llm.model, ms: Date.now() - t0, message: `Kết nối OK — model trả lời "${String(reply).trim().slice(0, 40)}"` });
    } catch (e) { res.status(200).json({ ok: false, message: e.message.slice(0, 220) }); }
  });

  // ---- LLM provider catalogue (ai-providers) ----
  // What the provider picker in AI Setting is built from. Unlike every other settings egress
  // in this file it is NOT masked: nothing in the catalogue ever came from the user, so there
  // is no secret to hide. Prices are decorated from core/pricing.js rather than stored in the
  // catalogue, so the number in the picker and the number in the cost meter are one table.
  r.get('/llm/providers', async (req, res) => {
    try {
      const { publicCatalog } = await import('../providers/llm-presets.js');
      const { priceFor, PRICING_VERSION } = await import('../core/pricing.js');
      res.json({ presets: publicCatalog(priceFor), pricingVersion: PRICING_VERSION });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Ask a provider what it actually serves today. Model ids drift constantly, so the catalogue
  // ships a starting point and this is the truth. It runs server-side for two reasons: the
  // browser only ever holds a masked key, and a cross-origin call from the page would be
  // refused by CORS anyway. Failure is HTTP 200 + ok:false, like /llm/test — the panel falls
  // back to the suggested list instead of showing an error.
  r.post('/llm/models', async (req, res) => {
    try {
      const { withPreset } = await import('../providers/llm-presets.js');
      const b = req.body || {};
      const saved = DB.aiSettings().llm || {};
      const llm = withPreset({
        preset: b.preset || undefined,
        baseUrl: String(b.baseUrl || saved.baseUrl || '').trim(),
        apiKey: (!b.apiKey || String(b.apiKey).includes('••')) ? saved.apiKey : String(b.apiKey),
      });
      if (!llm.baseUrl) return res.json({ ok: false, message: 'chưa có Base URL' });
      const base = llm.baseUrl.replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
      const out = await fetch(`${base}/models`, {
        headers: { Authorization: `Bearer ${llm.apiKey || 'none'}`, ...(llm.extraHeaders || {}) },
        signal: AbortSignal.timeout(15000),
      });
      if (!out.ok) return res.json({ ok: false, message: `HTTP ${out.status} — key sai, hoặc provider không cho liệt kê model` });
      const data = await out.json();
      // OpenAI answers {data:[{id}]}; a few compatible servers answer {models:[{name}]}.
      const ids = [...new Set((data?.data || data?.models || [])
        .map((m) => String(m?.id || m?.name || '').trim()).filter(Boolean))].sort();
      if (!ids.length) return res.json({ ok: false, message: 'provider không trả về model nào' });
      res.json({ ok: true, models: ids.slice(0, 400) });
    } catch (e) { res.status(200).json({ ok: false, message: e.message.slice(0, 220) }); }
  });

  // ---- local TTS server lifecycle (P40, Supertonic) ----
  // The self-hosted voice needs a process, not a key: report whether it is installed/running and
  // let the owner start or stop it from the same panel that configures the provider.
  r.get('/tts/server/status', async (req, res) => {
    try {
      const { ttsServerStatus } = await import('../media/tts-server.js');
      const cfg = (DB.aiSettings().tts?.providers?.supertonic) || {};
      res.json(await ttsServerStatus(cfg));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  r.post('/tts/server/start', async (req, res) => {
    try {
      const { ensureSupertonic, ttsServerStatus } = await import('../media/tts-server.js');
      const cfg = { ...(DB.aiSettings().tts?.providers?.supertonic || {}), ...(req.body || {}) };
      const ok = await ensureSupertonic(cfg, { restart: req.body?.restart === true });
      res.json({ ok, ...(await ttsServerStatus(cfg)) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  // Install the local voice engine from inside the app (P42 — reference `/tts/supertonic/install`).
  // It runs pip on the owner's own machine, so it is an EXPLICIT button, never automatic, and the
  // full output comes back so a failure is readable instead of mysterious.
  r.post('/tts/server/install', async (req, res) => {
    try {
      const { execFile } = await import('node:child_process');
      const py = ['python3', 'python'].find(Boolean) || 'python3';
      execFile(py, ['-m', 'pip', 'install', '--upgrade', 'supertonic'], { timeout: 600000, maxBuffer: 4 * 1024 * 1024 }, async (err, stdout, stderr) => {
        const { supertonicLauncher } = await import('../media/tts-server.js');
        const installed = !!supertonicLauncher();
        res.json({
          ok: installed && !err, installed,
          message: installed ? 'Đã cài Supertonic — bấm ▶ Khởi động' : `Cài thất bại: ${(stderr || err?.message || '').slice(-400)}`,
          log: String(stdout || '').slice(-2000),
        });
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  r.post('/tts/server/stop', async (req, res) => {
    try {
      const { stopSupertonic } = await import('../media/tts-server.js');
      res.json({ stopped: stopSupertonic(DB.aiSettings().tts?.providers?.supertonic || {}) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ---- the platform table (limits + cover sizes), so the panel and the writer agree ----
  r.get('/platforms', async (req, res) => {
    const { PLATFORMS, COVER_SIZES } = await import('../publish/platforms.js');
    res.json({ platforms: PLATFORMS, coverSizes: COVER_SIZES });
  });

  // ---- subtitle preset catalog for the UI gallery ----
  // Ten built-ins plus whatever the owner has saved. A saved one is a whole SETTINGS BUNDLE, not
  // an id the resolver knows, so it travels with its config and the panel applies it on click —
  // which is also why it works on every channel rather than belonging to one.
  r.get('/subtitle-presets', async (req, res) => {
    const { SUBTITLE_PRESETS } = await import('../subtitles/presets.js');
    const mine = DB.listStyles('subtitle').map((s) => {
      let config = {};
      try { config = JSON.parse(s.prompt || '{}'); } catch { /* a corrupt row must not empty the gallery */ }
      return {
        id: s.id, name: s.name, mine: true, config,
        fontStack: `'${config.subtitleFont || 'Be Vietnam Pro'}', sans-serif`,
        weight: config.subtitleWeight || 800,
        activeColor: config.subtitleColor || '#F7B500',
        baseColor: config.subtitleBaseColor || '#FFFFFF',
        effect: config.subtitleGlow ? 'glow' : (config.subtitleOutlineWidth ? 'outline' : 'shadow'),
        textCase: config.subtitleTextCase || 'original',
        boxBg: config.subtitleBox ? (config.subtitleBoxColor || '#0A0A10') : null,
      };
    });
    res.json({ presets: [...mine, ...SUBTITLE_PRESETS.map(({ id, name, fontStack, weight, activeColor, baseColor, effect, textCase, boxBg }) =>
      ({ id, name, fontStack, weight, activeColor, baseColor, effect, textCase, boxBg }))] });
  });

  r.post('/subtitle-presets', async (req, res) => {
    try {
      const name = String(req.body?.name || '').trim();
      if (!name) return res.status(400).json({ error: 'thiếu tên bộ mẫu' });
      const { pickSubtitleConfig } = await import('./services/subtitle-defaults.js');
      // through the same door channel defaults go through: a preset must not be able to carry a
      // setting the renderer would refuse, or it would look saved and then not apply
      const config = pickSubtitleConfig(req.body?.config || {});
      const row = DB.createStyle({ name, kind: 'subtitle', prompt: JSON.stringify(config) });
      res.json({ preset: { id: row.id, name: row.name, mine: true, config } });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  r.delete('/subtitle-presets/:id', (req, res) => {
    try { DB.deleteStyle(req.params.id); res.json({ ok: true }); } catch (e) { res.status(500).json({ error: e.message }); }
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

  // Logo presets (P42 — reference `/logo-presets*`): a named, reusable {logo file + placement}.
  // Stored as rows in the shared `styles` table (kind 'logo', payload JSON in `prompt`), the same
  // way named SEO styles work — no new table, and a preset is portable across channels.
  r.get('/logo-presets', (req, res) => {
    const presets = (DB.listStyles('logo') || []).map((row) => ({
      id: row.id, name: row.name, ...(safeJsonParse(row.prompt) || {}),
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
    const payload = row && safeJsonParse(row.prompt);
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
  // The channel's subtitle look, saved as it is edited so the next video of that channel starts
  // with it. A narrow door on purpose: the panel calls this on every change, and only subtitle
  // keys with usable values get through (services/subtitle-defaults.js).
  r.put('/channels/:id/subtitle-defaults', async (req, res) => {
    try {
      const { saveSubtitleDefaults } = await import('./services/subtitle-defaults.js');
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
  r.post('/channels/:id/brand-logo', upload.single('file'), async (req, res) => {
    try {
      const ch = DB.getChannel(req.params.id);
      if (!ch) return res.status(404).json({ error: 'not found' });
      if (!req.file) return res.status(400).json({ error: 'thiếu file' });
      const ext = (extname(req.file.originalname || '') || '.png').toLowerCase();
      const dir = join(ch.root_dir, 'library', 'logo');
      mkdirSync(dir, { recursive: true });
      // A macOS owner's logo is very often a HEIC (screenshot / iPhone photo) or a GIF, and the
      // file picker offers image/* — so refusing them read as "upload is broken". Anything the
      // renderer cannot use directly is CONVERTED to PNG instead of rejected.
      if (WEB_SAFE.has(ext)) {
        const dest = join(dir, `${newId('logo')}${ext}`);
        renameSync(req.file.path, dest);
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
    logger.info(`🆕 Đã tạo dự án (kênh ${channel?.name || 'Default'})`, { projectId: p.id });
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
      const { qcScan } = await import('./services/qc-scan.js');
      res.json(qcScan(req.params.id));
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // What would this edit cost? The fingerprints have always known which scenes a config change
  // invalidates; nobody asked them before the owner committed. Changing a subtitle font either
  // took a minute or an hour and the only way to find out was to start it.
  r.post('/projects/:id/plan-changes', async (req, res) => {
    try {
      const { planChanges } = await import('./services/change-plan.js');
      res.json(planChanges(req.params.id, req.body?.config || {}));
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // Save the config and run exactly the work the plan named — no more.
  r.post('/projects/:id/apply-changes', async (req, res) => {
    try {
      const p = DB.getProject(req.params.id);
      if (!p) return res.status(404).json({ error: 'not found' });
      const { planChanges } = await import('./services/change-plan.js');
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

  // One real frame with the pending logo / subtitle settings applied through the REAL final
  // pipeline. About a second, against fifteen minutes of re-concatenating to find out a badge
  // was four pixels too high.
  r.get('/projects/:id/frame-preview', async (req, res) => {
    try {
      const { framePreview } = await import('./services/frame-preview.js');
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
      const { normalizeAssets } = await import('../pipeline/brand-assets.js');
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
    const { atRiskScenes } = await import('../pipeline/typeset-scan.js');
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
    const { atRiskScenes } = await import('../pipeline/typeset-scan.js');
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

  /**
   * Every file this project OWNS — and nothing it merely shares.
   *
   * The working directory is exclusive, so it goes whole. `outputDir` is NOT: several projects of
   * one channel publish into the same folder, so deleting it would take other people's finished
   * videos with it. The deliverables there are removed one by one, by name.
   */
  function projectOwnedFiles(p, scenes) {
    const out = [];
    const dir = DB.projectDirFor(p.id);
    const walk = (d) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const full = join(d, e.name);
        if (e.isDirectory()) walk(full); else out.push(full);
      }
    };
    try { if (existsSync(dir)) walk(dir); } catch { /* unreadable — report what we have */ }
    for (const f of [p.video_path, p.thumb_path, ...(p.metadata?.covers || []).map((c) => c?.path)]) {
      if (f && existsSync(f) && !f.startsWith(dir)) out.push(f);
    }
    return [...new Set(out)];
  }

  r.delete('/projects/:id', (req, res) => {
    const p = DB.getProject(req.params.id);
    if (!p) return res.json({ ok: true, removed: 0 }); // already gone is the outcome asked for
    const removed = purgeProjectFiles(p);
    DB.deleteProject(p.id);
    logger.info(`🗑 Đã xoá dự án "${p.title}" — ${removed.files} file, ${(removed.bytes / 1048576).toFixed(0)} MB`, { projectId: p.id });
    res.json({ ok: true, ...removed });
  });

  /** Delete the owned files, then the working directory itself. Never a shared output folder. */
  function purgeProjectFiles(p) {
    const scenes = DB.getScenes(p.id);
    const files = projectOwnedFiles(p, scenes);
    let bytes = 0;
    let n = 0;
    for (const f of files) {
      try { bytes += statSync(f).size; unlinkSync(f); n++; } catch { /* gone or locked — keep going */ }
    }
    try { rmSync(DB.projectDirFor(p.id), { recursive: true, force: true }); } catch { /* best effort */ }
    return { files: n, bytes };
  }

  r.delete('/projects', (req, res) => {
    // Consistent with the single delete: "xoá" means the files go too.
    let files = 0;
    let bytes = 0;
    for (const p of DB.listProjects(DB.activeChannelId()) || []) {
      const r2 = purgeProjectFiles(p);
      files += r2.files; bytes += r2.bytes;
    }
    DB.deleteAllProjects();
    res.json({ ok: true, files, bytes });
  });

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
  // Per-SCENE subtitles (P42 — reference `/projects/:id/scenes-srt`). The whole-project export
  // above shifts every cue onto the finished timeline; this one keeps each scene on its OWN zero,
  // which is what you need to hand a single clip to an editor or re-check one scene's timing.
  r.get('/projects/:id/scenes-srt', async (req, res) => {
    const p = DB.getProject(req.params.id);
    if (!p) return res.status(404).json({ error: 'not found' });
    const { buildSrt } = await import('../pipeline/srt.js');
    const scenes = DB.getScenes(p.id).sort((a, b) => a.idx - b.idx)
      .map((sc) => ({ idx: sc.idx, duration: sc.duration || 0, srt: buildSrt(sc.srt_json || []) }));
    if (req.query.download) {
      const name = String(p.title || 'video').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'video';
      res.setHeader('Content-Disposition', `attachment; filename="${name}-scenes.txt"`);
      return res.type('text/plain').send(scenes.map((s) => `### Cảnh ${s.idx + 1} (${s.duration.toFixed(2)}s)\n${s.srt}`).join('\n'));
    }
    res.json({ scenes });
  });
  r.get('/projects/:id/srt', async (req, res) => {
    const p = DB.getProject(req.params.id);
    if (!p) return res.status(404).json({ error: 'not found' });
    const { buildSrt, shiftCues } = await import('../pipeline/srt.js');
    const cfg = p.config || {};
    const scenes = DB.getScenes(p.id);
    // Where each scene starts in the FINISHED file.
    //
    // This was the last place still guessing: `acc - TD * ordinal` with TD = 0.5, which assumes
    // every join is half a second when the doctrine's default hand-off is nothing of the sort, and
    // which carried its own copy of a clip-count cap that had to stay in step with the renderer's.
    // Both are gone. The stored timeline is what the file on disk was actually assembled on, so it
    // is preferred; a project that has never been exported falls back to replaying the same
    // arithmetic the concat would use.
    const stored = p.metadata?.timeline;
    let starts;
    if (Array.isArray(stored) && stored.length === scenes.length) {
      starts = scenes.map((sc, i) => stored.find((w) => w.sceneId === sc.id)?.start ?? stored[i].start);
    } else {
      const { planOffsets } = await import('../subtitles/timeline.js');
      const { planTransitions } = await import('../pipeline/render.js');
      const durs = scenes.map((sc) => Math.max(1.5, sc.duration || (cfg.sceneDuration || 6)));
      const plan = cfg.transitions === true && scenes.length > 1
        ? planTransitions({ scenes, clipCount: scenes.length, nIntro: 0, nOutro: 0, style: cfg.transitionStyle || 'auto' })
        : null;
      ({ starts } = planOffsets(durs, plan));
    }
    const all = [];
    scenes.forEach((sc, i) => {
      if (Array.isArray(sc.srt_json)) all.push(...shiftCues(sc.srt_json, Math.max(0, starts[i] || 0)));
    });
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
    const all = DB.getScenes(p.id);
    const pending = all.filter((s) => !s.audio_path);
    const chars = pending.reduce((a, s) => a + String(s.voice_text || '').trim().length, 0);
    const ch = p.channel_id ? DB.getChannel(p.channel_id) : null;
    const o = ttsOverrideFor(ch, p.config);
    const s = { ...(DB.aiSettings().tts || {}), ...(o || {}) };
    // language from the WHOLE script, not just the unvoiced tail — on a nearly-finished video
    // `pending` can be one short scene, which is not enough to read a language from.
    const lang = resolveLang(p.config, all);
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
  // P34 — PRE-create cost preview (assistant sheet): TTS chars priced by the pricing table,
  // LLM extrapolated from THIS installation's own history (avg LLM est_cost per scene over
  // recent projects — honest zero/null when there is no history). NOT /estimate — that route
  // is the duration-estimate helper and its contract stays untouched.
  r.post('/estimate-cost', (req, res) => {
    const b = req.body || {};
    const config = b.config || {};
    const duration = Math.max(10, parseInt(b.videoDuration || config.videoDuration, 10) || 60);
    const lang = declaredLang(config) || DEFAULT_LANG; // no scenes exist yet on a cost preview
    const words = Math.round(duration * (LANG_WPS[lang] || 3.0));
    const chars = Math.round(words * (lang === 'vi' ? 5.5 : 6));
    const o = config.tts || null;
    const s = { ...(DB.aiSettings().tts || {}), ...(o || {}) };
    const { pid: provider } = resolveVoiceTarget(s, lang, o);
    const ttsUsd = estimateCost({ kind: 'tts', provider, chars }) || 0;
    // history-based LLM estimate: mean llm cost per scene across the last ~20 usage-bearing projects
    const hist = db.prepare(`
      SELECT SUM(u.est_cost) AS cost, (SELECT COUNT(*) FROM scenes sc WHERE sc.project_id = u.project_id) AS scenes
      FROM provider_usage u WHERE u.kind='llm' AND u.project_id IS NOT NULL
      GROUP BY u.project_id ORDER BY MAX(u.at) DESC LIMIT 20`).all()
      .filter((r2) => r2.scenes > 0 && r2.cost > 0);
    const perScene = hist.length ? hist.reduce((a, r2) => a + r2.cost / r2.scenes, 0) / hist.length : null;
    const scenes = Math.max(1, Math.round(duration / Math.min(12, Math.max(4, +config.sceneDuration || 7))));
    const llmUsd = perScene != null ? +(perScene * scenes).toFixed(2) : null;
    res.json({
      scenes, chars, provider,
      credits: provider === 'larvoice' ? chars : null,
      ttsUsd: ttsUsd || null, llmUsd,
      usd: ttsUsd || llmUsd ? +((ttsUsd || 0) + (llmUsd || 0)).toFixed(2) : null,
      basis: perScene != null ? 'lịch sử kênh' : 'chưa đủ lịch sử để ước tính LLM',
    });
  });

  // ---- self-serve diagnostics bundle (masked, P14) ----
  r.get('/projects/:id/diagnostics', async (req, res) => {
    try {
      const { buildDiagnostics } = await import('../pipeline/diagnostics.js');
      res.json(buildDiagnostics(req.params.id));
    } catch (e) { res.status(e.message === 'project not found' ? 404 : 500).json({ error: e.message }); }
  });

  // ---- P32 persistent per-run journal ("Nhật ký xử lý") ----
  r.get('/projects/:id/journal', (req, res) => {
    const projectId = req.params.id;
    const jobId = req.query.job && req.query.job !== 'all' ? String(req.query.job) : null;
    const events = DB.listJournal({
      projectId, jobId,
      level: req.query.level ? String(req.query.level) : null,
      q: req.query.q ? String(req.query.q) : null,
      before: req.query.before ? parseInt(req.query.before, 10) : null,
      limit: req.query.limit ? parseInt(req.query.limit, 10) : 500,
    });
    const runs = DB.listJobs({ projectId, limit: 20 }).map((j) => ({
      id: j.id, kind: j.kind, status: j.status, attempts: j.attempts,
      created_at: j.created_at, started_at: j.started_at, finished_at: j.finished_at,
      durMs: j.started_at && j.finished_at ? j.finished_at - j.started_at : null,
    }));
    res.json({ events, runs });
  });
  // Global tasks feed: every running/queued/recent job across projects + system-lane rows.
  r.get('/tasks', (req, res) => {
    const jobs = DB.listJobs({ limit: Math.min(100, parseInt(req.query.limit, 10) || 40) }).map((j) => ({
      ...j, projectTitle: j.project_id ? (DB.getProject(j.project_id)?.title || null) : null,
    }));
    const sys = DB.listJournal({ sys: true, limit: 30 });
    res.json({ jobs, sys });
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
  // AI post caption (P42 — reference `/publish/generate-caption`). A YouTube description is not
  // a Facebook caption: this writes the SHORT hook-first post copy for the platform, from the
  // narration the video actually contains rather than from its title.
  r.post('/publish/generate-caption', async (req, res) => {
    try {
      const p = DB.getProject(req.body?.projectId || '');
      if (!p) return res.status(404).json({ error: 'not found' });
      const { chat, llmEnabled } = await import('../providers/llm.js');
      const ai = DB.aiSettings();
      if (!llmEnabled(ai.llm)) return res.status(400).json({ error: 'chưa bật LLM trong AI Setting' });
      const platform = ['facebook', 'youtube', 'tiktok'].includes(req.body?.platform) ? req.body.platform : 'facebook';
      const script = DB.getScenes(p.id).map((s) => (s.voice_text || '').trim()).filter(Boolean).join('\n').slice(0, 5000);
      const reply = await chat([
        { role: 'system', content: `You write short social captions for ${platform}. Reply with the caption text ONLY — no quotes, no preamble, no markdown.` },
        { role: 'user', content: `Video title: "${p.title || p.topic}"\n\nWhat the video actually says:\n<<<\n${script}\n>>>\n\nWrite the ${platform} caption in the SAME LANGUAGE as the narration: a hook in the first line (that is all most people see), 2-4 short lines of real substance drawn from the script above, then 3-5 hashtags. Never promise anything the script does not deliver. No emoji spam — two at most.` },
      ], { temperature: 0.8, maxTokens: 700, llm: ai.llm });
      const caption = String(reply || '').trim().replace(/^["']|["']$/g, '');
      if (!caption) return res.status(502).json({ error: 'model không trả về caption' });
      const md = p.metadata || {};
      DB.updateProject(p.id, { metadata: { ...md, captions: { ...(md.captions || {}), [platform]: caption } } });
      res.json({ platform, caption });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Facebook Page connect/disconnect — a pasted Page access token, verified against the Page
  // (P40). No OAuth dance: this is a desktop tool and the reference app works the same way.
  r.post('/publish/facebook/connect', async (req, res) => {
    try {
      const { getPublisher } = await import('../publish/index.js');
      res.json(await getPublisher('facebook').connect(req.body || {}));
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  // Facebook Page registry + token health (P42). A Page token expires; without this a silent
  // expiry just looks like "publishing broke".
  r.get('/publish/pages', async (req, res) => {
    const { getPublisher } = await import('../publish/index.js');
    res.json({ pages: getPublisher('facebook').listPages() });
  });
  r.post('/publish/pages/:pageId/select', async (req, res) => {
    try {
      const { getPublisher } = await import('../publish/index.js');
      res.json(getPublisher('facebook').selectPage(req.params.pageId));
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  r.delete('/publish/pages/:pageId', async (req, res) => {
    try {
      const { getPublisher } = await import('../publish/index.js');
      res.json(getPublisher('facebook').removePage(req.params.pageId));
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  r.post('/publish/pages/:pageId/check', async (req, res) => {
    try {
      const { getPublisher } = await import('../publish/index.js');
      res.json(await getPublisher('facebook').checkToken(req.params.pageId));
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  r.post('/publish/pages/:pageId/extend', async (req, res) => {
    try {
      const { getPublisher } = await import('../publish/index.js');
      res.json(await getPublisher('facebook').extendToken({ ...(req.body || {}), pageId: req.params.pageId }));
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  // Which projects already went out — so the grid can badge them instead of the owner guessing.
  r.get('/publish/published-ids', (req, res) => res.json({ ids: DB.publishedProjectIds() }));

  r.post('/publish/facebook/disconnect', async (req, res) => {
    try {
      const { getPublisher } = await import('../publish/index.js');
      res.json(getPublisher('facebook').disconnect());
    } catch (e) { res.status(500).json({ error: e.message }); }
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
        // a platform-shaped caption (P42) outranks the generic description when one was written
        // P43: a caption/title typed in the publish dialog is the owner's final word — it outranks
        // the stored platform caption, which outranks the generic description.
        videoPath: p.video_path,
        title: String(req.body?.title || '').trim() || md.title || p.title,
        description: String(req.body?.caption || '').trim() || md.captions?.[pub.id] || md.description || '',
        tags: (md.platforms?.[pub.id]?.tags || md.platforms?.youtube?.tags || md.hashtags || []).map((t) => String(t).replace(/^#/, '')),
        privacy, thumbPath: p.thumb_path && existsSync(p.thumb_path) ? p.thumb_path : null,
        // Facebook picks reels vs feed video from the shape, and can pin a first comment.
        aspectRatio: p.aspect_ratio,
        scheduledAt: Number.isFinite(+req.body?.scheduledAt) && +req.body.scheduledAt > 0 ? +req.body.scheduledAt : null,
        firstComment: String(req.body?.firstComment || md.pinnedComment || '').trim(),
        onLog: (m) => logger.info(m, { projectId: p.id }),
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
  // A thumbnail is codegen, not chat: it renders through headless Chrome from model-written
  // markup, so it takes the codegen model like scene visuals do — never the general chat model.
  const thumbLlmFor = (proj) => {
    const base = DB.aiSettings().llm;
    if (!base) return base;
    return { ...base, model: proj?.config?.thumbnailModel || proj?.config?.hyperframe?.model || base.codegenModel || base.model };
  };
  const fileUrlOf = (fp) => `/api/file?path=${encodeURIComponent(fp)}`;

  // ---- thumbnail operations (P40) — the reference exposes regen/edit/preview; we only ever
  // produced one at the end of a render, with no way to look at it, retry it or hand-tune it.
  r.get('/projects/:id/thumbnail', (req, res) => {
    const p = DB.getProject(req.params.id);
    if (!p) return res.status(404).json({ error: 'not found' });
    res.json({
      path: p.thumb_path || null,
      url: p.thumb_path && existsSync(p.thumb_path) ? `/api/file?path=${encodeURIComponent(p.thumb_path)}` : null,
      // the markup of the AI design, when there is one — this is what /edit-html re-renders
      html: p.metadata?.thumbnail?.html || null,
      title: p.metadata?.thumbnail?.title || p.title || '',
    });
  });
  // Re-design (no body / {hook,prompt,variant}) or re-render a hand-edited design ({html}).
  r.post('/projects/:id/thumbnail/regen', async (req, res) => {
    try {
      const p = DB.getProject(req.params.id);
      if (!p) return res.status(404).json({ error: 'not found' });
      const { generateThumbnailImage, renderThumbnailFragment } = await import('../pipeline/thumbnail-codegen.js');
      const { resolveGuide } = await import('../styleguide/index.js');
      const { resolveOutputDir } = await import('../pipeline/helpers.js');
      const guide = resolveGuide(p.config || {});
      const size = { w: 1280, h: 720 };
      const outDir = resolveOutputDir(p.id, p.config || {}, DB.projectDirFor(p.id));
      mkdirSync(outDir, { recursive: true });
      const outPath = join(outDir, `thumb_${Date.now()}.jpg`);
      const md = p.metadata || {};
      const { normalizeAssets } = await import('../pipeline/brand-assets.js');
      const { heroMediaUri } = await import('../util/asset-uri.js');
      const media = normalizeAssets(p.config?.assets).slice(0, 4)
        .map((a) => ({ name: a.name, uri: heroMediaUri(a.path) })).filter((m) => m.uri);
      let path = null, html = String(req.body?.html || '').trim() || null;
      if (html) {
        path = await renderThumbnailFragment(html, { guide, size, outPath, media });
        if (!path) return res.status(400).json({ error: 'HTML không dựng được (rỗng hoặc bị chặn)' });
      } else {
        const ai = await generateThumbnailImage({
          title: p.title, hook: req.body?.hook || md.thumbnail?.title || '',
          prompt: req.body?.prompt || md.thumbnail?.prompt || '',
          guide, size, outPath,
          language: resolveLang(p.config, DB.getScenes(p.id)),
          variant: Math.max(0, Math.min(2, parseInt(req.body?.variant, 10) || 0)),
          media, llm: thumbLlmFor(p),
        });
        if (!ai) return res.status(400).json({ error: 'AI chưa dựng được thumbnail — kiểm tra LLM trong AI Setting' });
        ({ path } = ai);
        html = ai.fragment;
      }
      DB.updateProject(p.id, { thumb_path: path, metadata: { ...md, thumbnail: { ...(md.thumbnail || {}), html } } });
      const version = DB.addThumbnail({
        projectId: p.id, path, html,
        source: req.body?.html ? 'hand' : 'ai',
        composition: req.body?.html ? null : Math.max(0, parseInt(req.body?.variant, 10) || 0),
      });
      res.json({ path, url: fileUrlOf(path), html, version });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Edit the thumbnail BY INSTRUCTION (P42 — reference `/thumbnail/edit-html`). Re-designing
  // throws away everything the owner liked; this changes only what they asked for.
  r.post('/projects/:id/thumbnail/edit-html', async (req, res) => {
    try {
      const p = DB.getProject(req.params.id);
      if (!p) return res.status(404).json({ error: 'not found' });
      const current = p.metadata?.thumbnail?.html;
      if (!current) return res.status(400).json({ error: 'chưa có thiết kế thumbnail để sửa — tạo bằng AI trước' });
      const prompt = String(req.body?.prompt || '').trim();
      if (!prompt) return res.status(400).json({ error: 'cần mô tả thay đổi' });
      const { editThumbnailFragment, renderThumbnailFragment } = await import('../pipeline/thumbnail-codegen.js');
      const { resolveGuide } = await import('../styleguide/index.js');
      const { resolveOutputDir } = await import('../pipeline/helpers.js');
      const { normalizeAssets } = await import('../pipeline/brand-assets.js');
      const { heroMediaUri } = await import('../util/asset-uri.js');
      const guide = resolveGuide(p.config || {});
      const edited = await editThumbnailFragment(current, prompt, { guide, llm: thumbLlmFor(p), language: resolveLang(p.config, DB.getScenes(p.id)) });
      if (!edited) return res.status(422).json({ error: 'AI chưa sửa được — thử mô tả cụ thể hơn' });
      const media = normalizeAssets(p.config?.assets).slice(0, 4)
        .map((a) => ({ name: a.name, uri: heroMediaUri(a.path) })).filter((m) => m.uri);
      const outDir = resolveOutputDir(p.id, p.config || {}, DB.projectDirFor(p.id));
      mkdirSync(outDir, { recursive: true });
      const outPath = join(outDir, `thumb_${Date.now()}.jpg`);
      const path = await renderThumbnailFragment(edited, { guide, size: { w: 1280, h: 720 }, outPath, media });
      if (!path) return res.status(422).json({ error: 'bản sửa không dựng được' });
      const md = p.metadata || {};
      DB.updateProject(p.id, { thumb_path: path, metadata: { ...md, thumbnail: { ...(md.thumbnail || {}), html: edited } } });
      const version = DB.addThumbnail({ projectId: p.id, path, html: edited, source: 'ai-edit', instruction: prompt });
      res.json({ path, url: fileUrlOf(path), html: edited, version });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Re-design the platform covers. They used to be generated once, inside finalize, and never
  // again — so a bad cover set could only be fixed by re-rendering the whole video. Seeding from
  // the thumbnail the owner already approved means the six canvases inherit a design they liked
  // instead of six fresh rolls of the dice.
  r.post('/projects/:id/covers/regen', async (req, res) => {
    try {
      const p = DB.getProject(req.params.id);
      if (!p) return res.status(404).json({ error: 'not found' });
      const llm = thumbLlmFor(p);
      if (!llm) return res.status(400).json({ error: 'chưa cấu hình LLM trong AI Setting' });
      const { generateCoverSet } = await import('../pipeline/thumbnail-codegen.js');
      const { COVER_SIZES, orientationOf } = await import('../publish/platforms.js');
      const { resolveGuide } = await import('../styleguide/index.js');
      const { resolveOutputDir } = await import('../pipeline/helpers.js');
      const { normalizeAssets } = await import('../pipeline/brand-assets.js');
      const { heroMediaUri } = await import('../util/asset-uri.js');
      const md = p.metadata || {};
      const outDir = resolveOutputDir(p.id, p.config || {}, DB.projectDirFor(p.id));
      mkdirSync(outDir, { recursive: true });
      const media = normalizeAssets(p.config?.assets).slice(0, 4)
        .map((a) => ({ name: a.name, uri: heroMediaUri(a.path) })).filter((m) => m.uri);
      // Reuse the approved design for its own orientation unless the caller asks for a clean slate.
      const seedHtml = req.body?.fresh ? null : (md.thumbnail?.html || null);
      const size = ratioToSize(p.aspect_ratio || '16:9');
      const fragments = seedHtml ? { [orientationOf(size)]: seedHtml } : {};
      // `only: ['youtube']` redoes ONE ratio. Redesigning all six because one is wrong throws away
      // five the owner may already be happy with — and costs six generations to fix one.
      const only = Array.isArray(req.body?.only) ? req.body.only.filter(Boolean) : null;
      const sizes = only?.length ? COVER_SIZES.filter((s) => only.includes(s.id)) : COVER_SIZES;
      if (!sizes.length) return res.status(400).json({ error: `không có khổ nào khớp: ${only?.join(', ')}` });
      const { covers } = await generateCoverSet({
        title: p.title, hook: req.body?.hook || md.thumbnail?.title || '',
        prompt: req.body?.prompt || md.thumbnail?.prompt || '',
        guide: resolveGuide(p.config || {}), sizes, outDir, baseName: 'cover',
        language: resolveLang(p.config, DB.getScenes(p.id)), media, llm, fragments,
        onLog: (m) => logger.info(m, { projectId: p.id }),
      });
      if (!covers.length) return res.status(422).json({ error: 'AI chưa dựng được ảnh bìa nào' });
      // A partial redo MERGES: the ratios that were not asked for keep the covers they had.
      const prev = (DB.getProject(p.id).metadata || {}).covers || [];
      const merged = only?.length
        ? [...prev.filter((c) => !only.includes(c.id)), ...covers].sort(
          (a, b) => COVER_SIZES.findIndex((s) => s.id === a.id) - COVER_SIZES.findIndex((s) => s.id === b.id))
        : covers;
      DB.updateProject(p.id, { metadata: { ...(DB.getProject(p.id).metadata || {}), covers: merged } });
      res.json({ ok: true, covers: merged.map((c) => ({ ...c, url: c.path ? fileUrlOf(c.path) : null })) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ---- thumbnail VERSIONS: every design a project has ever had, and the way back to any of them.
  r.get('/projects/:id/thumbnails', (req, res) => {
    const p = DB.getProject(req.params.id);
    if (!p) return res.status(404).json({ error: 'not found' });
    const rows = DB.listThumbnails(p.id).map((v) => ({
      ...v,
      url: v.path && existsSync(v.path) ? fileUrlOf(v.path) : null,
      missing: !!(v.path && !existsSync(v.path)),
      current: v.path === p.thumb_path,
    }));
    res.json({ versions: rows, current: p.thumb_path || null });
  });

  // Make one past version the project's thumbnail again. The image is already on disk — going
  // back costs nothing and re-renders nothing, which is the whole point of keeping versions.
  r.post('/projects/:id/thumbnails/:tid/use', (req, res) => {
    const p = DB.getProject(req.params.id);
    if (!p) return res.status(404).json({ error: 'not found' });
    const v = DB.getThumbnail(req.params.tid);
    if (!v || v.project_id !== p.id) return res.status(404).json({ error: 'không có phiên bản này' });
    if (!v.path || !existsSync(v.path)) return res.status(410).json({ error: 'ảnh của phiên bản này không còn trên đĩa' });
    const md = p.metadata || {};
    DB.updateProject(p.id, { thumb_path: v.path, metadata: { ...md, thumbnail: { ...(md.thumbnail || {}), html: v.html || md.thumbnail?.html || null } } });
    res.json({ ok: true, path: v.path, url: fileUrlOf(v.path), html: v.html || null });
  });

  // Drop a version from the list. The file stays on disk: deleting a row is tidying the shelf,
  // not destroying an export the owner may have already posted somewhere.
  r.delete('/projects/:id/thumbnails/:tid', (req, res) => {
    const p = DB.getProject(req.params.id);
    if (!p) return res.status(404).json({ error: 'not found' });
    const v = DB.getThumbnail(req.params.tid);
    if (!v || v.project_id !== p.id) return res.status(404).json({ error: 'không có phiên bản này' });
    if (v.path === p.thumb_path) return res.status(409).json({ error: 'không xoá được phiên bản đang dùng — chọn bản khác trước' });
    res.json({ ok: DB.deleteThumbnail(v.id) });
  });

  /**
   * Copy the platform covers somewhere the owner can actually use them.
   *
   * They are already written into the project's output folder, so this is not "download" in the
   * browser sense — it is "put a tidy, clearly-named set where I am about to upload from". The
   * destination is either a path the caller passes or one chosen in the native folder dialog,
   * because a WKWebView has no File System Access API to pick one with.
   */
  r.post('/projects/:id/covers/export', async (req, res) => {
    try {
      const p = DB.getProject(req.params.id);
      if (!p) return res.status(404).json({ error: 'not found' });
      const covers = (p.metadata?.covers || []).filter((c) => c?.path && existsSync(c.path));
      if (!covers.length) return res.status(400).json({ error: 'chưa có ảnh bìa nào — tạo metadata/ảnh bìa trước' });
      const { execFile } = await import('node:child_process');
      let dir = String(req.body?.dir || '').trim();
      if (req.body?.pick) {
        // The native folder chooser differs per OS. Anywhere without one, the caller still gets a
        // usable answer: the UI falls back to typing a path, which is why this resolves '' instead
        // of throwing — a missing picker must not make exporting covers impossible.
        dir = await new Promise((resolve) => {
          const done = (err, out) => resolve(err ? '' : String(out).trim());
          if (process.platform === 'darwin') {
            execFile('osascript', ['-e', 'POSIX path of (choose folder with prompt "Chọn thư mục lưu ảnh bìa")'], done);
          } else if (process.platform === 'win32') {
            execFile('powershell', ['-NoProfile', '-STA', '-Command',
              'Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog;'
              + ' $d.Description = "Chọn thư mục lưu ảnh bìa"; if ($d.ShowDialog() -eq "OK") { $d.SelectedPath }'], done);
          } else {
            execFile('zenity', ['--file-selection', '--directory', '--title=Chọn thư mục lưu ảnh bìa'], done);
          }
        });
        if (!dir) return res.json({ ok: false, cancelled: true });
      }
      if (!dir) dir = p.outputDir || DB.projectDirFor(p.id);
      if (!existsSync(dir) || !statSync(dir).isDirectory()) return res.status(400).json({ error: `thư mục không tồn tại: ${dir}` });
      // A folder per video, named after it: six files called cover_youtube.jpg from three videos
      // in one Downloads folder is not a set anyone can use.
      const slug = String(p.title || 'video').replace(/[^\p{L}\p{N}\- ]/gu, '').replace(/\s+/g, '_').slice(0, 60) || 'video';
      const outDir = join(dir, `${slug}_anh-bia`);
      mkdirSync(outDir, { recursive: true });
      const files = [];
      for (const c of covers) {
        const px = c.px || { w: c.w, h: c.h };
        const name = `${slug}_${c.id}_${px.w}x${px.h}.jpg`;
        copyFileSync(c.path, join(outDir, name));
        files.push(name);
      }
      execFile('open', [outDir], () => {}); // land the owner in the folder they just filled
      res.json({ ok: true, dir: outDir, files });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Reveal a project's output folder in Finder (P40 — the toolbar button had no handler).
  r.post('/projects/:id/open', async (req, res) => {
    try {
      const p = DB.getProject(req.params.id);
      if (!p) return res.status(404).json({ error: 'not found' });
      const { resolveOutputDir } = await import('../pipeline/helpers.js');
      const dir = resolveOutputDir(p.id, p.config || {}, DB.projectDirFor(p.id));
      if (!existsSync(dir)) return res.status(400).json({ error: 'chưa có thư mục xuất — render xong đã' });
      const { execFile } = await import('node:child_process');
      // Reveal the finished file when there is one, otherwise just open the folder.
      const target = p.video_path && existsSync(p.video_path) ? p.video_path : dir;
      execFile('open', target === dir ? [dir] : ['-R', target], () => {});
      res.json({ ok: true, dir });
    } catch (e) { res.status(500).json({ error: e.message }); }
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
      // this scene's OWN text decides — resync runs after the owner edited that one line
      const lang = declaredLang(p.config) || detectLang(sc.voice_text || '');
      const padMs = padMsFor(lang);
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
    // The model pass needs a model. Without this the route was the ONE caller that could never use
    // it, so the Studio button would have kept shipping the structural answer.
    try { res.json(await fetchLink(req.body.url, { llm: DB.aiSettings().llm })); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  r.post('/image-search', async (req, res) => {
    try { res.json(await imageSearch(req.body.query || req.body.topic, req.body.count || 6)); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  r.post('/metadata', async (req, res) => {
    try {
      const p = DB.getProject(req.body.projectId);
      // Same contract as the pipeline stage: SEO is written from the narration, not the title.
      const script = p ? DB.getScenes(p.id).map((s) => (s.voice_text || '').trim()).filter(Boolean).join('\n') : '';
      const md = await generateMetadata(p, req.body.stylePrompt, { script });
      // merge — B2's thumbnail {title,prompt,html} must survive a metadata regeneration
      if (p) DB.updateProject(p.id, { metadata: { ...(p.metadata || {}), ...md } });
      res.json({ metadata: md });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ---- library ----
  r.get("/library/:kind", async (req, res) => {
    const { brandFolders, brandCatalog } = await import('../pipeline/brand-assets.js');
    if (req.params.kind === 'brand') {
      // Union of registered rows and whatever is sitting in the folder, so art dropped in via
      // Finder is visible and castable (P40).
      const folder = req.query.brand || 'Default';
      const rows = DB.listLibrary('brand', folder) || [];
      const byName = new Map(rows.map((r) => [String(r.name).toLowerCase(), r]));
      const items = brandCatalog(folder).map((a) => byName.get(a.name.toLowerCase())
        || { id: `disk:${folder}:${a.name}`, kind: 'brand', brand_folder: folder, name: a.name, filename: a.name, path: a.path, onDisk: true });
      return res.json({ items, brands: brandFolders() });
    }
    res.json({ items: DB.listLibrary(req.params.kind, req.query.brand), brands: brandFolders() });
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
  // Rename a library entry (P40). The FILE keeps its stored name — only the display name the
  // codegen/casting lanes key on changes — so a rename can never break an existing project's
  // asset reference to the path.
  r.patch('/library/:id', (req, res) => {
    const name = String(req.body?.name || '').replace(/[^\w.\- À-ỹ]/gu, '').trim();
    if (!name) return res.status(400).json({ error: 'tên không hợp lệ' });
    const row = DB.renameLibrary(req.params.id, name);
    if (!row) return res.status(404).json({ error: 'không tìm thấy' });
    res.json({ item: row });
  });
  r.delete('/library/:id', (req, res) => {
    const row = DB.deleteLibrary(req.params.id);
    if (row && row.path && existsSync(row.path)) { try { unlinkSync(row.path); } catch { /* ignore */ } }
    res.json({ ok: true });
  });


  // ---- fonts: ONE list, and the bytes to prove it ----
  // Every family the owner may pick, each with an honest source and a `ready` flag. A family
  // that has not been fetched renders as a substitute in both the preview and the video, so it
  // is listed as not-ready rather than silently offered as though it were there.
  r.get('/fonts/families', async (req, res) => {
    try {
      const { fontLibrary, familiesForLanguage } = await import('../fonts/registry.js');
      const lang = req.query.lang;
      res.json({ families: lang ? familiesForLanguage(lang) : fontLibrary() });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // The actual @font-face bytes for ONE family, so the preview can draw in the real typeface
  // instead of whatever the browser falls back to. Base64 data URIs — same delivery the scene
  // pages use, so what the owner previews is what the renderer will embed.
  r.get('/fonts/:family/css', async (req, res) => {
    try {
      const family = String(req.params.family || '');
      const [{ fontsCss }, { userFontsCss }, { downloadedCss }, { isSystemFamily }] = await Promise.all([
        import('../animation/harness.js'), import('../animation/userfonts.js'),
        import('../fonts/files.js'), import('../fonts/files.js'),
      ]);
      const css = fontsCss([family]) || downloadedCss(family) || userFontsCss([family]) || '';
      res.setHeader('Content-Type', 'text/css; charset=utf-8');
      // system faces need no bytes; the browser already has them
      res.setHeader('X-Font-Source', css ? 'embedded' : (isSystemFamily(family) ? 'system' : 'missing'));
      res.send(css);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Everything a LANGUAGE needs, in one click. Same rule as the single-family route below: an
  // explicit action, never something a render does on its own — which is why it is a route the
  // owner's language picker calls and not a step inside the pipeline.
  //
  // A system family needs nothing fetched; only a downloadable one does. The reply says what it
  // did and what it could not, so the picker can be honest rather than optimistic.
  r.post('/fonts/language/:lang/ensure', async (req, res) => {
    try {
      const code = String(req.params.lang || '').slice(0, 5);
      const [{ familiesForLanguage }, { downloadFamily }, { lang: langRow }] = await Promise.all([
        import('../fonts/registry.js'), import('../fonts/store.js'), import('../i18n/languages.js'),
      ]);
      const want = langRow(code).script;
      const fams = familiesForLanguage(code).filter((f) => f.scripts.includes(want));
      if (fams.some((f) => f.ready)) {
        return res.json({ lang: code, script: want, already: true, ready: fams.filter((f) => f.ready).map((f) => f.family) });
      }
      const target = fams.find((f) => f.source === 'downloadable' && f.google);
      if (!target) return res.json({ lang: code, script: want, already: false, ready: [], note: 'no downloadable family covers this script' });
      await downloadFamily(target.family);
      res.json({ lang: code, script: want, already: false, fetched: target.family });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // Fetch a catalogue family from Google Fonts. ALWAYS an explicit action: a render that reaches
  // out to the network is a render that can fail on a DNS hiccup, in the middle of work the
  // owner is paying for.
  r.post('/fonts/:family/download', async (req, res) => {
    try {
      const { downloadFamily } = await import('../fonts/store.js');
      res.json(await downloadFamily(String(req.params.family || '')));
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  r.delete('/fonts/:family', async (req, res) => {
    try {
      const { removeFamily } = await import('../fonts/store.js');
      res.json({ ok: true, removed: removeFamily(String(req.params.family || '')) });
    } catch (e) { res.status(400).json({ error: e.message }); }
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
  r.get('/brands', async (req, res) => {
    // Folders on disk count too — the owner may simply have made one in Finder (P40).
    const { brandFolders } = await import('../pipeline/brand-assets.js');
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

  // Bring a remote image/video into the project (P40 — reference `/media/download`). An image
  // search result is a URL on someone else's server; a scene must be self-contained and offline,
  // so the file is fetched ONCE into uploads and everything downstream works with a local path.
  r.post('/media/download', async (req, res) => {
    try {
      const url = String(req.body?.url || '').trim();
      if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'cần URL http(s)' });
      const resp = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(60000) });
      if (!resp.ok) return res.status(400).json({ error: `tải về lỗi HTTP ${resp.status}` });
      const type = (resp.headers.get('content-type') || '').toLowerCase();
      if (!/^(image|video)\//.test(type)) return res.status(400).json({ error: `không phải ảnh/video (${type || 'không rõ'})` });
      const buf = Buffer.from(await resp.arrayBuffer());
      if (!buf.length) return res.status(400).json({ error: 'file rỗng' });
      const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'video/mp4': '.mp4', 'video/quicktime': '.mov' };
      const ext = EXT[type.split(';')[0]] || extname(new URL(url).pathname) || '.bin';
      const out = join(DIRS.uploads, `${newId('dl')}${ext}`);
      writeFileSync(out, buf);
      res.json({ path: out, name: basename(out), size: buf.length, type });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Standalone transcription (P42 — reference `/edit-video/transcribe`): read the words out of a
  // video or audio file WITHOUT starting a project or spending anything but CPU. Same segment
  // granularity and the same optional AI spelling repair the edit-video lane uses.
  r.post('/edit-video/transcribe', async (req, res) => {
    try {
      const src = resolve(String(req.body?.path || ''));
      if (!inAllowedRoots(src) || !existsSync(src)) return res.status(400).json({ error: 'file không hợp lệ' });
      const { transcribeWords, whisperAvailable } = await import('../media/whisper.js');
      if (!whisperAvailable()) return res.status(400).json({ error: 'chưa có whisper (kiểm tra Cài đặt → phụ đề)' });
      const language = String(req.body?.language || 'auto');
      const { segments } = await transcribeWords(src, { language, granularity: 'segment' });
      let cues = segments;
      if (req.body?.repair !== false) {
        const { repairTranscript } = await import('../pipeline/edit-video.js');
        // 'auto' means the owner did not say; read it off the transcript rather than assuming
        // Vietnamese, which is what silently mangled every non-Vietnamese import.
        const repairLang = language === 'auto' ? majorityLang(segments.map((c) => c.text)) || DEFAULT_LANG : language;
        cues = await repairTranscript(segments, { language: repairLang, llm: DB.aiSettings().llm });
      }
      const { buildSrt } = await import('../pipeline/srt.js');
      res.json({ cues, srt: buildSrt(cues.map((c) => ({ start: c.start, end: c.end, text: c.text }))) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ---- edit video (P40): motion graphics onto footage the owner already has ----
  // Creates a normal project carrying config.editVideo, then starts it through the ordinary
  // queue — so stop/resume/re-render/the job ledger all work exactly as for a scripted video.
  r.post('/edit-video/start', async (req, res) => {
    try {
      const { path: inPath, title, language, config } = req.body || {};
      const src = resolve(inPath || '');
      if (!inAllowedRoots(src) || !existsSync(src)) return res.status(400).json({ error: 'file không hợp lệ' });
      const { createEditVideoProject } = await import('../pipeline/edit-video.js');
      const project = await createEditVideoProject({
        source: src, title, language: language || 'auto', config: config || {},
      });
      Pipeline.startProject(project.id).catch((e) => logger.error(`edit-video failed: ${e.message}`, { projectId: project.id }));
      res.json({ projectId: project.id, aspectRatio: project.aspect_ratio, status: 'running' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  // Full transcript of an edit-video project, as SRT on the finished timeline.
  r.get('/edit-video/:id/srt', async (req, res) => {
    try {
      const { editVideoSrt } = await import('../pipeline/edit-video.js');
      res.type('text/plain').send(editVideoSrt(req.params.id));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // duration estimate helper used by the UI
  r.post('/estimate', (req, res) => {
    const { videoDuration = 60, sceneDuration = 7, language } = req.body || {};
    const scenes = Math.max(1, Math.round(videoDuration / sceneDuration));
    // same formula the script generator budgets with — the UI estimate must never disagree
    const wordsPerScene = wordsForSlot(sceneDuration, declaredLang({ language }) || DEFAULT_LANG);
    res.json({ scenes, wordsPerScene, size: ratioToSize(req.body.aspectRatio || '9:16') });
  });

  app.use('/api', r);
}
