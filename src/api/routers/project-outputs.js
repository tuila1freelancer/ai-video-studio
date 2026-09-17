// Project outputs: repurposing, thumbnails and covers, thumbnail versions, open/export/dub.
import { existsSync, statSync, mkdirSync, copyFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import * as DB from '../../db/index.js';
import { logger } from '../../util/log.js';
import { ratioToSize } from '../../util/util.js';
import * as Pipeline from '../../pipeline/queue.js';
import { resolveLang } from '../../util/lang.js';
import { m, tp } from '../../i18n/t.js';
import { fileUrlOf, thumbLlmFor } from '../helpers.js';
import { pickFolder } from '../services/folder-picker.js';
import { EXPORT_PRESETS, exportForPlatform } from '../../pipeline/export-presets.js';
import { generateThumbnailImage, renderThumbnailFragment, editThumbnailFragment, generateCoverSet } from '../../pipeline/thumbnail-codegen.js';
import { resolveGuide } from '../../styleguide/index.js';
import { resolveOutputDir } from '../../pipeline/helpers.js';
import { normalizeAssets } from '../../pipeline/brand-assets.js';
import { heroMediaUri } from '../../util/asset-uri.js';
import { COVER_SIZES, orientationOf } from '../../publish/platforms.js';
import { repurposeProject } from '../../pipeline/repurpose.js';
import { dubProject } from '../../pipeline/dub.js';

/** @param {import('express').Router} r */
export function mount(r) {
  // ---- multi-aspect repurposing (16:9 <-> 9:16, no crop — full reflow re-render) ----
  // one-click platform exports (fast remux / confirmed fade-trim; aspect mismatch →
  // the caller runs the existing repurpose flow)
  r.get('/export/presets', async (req, res) => {
    res.json({ presets: Object.entries(EXPORT_PRESETS).map(([id, p]) => ({ id, ...p })) });
  });

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
      const guide = resolveGuide(p.config || {});
      const size = { w: 1280, h: 720 };
      const outDir = resolveOutputDir(p.id, p.config || {}, DB.projectDirFor(p.id));
      mkdirSync(outDir, { recursive: true });
      const outPath = join(outDir, `thumb_${Date.now()}.jpg`);
      const md = p.metadata || {};
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
      if (!sizes.length) return res.status(400).json({ error: tp`không có khổ nào khớp: ${only?.join(', ')}` });
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
      let dir = String(req.body?.dir || '').trim();
      if (req.body?.pick) {
        dir = await pickFolder(m('Chọn thư mục lưu ảnh bìa'));
        if (!dir) return res.json({ ok: false, cancelled: true });
      }
      if (!dir) dir = p.outputDir || DB.projectDirFor(p.id);
      if (!existsSync(dir) || !statSync(dir).isDirectory()) return res.status(400).json({ error: tp`thư mục không tồn tại: ${dir}` });
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
      const dir = resolveOutputDir(p.id, p.config || {}, DB.projectDirFor(p.id));
      if (!existsSync(dir)) return res.status(400).json({ error: 'chưa có thư mục xuất — render xong đã' });
      // Reveal the finished file when there is one, otherwise just open the folder.
      const target = p.video_path && existsSync(p.video_path) ? p.video_path : dir;
      execFile('open', target === dir ? [dir] : ['-R', target], () => {});
      res.json({ ok: true, dir });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  r.post('/projects/:id/export', async (req, res) => {
    try {
      res.json(await exportForPlatform(req.params.id, req.body?.preset, { allowTrim: !!req.body?.allowTrim }));
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  r.post('/projects/:id/repurpose', async (req, res) => {
    try {
      const out = await repurposeProject(req.params.id, { aspectRatio: req.body?.aspectRatio });
      // start the derived render as a resume run: voice/captions are already attached,
      // so only visuals-for-dropped-scenes + the full re-render actually execute
      Pipeline.startProject(out.project.id, { resume: true }).catch((e) => logger.error(e.message, { projectId: out.project.id }));
      res.json(out);
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // Dub: the same video in another language. Creates a project and stops — running it is the
  // owner's own click, like every other paid path (P16).
  r.post('/projects/:id/dub', async (req, res) => {
    try {
      const out = await dubProject(req.params.id, {
        language: String(req.body?.language || ''),
        llm: DB.aiSettings().llm,
        onLog: (msg) => logger.info(msg, { projectId: req.params.id }),
      });
      res.json({ ok: true, project: out.project, scenes: out.scenes, language: out.language });
    } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
  });
}
