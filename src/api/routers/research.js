// Research helpers: fetch a link, search images, generate metadata.
import * as DB from '../../db/index.js';
import { fetchLink } from '../../providers/fetchlink.js';
import { imageSearch } from '../../providers/imagesearch.js';
import { generateMetadata } from '../../providers/llm.js';

/** @param {import('express').Router} r */
export function mount(r) {
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
}
