// VieNeu-TTS — a LOCAL, open-source Vietnamese–English voice (github.com/pnnbao97/VieNeu-TTS).
//
// Why it is here: its phonemizer tells "AI" (→ /eɪ aɪ/) from the pronoun "ai" and reads brand
// names in English, which the Vietnamese SaaS voices cannot. The v3 Turbo model and its preset
// voices are Apache-2.0 and cleared for monetised content (the older v1/v2 voices are CC BY-NC —
// do not point this provider at them). It speaks the OpenAI-style POST /v1/audio/speech of the
// repo's own `apps.openai_speech` server; the process lifecycle lives in ../../media/tts-server.js.
import { writeFileSync } from 'node:fs';
import { probeDuration } from '../../media/ffmpeg.js';
import { vieneuUrl, ensureVieneu, isAlive } from '../../media/tts-server.js';

import { m, tp } from '../../i18n/t.js';

const RATE = 48000;
// Measured 205–280 words/min across the presets; faster than this means words were dropped.
export const MAX_WPM = 340;

// v3 Turbo presets as shipped with SDK 3.8 — GET /v1/voices adds any voice enrolled at runtime.
// i18n-exempt: `name` is the voice's own name; the `note` beside it is a description.
const CATALOG = [
  ['Hải Đăng', 'm', 'Bắc · tự nhiên'], ['Adam bựa', 'm', 'Bắc · tự nhiên'], ['Phạm Tuyên', 'm', 'Bắc · tự nhiên'],
  ['Xuân Vĩnh', 'm', 'Bắc · tự nhiên'], ['Quốc Tuấn', 'm', 'Bắc · tự nhiên'], ['Minh Đức', 'm', 'Bắc · tin tức'],
  ['Thanh Bình', 'm', 'Bắc · kể chuyện'], ['Thiện Minh', 'm', 'Bắc · kể chuyện'], ['Thiền Tâm Đức', 'm', 'Bắc · kể chuyện'],
  ['Quang Sơn', 'm', 'Trung · tự nhiên'], ['Adam', 'm', 'Nam · tự nhiên'], ['Minh Triết', 'm', 'Nam · tin tức'],
  ['Thái Sơn', 'm', 'Nam · kể chuyện'], ['Đức Trí', 'm', 'Nam · kể chuyện'],
  ['Trúc Ly', 'f', 'Bắc · tự nhiên'], ['Ngọc Huyền', 'f', 'Bắc · tự nhiên'], ['Đoan Trang', 'f', 'Bắc · tự nhiên'],
  ['Mai Anh', 'f', 'Bắc · tin tức'], ['Ngọc Linh', 'f', 'Bắc · kể chuyện'], ['Quỳnh Anh', 'f', 'Bắc · kể chuyện'],
  ['Ngọc Trân', 'f', 'Trung · tự nhiên'], ['Thùy Dung', 'f', 'Nam · tin tức'], ['Thục Đoan', 'f', 'Nam · kể chuyện'],
  ['Mỹ Duyên', 'f', 'Nam · kể chuyện'], ['Kim Thanh', 'f', 'Nam · kể chuyện'],
].map(([id, gender, note]) => ({ id, name: id, gender, note }));

const toVoice = (v) => ({ ...v, lang: 'vi', locale: 'vi-VN', tags: ['local', 'offline', 'vi-en'], provider: 'vieneu' });

/** A 44-byte RIFF header around raw s16le mono PCM — the server streams PCM with no length. */
export function wavFromPcm16(pcm, rate = RATE) {
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + pcm.length, 4); head.write('WAVE', 8);
  head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24); head.writeUInt32LE(rate * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36); head.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([head, pcm]);
}

function headersOf(cfg) {
  const key = String(cfg?.apiKey || '').trim();
  return { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) };
}

