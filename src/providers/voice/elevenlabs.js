// ElevenLabs — premium multilingual voices (needs API key).
import { writeFileSync } from 'node:fs';
import { probeDuration } from '../../media/ffmpeg.js';
import { recordUsage } from '../../util/usage.js';

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
    if (!voiceId) throw new Error('Chưa chọn voice ElevenLabs');
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'xi-api-key': cfg?.apiKey },
      body: JSON.stringify({ text, model_id: cfg?.model || 'eleven_multilingual_v2' }),
    });
    if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 160)}`);
    writeFileSync(outPath, Buffer.from(await res.arrayBuffer()));
    recordUsage('tts', { provider: 'elevenlabs', chars: String(text).length });
    return { path: outPath, duration: await probeDuration(outPath) };
  },

  async testConnection(cfg) {
    if (!cfg?.apiKey) return { ok: false, message: 'Chưa nhập API Key' };
    try {
      const res = await fetch('https://api.elevenlabs.io/v1/user', {
        headers: { 'xi-api-key': cfg.apiKey }, signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return { ok: false, message: `HTTP ${res.status} — key không hợp lệ?` };
      const u = await res.json();
      const used = u.subscription?.character_count ?? '?', limit = u.subscription?.character_limit ?? '?';
      return { ok: true, message: `OK — đã dùng ${used}/${limit} ký tự` };
    } catch (e) { return { ok: false, message: e.message }; }
  },
};
