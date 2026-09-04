// LarVoice — official API surface (https://larvoice.com/docs):
//   base https://larvoice.com/api/v1, auth 'Authorization: Bearer lv_...'
//   (key created at https://larvoice.com/app/api — NOT the Telegram-bot key from the
//   legacy api.larvoice.com/x-api-key system; the two systems don't share keys).
// Internal voice id: '<voice_type>:<voice_id>' (e.g. 'public:123', 'personal:ab-cd').
import { writeFileSync } from 'node:fs';
import { probeDuration } from '../../media/ffmpeg.js';
import { detectLang } from '../../util/lang.js';
import { withRetry, sleep } from '../../util/retry.js';
import { recordUsage } from '../../util/usage.js';
import { failed } from '../../core/errors.js';

import { m, tp } from '../../i18n/t.js';
const BASE = 'https://larvoice.com/api/v1';
const ORIGIN = 'https://larvoice.com';
const LANGS = new Set(['vi', 'en', 'zh', 'ja', 'ko']);

const langOf = (text) => { const l = detectLang(text); return LANGS.has(l) ? l : 'en'; };
const localeOf = (lang) => ({ vi: 'vi-VN', en: 'en-US', zh: 'zh-CN', ja: 'ja-JP', ko: 'ko-KR' }[lang] || 'en-US');

function headersOf(cfg) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${String(cfg.apiKey || '').trim()}` };
}

// '<type>:<id>' → body fields; legacy ids (demo:*, id:<uuid>) and 'auto:<lang>' → resolve via catalog.
function parseVoice(voiceId) {
  const v = String(voiceId || '');
  const m = /^(public|personal):(.+)$/.exec(v);
  if (m) return { voice_type: m[1], voice_id: /^\d+$/.test(m[2]) ? Number(m[2]) : m[2] };
  return null; // legacy/auto → caller picks from catalog
}

// Small catalog, cached 10 minutes PER API KEY (the catalog holds account-specific 'personal'
// voices — different keys via per-channel override must not share the cache).
const catCaches = new Map(); // apiKey → { at, voices }
async function fetchCatalog(cfg) {
  const key = String(cfg?.apiKey || '').trim();
  const hit = catCaches.get(key);
  if (hit && Date.now() - hit.at < 600000 && hit.voices.length) return hit.voices;
  const out = [];
  let cursor = '';
  const seenCursors = new Set();
  // Paginate the WHOLE catalog (LarVoice has 300+ voices — an earlier 3-page cap silently
  // dropped everything past 300). Bounded to 60 pages (6000 voices) so a stuck/looping
  // cursor can never hang the fetch.
  for (let page = 0; page < 60; page++) {
    const url = `${BASE}/voices?voice_type=all&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const r = await fetch(url, { headers: headersOf(cfg), signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`LarVoice /voices ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const d = (await r.json()).data || {};
    out.push(...(d.voices || []));
    if (!d.has_more || !d.next_cursor || seenCursors.has(d.next_cursor)) break;
    seenCursors.add(d.next_cursor);
    cursor = d.next_cursor;
  }
  catCaches.set(key, { at: Date.now(), voices: out });
  if (catCaches.size > 8) catCaches.delete(catCaches.keys().next().value);
  return out;
}

async function resolveVoice(voiceId, cfg, text) {
  const parsed = parseVoice(voiceId);
  if (parsed) return parsed;
  // legacy ('demo:*'/'id:*'/uuid) or 'auto' → first public voice matching the language
  const lang = /^auto:/.test(String(voiceId)) ? String(voiceId).slice(5) : langOf(text || '');
  const voices = await fetchCatalog(cfg);
  const pick = voices.find((v) => v.voice_type === 'public' && v.language === lang)
    || voices.find((v) => v.language === lang) || voices[0];
  if (!pick) throw failed('config.empty-catalog', m('LarVoice: catalog trống — kiểm tra API key'));
  return { voice_type: pick.voice_type, voice_id: pick.voice_id };
}

function speedOf(cfg) {
  const v = parseFloat(cfg?.speed);
  return Number.isFinite(v) && v >= 0.5 && v <= 2 ? { post_speed: v } : {};
}

async function downloadTo(url, outPath, cfg, timeoutMs = 120000) {
  const abs = /^https?:/.test(url) ? url : `${ORIGIN}${url}`;
  const audio = await fetch(abs, { headers: { Authorization: headersOf(cfg).Authorization }, signal: AbortSignal.timeout(timeoutMs) });
  if (!audio.ok) throw new Error(`LarVoice download ${audio.status}`);
  writeFileSync(outPath, Buffer.from(await audio.arrayBuffer()));
}

async function runTtsJob(text, voiceId, cfg, outPath, maxChars) {
  if (!cfg?.apiKey) throw failed('config.no-key', m('LarVoice: chưa cấu hình API Key'));
  const voice = await resolveVoice(voiceId, cfg, text);
  const body = {
    ...voice,
    gen_text: String(text).slice(0, maxChars),
    language: langOf(text),
    format: 'mp3',
    return_srt: false, // app builds subtitles itself — saves payload
    ...speedOf(cfg),
  };
  // POST /tts usually returns completed right away (200 {data:{job_id,status,output_url,cost}})
  const job = await withRetry(async () => {
    const r = await fetch(`${BASE}/tts`, {
      method: 'POST', headers: headersOf(cfg), body: JSON.stringify(body), signal: AbortSignal.timeout(120000),
    });
    if (!r.ok) throw new Error(`LarVoice submit ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return (await r.json()).data || {};
  }, { tries: 2, label: 'larvoice submit' });

  let { status, output_url } = { status: String(job.status || '').toLowerCase(), output_url: job.output_url };
  let cost = Number(job.cost) || 0; // per-job credit cost reported by the API — feed the meter
  // not done yet → poll GET /jobs/:id every 2s, capped at 5 minutes
  for (let i = 0; i < 150 && status !== 'completed'; i++) {
    if (status === 'failed') throw new Error(tp`LarVoice job failed: ${job.error || m('không rõ nguyên nhân')}`);
    await sleep(2000);
    try {
      const st = await fetch(`${BASE}/jobs/${job.job_id}`, { headers: headersOf(cfg), signal: AbortSignal.timeout(15000) });
      if (!st.ok) continue;
      const d = (await st.json()).data || {};
      status = String(d.status || '').toLowerCase();
      output_url = d.output_url || output_url;
      cost = Number(d.cost) || cost;
      if (status === 'failed') throw new Error(tp`LarVoice job failed: ${d.error || m('không rõ nguyên nhân')}`);
    } catch (e) { if (String(e.message).includes('job failed')) throw e; }
  }
  if (status !== 'completed') throw new Error(m('LarVoice: quá 5 phút chưa xong job'));
  if (!output_url) throw new Error(m('LarVoice: job completed nhưng thiếu output_url'));
  await downloadTo(output_url, outPath, cfg);
  recordUsage('tts', { provider: 'larvoice', chars: String(text).slice(0, maxChars).length, credits: cost });
  return { path: outPath, duration: await probeDuration(outPath), cost };
}

