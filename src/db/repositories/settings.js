// Key/value app settings + the AI provider defaults layered under channel/project overrides.
import db from '../connection.js';
import { safeJson } from '../../util/util.js';

const _getSetting = db.prepare('SELECT value FROM settings WHERE key=?');
const _setSetting = db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');

/** @param {string} key @param {*} [fallback] @returns {*} parsed JSON value or the raw string */
export function getSetting(key, fallback = null) {
  const row = _getSetting.get(key);
  return row ? safeJson(row.value, row.value) : fallback;
}
/** @param {string} key @param {*} value stored as-is if string, else JSON-stringified */
export function setSetting(key, value) {
  _setSetting.run(key, typeof value === 'string' ? value : JSON.stringify(value));
}

export const DEFAULT_SETTINGS = {
  llm: { baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4o-mini', enabled: false },
  // 'edge' = Microsoft neural voices (free, needs internet, auto-falls back to say offline).
  // 'auto' voices resolve per-scene from the detected text language — never a wrong-language voice.
  tts: { provider: 'edge', edgeVoice: 'auto', voice: 'auto', rate: 175, apiKey: '', voiceId: '', model: '' },
  // 'align'    = forced alignment: whisper's word TIMESTAMPS + the script's exact WORDS —
  //              the default: tight karaoke timing that can never mis-spell the script.
  // 'estimate' = known script text with length-weighted timing (no whisper needed).
  // 'whisper'  = raw re-transcription (only better when the audio text is unknown).
  subtitle: { engine: 'align' },
  imageSearch: { provider: 'none', apiKey: '' },
  // Real AI image per scene. 'pollinations' is free + keyless (default). 'openai' or 'none' too.
  imageGen: { provider: 'pollinations', model: 'flux', apiKey: '', baseUrl: 'https://api.openai.com/v1' },
};

/** @returns {typeof DEFAULT_SETTINGS} defaults merged with the saved 'ai' setting */
export function aiSettings() {
  const s = getSetting('ai', null);
  return { ...DEFAULT_SETTINGS, ...(s || {}) };
}