export default {
  id: 'vieneu', get name() { return m('VieNeu-TTS (chạy máy mình — miễn phí, đọc được tiếng Anh)'); },
  free: true, needsNetwork: false, ext: '.wav',
  configSchema: [
    { key: 'serverUrl', label: 'Địa chỉ server', type: 'text', required: false, placeholder: 'http://127.0.0.1:8000' },
    { key: 'repoDir', label: 'Thư mục VieNeu-TTS (đã chạy uv sync)', type: 'text', required: false, placeholder: '/đường/dẫn/VieNeu-TTS' },
    { key: 'autoStart', label: 'Tự khởi động server khi cần', type: 'checkbox', required: false },
  ],
  // One bilingual model: the same preset reads Vietnamese and English.
  autoVoiceFor: (lang) => (lang === 'vi' || lang === 'en' ? CATALOG[0].id : null),

  async listVoices(cfg) {
    try {
      const res = await fetch(`${vieneuUrl(cfg)}/v1/voices`, { headers: headersOf(cfg), signal: AbortSignal.timeout(2500) });
      const live = res.ok ? ((await res.json()).data || []) : [];
      const known = new Set(CATALOG.map((v) => v.id));
      const extra = live.map((v) => String(v.id || v.name || '')).filter((id) => id && !known.has(id))
        .map((id) => ({ id, name: id, gender: 'u', note: '' }));
      return [...CATALOG, ...extra].map(toVoice);
    } catch { return CATALOG.map(toVoice); }
  },

  async synthesize(text, voiceId, cfg, outPath) {
    const base = vieneuUrl(cfg);
    if (cfg?.autoStart) await ensureVieneu(cfg);
    const res = await fetch(`${base}/v1/audio/speech`, {
      method: 'POST',
      headers: headersOf(cfg),
      body: JSON.stringify({
        model: 'vieneu-v3-turbo', input: String(text),
        voice: voiceId && voiceId !== 'auto' ? voiceId : CATALOG[0].id,
        response_format: 'pcm', sample_rate: RATE,
      }),
      signal: AbortSignal.timeout(240000),
    });
    if (!res.ok) throw new Error(`VieNeu ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const pcm = Buffer.from(await res.arrayBuffer());
    if (pcm.length < RATE * 2 * 0.2) throw new Error(m('VieNeu: audio trả về rỗng'));
    const seconds = pcm.length / 2 / RATE;
    const words = String(text).trim().split(/\s+/).length;
    // A throw here is a retry with fresh sampling — the façade fights for the same voice first.
    if (words >= 8 && (words / seconds) * 60 > MAX_WPM) {
      throw new Error(tp`VieNeu đọc sót chữ (${Math.round((words / seconds) * 60)} chữ/phút) — đọc lại`);
    }
    writeFileSync(outPath, wavFromPcm16(pcm, RATE));
    return { path: outPath, duration: await probeDuration(outPath) };
  },

  async testConnection(cfg) {
    const base = vieneuUrl(cfg);
    try {
      if (cfg?.autoStart) await ensureVieneu(cfg);
      if (!(await isAlive(base))) {
        // m(), not tp, for the instruction: an escaped backtick never matches its msgid at runtime.
        return { ok: false, message: `${tp`Không thấy server tại ${base}`} ${m('— chạy "uv run python -m apps.openai_speech" trong thư mục VieNeu-TTS, hoặc bật tự khởi động')}` };
      }
      const tmp = `${process.env.TMPDIR || '/tmp'}/vieneu_test_${Date.now()}.wav`;
      // i18n-exempt: the sentence the voice SPEAKS to prove it works, not text the app shows.
      const r = await this.synthesize('Xin chào, đây là giọng đọc thử nghiệm của AI.', CATALOG[0].id, cfg, tmp);
      return { ok: true, message: tp`Kết nối OK tại ${base} — synth thử ${r.duration.toFixed(1)}s audio` };
    } catch (e) { return { ok: false, message: String(e.message || e).slice(0, 200) }; }
  },
};
