// Canonical scenes JSON and SRT exports of a project.

import * as DB from '../../db/index.js';
import { resolveLang } from '../../util/lang.js';
import { isSupported } from '../../i18n/languages.js';
import { tp } from '../../i18n/t.js';
import { scenesJsonFromRows } from '../../content/master-script.js';
import { buildSrt, shiftCues } from '../../pipeline/srt.js';
import { planOffsets } from '../../subtitles/timeline.js';
import { planTransitions } from '../../pipeline/render.js';
import { translateCues, buildVtt } from '../../subtitles/translate.js';

/** @param {import('express').Router} r */
export function mount(r) {
  // ---- canonical scenes JSON export (factory format; DB is the source of truth) ----
  r.get('/projects/:id/scenes-json', async (req, res) => {
    const p = DB.getProject(req.params.id);
    if (!p) return res.status(404).json({ error: 'not found' });
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
    const scenes = DB.getScenes(p.id).sort((a, b) => a.idx - b.idx)
      .map((sc) => ({ idx: sc.idx, duration: sc.duration || 0, srt: buildSrt(sc.srt_json || []) }));
    if (req.query.download) {
      const name = String(p.title || 'video').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'video';
      res.setHeader('Content-Disposition', `attachment; filename="${name}-scenes.txt"`);
      return res.type('text/plain').send(scenes.map((s) => `${tp`### Cảnh ${s.idx + 1} (${s.duration.toFixed(2)}s)`}\n${s.srt}`).join('\n'));
    }
    res.json({ scenes });
  });
  r.get('/projects/:id/srt', async (req, res) => {
    const p = DB.getProject(req.params.id);
    if (!p) return res.status(404).json({ error: 'not found' });
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
    // ?lang= translates the cue sheet; ?format=vtt gives WebVTT, which is what YouTube's caption
    // editor and every browser player prefer. Nothing is re-rendered either way — a finished video
    // reaches another audience for the price of some text.
    const want = String(req.query.lang || '').toLowerCase();
    const from = resolveLang(cfg, scenes);
    let cues = all;
    if (want && want !== from) {
      if (!isSupported(want)) return res.status(400).json({ error: 'ngôn ngữ không được hỗ trợ' });
      try {
        cues = await translateCues(all, { from, to: want, llm: DB.aiSettings().llm });
      } catch (e) { return res.status(400).json({ error: e.message }); }
    }
    const vtt = String(req.query.format || '').toLowerCase() === 'vtt';
    const code = want || from;
    res.setHeader('Content-Type', vtt ? 'text/vtt; charset=utf-8' : 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="subtitles.${code}.${vtt ? 'vtt' : 'srt'}"`);
    res.send(vtt ? buildVtt(cues) : buildSrt(cues));
  });
}
