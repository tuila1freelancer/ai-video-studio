// Azure AI Speech — the widest language coverage of any provider here (~150 locales).
//
// The keyless `edge` provider already speaks to this engine through Microsoft Edge's read-aloud
// endpoint, which is an undocumented back door: no quota, no support, and nothing to appeal to
// when it changes. This is the same voices through the front door, plus two things the back door
// cannot offer — HD voices, and `mstts:express-as` speaking styles, which is the first provider
// that can actually use the per-scene mood the pipeline has been computing all along.
import { writeFileSync } from 'node:fs';
import { probeDuration } from '../../media/ffmpeg.js';
import { recordUsage } from '../../util/usage.js';
import { escapeXml, ssmlProsody } from './ssml.js';

import { tp } from '../../i18n/t.js';
const host = (cfg) => `${String(cfg?.region || 'eastus').trim()}.tts.speech.microsoft.com`;

// One sensible default per language, so 'auto' never has to guess from a list of four hundred.
const AUTO = {
  vi: 'vi-VN-HoaiMyNeural', en: 'en-US-AvaMultilingualNeural', ja: 'ja-JP-NanamiNeural',
  ko: 'ko-KR-SunHiNeural', zh: 'zh-CN-XiaoxiaoNeural', ru: 'ru-RU-SvetlanaNeural',
  fr: 'fr-FR-DeniseNeural', de: 'de-DE-KatjaNeural', es: 'es-ES-ElviraNeural',
  pt: 'pt-BR-FranciscaNeural', hi: 'hi-IN-SwaraNeural', th: 'th-TH-PremwadeeNeural',
  id: 'id-ID-GadisNeural',
};

// The pipeline's mood hint → the closest style every expressive Azure voice supports. A voice
// that does not support the style ignores the tag, so this can never cost a synthesis.
const STYLE = { energetic: 'excited', calm: 'gentle' };

export default {
  id: 'azure', name: 'Azure Speech (Microsoft)', free: false, needsNetwork: true, ext: '.mp3',
  configSchema: [
    { key: 'apiKey', label: 'Subscription Key', type: 'password', required: true },
    { key: 'region', label: 'Region', type: 'text', required: true, placeholder: 'southeastasia' },
    { key: 'rate', label: 'Tốc độ đọc (-50 đến +100, %)', type: 'text', required: false, placeholder: '0' },
    { key: 'pitch', label: 'Cao độ (-24 đến +24, semitone)', type: 'text', required: false, placeholder: '0' },
  ],
  autoVoiceFor: (lang) => AUTO[lang] || AUTO.en,

  async listVoices(cfg) {
    if (!cfg?.apiKey) return [];
    const res = await fetch(`https://${host(cfg)}/cognitiveservices/voices/list`, {
      headers: { 'Ocp-Apim-Subscription-Key': cfg.apiKey }, signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`Azure voices ${res.status}`);
    return (await res.json()).map((v) => ({
      id: v.ShortName,
      name: `${v.LocalName || v.DisplayName} (${v.Locale})`,
      lang: String(v.Locale || '').slice(0, 2).toLowerCase(),
      locale: v.Locale,
      gender: (v.Gender || 'U')[0].toLowerCase(),
      tags: [v.VoiceType === 'Neural' ? 'neural' : v.VoiceType, ...(v.StyleList || []).slice(0, 2)].filter(Boolean),
      provider: 'azure',
    }));
  },

  async synthesize(text, voiceId, cfg, outPath, opts = {}) {
    const voice = voiceId && voiceId !== 'auto' ? voiceId : (AUTO[opts.lang] || AUTO.en);
    const locale = voice.split('-').slice(0, 2).join('-') || 'en-US';
    const style = STYLE[cfg?._style];
    const inner = ssmlProsody(escapeXml(text), cfg);
    const body = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" `
      + `xmlns:mstts="http://www.w3.org/2001/mstts" xml:lang="${locale}">`
      + `<voice name="${voice}">`
      + (style ? `<mstts:express-as style="${style}">${inner}</mstts:express-as>` : inner)
      + '</voice></speak>';
    const res = await fetch(`https://${host(cfg)}/cognitiveservices/v1`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': cfg?.apiKey,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-24khz-96kbitrate-mono-mp3',
        'User-Agent': 'AIVideoStudio',
      },
      body,
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) throw new Error(`Azure ${res.status}: ${(await res.text()).slice(0, 160)}`);
    writeFileSync(outPath, Buffer.from(await res.arrayBuffer()));
    recordUsage('tts', { provider: 'azure', chars: String(text).length });
    return { path: outPath, duration: await probeDuration(outPath) };
  },

  async testConnection(cfg) {
    if (!cfg?.apiKey) return { ok: false, message: 'Chưa nhập Subscription Key' };
    if (!cfg?.region) return { ok: false, message: 'Chưa nhập Region (ví dụ: southeastasia)' };
    try {
      const res = await fetch(`https://${host(cfg)}/cognitiveservices/voices/list`, {
        headers: { 'Ocp-Apim-Subscription-Key': cfg.apiKey }, signal: AbortSignal.timeout(15000),
      });
      if (res.status === 401 || res.status === 403) return { ok: false, message: 'Key hoặc region không đúng' };
      if (!res.ok) return { ok: false, message: `HTTP ${res.status}` };
      const list = await res.json();
      const langs = new Set(list.map((v) => v.Locale));
      return { ok: true, message: tp`OK — ${list.length} giọng, ${langs.size} ngôn ngữ` };
    } catch (e) { return { ok: false, message: e.message }; }
  },
};
