// Static-ish catalogs: scene/metadata styles, media library (brand/bgm/sfx), logo presets,
// and the per-provider voice cache. Small, independent tables grouped for locality.
import db from '../connection.js';
import { newId, safeJson } from '../../util/util.js';

// ---- voices cache ----
export function cacheVoices(provider, voices) {
  const ins = db.prepare(`INSERT INTO voices_cache(provider,id,name,lang,locale,gender,tags,preview_url,fetched_at)
    VALUES (@provider,@id,@name,@lang,@locale,@gender,@tags,@preview_url,@fetched_at)
    ON CONFLICT(provider,id) DO UPDATE SET name=excluded.name,lang=excluded.lang,locale=excluded.locale,
    gender=excluded.gender,tags=excluded.tags,preview_url=excluded.preview_url,fetched_at=excluded.fetched_at`);
  const now = Date.now();
  const tx = db.transaction((arr) => {
    db.prepare('DELETE FROM voices_cache WHERE provider=?').run(provider);
    for (const v of arr) ins.run({
      provider, id: v.id, name: v.name, lang: v.lang || 'en', locale: v.locale || '',
      gender: v.gender || 'u', tags: JSON.stringify(v.tags || []), preview_url: v.previewUrl || null, fetched_at: now,
    });
  });
  tx(voices);
}
export function cachedVoices(provider) {
  return db.prepare('SELECT * FROM voices_cache WHERE provider=? ORDER BY lang, name').all(provider)
    .map((r) => ({ ...r, tags: safeJson(r.tags, []) }));
}
export function voicesCacheAge(provider) {
  const r = db.prepare('SELECT MAX(fetched_at) t FROM voices_cache WHERE provider=?').get(provider);
  return r && r.t ? Date.now() - r.t : Infinity;
}

/** Gender ('m'|'f'|'u') of a cached voice, or null when unknown/uncached. */
export function cachedVoiceGender(provider, voiceId) {
  const r = db.prepare('SELECT gender FROM voices_cache WHERE provider=? AND id=?').get(provider, String(voiceId || ''));
  return r?.gender || null;
}

/**
 * Timbre-preserving fallback pick: the closest voice on `provider` to (lang, gender),
 * from the cached catalog. Same-language + same-gender first, then same-language.
 * Returns a voice id or null (caller keeps 'auto').
 */
export function nearestCachedVoice(provider, lang, gender) {
  const rows = db.prepare('SELECT id, gender FROM voices_cache WHERE provider=? AND lang=?').all(provider, lang);
  if (!rows.length) return null;
  if (gender && gender !== 'u') {
    const same = rows.find((r) => r.gender === gender);
    if (same) return same.id;
  }
  return rows[0].id;
}

// ---- styles ----
export function listStyles(kind) {
  return db.prepare('SELECT * FROM styles WHERE kind=? ORDER BY builtin DESC, name ASC').all(kind);
}
export function createStyle({ name, kind, prompt, builtin = 0 }) {
  const id = newId('st');
  db.prepare('INSERT INTO styles(id,name,kind,prompt,builtin) VALUES(?,?,?,?,?)').run(id, name, kind, prompt, builtin);
  return db.prepare('SELECT * FROM styles WHERE id=?').get(id);
}
export function deleteStyle(id) { db.prepare('DELETE FROM styles WHERE id=? AND builtin=0').run(id); }

// ---- library ----
export function listLibrary(kind, brandFolder) {
  if (kind === 'brand' && brandFolder) {
    return db.prepare('SELECT * FROM library WHERE kind=? AND brand_folder=? ORDER BY created_at DESC').all(kind, brandFolder);
  }
  return db.prepare('SELECT * FROM library WHERE kind=? ORDER BY created_at DESC').all(kind);
}
export function addLibrary({ kind, brandFolder = 'Default', name, filename, path, size }) {
  const id = newId('lib');
  db.prepare('INSERT INTO library(id,kind,brand_folder,name,filename,path,size,created_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(id, kind, brandFolder, name, filename, path, size, Date.now());
  return db.prepare('SELECT * FROM library WHERE id=?').get(id);
}
export function deleteLibrary(id) {
  const row = db.prepare('SELECT * FROM library WHERE id=?').get(id);
  db.prepare('DELETE FROM library WHERE id=?').run(id);
  return row;
}
/** Rename a library entry's DISPLAY name (P40). The file on disk is untouched, so an existing
 *  project that references it by path keeps working. */
export function renameLibrary(id, name) {
  db.prepare('UPDATE library SET name=? WHERE id=?').run(name, id);
  return db.prepare('SELECT * FROM library WHERE id=?').get(id) || null;
}
export function brandFolders() {
  return db.prepare("SELECT DISTINCT brand_folder FROM library WHERE kind='brand'").all().map((r) => r.brand_folder);
}

// ---- logo presets ----
export function listLogoPresets() { return db.prepare('SELECT * FROM logo_presets ORDER BY name').all(); }
export function addLogoPreset({ name, path, position, size }) {
  const id = newId('logo');
  db.prepare('INSERT INTO logo_presets(id,name,path,position,size) VALUES(?,?,?,?,?)').run(id, name, path, position, size);
  return db.prepare('SELECT * FROM logo_presets WHERE id=?').get(id);
}
export function deleteLogoPreset(id) { db.prepare('DELETE FROM logo_presets WHERE id=?').run(id); }
