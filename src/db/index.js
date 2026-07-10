// SQLite persistence (better-sqlite3). One file DB under data/.
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { writeFileSync } from 'node:fs';
import { DIRS, DATA_DIR, ensureDirs, projectDirIn, ensureChannelDirs } from '../config/paths.js';
import { newId, safeJson } from '../util/util.js';
import { maskSecrets } from '../util/secrets.js';

ensureDirs();
const db = new Database(join(DIRS.data, 'studio.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000'); // multiple processes (app + background renders) share this DB

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  title TEXT,
  topic TEXT,
  input_type TEXT,
  aspect_ratio TEXT DEFAULT '9:16',
  status TEXT DEFAULT 'draft',          -- draft|running|paused|done|error
  current_step TEXT,                    -- b2|b34|b5|b6|b7
  config TEXT,                          -- JSON: all output config
  metadata TEXT,                        -- JSON: title/desc/hashtags
  video_path TEXT,
  thumb_path TEXT,
  error TEXT,
  created_at INTEGER,
  updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS scenes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  idx INTEGER,
  voice_text TEXT,
  visual_prompt TEXT,
  keywords TEXT,                        -- JSON array
  image_path TEXT,
  audio_path TEXT,
  srt_path TEXT,
  srt_json TEXT,                        -- JSON word/cue timings
  html_path TEXT,
  video_path TEXT,
  duration REAL DEFAULT 0,
  status TEXT DEFAULT 'pending',        -- pending|script|tts|html|rendered|error
  error TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_scenes_project ON scenes(project_id, idx);
`);

// lightweight migrations for older DBs
{
  const cols = db.prepare('PRAGMA table_info(scenes)').all().map((c) => c.name);
  if (!cols.includes('template')) db.exec('ALTER TABLE scenes ADD COLUMN template TEXT');
  if (!cols.includes('props')) db.exec('ALTER TABLE scenes ADD COLUMN props TEXT');
  const pcols = db.prepare('PRAGMA table_info(projects)').all().map((c) => c.name);
  if (!pcols.includes('channel_id')) db.exec('ALTER TABLE projects ADD COLUMN channel_id TEXT');
}

db.exec(`
CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  name TEXT,
  slug TEXT UNIQUE,
  root_dir TEXT,
  config TEXT,
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS channel_presets (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  name TEXT,
  config TEXT,
  is_default INTEGER DEFAULT 0,
  created_at INTEGER,
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_presets_channel ON channel_presets(channel_id);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS styles (
  id TEXT PRIMARY KEY,
  name TEXT,
  kind TEXT,                            -- scene|metadata
  prompt TEXT,
  builtin INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS library (
  id TEXT PRIMARY KEY,
  kind TEXT,                            -- brand|bgm|sfx
  brand_folder TEXT DEFAULT 'Default',
  name TEXT,
  filename TEXT,
  path TEXT,
  size INTEGER,
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS logo_presets (
  id TEXT PRIMARY KEY,
  name TEXT,
  path TEXT,
  position TEXT,
  size INTEGER
);
CREATE TABLE IF NOT EXISTS voices_cache (
  provider TEXT,
  id TEXT,
  name TEXT,
  lang TEXT,
  locale TEXT,
  gender TEXT,
  tags TEXT,
  preview_url TEXT,
  fetched_at INTEGER,
  PRIMARY KEY (provider, id)
);
`);

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

// ---- settings ----
const _getSetting = db.prepare('SELECT value FROM settings WHERE key=?');
const _setSetting = db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
export function getSetting(key, fallback = null) {
  const row = _getSetting.get(key);
  return row ? safeJson(row.value, row.value) : fallback;
}
export function setSetting(key, value) {
  _setSetting.run(key, typeof value === 'string' ? value : JSON.stringify(value));
}

export const DEFAULT_SETTINGS = {
  llm: { baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4o-mini', enabled: false },
  // 'edge' = Microsoft neural voices (free, needs internet, auto-falls back to say offline).
  // 'auto' voices resolve per-scene from the detected text language — never a wrong-language voice.
  tts: { provider: 'edge', edgeVoice: 'auto', voice: 'auto', rate: 175, apiKey: '', voiceId: '', model: '' },
  // 'estimate' = use the known script text with even timing (correct words, great for TTS).
  // 'whisper'  = re-transcribe audio (only better when the audio text is unknown).
  subtitle: { engine: 'estimate' },
  imageSearch: { provider: 'none', apiKey: '' },
  // Real AI image per scene. 'pollinations' is free + keyless (default). 'openai' or 'none' too.
  imageGen: { provider: 'pollinations', model: 'flux', apiKey: '', baseUrl: 'https://api.openai.com/v1' },
};
export function aiSettings() {
  const s = getSetting('ai', null);
  return { ...DEFAULT_SETTINGS, ...(s || {}) };
}

// ---- projects ----
const _insProject = db.prepare(`INSERT INTO projects
  (id,title,topic,input_type,aspect_ratio,status,config,channel_id,created_at,updated_at)
  VALUES (@id,@title,@topic,@input_type,@aspect_ratio,@status,@config,@channel_id,@created_at,@updated_at)`);
const _getProject = db.prepare('SELECT * FROM projects WHERE id=?');
const _listProjects = db.prepare('SELECT * FROM projects ORDER BY updated_at DESC');
const _delProject = db.prepare('DELETE FROM projects WHERE id=?');

function rowToProject(r) {
  if (!r) return null;
  return { ...r, config: safeJson(r.config, {}), metadata: safeJson(r.metadata, null) };
}

export function createProject({ title, topic, inputType, aspectRatio, config, channelId }) {
  const id = newId('p');
  const now = Date.now();
  _insProject.run({
    id, title: title || 'Dự án mới', topic: topic || '', input_type: inputType || 'text',
    aspect_ratio: aspectRatio || '9:16', status: 'draft',
    config: JSON.stringify(config || {}), channel_id: channelId || activeChannelId(), created_at: now, updated_at: now,
  });
  return rowToProject(_getProject.get(id));
}
export function getProject(id) { return rowToProject(_getProject.get(id)); }
export function listProjects(channelId) {
  if (channelId && channelId !== 'all') {
    return db.prepare('SELECT * FROM projects WHERE channel_id=? ORDER BY updated_at DESC').all(channelId).map(rowToProject);
  }
  return _listProjects.all().map(rowToProject);
}
export function deleteProject(id) { _delProject.run(id); }
export function deleteAllProjects() { db.prepare('DELETE FROM projects').run(); }
// Boot recovery: a project can only be 'running' while a pipeline holds it in-process,
// so any 'running' rows at startup are crash leftovers → flip to 'paused' (Resume-able).
export function recoverZombieProjects() {
  return db.prepare("UPDATE projects SET status='paused' WHERE status='running'").run().changes;
}

export function updateProject(id, fields) {
  const allowed = ['title', 'topic', 'aspect_ratio', 'status', 'current_step', 'config', 'metadata', 'video_path', 'thumb_path', 'error'];
  const sets = [], vals = {};
  for (const k of allowed) {
    if (k in fields) {
      sets.push(`${k}=@${k}`);
      vals[k] = (k === 'config' || k === 'metadata') && typeof fields[k] !== 'string'
        ? JSON.stringify(fields[k]) : fields[k];
    }
  }
  if (!sets.length) return getProject(id);
  vals.id = id; vals.updated_at = Date.now();
  db.prepare(`UPDATE projects SET ${sets.join(',')}, updated_at=@updated_at WHERE id=@id`).run(vals);
  return getProject(id);
}

// ---- scenes ----
const _insScene = db.prepare(`INSERT INTO scenes
  (id,project_id,idx,voice_text,visual_prompt,keywords,template,props,status)
  VALUES (@id,@project_id,@idx,@voice_text,@visual_prompt,@keywords,@template,@props,'script')`);
const _listScenes = db.prepare('SELECT * FROM scenes WHERE project_id=? ORDER BY idx ASC');
const _getScene = db.prepare('SELECT * FROM scenes WHERE id=?');
const _delScenes = db.prepare('DELETE FROM scenes WHERE project_id=?');

function rowToScene(r) {
  if (!r) return null;
  return { ...r, keywords: safeJson(r.keywords, []), srt_json: safeJson(r.srt_json, null), props: safeJson(r.props, null) };
}
export function replaceScenes(projectId, scenes) {
  const tx = db.transaction((arr) => {
    _delScenes.run(projectId);
    arr.forEach((s, i) => _insScene.run({
      id: newId('s'), project_id: projectId, idx: i,
      voice_text: s.voice || s.voice_text || '', visual_prompt: s.visualPrompt || s.visual_prompt || '',
      keywords: JSON.stringify(s.keywords || []),
      // Two-stage B2 may pre-assign a plan (e.g. chapter-break scenes); B5 backfills the rest.
      template: s.template || null, props: s.props ? JSON.stringify(s.props) : null,
    }));
  });
  tx(scenes);
  return getScenes(projectId);
}
export function getScenes(projectId) { return _listScenes.all(projectId).map(rowToScene); }
export function getScene(id) { return rowToScene(_getScene.get(id)); }
export function updateScene(id, fields) {
  const allowed = ['idx', 'voice_text', 'visual_prompt', 'keywords', 'image_path', 'audio_path', 'srt_path', 'srt_json', 'html_path', 'video_path', 'duration', 'status', 'error', 'template', 'props'];
  const sets = [], vals = {};
  for (const k of allowed) {
    if (k in fields) {
      sets.push(`${k}=@${k}`);
      vals[k] = (k === 'keywords' || k === 'srt_json' || k === 'props') && fields[k] != null && typeof fields[k] !== 'string'
        ? JSON.stringify(fields[k]) : fields[k];
    }
  }
  if (!sets.length) return getScene(id);
  vals.id = id;
  db.prepare(`UPDATE scenes SET ${sets.join(',')} WHERE id=@id`).run(vals);
  return getScene(id);
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

// ---- channels ----
function slugify(name) {
  return String(name || 'kenh').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'kenh';
}
function rowToChannel(r) { return r ? { ...r, config: safeJson(r.config, {}) } : null; }

export function listChannels() { return db.prepare('SELECT * FROM channels ORDER BY created_at ASC').all().map(rowToChannel); }
export function getChannel(id) { return rowToChannel(db.prepare('SELECT * FROM channels WHERE id=?').get(id)); }

export function writeChannelJson(ch) {
  // exported to the user's folder → never write real API keys to disk
  try { writeFileSync(join(ch.root_dir, 'channel.json'), JSON.stringify({ name: ch.name, slug: ch.slug, config: maskSecrets(ch.config || {}), exported_at: new Date().toISOString() }, null, 2)); }
  catch { /* folder may be missing/readonly — non-fatal */ }
}

export function createChannel({ name, rootDir, config = {} }) {
  const slug0 = slugify(name);
  let slug = slug0, n = 1;
  while (db.prepare('SELECT 1 FROM channels WHERE slug=?').get(slug)) slug = `${slug0}-${++n}`;
  const root = rootDir && rootDir.trim()
    ? rootDir.trim().replace(/^~(?=\/|$)/, homedir())
    : join(homedir(), 'Movies', 'AI Video Studio', slug);
  const id = newId('ch');
  ensureChannelDirs(root);
  db.prepare('INSERT INTO channels(id,name,slug,root_dir,config,created_at) VALUES(?,?,?,?,?,?)')
    .run(id, name, slug, root, JSON.stringify(config), Date.now());
  const ch = getChannel(id);
  writeChannelJson(ch);
  return ch;
}

export function updateChannel(id, fields) {
  const ch = getChannel(id);
  if (!ch) return null;
  const name = fields.name ?? ch.name;
  const root = fields.rootDir ? fields.rootDir.replace(/^~(?=\/|$)/, homedir()) : ch.root_dir;
  const config = fields.config !== undefined ? fields.config : ch.config;
  ensureChannelDirs(root);
  db.prepare('UPDATE channels SET name=?, root_dir=?, config=? WHERE id=?')
    .run(name, root, JSON.stringify(config), id);
  const out = getChannel(id);
  writeChannelJson(out);
  return out;
}

export function deleteChannel(id) {
  const def = defaultChannel();
  if (id === def.id) throw new Error('Không thể xoá kênh Default');
  // unlink only — never delete files on disk
  db.prepare('UPDATE projects SET channel_id=? WHERE channel_id=?').run(def.id, id);
  db.prepare('DELETE FROM channels WHERE id=?').run(id);
  if (activeChannelId() === id) setSetting('activeChannel', def.id);
}

export function defaultChannel() {
  let ch = rowToChannel(db.prepare("SELECT * FROM channels WHERE slug='default'").get());
  if (!ch) {
    const id = newId('ch');
    db.prepare('INSERT INTO channels(id,name,slug,root_dir,config,created_at) VALUES(?,?,?,?,?,?)')
      .run(id, 'Default', 'default', DATA_DIR, '{}', Date.now());
    ch = getChannel(id);
  }
  return ch;
}

export function activeChannelId() {
  const v = getSetting('activeChannel', null);
  return (v && getChannel(v)) ? v : defaultChannel().id;
}
export function setActiveChannel(id) { if (getChannel(id)) setSetting('activeChannel', id); }

export function channelOf(projectId) {
  const p = _getProject.get(projectId);
  return (p && p.channel_id && getChannel(p.channel_id)) || defaultChannel();
}

// Channel-aware project working dir (Default channel → original data/projects/<id> layout).
export function projectDirFor(projectId) {
  return projectDirIn(channelOf(projectId).root_dir, projectId);
}

// ---- channel presets (named output configs per channel) ----
function rowToPreset(r) { return r ? { ...r, config: safeJson(r.config, {}), is_default: !!r.is_default } : null; }
export function listPresets(channelId) {
  return db.prepare('SELECT * FROM channel_presets WHERE channel_id=? ORDER BY created_at ASC')
    .all(channelId).map(rowToPreset);
}
export function getPreset(id) {
  return rowToPreset(db.prepare('SELECT * FROM channel_presets WHERE id=?').get(id));
}
export function defaultPresetFor(channelId) {
  return rowToPreset(db.prepare('SELECT * FROM channel_presets WHERE channel_id=? AND is_default=1').get(channelId));
}
const _setDefaultPreset = db.transaction((channelId, presetId) => {
  db.prepare('UPDATE channel_presets SET is_default=0 WHERE channel_id=?').run(channelId);
  db.prepare('UPDATE channel_presets SET is_default=1 WHERE id=?').run(presetId);
});
export function createPreset({ channelId, name, config, isDefault = false }) {
  const id = newId('ps');
  db.prepare(`INSERT INTO channel_presets (id, channel_id, name, config, is_default, created_at)
    VALUES (?, ?, ?, ?, 0, ?)`).run(id, channelId, name || 'Preset', JSON.stringify(config || {}), Date.now());
  if (isDefault) _setDefaultPreset(channelId, id);
  return getPreset(id);
}
export function updatePreset(id, fields) {
  const cur = getPreset(id);
  if (!cur) return null;
  if (fields.name !== undefined) db.prepare('UPDATE channel_presets SET name=? WHERE id=?').run(fields.name, id);
  if (fields.config !== undefined) db.prepare('UPDATE channel_presets SET config=? WHERE id=?').run(JSON.stringify(fields.config || {}), id);
  if (fields.isDefault === true) _setDefaultPreset(cur.channel_id, id);
  else if (fields.isDefault === false) db.prepare('UPDATE channel_presets SET is_default=0 WHERE id=?').run(id);
  return getPreset(id);
}
export function deletePreset(id) { db.prepare('DELETE FROM channel_presets WHERE id=?').run(id); }

// one-time backfill: existing projects belong to Default
{
  const def = defaultChannel();
  db.prepare('UPDATE projects SET channel_id=? WHERE channel_id IS NULL').run(def.id);
}

// seed default styles once
if (listStyles('scene').length === 0) {
  createStyle({ name: 'Cinematic', kind: 'scene', builtin: 1, prompt: 'Cinematic, dramatic lighting, gradient overlays, smooth Ken-Burns motion, bold modern typography.' });
  createStyle({ name: 'Minimal', kind: 'scene', builtin: 1, prompt: 'Clean minimal flat design, soft pastel background, simple centered text, gentle fades.' });
  createStyle({ name: 'Neon Tech', kind: 'scene', builtin: 1, prompt: 'Dark background, neon glow, futuristic grid, glitch accents, animated highlights.' });
}
if (listStyles('metadata').length === 0) {
  createStyle({ name: 'Viral Hook', kind: 'metadata', builtin: 1, prompt: 'Tạo tiêu đề giật tít, mô tả ngắn cuốn hút và 12 hashtag thịnh hành cho mạng xã hội.' });
}

export default db;
