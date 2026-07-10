// Microsoft Edge neural TTS — free, keyless, ~400 voices across every major language.
import { writeFileSync } from 'node:fs';
import { probeDuration } from '../../media/ffmpeg.js';

const AUTO = {
  vi: 'vi-VN-HoaiMyNeural', en: 'en-US-AriaNeural', ja: 'ja-JP-NanamiNeural',
  ko: 'ko-KR-SunHiNeural', zh: 'zh-CN-XiaoxiaoNeural', ru: 'ru-RU-SvetlanaNeural',
  fr: 'fr-FR-DeniseNeural', de: 'de-DE-KatjaNeural', es: 'es-ES-ElviraNeural',
};

export default {
  id: 'edge', name: 'Edge Neural (miễn phí)', free: true, needsNetwork: true,
  configSchema: [],
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
        const { audioStream } = await tts.toStream(text);
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
    return { ok: voices.length > 0, message: `OK — ${voices.length} giọng khả dụng (không cần key)` };
  },
};
