// Channels (a YouTube channel = its own output folder + AI config) and their named presets.
import { join } from 'node:path';
import { homedir } from 'node:os';
import { writeFileSync } from 'node:fs';
import db, { stmt } from '../connection.js';
import { getSetting, setSetting } from './settings.js';
import { DATA_DIR, projectDirIn, ensureChannelDirs } from '../../config/paths.js';
import { newId, safeJson } from '../../util/util.js';
import { maskSecrets } from '../../util/secrets.js';

import { m } from '../../i18n/t.js';
function slugify(name) {
  return String(name || 'kenh').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'kenh';
}
function rowToChannel(r) { return r ? { ...r, config: safeJson(r.config, {}) } : null; }

export function listChannels() { return stmt('SELECT * FROM channels ORDER BY created_at ASC').all().map(rowToChannel); }
export function getChannel(id) { return rowToChannel(stmt('SELECT * FROM channels WHERE id=?').get(id)); }

export function writeChannelJson(ch) {
  // exported to the user's folder → never write real API keys to disk
  try { writeFileSync(join(ch.root_dir, 'channel.json'), JSON.stringify({ name: ch.name, slug: ch.slug, config: maskSecrets(ch.config || {}), exported_at: new Date().toISOString() }, null, 2)); }
  catch { /* folder may be missing/readonly — non-fatal */ }
}

// Bumped on every write so read-side caches (the /api/file root list) know when to rebuild.
let version = 0;
export function channelsVersion() { return version; }

export function createChannel({ name, rootDir, config = {} }) {
  version += 1;
  const slug0 = slugify(name);
  let slug = slug0, n = 1;
  while (stmt('SELECT 1 FROM channels WHERE slug=?').get(slug)) slug = `${slug0}-${++n}`;
  const root = rootDir && rootDir.trim()
    ? rootDir.trim().replace(/^~(?=\/|$)/, homedir())
    : join(homedir(), 'Movies', 'AI Video Studio', slug);
  const id = newId('ch');
  ensureChannelDirs(root);
  stmt('INSERT INTO channels(id,name,slug,root_dir,config,created_at) VALUES(?,?,?,?,?,?)')
    .run(id, name, slug, root, JSON.stringify(config), Date.now());
  const ch = getChannel(id);
  writeChannelJson(ch);
  return ch;
}

export function updateChannel(id, fields) {
  version += 1;
  const ch = getChannel(id);
  if (!ch) return null;
  const name = fields.name ?? ch.name;
  const root = fields.rootDir ? fields.rootDir.replace(/^~(?=\/|$)/, homedir()) : ch.root_dir;
  const config = fields.config !== undefined ? fields.config : ch.config;
  ensureChannelDirs(root);
  stmt('UPDATE channels SET name=?, root_dir=?, config=? WHERE id=?')
    .run(name, root, JSON.stringify(config), id);
  const out = getChannel(id);
  writeChannelJson(out);
  return out;
}

export function deleteChannel(id) {
  version += 1;
  const def = defaultChannel();
  if (id === def.id) throw new Error(m('Không thể xoá kênh Default'));
  // unlink only — never delete files on disk; one transaction so a crash cannot orphan projects
  db.transaction(() => {
    stmt('UPDATE projects SET channel_id=? WHERE channel_id=?').run(def.id, id);
    stmt('DELETE FROM channels WHERE id=?').run(id);
    if (activeChannelId() === id) setSetting('activeChannel', def.id);
  })();
}

