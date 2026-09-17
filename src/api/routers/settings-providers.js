// App settings, the voice catalogue and previews, LLM presets, the local TTS server, platform and subtitle-preset catalogues, provider tests.
import * as DB from '../../db/index.js';
import { maskSecrets, applyMaskedUpdate } from '../../core/config.js';
import { synthPreview } from '../services/voice-preview.js';
import { getVoiceCatalog } from '../services/voice-catalog.js';
import { m, tp, uiLang, setUiLang } from '../../i18n/t.js';
import { localize } from '../helpers.js';
import { syncLlmAccounts } from '../../core/llm-accounts.js';
import { chat } from '../../providers/llm.js';
import { withPreset, publicCatalog } from '../../providers/llm-presets.js';
import { priceFor, PRICING_VERSION } from '../../core/pricing.js';
import { ttsServerStatus, ensureSupertonic, supertonicLauncher, stopSupertonic } from '../../media/tts-server.js';
import { execFile } from 'node:child_process';
import { PLATFORMS, COVER_SIZES } from '../../publish/platforms.js';
import { SUBTITLE_PRESETS } from '../../subtitles/presets.js';
import { pickSubtitleConfig } from '../services/subtitle-defaults.js';
import { getProvider, providerConfig } from '../../providers/voice/index.js';

/** Settings (masked on egress), the voice catalogue, previews, the LLM endpoint test. */
function mountSettings(r) {
  // ---- settings ----
  // Secrets are masked '••' on EVERY egress (recursive — covers nested tts.providers.*.apiKey)
  // and a masked round-trip on ingest keeps the saved value. Never ship raw keys to the client.
  r.get('/settings', (req, res) => {
    res.json({ settings: maskSecrets(DB.aiSettings()), uiLang: uiLang() });
  });
  r.put('/settings', (req, res) => {
    // The INTERFACE language is a different axis from the VIDEO language and is stored apart from
    // the AI settings blob on purpose — someone can want a Japanese interface for English videos.
    if (req.body?.uiLang !== undefined) {
      DB.setSetting('uiLang', setUiLang(req.body.uiLang));
      if (Object.keys(req.body).length === 1) return res.json({ ok: true, uiLang: uiLang() });
    }
    const prev = DB.aiSettings();
    const next = applyMaskedUpdate(prev, req.body || {});
    syncLlmAccounts(prev, next, req.body?.llm);
    DB.setSetting('ai', next);
    res.json({ ok: true, uiLang: uiLang() });
  });

  // ---- voice catalog (normalized, cached) ----
  r.get('/voices', async (req, res) => {
    try {
      res.json(localize(await getVoiceCatalog(req.query || {})));
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
      res.json({ ok: true, model: llm.model, ms: Date.now() - t0, message: tp`Kết nối OK — model trả lời "${String(reply).trim().slice(0, 40)}"` });
    } catch (e) { res.status(200).json({ ok: false, message: e.message.slice(0, 220) }); }
  });
}

/** The LLM provider catalogue and the local TTS server lifecycle. */
function mountProviders(r) {
  // ---- LLM provider catalogue (ai-providers) ----
  // What the provider picker in AI Setting is built from. Unlike every other settings egress
  // in this file it is NOT masked: nothing in the catalogue ever came from the user, so there
  // is no secret to hide. Prices are decorated from core/pricing.js rather than stored in the
  // catalogue, so the number in the picker and the number in the cost meter are one table.
  r.get('/llm/providers', async (req, res) => {
    try {
      res.json(localize({ presets: publicCatalog(priceFor), pricingVersion: PRICING_VERSION }));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Ask a provider what it actually serves today. Model ids drift constantly, so the catalogue
  // ships a starting point and this is the truth. It runs server-side for two reasons: the
  // browser only ever holds a masked key, and a cross-origin call from the page would be
  // refused by CORS anyway. Failure is HTTP 200 + ok:false, like /llm/test — the panel falls
  // back to the suggested list instead of showing an error.
  r.post('/llm/models', async (req, res) => {
    try {
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
      if (!out.ok) return res.json({ ok: false, message: tp`HTTP ${out.status} — key sai, hoặc provider không cho liệt kê model` });
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
      const cfg = (DB.aiSettings().tts?.providers?.supertonic) || {};
      res.json(await ttsServerStatus(cfg));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  r.post('/tts/server/start', async (req, res) => {
    try {
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
      // The launcher probe already knows which interpreter works here; otherwise try both names.
      const py = supertonicLauncher()?.[0]?.startsWith('python') ? supertonicLauncher()[0]
        : (process.platform === 'win32' ? 'python' : 'python3');
      execFile(py, ['-m', 'pip', 'install', '--upgrade', 'supertonic'], { timeout: 600000, maxBuffer: 4 * 1024 * 1024 }, async (err, stdout, stderr) => {
        const installed = !!supertonicLauncher({ fresh: true });
        res.json({
          ok: installed && !err, installed,
          message: installed ? m('Đã cài Supertonic — bấm ▶ Khởi động') : tp`Cài thất bại: ${(stderr || err?.message || '').slice(-400)}`,
          log: String(stdout || '').slice(-2000),
        });
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  r.post('/tts/server/stop', async (req, res) => {
    try {
      res.json({ stopped: stopSupertonic(DB.aiSettings().tts?.providers?.supertonic || {}) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
}

/** Platform table, subtitle presets, provider connection test. */
function mountCatalogs(r) {
  // ---- the platform table (limits + cover sizes), so the panel and the writer agree ----
  r.get('/platforms', async (req, res) => {
    res.json(localize({ platforms: PLATFORMS, coverSizes: COVER_SIZES }));
  });

  // ---- subtitle preset catalog for the UI gallery ----
  // Ten built-ins plus whatever the owner has saved. A saved one is a whole SETTINGS BUNDLE, not
  // an id the resolver knows, so it travels with its config and the panel applies it on click —
  // which is also why it works on every channel rather than belonging to one.
  r.get('/subtitle-presets', async (req, res) => {
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
      const prov = getProvider(pid);
      // merge masked/unchanged fields from saved settings (same contract as PUT /settings)
      const saved = providerConfig(DB.aiSettings().tts, pid);
      res.json(await prov.testConnection(applyMaskedUpdate(saved, cfg)));
    } catch (e) { res.json({ ok: false, message: e.message }); }
  });
}

/** @param {import('express').Router} r */
export function mount(r) {
  mountSettings(r);
  mountProviders(r);
  mountCatalogs(r);
}
