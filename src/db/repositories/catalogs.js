// Static-ish catalogs: scene/metadata styles, media library (brand/bgm/sfx), logo presets,
// and the per-provider voice cache. Small, independent tables grouped for locality.
import db, { stmt } from '../connection.js';
import { newId, safeJson } from '../../util/util.js';

// ---- voices cache ----
export function cacheVoices(provider, voices) {
  const ins = stmt(`INSERT INTO voices_cache(provider,id,name,lang,locale,gender,tags,preview_url,fetched_at)
    VALUES (@provider,@id,@name,@lang,@locale,@gender,@tags,@preview_url,@fetched_at)
    ON CONFLICT(provider,id) DO UPDATE SET name=excluded.name,lang=excluded.lang,locale=excluded.locale,
    gender=excluded.gender,tags=excluded.tags,preview_url=excluded.preview_url,fetched_at=excluded.fetched_at`);
  const now = Date.now();
  const tx = db.transaction((arr) => {
    stmt('DELETE FROM voices_cache WHERE provider=?').run(provider);
    for (const v of arr) ins.run({
      provider, id: v.id, name: v.name, lang: v.lang || 'en', locale: v.locale || '',
      gender: v.gender || 'u', tags: JSON.stringify(v.tags || []), preview_url: v.previewUrl || null, fetched_at: now,
    });
  });
  tx(voices);
}
export function cachedVoices(provider) {
  return stmt('SELECT * FROM voices_cache WHERE provider=? ORDER BY lang, name').all(provider)
    .map((r) => ({ ...r, tags: safeJson(r.tags, []) }));
}
export function voicesCacheAge(provider) {
  const r = stmt('SELECT MAX(fetched_at) t FROM voices_cache WHERE provider=?').get(provider);
  return r && r.t ? Date.now() - r.t : Infinity;
}

/** Gender ('m'|'f'|'u') of a cached voice, or null when unknown/uncached. */
export function cachedVoiceGender(provider, voiceId) {
  const r = stmt('SELECT gender FROM voices_cache WHERE provider=? AND id=?').get(provider, String(voiceId || ''));
  return r?.gender || null;
}

/**
 * Timbre-preserving fallback pick: the closest voice on `provider` to (lang, gender),
 * from the cached catalog. Same-language + same-gender first, then same-language.
 * Returns a voice id or null (caller keeps 'auto').
 */
export function nearestCachedVoice(provider, lang, gender) {
  const rows = stmt('SELECT id, gender FROM voices_cache WHERE provider=? AND lang=?').all(provider, lang);
  if (!rows.length) return null;
  if (gender && gender !== 'u') {
    const same = rows.find((r) => r.gender === gender);
    if (same) return same.id;
  }
  return rows[0].id;
}

// ---- styles ----
export function listStyles(kind) {
  return stmt('SELECT * FROM styles WHERE kind=? ORDER BY builtin DESC, name ASC').all(kind);
}
export function createStyle({ name, kind, prompt, builtin = 0 }) {
  const id = newId('st');
  stmt('INSERT INTO styles(id,name,kind,prompt,builtin) VALUES(?,?,?,?,?)').run(id, name, kind, prompt, builtin);
  return stmt('SELECT * FROM styles WHERE id=?').get(id);
}
export function deleteStyle(id) { stmt('DELETE FROM styles WHERE id=? AND builtin=0').run(id); }

// ---- library ----
export function listLibrary(kind, brandFolder) {
  if (kind === 'brand' && brandFolder) {
    return stmt('SELECT * FROM library WHERE kind=? AND brand_folder=? ORDER BY created_at DESC').all(kind, brandFolder);
  }
  return stmt('SELECT * FROM library WHERE kind=? ORDER BY created_at DESC').all(kind);
}
export function addLibrary({ kind, brandFolder = 'Default', name, filename, path, size }) {
  const id = newId('lib');
  stmt('INSERT INTO library(id,kind,brand_folder,name,filename,path,size,created_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(id, kind, brandFolder, name, filename, path, size, Date.now());
  return stmt('SELECT * FROM library WHERE id=?').get(id);
}
export function deleteLibrary(id) {
  const row = stmt('SELECT * FROM library WHERE id=?').get(id);
  stmt('DELETE FROM library WHERE id=?').run(id);
  return row;
}
/** Rename a saved style/preset (P42) — the row keeps its id, so anything referencing it holds. */
export function renameStyle(id, name) {
  stmt('UPDATE styles SET name=? WHERE id=?').run(name, id);
  return stmt('SELECT * FROM styles WHERE id=?').get(id) || null;
}

/** Rename a library entry's DISPLAY name (P40). The file on disk is untouched, so an existing
 *  project that references it by path keeps working. */
export function renameLibrary(id, name) {
  stmt('UPDATE library SET name=? WHERE id=?').run(name, id);
  return stmt('SELECT * FROM library WHERE id=?').get(id) || null;
}
/** Follow a brand folder rename / delete in the library rows, so art keeps its registration. */
export function renameBrandFolder(from, to) {
  stmt("UPDATE library SET brand_folder=? WHERE kind='brand' AND brand_folder=?").run(to, from);
}
export function deleteBrandFolder(name) {
  stmt("DELETE FROM library WHERE kind='brand' AND brand_folder=?").run(name);
}
export function brandFolders() {
  return stmt("SELECT DISTINCT brand_folder FROM library WHERE kind='brand'").all().map((r) => r.brand_folder);
}
