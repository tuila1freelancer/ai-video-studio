// Supertonic — a LOCAL, self-hosted neural TTS server (reference-app parity, P40).
//
// The owner installs it once (`pip install supertonic`) and this provider talks to the plain
// HTTP API it serves on 127.0.0.1: POST /v1/tts { text, voice, lang, steps, speed,
// response_format } → audio bytes. Nothing leaves the machine, there is no API key and no quota,
// so it is the offline-capable counterpart to the SaaS voices.
//
// The server lifecycle (spawn/health/stop) lives in ../../media/tts-server.js — this file stays a
// pure provider so the façade's fallback chain treats it like any other.
import { writeFileSync } from 'node:fs';
import { probeDuration } from '../../media/ffmpeg.js';
import { supertonicUrl, ensureSupertonic } from '../../media/tts-server.js';

// Shipped with the model — ids are stable, the descriptions come from the upstream voice card.
const CATALOG = [
  { id: 'M1', name: 'M1 — sôi nổi, tự tin', gender: 'm', note: 'Promo, giải thích, đời thường' },
  { id: 'M2', name: 'M2 — trầm, điềm tĩnh', gender: 'm', note: 'Doanh nghiệp, phim tài liệu' },
  { id: 'M3', name: 'M3 — chuẩn mực, uy tín', gender: 'm', note: 'Kinh doanh, thuyết minh' },
  { id: 'M4', name: 'M4 — nhẹ, trẻ trung', gender: 'm', note: 'Giáo dục, hướng dẫn' },
  { id: 'M5', name: 'M5 — ấm, kể chuyện', gender: 'm', note: 'Sách nói, truyện' },
  { id: 'F1', name: 'F1 — điềm đạm, hơi trầm', gender: 'f', note: 'Chăm sóc khách hàng, thiền' },
  { id: 'F2', name: 'F2 — tươi sáng, vui', gender: 'f', note: 'Nội dung trẻ, quảng cáo social' },
  { id: 'F3', name: 'F3 — rõ ràng, chuyên nghiệp', gender: 'f', note: 'Quảng cáo, bản tin' },
  { id: 'F4', name: 'F4 — sắc, tự tin, biểu cảm', gender: 'f', note: 'Giải thích, đào tạo' },
  { id: 'F5', name: 'F5 — dịu dàng, êm', gender: 'f', note: 'Sách nói, thư giãn' },
];

export const SUPERTONIC_LANGS = ['vi', 'en', 'ko', 'ja', 'zh', 'fr', 'de', 'es', 'pt'];

const clamp = (v, lo, hi, dflt) => {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};

export default {
  id: 'supertonic', name: 'Supertonic (chạy máy mình — miễn phí)', free: true, needsNetwork: false,
  ext: '.wav',
  configSchema: [
    { key: 'serverUrl', label: 'Địa chỉ server', type: 'text', required: false, placeholder: 'http://127.0.0.1:7788' },
    { key: 'speed', label: 'Tốc độ đọc (0.5–2.0)', type: 'text', required: false, placeholder: '1.0' },
    { key: 'steps', label: 'Số bước khuếch tán (2–32, cao = mượt hơn, chậm hơn)', type: 'text', required: false, placeholder: '8' },
    { key: 'autoStart', label: 'Tự khởi động server khi cần (cần `pip install supertonic`)', type: 'checkbox', required: false },
  ],
  // The model is multilingual; the same voice serves every language, so 'auto' is always safe.
  autoVoiceFor: () => CATALOG[0].id,

  async listVoices() {
    return CATALOG.map((v) => ({ ...v, lang: 'multi', locale: '', tags: ['local', 'offline'], provider: 'supertonic' }));
  },

  async synthesize(text, voiceId, cfg, outPath, opts = {}) {
    const base = supertonicUrl(cfg);
    if (cfg?.autoStart) await ensureSupertonic(cfg);
    const lang = SUPERTONIC_LANGS.includes(opts.lang) ? opts.lang : 'vi';
    const res = await fetch(`${base}/v1/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        voice: voiceId && voiceId !== 'auto' ? voiceId : CATALOG[0].id,
        lang,
        steps: Math.round(clamp(cfg?.steps, 2, 32, 8)),
        speed: clamp(cfg?.speed, 0.5, 2, 1),
        response_format: 'wav',
      }),
      signal: AbortSignal.timeout(180000), // local diffusion TTS is slow on CPU
    });
    if (!res.ok) throw new Error(`Supertonic ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 200) throw new Error('Supertonic: audio trả về rỗng');
    writeFileSync(outPath, buf);
    return { path: outPath, duration: await probeDuration(outPath) };
  },

  async testConnection(cfg) {
    const base = supertonicUrl(cfg);
    try {
      if (cfg?.autoStart) await ensureSupertonic(cfg);
      const tmp = `${process.env.TMPDIR || '/tmp'}/supertonic_test_${Date.now()}.wav`;
      const r = await this.synthesize('Xin chào, đây là giọng đọc thử nghiệm.', CATALOG[0].id, cfg, tmp, { lang: 'vi' });
      return { ok: true, message: `Kết nối OK tại ${base} — synth thử ${r.duration.toFixed(1)}s audio` };
    } catch (e) {
      return { ok: false, message: `${e.message.slice(0, 160)} — cài bằng \`pip install supertonic\` rồi bật "tự khởi động", hoặc chạy \`supertonic serve --port 7788\`` };
    }
  },
};
