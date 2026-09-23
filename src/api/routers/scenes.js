// Scenes: edits, waveform, takes, per-scene review and re-generation.
import { existsSync } from 'node:fs';
import * as DB from '../../db/index.js';
import { hub } from '../../ws/hub.js';
import { logger } from '../../util/log.js';
import * as Pipeline from '../../pipeline/queue.js';
import { declaredLang, detectLang, padMsFor } from '../../util/lang.js';
import { audioPeaks } from '../../media/waveform.js';
import { buildSubtitles } from '../../providers/subtitle.js';
import { aiSettingsFor } from '../../core/config.js';

/** @param {import('express').Router} r */
export function mount(r) {
  // ---- scenes ----
  r.get('/scenes/:id', (req, res) => {
    const s = DB.getScene(req.params.id);
    if (!s) return res.status(404).json({ error: 'not found' });
    res.json({ scene: s });
  });
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
    const strip = (pr) => { const { audio: _audio, ...rest } = pr || {}; return rest; };
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
      const channel = DB.channelOf(p.id);
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
  // A running pipeline/render job owns its scenes; a regen underneath it would be overwritten by
  // the stage's own result (or overwrite it), so it is refused rather than raced.
  const busy = (sceneId) => {
    const pid = DB.getScene(sceneId)?.project_id;
    return pid && (DB.activeJobFor(pid, 'pipeline') || DB.activeJobFor(pid, 'render'));
  };
  r.post('/scenes/:id/regen-voice', async (req, res) => {
    try {
      if (busy(req.params.id)) return res.status(409).json({ error: 'dự án đang chạy — đợi xong rồi tạo lại cảnh' });
      await Pipeline.regenScene(req.params.id, 'voice', { actor: req.actor });
      res.json({ ok: true, scene: DB.getScene(req.params.id) });
    } catch (e) { logger.error(e.message); res.status(500).json({ error: e.message }); }
  });
  r.post('/scenes/:id/regen-html', async (req, res) => {
    try {
      if (busy(req.params.id)) return res.status(409).json({ error: 'dự án đang chạy — đợi xong rồi tạo lại cảnh' });
      await Pipeline.regenScene(req.params.id, 'html', { actor: req.actor });
      res.json({ ok: true, scene: DB.getScene(req.params.id) });
    } catch (e) { logger.error(e.message); res.status(500).json({ error: e.message }); }
  });
}
