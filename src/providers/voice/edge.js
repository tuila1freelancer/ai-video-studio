// Microsoft Edge neural TTS — free, keyless, ~400 voices across every major language.
import { writeFileSync } from 'node:fs';
import { probeDuration } from '../../media/ffmpeg.js';

import { m, tp } from '../../i18n/t.js';
const AUTO = {
  vi: 'vi-VN-HoaiMyNeural', en: 'en-US-AriaNeural', ja: 'ja-JP-NanamiNeural',
  ko: 'ko-KR-SunHiNeural', zh: 'zh-CN-XiaoxiaoNeural', ru: 'ru-RU-SvetlanaNeural',
  fr: 'fr-FR-DeniseNeural', de: 'de-DE-KatjaNeural', es: 'es-ES-ElviraNeural',
};

// SSML prosody — Edge accepts a signed percentage for rate/volume and semitones for pitch.
// The default free provider had NO controls at all (P40 audit), so a narration could not be
// slowed for a tutorial or lifted for a hook without paying for another provider.
const PCT = (v, lo, hi) => {
  const n = Number.parseFloat(v);
  if (!Number.isFinite(n) || n === 0) return null;
  return `${Math.round(Math.min(hi, Math.max(lo, n)) * 100) / 100 >= 0 ? '+' : ''}${Math.round(Math.min(hi, Math.max(lo, n)))}%`;
};
export function edgeProsody(cfg = {}) {
  const rate = PCT(cfg.rate, -50, 100);
  const volume = PCT(cfg.volume, -50, 100);
  const p = Number.parseFloat(cfg.pitch);
  const pitch = Number.isFinite(p) && p !== 0 ? `${p >= 0 ? '+' : ''}${Math.round(Math.min(24, Math.max(-24, p)))}Hz` : null;
  const out = {};
  if (rate) out.rate = rate;
  if (volume) out.volume = volume;
  if (pitch) out.pitch = pitch;
  return Object.keys(out).length ? out : null;
}

export default {
  id: 'edge', get name() { return m('Edge Neural (miễn phí)'); }, free: true, needsNetwork: true,
  configSchema: [
    { key: 'rate', label: 'Tốc độ (%) — âm là chậm hơn, vd -10', type: 'text', required: false, placeholder: '0' },
    { key: 'pitch', label: 'Cao độ (Hz) — vd +20 cho giọng tươi hơn', type: 'text', required: false, placeholder: '0' },
    { key: 'volume', label: 'Âm lượng (%) — vd +10', type: 'text', required: false, placeholder: '0' },
  ],
  autoVoiceFor: (lang) => AUTO[lang] || AUTO.en,

  async listVoices() {
    const { MsEdgeTTS } = await import('msedge-tts');
    const raw = await new MsEdgeTTS().getVoices();
    return raw.map((v) => ({
      id: v.ShortName,
      name: (v.FriendlyName || v.ShortName).replace(/^Microsoft\s+/, '').replace(/\s+Online.*$/, ''),
      lang: (v.Locale || '').split('-')[0] || 'en',
      locale: v.Locale,
      gender: (v.Gender || '').toLowerCase().startsWith('f') ? 'f' : 'm',
      tags: [],
      provider: 'edge',
    }));
  },

  async synthesize(text, voiceId, cfg, outPath) {
    const { MsEdgeTTS, OUTPUT_FORMAT } = await import('msedge-tts');
    let lastErr;
    for (let i = 0; i < 3; i++) {
      try {
        const tts = new MsEdgeTTS();
        await tts.setMetadata(voiceId, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
        // Prosody rides in the SSML; an empty knob set means the historic call, byte for byte.
        const prosody = edgeProsody(cfg);
        const { audioStream } = prosody ? await tts.toStream(text, prosody) : await tts.toStream(text);
        const chunks = [];
        for await (const c of audioStream) chunks.push(c);
        const buf = Buffer.concat(chunks);
        if (buf.length < 800) throw new Error('edge returned empty audio');
        writeFileSync(outPath, buf);
        return { path: outPath, duration: await probeDuration(outPath) };
      } catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 600 + i * 900)); }
    }
    throw lastErr || new Error('edge tts failed');
  },

  async testConnection() {
    const voices = await this.listVoices();
    return { ok: voices.length > 0, message: tp`OK — ${voices.length} giọng khả dụng (không cần key)` };
  },
};
