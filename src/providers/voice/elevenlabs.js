// ElevenLabs — premium multilingual voices (needs API key).
import { writeFileSync } from 'node:fs';
import { probeDuration } from '../../media/ffmpeg.js';
import { recordUsage } from '../../util/usage.js';
import { failed } from '../../core/errors.js';

import { m, tp } from '../../i18n/t.js';
// { characters:[], character_start_times_seconds:[], character_end_times_seconds:[] }
// → word timings: whitespace splits words, each word spans its first→last character.
function charAlignmentToWords(text, alignment) {
  const chars = alignment?.characters, t0 = alignment?.character_start_times_seconds, t1 = alignment?.character_end_times_seconds;
  if (!Array.isArray(chars) || !Array.isArray(t0) || !Array.isArray(t1) || chars.length !== t0.length) return null;
  const words = [];
  let cur = null;
  for (let i = 0; i < chars.length; i++) {
    if (/\s/.test(chars[i])) { if (cur) { words.push(cur); cur = null; } continue; }
    if (!cur) cur = { start: t0[i], end: t1[i], word: chars[i] };
    else { cur.word += chars[i]; cur.end = t1[i]; }
  }
  if (cur) words.push(cur);
  return words.map((w) => ({ start: +(+w.start).toFixed(3), end: +(+w.end).toFixed(3), word: w.word }));
}

export default {
  id: 'elevenlabs', name: 'ElevenLabs', free: false, needsNetwork: true,
  configSchema: [
    { key: 'apiKey', label: 'API Key (xi-api-key)', type: 'password', required: true },
    { key: 'model', label: 'Model', type: 'text', required: false, placeholder: 'eleven_multilingual_v2' },
  ],
  autoVoiceFor: () => null, // must pick from the user's voice library

  async listVoices(cfg) {
    if (!cfg?.apiKey) return [];
    const res = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: { 'xi-api-key': cfg.apiKey }, signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`ElevenLabs voices ${res.status}`);
    const data = await res.json();
    return (data.voices || []).map((v) => ({
      id: v.voice_id, name: v.name,
      lang: 'multi', locale: 'multi',
      gender: (v.labels?.gender || 'u')[0],
      tags: Object.values(v.labels || {}).slice(0, 3),
      provider: 'elevenlabs',
      previewUrl: v.preview_url || null, // ElevenLabs ships its own sample mp3
    }));
  },

  async synthesize(text, voiceId, cfg, outPath) {
    if (!voiceId) throw failed('config.no-voice', m('Chưa chọn voice ElevenLabs'));
    // prosody hint from the pipeline (cfg._style): expressive voice_settings per mood
    const vs = cfg?._style === 'energetic' ? { stability: 0.35, similarity_boost: 0.85, style: 0.55 }
      : cfg?._style === 'calm' ? { stability: 0.7, similarity_boost: 0.85, style: 0.15 } : null;
    const body = JSON.stringify({ text, model_id: cfg?.model || 'eleven_multilingual_v2', ...(vs ? { voice_settings: vs } : {}) });
    const headers = { 'Content-Type': 'application/json', 'xi-api-key': cfg?.apiKey };
    // with-timestamps returns character-level alignment alongside the audio — perfect
    // word timing for the exact script, no transcription pass needed downstream.
    let words = null;
    let res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`, { method: 'POST', headers, body });
    if (res.ok) {
      const data = await res.json();
      writeFileSync(outPath, Buffer.from(data.audio_base64, 'base64'));
      words = charAlignmentToWords(text, data.alignment);
    } else {
      res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, { method: 'POST', headers, body });
      if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 160)}`);
      writeFileSync(outPath, Buffer.from(await res.arrayBuffer()));
    }
    recordUsage('tts', { provider: 'elevenlabs', chars: String(text).length });
    return { path: outPath, duration: await probeDuration(outPath), ...(words?.length ? { words } : {}) };
  },

  async testConnection(cfg) {
    if (!cfg?.apiKey) return { ok: false, message: m('Chưa nhập API Key') };
    try {
      const res = await fetch('https://api.elevenlabs.io/v1/user', {
        headers: { 'xi-api-key': cfg.apiKey }, signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return { ok: false, message: tp`HTTP ${res.status} — key không hợp lệ?` };
      const u = await res.json();
      const used = u.subscription?.character_count ?? '?', limit = u.subscription?.character_limit ?? '?';
      return { ok: true, message: tp`OK — đã dùng ${used}/${limit} ký tự` };
    } catch (e) { return { ok: false, message: e.message }; }
  },
};
