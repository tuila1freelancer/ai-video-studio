// OpenAI TTS (or any OpenAI-compatible /audio/speech endpoint).
import { writeFileSync } from 'node:fs';
import { probeDuration } from '../../media/ffmpeg.js';

const VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse'];

export default {
  id: 'openai', name: 'OpenAI TTS', free: false, needsNetwork: true,
  configSchema: [
    { key: 'apiKey', label: 'API Key', type: 'password', required: true, placeholder: 'sk-…' },
    { key: 'baseUrl', label: 'Base URL', type: 'text', required: false, placeholder: 'https://api.openai.com/v1' },
    { key: 'model', label: 'Model', type: 'text', required: false, placeholder: 'gpt-4o-mini-tts' },
  ],
  autoVoiceFor: () => 'alloy', // multilingual voices — one default is fine

  async listVoices() {
    return VOICES.map((v) => ({ id: v, name: v, lang: 'multi', locale: 'multi', gender: 'u', tags: ['multilingual'], provider: 'openai' }));
  },

  async synthesize(text, voiceId, cfg, outPath) {
    const res = await fetch(`${(cfg?.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '')}/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg?.apiKey}` },
      body: JSON.stringify({ model: cfg?.model || 'gpt-4o-mini-tts', voice: voiceId || 'alloy', input: text, format: 'mp3' }),
    });
    if (!res.ok) throw new Error(`OpenAI TTS ${res.status}: ${(await res.text()).slice(0, 160)}`);
    writeFileSync(outPath, Buffer.from(await res.arrayBuffer()));
    return { path: outPath, duration: await probeDuration(outPath) };
  },

  async testConnection(cfg) {
    if (!cfg?.apiKey) return { ok: false, message: 'Chưa nhập API Key' };
    try {
      const res = await fetch(`${(cfg.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '')}/models`, {
        headers: { Authorization: `Bearer ${cfg.apiKey}` }, signal: AbortSignal.timeout(10000),
      });
      return res.ok ? { ok: true, message: 'Kết nối OK' } : { ok: false, message: `HTTP ${res.status} — key sai hoặc hết hạn?` };
    } catch (e) { return { ok: false, message: e.message }; }
  },
};
