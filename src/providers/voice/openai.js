// OpenAI TTS (or any OpenAI-compatible /audio/speech endpoint).
import { writeFileSync } from 'node:fs';
import { probeDuration } from '../../media/ffmpeg.js';
import { presetById, presetsForLane } from '../llm-presets.js';
import { recordUsage } from '../../util/usage.js';

import { m, tp } from '../../i18n/t.js';
const VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse'];

// Several providers speak the same /audio/speech shape — Groq's playai-tts is free where
// OpenAI's is not. Offer them by name and fill the endpoint in, same as the LLM lane.
const PRESETS = presetsForLane('tts').filter((p) => p.id !== 'custom');
const PRESET_OPTIONS = [
  ...PRESETS.map((p) => ({ value: p.id, label: p.label })),
  { value: 'custom', label: '✏️ Tuỳ chỉnh (tự nhập Base URL)' },
];

/** The endpoint root and default model this config resolves to. */
function endpointFor(cfg) {
  const p = cfg?.preset && cfg.preset !== 'custom' ? presetById(cfg.preset) : null;
  return {
    base: String(p?.baseUrl || cfg?.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, ''),
    model: cfg?.model || (typeof p?.lanes?.tts === 'object' ? p.lanes.tts.model : '') || 'gpt-4o-mini-tts',
  };
}

export default {
  id: 'openai', name: 'OpenAI TTS', free: false, needsNetwork: true,
  configSchema: [
    { key: 'preset', label: 'Nhà cung cấp', type: 'select', options: PRESET_OPTIONS },
    { key: 'apiKey', label: 'API Key', type: 'password', required: true, placeholder: 'sk-…' },
    { key: 'baseUrl', label: 'Base URL (chỉ khi chọn Tuỳ chỉnh)', type: 'text', required: false, placeholder: 'https://api.openai.com/v1' },
    { key: 'model', label: 'Model', type: 'text', required: false, placeholder: 'gpt-4o-mini-tts' },
  ],
  autoVoiceFor: () => 'alloy', // multilingual voices — one default is fine

  async listVoices() {
    return VOICES.map((v) => ({ id: v, name: v, lang: 'multi', locale: 'multi', gender: 'u', tags: ['multilingual'], provider: 'openai' }));
  },

  async synthesize(text, voiceId, cfg, outPath) {
    // prosody hint from the pipeline (cfg._style) → natural-language delivery instructions
    const instructions = cfg?._style === 'energetic'
      ? 'Speak with energy and excitement, upbeat pacing, confident tone.'
      : cfg?._style === 'calm' ? 'Speak calmly and warmly, relaxed pacing, gentle tone.' : null;
    const { base, model } = endpointFor(cfg);
    const res = await fetch(`${base}/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg?.apiKey}` },
      body: JSON.stringify({ model, voice: voiceId || 'alloy', input: text, format: 'mp3',
        ...(instructions ? { instructions } : {}) }),
      signal: AbortSignal.timeout(120000), // a hung provider used to hang the scene forever
    });
    if (!res.ok) throw new Error(`OpenAI TTS ${res.status}: ${(await res.text()).slice(0, 160)}`);
    writeFileSync(outPath, Buffer.from(await res.arrayBuffer()));
    recordUsage('tts', { provider: 'openai', chars: String(text).length });
    return { path: outPath, duration: await probeDuration(outPath) };
  },

  async testConnection(cfg) {
    if (!cfg?.apiKey) return { ok: false, message: m('Chưa nhập API Key') };
    try {
      const res = await fetch(`${endpointFor(cfg).base}/models`, {
        headers: { Authorization: `Bearer ${cfg.apiKey}` }, signal: AbortSignal.timeout(10000),
      });
      return res.ok ? { ok: true, message: m('Kết nối OK') } : { ok: false, message: tp`HTTP ${res.status} — key sai hoặc hết hạn?` };
    } catch (e) { return { ok: false, message: e.message }; }
  },
};
