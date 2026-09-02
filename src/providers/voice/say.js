// macOS `say` — fully offline fallback.
import { listVoices as sayList, synthesize as saySynth, pickVoice } from '../../media/say.js';
import { detectLang } from '../../util/lang.js';

const LOCALE = { vi: 'vi_VN', en: 'en_US', ja: 'ja_JP', ko: 'ko_KR', zh: 'zh_CN', ru: 'ru_RU', fr: 'fr_FR', de: 'de_DE', es: 'es_ES' };

export default {
  id: 'say', name: 'macOS say (offline)', free: true, needsNetwork: false,
  ext: '.m4a',
  configSchema: [
    { key: 'rate', label: 'Tốc độ đọc (từ/phút)', type: 'text', required: false, placeholder: '175' },
  ],
  // async resolution happens in synthesize when voiceId === 'auto'
  autoVoiceFor: () => 'auto',

  async listVoices() {
    const raw = await sayList();
    return raw.map((v) => ({
      id: v.name, name: v.name,
      lang: (v.locale || '').split('_')[0] || 'en', locale: v.locale,
      gender: 'u', tags: ['offline'], provider: 'say',
    }));
  },

  async synthesize(text, voiceId, cfg, outPath) {
    let voice = voiceId;
    if (!voice || voice === 'auto') {
      voice = await pickVoice(LOCALE[detectLang(text)] || 'en_US');
    }
    return saySynth(text, { voice, rate: parseInt(cfg?.rate || 175, 10), outPath });
  },

  async testConnection() {
    const voices = await this.listVoices();
    return { ok: voices.length > 0, message: `OK — ${voices.length} giọng hệ thống (offline)` };
  },
};
