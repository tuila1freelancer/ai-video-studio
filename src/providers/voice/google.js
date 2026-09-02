// Google Cloud Text-to-Speech — ~50 languages, and the strongest voices in the set for Hindi,
// Thai and Indonesian, which is exactly where the rest of this roster is thinnest.
//
// The catalogue is large and mostly uninteresting: every language ships a row of Standard voices
// nobody should pick when a Neural2/Chirp/Wavenet voice exists beside it. They are all listed —
// hiding options is worse than ordering them — but the tags say which is which so the picker can
// sort, and `auto` never lands on a Standard voice.
import { writeFileSync } from 'node:fs';
import { probeDuration } from '../../media/ffmpeg.js';
import { recordUsage } from '../../util/usage.js';

const API = 'https://texttospeech.googleapis.com/v1';

// Locale per language; the voice NAME carries the tier, and `auto` resolves it from the live
// catalogue rather than pinning a name that Google may retire.
const LOCALE = {
  vi: 'vi-VN', en: 'en-US', ja: 'ja-JP', ko: 'ko-KR', zh: 'cmn-CN', ru: 'ru-RU',
  fr: 'fr-FR', de: 'de-DE', es: 'es-US', pt: 'pt-BR', hi: 'hi-IN', th: 'th-TH', id: 'id-ID',
};

// Best tier first — a Standard voice is the one nobody wants and the one alphabetical order picks.
const TIER = ['Chirp3-HD', 'Chirp-HD', 'Neural2', 'Studio', 'Wavenet', 'Polyglot', 'News', 'Standard'];
const tierOf = (name) => TIER.find((t) => name.includes(t)) || 'Standard';

export default {
  id: 'google', name: 'Google Cloud TTS', free: false, needsNetwork: true, ext: '.mp3',
  configSchema: [
    { key: 'apiKey', label: 'API Key', type: 'password', required: true },
    { key: 'speed', label: 'Tốc độ đọc (0.25–4.0)', type: 'text', required: false, placeholder: '1.0' },
    { key: 'pitch', label: 'Cao độ (-20 đến 20)', type: 'text', required: false, placeholder: '0' },
  ],
  autoVoiceFor: (lang) => `${LOCALE[lang] || LOCALE.en}//auto`,

  async listVoices(cfg) {
    if (!cfg?.apiKey) return [];
    const res = await fetch(`${API}/voices?key=${encodeURIComponent(cfg.apiKey)}`, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`Google voices ${res.status}`);
    const out = [];
    for (const v of (await res.json()).voices || []) {
      const locale = (v.languageCodes || [])[0] || '';
      out.push({
        id: v.name,
        name: `${v.name} (${locale})`,
        // cmn-CN is Mandarin; its ISO-639-1 code is zh, and nothing else in the app knows 'cm'.
        lang: locale.startsWith('cmn') ? 'zh' : locale.slice(0, 2).toLowerCase(),
        locale,
        gender: (v.ssmlGender || 'U')[0].toLowerCase(),
        tags: [tierOf(v.name)],
        provider: 'google',
      });
    }
    return out;
  },

  async synthesize(text, voiceId, cfg, outPath, opts = {}) {
    if (!cfg?.apiKey) throw new Error('Chưa nhập Google API Key');
    // 'xx-XX//auto' from autoVoiceFor: let Google pick the locale's default rather than naming a
    // voice that may have been retired since this table was written.
    const [autoLocale] = String(voiceId || '').split('//auto');
    const auto = String(voiceId || '').endsWith('//auto');
    const name = auto ? null : voiceId;
    const languageCode = auto ? autoLocale : String(voiceId).split('-').slice(0, 2).join('-');
    const speakingRate = Number.parseFloat(cfg?.speed);
    const pitch = Number.parseFloat(cfg?.pitch);
    const res = await fetch(`${API}/text:synthesize?key=${encodeURIComponent(cfg.apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode: languageCode || LOCALE[opts.lang] || LOCALE.en, ...(name ? { name } : {}) },
        audioConfig: {
          audioEncoding: 'MP3',
          ...(Number.isFinite(speakingRate) && speakingRate > 0 ? { speakingRate: Math.min(4, Math.max(0.25, speakingRate)) } : {}),
          ...(Number.isFinite(pitch) && pitch !== 0 ? { pitch: Math.min(20, Math.max(-20, pitch)) } : {}),
        },
      }),
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) throw new Error(`Google TTS ${res.status}: ${(await res.text()).slice(0, 160)}`);
    const data = await res.json();
    if (!data.audioContent) throw new Error('Google TTS: phản hồi không có audio');
    writeFileSync(outPath, Buffer.from(data.audioContent, 'base64'));
    recordUsage('tts', { provider: 'google', chars: String(text).length });
    return { path: outPath, duration: await probeDuration(outPath) };
  },

  async testConnection(cfg) {
    if (!cfg?.apiKey) return { ok: false, message: 'Chưa nhập API Key' };
    try {
      const res = await fetch(`${API}/voices?key=${encodeURIComponent(cfg.apiKey)}`, { signal: AbortSignal.timeout(15000) });
      if (res.status === 400 || res.status === 403) return { ok: false, message: 'Key không hợp lệ hoặc chưa bật Text-to-Speech API' };
      if (!res.ok) return { ok: false, message: `HTTP ${res.status}` };
      const voices = (await res.json()).voices || [];
      const langs = new Set(voices.flatMap((v) => v.languageCodes || []));
      return { ok: true, message: `OK — ${voices.length} giọng, ${langs.size} ngôn ngữ` };
    } catch (e) { return { ok: false, message: e.message }; }
  },
};
