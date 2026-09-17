// Vbee AIVoice — Vietnamese TTS SaaS (async API: submit → poll → download).
// Docs: https://vbee.vn/api-docs (Postman: documenter.getpostman.com/view/12951168/Uz5FHbSd)
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { DIRS } from '../../config/paths.js';
import { probeDuration } from '../../media/ffmpeg.js';
import { recordUsage } from '../../util/usage.js';
import { failed } from '../../core/errors.js';

import { m, tp } from '../../i18n/t.js';
import { sleep } from '../../util/util.js';
const BASE = 'https://vbee.vn/api/v1';

// Common Vietnamese voice_codes (North/Central/South). Users can also type any code manually.
// i18n-exempt: a voice's NAME. Someone picking "Duy Phương (Huế · nam)" has to read the name the
// provider gave it, in any interface language.
const CATALOG = [
  { id: 'hn_female_ngochuyen_full_48k-fhg', name: 'Ngọc Huyền (Bắc · nữ)', gender: 'f' },
  { id: 'hn_male_phuthang_stor80dt_48k-fhg', name: 'Phú Thắng (Bắc · nam)', gender: 'm' },
  { id: 'hn_female_maiphuong_vdts_48k-fhg', name: 'Mai Phương (Bắc · nữ)', gender: 'f' },
  { id: 'hn_male_manhdung_news_48k-fhg', name: 'Mạnh Dũng (Bắc · nam · tin tức)', gender: 'm' },
  { id: 'hn_female_thutrang_phrase_48k-fhg', name: 'Thu Trang (Bắc · nữ)', gender: 'f' },
  { id: 'hue_female_huonggiang_full_48k-fhg', name: 'Hương Giang (Huế · nữ)', gender: 'f' },
  { id: 'hue_male_duyphuong_full_48k-fhg', name: 'Duy Phương (Huế · nam)', gender: 'm' },
  { id: 'sg_female_thaotrinh_full_48k-fhg', name: 'Thảo Trinh (Nam · nữ)', gender: 'f' },
  { id: 'sg_male_minhhoang_full_48k-fhg', name: 'Minh Hoàng (Nam · nam)', gender: 'm' },
  { id: 'sg_female_lantrinh_vdts_48k-fhg', name: 'Lan Trinh (Nam · nữ)', gender: 'f' },
];


export default {
  id: 'vbee', get name() { return m('Vbee AIVoice (tiếng Việt)'); }, free: false, needsNetwork: true,
  configSchema: [
    { key: 'token', label: 'API Token (Bearer)', type: 'password', required: true },
    { key: 'appId', label: 'App ID', type: 'text', required: true },
    { key: 'speed', label: 'Tốc độ đọc (0.5–2.0)', type: 'text', required: false, placeholder: '1.0' },
  ],
  autoVoiceFor: (lang) => (lang === 'vi' ? CATALOG[0].id : null),

  async listVoices() {
    return CATALOG.map((v) => ({ ...v, lang: 'vi', locale: 'vi-VN', tags: ['48k'], provider: 'vbee' }));
  },

  async synthesize(text, voiceId, cfg, outPath) {
    if (!cfg?.token || !cfg?.appId) throw failed('config.no-key', m('Vbee: chưa cấu hình token/appId'));
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.token}` };
    // 1) submit async job
    const sub = await fetch(`${BASE}/tts`, {
      method: 'POST', headers,
      body: JSON.stringify({
        app_id: cfg.appId,
        input_text: text,
        voice_code: voiceId || CATALOG[0].id,
        speed_rate: String(cfg.speed || '1.0'),
        audio_type: 'mp3',
        bitrate: 128000,
        response_type: 'direct',
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!sub.ok) throw new Error(`Vbee submit ${sub.status}: ${(await sub.text()).slice(0, 200)}`);
    const data = await sub.json();
    const result = data.result || data;
    // direct mode may return the audio link immediately; otherwise poll by request_id
    let audioLink = result.audio_link || null;
    const reqId = result.request_id || result.id;
    if (!audioLink && reqId) {
      for (let i = 0; i < 60; i++) {
        await sleep(1500);
        const st = await fetch(`${BASE}/tts/${reqId}`, { headers, signal: AbortSignal.timeout(15000) });
        if (!st.ok) continue;
        const js = await st.json();
        const r = js.result || js;
        if ((r.status || '').toUpperCase() === 'SUCCESS' && r.audio_link) { audioLink = r.audio_link; break; }
        if ((r.status || '').toUpperCase() === 'FAILURE') throw new Error('Vbee job FAILURE');
      }
    }
    if (!audioLink) throw new Error(m('Vbee: không nhận được audio_link (kiểm tra token/appId/voice_code)'));
    // 2) download the mp3
    const audio = await fetch(audioLink, { signal: AbortSignal.timeout(60000) });
    if (!audio.ok) throw new Error(`Vbee download ${audio.status}`);
    writeFileSync(outPath, Buffer.from(await audio.arrayBuffer()));
    recordUsage('tts', { provider: 'vbee', chars: String(text).length });
    return { path: outPath, duration: await probeDuration(outPath) };
  },

  async testConnection(cfg) {
    if (!cfg?.token || !cfg?.appId) return { ok: false, message: m('Cần API Token + App ID (lấy tại vbee.vn → API)') };
    try {
      const tmp = join(DIRS.tmp, `vbee_test_${Date.now()}.mp3`); // the app's own temp dir works on Windows too
      const r = await this.synthesize('Xin chào', CATALOG[0].id, cfg, tmp); // i18n-exempt: spoken, not shown
      try { unlinkSync(tmp); } catch { /* the sweep gets it */ }
      return { ok: true, message: tp`Kết nối OK — synth thử ${r.duration.toFixed(1)}s audio` };
    } catch (e) { return { ok: false, message: e.message.slice(0, 200) }; }
  },
};
