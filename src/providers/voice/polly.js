// Amazon Polly — and the only provider in this roster that returns real word timestamps.
//
// Polly's speech marks are a second, cheap call against the same text and voice that returns
// `{time, type:'word', start, end, value}` per word. That lets the subtitle lane skip whisper
// entirely: the caption shows the script's own words, timed by the engine that spoke them, with
// no transcription pass to mis-hear a proper noun. Only ElevenLabs does the same today.
//
// It is also the one provider that will not take an API key, so it is signed. See aws-sig.js for
// why that is sixty lines here instead of a dependency.
import { writeFileSync } from 'node:fs';
import { probeDuration } from '../../media/ffmpeg.js';
import { recordUsage } from '../../util/usage.js';
import { signRequest } from './aws-sig.js';

const host = (cfg) => `polly.${String(cfg?.region || 'us-east-1').trim()}.amazonaws.com`;

const AUTO = {
  vi: 'Danielle', en: 'Joanna', ja: 'Tomoko', ko: 'Seoyeon', zh: 'Zhiyu', ru: 'Tatyana',
  fr: 'Lea', de: 'Vicki', es: 'Lucia', pt: 'Camila', hi: 'Kajal', id: 'Sofie', th: 'Bua',
};

/** Every request to Polly: sign, send, and turn a failure into something readable. */
async function call(cfg, path, payload, { accept = null } = {}) {
  const body = JSON.stringify(payload);
  const h = signRequest({
    method: 'POST', host: host(cfg), path, body,
    region: cfg?.region || 'us-east-1', service: 'polly',
    accessKeyId: cfg?.accessKeyId, secretAccessKey: cfg?.secretAccessKey,
  });
  const res = await fetch(`https://${host(cfg)}${path}`, {
    method: 'POST',
    headers: { ...h, 'Content-Type': 'application/json', ...(accept ? { Accept: accept } : {}) },
    body,
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`Polly ${res.status}: ${(await res.text()).slice(0, 160)}`);
  return res;
}

/**
 * Speech marks arrive as newline-delimited JSON, one object per mark — not as a JSON array.
 * `time` and the character offsets are integers in milliseconds and bytes respectively; only the
 * word text and its start time survive into a cue, and the end is the next word's start.
 */
export function parseSpeechMarks(ndjson, totalMs) {
  const marks = String(ndjson || '').split('\n').map((l) => l.trim()).filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((m) => m && m.type === 'word' && m.value);
  if (!marks.length) return null;
  return marks.map((m, i) => ({
    word: m.value,
    start: +(m.time / 1000).toFixed(3),
    end: +(((i + 1 < marks.length ? marks[i + 1].time : (totalMs ?? m.time + 400))) / 1000).toFixed(3),
  }));
}

export default {
  id: 'polly', name: 'Amazon Polly', free: false, needsNetwork: true, ext: '.mp3',
  configSchema: [
    { key: 'accessKeyId', label: 'Access Key ID', type: 'password', required: true },
    { key: 'secretAccessKey', label: 'Secret Access Key', type: 'password', required: true },
    { key: 'region', label: 'Region', type: 'text', required: true, placeholder: 'us-east-1' },
    {
      key: 'engine', label: 'Engine', type: 'select', required: false,
      options: [
        { value: 'neural', label: 'Neural — cân bằng, có ở hầu hết giọng' },
        { value: 'generative', label: 'Generative — tự nhiên nhất, ít giọng hơn' },
        { value: 'long-form', label: 'Long-form — cho video dài' },
        { value: 'standard', label: 'Standard — rẻ nhất, máy móc hơn' },
      ],
    },
  ],
  autoVoiceFor: (lang) => AUTO[lang] || AUTO.en,

  async listVoices(cfg) {
    if (!cfg?.accessKeyId || !cfg?.secretAccessKey) return [];
    // The voice list is a GET, so it signs an empty body rather than a payload.
    const h = signRequest({
      method: 'GET', host: host(cfg), path: '/v1/voices', body: '',
      region: cfg.region || 'us-east-1', service: 'polly',
      accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey,
    });
    const res = await fetch(`https://${host(cfg)}/v1/voices`, { headers: h, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`Polly voices ${res.status}`);
    return ((await res.json()).Voices || []).map((v) => ({
      id: v.Id,
      name: `${v.Name} (${v.LanguageCode})`,
      lang: String(v.LanguageCode || '').slice(0, 2).toLowerCase(),
      locale: v.LanguageCode,
      gender: (v.Gender || 'U')[0].toLowerCase(),
      tags: (v.SupportedEngines || []).slice(0, 3),
      provider: 'polly',
    }));
  },

  async synthesize(text, voiceId, cfg, outPath, opts = {}) {
    if (!cfg?.accessKeyId || !cfg?.secretAccessKey) throw new Error('Chưa nhập AWS Access Key');
    const VoiceId = voiceId && voiceId !== 'auto' ? voiceId : (AUTO[opts.lang] || AUTO.en);
    const Engine = cfg?.engine || 'neural';
    const base = { Text: String(text), TextType: 'text', VoiceId, Engine };

    const audio = await call(cfg, '/v1/speech', { ...base, OutputFormat: 'mp3' });
    writeFileSync(outPath, Buffer.from(await audio.arrayBuffer()));
    const duration = await probeDuration(outPath);
    recordUsage('tts', { provider: 'polly', chars: String(text).length });

    // Word timing is a bonus, never a requirement: a scene must still ship if this call fails,
    // and the subtitle lane already knows how to fall back to alignment.
    let words = null;
    try {
      const marks = await call(cfg, '/v1/speech', { ...base, OutputFormat: 'json', SpeechMarkTypes: ['word'] });
      words = parseSpeechMarks(await marks.text(), duration ? duration * 1000 : null);
    } catch { /* the audio is what matters */ }
    return { path: outPath, duration, ...(words?.length ? { words } : {}) };
  },

  async testConnection(cfg) {
    if (!cfg?.accessKeyId || !cfg?.secretAccessKey) return { ok: false, message: 'Chưa nhập Access Key ID / Secret' };
    try {
      const voices = await this.listVoices(cfg);
      if (!voices.length) return { ok: false, message: 'Không lấy được danh sách giọng' };
      const langs = new Set(voices.map((v) => v.locale));
      return { ok: true, message: `OK — ${voices.length} giọng, ${langs.size} ngôn ngữ` };
    } catch (e) {
      const m = /403|401|InvalidSignature|SignatureDoesNotMatch/.test(e.message)
        ? 'Key hoặc region không đúng' : e.message;
      return { ok: false, message: m };
    }
  },
};