export function defaultChannel() {
  let ch = rowToChannel(stmt("SELECT * FROM channels WHERE slug='default'").get());
  if (!ch) {
    const id = newId('ch');
    stmt('INSERT INTO channels(id,name,slug,root_dir,config,created_at) VALUES(?,?,?,?,?,?)')
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
  const p = stmt('SELECT * FROM projects WHERE id=?').get(projectId);
  return (p && p.channel_id && getChannel(p.channel_id)) || defaultChannel();
}

// Channel-aware project working dir (Default channel → original data/projects/<id> layout).
export function projectDirFor(projectId) {
  return projectDirIn(channelOf(projectId).root_dir, projectId);
}

// ---- channel presets (named output configs per channel) ----
function rowToPreset(r) { return r ? { ...r, config: safeJson(r.config, {}), is_default: !!r.is_default } : null; }
export function listPresets(channelId) {
  return stmt('SELECT * FROM channel_presets WHERE channel_id=? ORDER BY created_at ASC')
    .all(channelId).map(rowToPreset);
}
export function getPreset(id) {
  return rowToPreset(stmt('SELECT * FROM channel_presets WHERE id=?').get(id));
}
export function defaultPresetFor(channelId) {
  return rowToPreset(stmt('SELECT * FROM channel_presets WHERE channel_id=? AND is_default=1').get(channelId));
}
const _setDefaultPreset = db.transaction((channelId, presetId) => {
  stmt('UPDATE channel_presets SET is_default=0 WHERE channel_id=?').run(channelId);
  stmt('UPDATE channel_presets SET is_default=1 WHERE id=?').run(presetId);
});
export function createPreset({ channelId, name, config, isDefault = false }) {
  const id = newId('ps');
  stmt(`INSERT INTO channel_presets (id, channel_id, name, config, is_default, created_at)
    VALUES (?, ?, ?, ?, 0, ?)`).run(id, channelId, name || 'Preset', JSON.stringify(config || {}), Date.now());
  if (isDefault) _setDefaultPreset(channelId, id);
  return getPreset(id);
}
export function updatePreset(id, fields) {
  const cur = getPreset(id);
  if (!cur) return null;
  db.transaction(() => {
    if (fields.name !== undefined) stmt('UPDATE channel_presets SET name=? WHERE id=?').run(fields.name, id);
    if (fields.config !== undefined) stmt('UPDATE channel_presets SET config=? WHERE id=?').run(JSON.stringify(fields.config || {}), id);
    if (fields.isDefault === true) _setDefaultPreset(cur.channel_id, id);
    else if (fields.isDefault === false) stmt('UPDATE channel_presets SET is_default=0 WHERE id=?').run(id);
  })();
  return getPreset(id);
}
export function deletePreset(id) { stmt('DELETE FROM channel_presets WHERE id=?').run(id); }

// ---- Show Bible / channel memory ----------------------------------------------------
// One row per channel: an owner-editable "bible" block injected into script generation,
// plus a rolling anti-repeat ledger of recent video topics (deterministic write-back —
// runner appends after each finished video, best-effort).
export function getChannelMemory(channelId) {
  if (!channelId) return { bible: '', topics: [] };
  const r = stmt('SELECT * FROM channel_memory WHERE channel_id=?').get(channelId);
  return { bible: r?.bible || '', topics: safeJson(r?.topics, []) };
}

export function setChannelBible(channelId, bible) {
  const cur = getChannelMemory(channelId);
  stmt(`INSERT INTO channel_memory(channel_id,bible,topics,updated_at) VALUES(?,?,?,?)
    ON CONFLICT(channel_id) DO UPDATE SET bible=excluded.bible, updated_at=excluded.updated_at`)
    .run(channelId, String(bible || '').slice(0, 4000), JSON.stringify(cur.topics), Date.now());
  return getChannelMemory(channelId);
}

export function appendChannelTopic(channelId, title) {
  if (!channelId || !String(title || '').trim()) return;
  const cur = getChannelMemory(channelId);
  const topics = [...cur.topics, { t: String(title).slice(0, 120), at: Date.now() }].slice(-40);
  stmt(`INSERT INTO channel_memory(channel_id,bible,topics,updated_at) VALUES(?,?,?,?)
    ON CONFLICT(channel_id) DO UPDATE SET topics=excluded.topics, updated_at=excluded.updated_at`)
    .run(channelId, cur.bible, JSON.stringify(topics), Date.now());
}
