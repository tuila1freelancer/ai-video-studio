// Pipeline control: batch queue, start/stop/resume, the scene gate, cost estimates, re-render.
import * as DB from '../../db/index.js';
import db from '../../db/index.js';
import { logger } from '../../util/log.js';
import { ratioToSize } from '../../util/util.js';
import { wordsForSlot, LANG_WPS } from '../../providers/llm.js';
import * as Pipeline from '../../pipeline/queue.js';
import { ttsOverrideFor } from '../../core/config.js';
import { estimateCost } from '../../core/pricing.js';
import { resolveVoiceTarget } from '../../providers/tts.js';
import { startBatch } from '../services/batch.js';
import { resolveLang, declaredLang, DEFAULT_LANG } from '../../util/lang.js';
import { m } from '../../i18n/t.js';

/** @param {import('express').Router} r */
export function mount(r) {
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
      basis: perScene != null ? m('lịch sử kênh') : m('chưa đủ lịch sử để ước tính LLM'),
    });
  });

  // duration estimate helper used by the UI
  r.post('/estimate', (req, res) => {
    const { videoDuration = 60, sceneDuration = 7, language } = req.body || {};
    const scenes = Math.max(1, Math.round(videoDuration / sceneDuration));
    // same formula the script generator budgets with — the UI estimate must never disagree
    const wordsPerScene = wordsForSlot(sceneDuration, declaredLang({ language }) || DEFAULT_LANG);
    res.json({ scenes, wordsPerScene, size: ratioToSize(req.body.aspectRatio || '9:16') });
  });
}
