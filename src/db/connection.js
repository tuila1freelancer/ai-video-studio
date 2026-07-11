// SQLite connection + schema (better-sqlite3). One file DB under data/.
// This file owns ONLY the handle and DDL — no query functions, no seed data — so every
// repository can `import db from './connection.js'` without a dependency cycle.
// Column ALTERs + backfills live in ./migrate.js (versioned via PRAGMA user_version);
// new tables keep being added here via CREATE TABLE IF NOT EXISTS.
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { DIRS, ensureDirs } from '../config/paths.js';
import { migrate } from './migrate.js';

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
CREATE TABLE IF NOT EXISTS channel_memory (
  channel_id TEXT PRIMARY KEY,
  bible TEXT,                           -- the channel's Show Bible (persona, style, standing facts)
  topics TEXT,                          -- JSON [{t,at}]: recent video topics — anti-repeat ledger
  updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS provider_usage (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  channel_id TEXT,
  kind TEXT,                            -- llm|tts
  provider TEXT,
  model TEXT,
  prompt_tokens INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  chars INTEGER DEFAULT 0,
  credits REAL DEFAULT 0,
  est_cost REAL DEFAULT 0,              -- USD estimate at record time (pricing.js version)
  at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_usage_project ON provider_usage(project_id, at);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                   -- pipeline|render
  project_id TEXT,
  batch_id TEXT,
  payload TEXT,                         -- JSON: executor opts (resume, mode, sceneIds…)
  status TEXT DEFAULT 'queued',         -- queued|running|done|error|cancelled
  priority INTEGER DEFAULT 0,           -- higher first; batch items enqueue at -1
  attempts INTEGER DEFAULT 0,
  error TEXT,
  created_at INTEGER,
  started_at INTEGER,
  finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_jobs_claim ON jobs(status, priority DESC, created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_project ON jobs(project_id, created_at);
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

// Versioned migrations run AFTER every CREATE TABLE block (so migrations may reference any
// table) and BEFORE db/index.js's bootstrap issues its first query.
migrate(db);

export default db;
