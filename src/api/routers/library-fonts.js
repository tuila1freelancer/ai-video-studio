// The media library and the font registry.
import { existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { moveFile } from '../../util/fs.js';
import { join, extname, basename } from 'node:path';
import * as DB from '../../db/index.js';
import { DIRS } from '../../config/paths.js';
import { tp } from '../../i18n/t.js';
import { upload } from '../helpers.js';
import { brandFolders, brandCatalog } from '../../pipeline/brand-assets.js';
import { fontLibrary, familiesForLanguage } from '../../fonts/registry.js';
import { downloadFamily, removeFamily } from '../../fonts/store.js';

/** @param {import('express').Router} r */
export function mount(r) {
  // ---- library ----
  r.get("/library/:kind", async (req, res) => {
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
      return res.status(400).json({ error: tp`loại thư viện không hỗ trợ: ${kind}` });
    }
    if (kind === 'font') {
      const badFile = (req.files || []).find((f) => !/\.(ttf|otf|woff2?)$/i.test(f.originalname));
      if (badFile) {
        for (const f of req.files || []) { try { unlinkSync(f.path); } catch { /* temp cleanup */ } }
        return res.status(400).json({ error: tp`font chỉ nhận .ttf/.otf/.woff/.woff2 — "${badFile.originalname}" không hợp lệ` });
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
      moveFile(f.path, finalPath);
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
        import('../../animation/harness.js'), import('../../animation/userfonts.js'),
        import('../../fonts/files.js'), import('../../fonts/files.js'),
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
        import('../../fonts/registry.js'), import('../../fonts/store.js'), import('../../i18n/languages.js'),
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
      res.json(await downloadFamily(String(req.params.family || '')));
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  r.delete('/fonts/:family', async (req, res) => {
    try {
      res.json({ ok: true, removed: removeFamily(String(req.params.family || '')) });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
}