export default {
  id: 'larvoice', get name() { return m('LarVoice (giọng vi/en/zh/ja/ko)'); }, free: false, needsNetwork: true,
  configSchema: [
    { key: 'apiKey', label: 'API Key (Bearer)', type: 'password', required: true, placeholder: 'lv_… — tạo tại larvoice.com/app/api' },
    { key: 'speed', label: 'Tốc độ (0.5–2.0)', type: 'text', required: false, placeholder: '1.0' },
  ],
  // actual resolution happens in synthesize (catalog by language) — sentinel keeps the contract in sync
  autoVoiceFor: (lang) => (LANGS.has(lang) ? `auto:${lang}` : null),

  async listVoices(cfg) {
    if (!cfg?.apiKey) return []; // official API requires a key — no offline demo
    try {
      const voices = await fetchCatalog(cfg);
      return voices.map((v) => ({
        id: `${v.voice_type}:${v.voice_id}`,
        name: v.name || String(v.voice_id),
        lang: LANGS.has(v.language) ? v.language : 'vi',
        locale: localeOf(v.language),
        gender: v.gender === 'female' ? 'f' : v.gender === 'male' ? 'm' : (v.gender || 'u'),
        // i18n-exempt: cached into voices_cache — translating here would freeze the owner's language into the row.
        tags: v.voice_type === 'personal' ? ['của tôi'] : ['public'],
        previewUrl: v.preview_url || null, // ready-made sample — previewing costs no credit
        provider: 'larvoice',
      }));
    } catch { return []; }
  },

  async synthesize(text, voiceId, cfg, outPath) {
    return runTtsJob(text, voiceId, cfg, outPath, 50000);
  },

  // No dedicated preview endpoint on the official system:
  // text=null → download the voice's ready-made preview_url (0 credit); with text → short TTS job.
  async previewSynthesize(text, voiceId, cfg, outPath) {
    if (!cfg?.apiKey) throw failed('config.no-key', m('LarVoice: chưa cấu hình API Key'));
    if (!text) {
      const voices = await fetchCatalog(cfg);
      const parsed = parseVoice(voiceId);
      const v = parsed && voices.find((x) => String(x.voice_id) === String(parsed.voice_id) && x.voice_type === parsed.voice_type);
      if (v?.preview_url) {
        await downloadTo(v.preview_url, outPath, cfg, 30000);
        return { path: outPath, duration: await probeDuration(outPath) };
      }
    }
    return runTtsJob(text || 'Xin chào, tôi là giọng đọc cho video của bạn.', voiceId, cfg, outPath, 300);
  },

  async testConnection(cfg) {
    if (!cfg?.apiKey) return { ok: false, message: 'Cần API Key — tạo tại larvoice.com/app/api (Bearer)' };
    try {
      const r = await fetch(`${BASE}/voices?voice_type=all&limit=1`, { headers: headersOf(cfg), signal: AbortSignal.timeout(15000) });
      if (r.status === 401) return { ok: false, message: 'Key bị từ chối (401). Dùng key Bearer tạo tại larvoice.com/app/api — key Telegram bot thuộc hệ cũ api.larvoice.com, không dùng được ở đây.' };
      if (!r.ok) return { ok: false, message: `LarVoice /voices ${r.status}: ${(await r.text()).slice(0, 200)}` };
      const total = await fetchCatalog(cfg).then((v) => v.length).catch(() => '?');
      return { ok: true, message: tp`Kết nối OK — key hợp lệ, catalog ${total} giọng (vi/en/zh/ja/ko). Quota trừ theo credit từng job.` };
    } catch (e) { return { ok: false, message: String(e.message || e).slice(0, 200) }; }
  },
};
