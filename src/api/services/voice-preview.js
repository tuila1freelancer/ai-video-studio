// Voice preview: synth a short sample once and cache it forever on disk. ElevenLabs-style
// providers return their own hosted sample (no credits burned); others synth locally.
import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DIRS } from '../../config/paths.js';
import * as DB from '../../db/index.js';
import { detectLang } from '../../util/lang.js';

const SAMPLES = {
  vi: 'Xin chào, tôi là giọng đọc cho video của bạn.', en: 'Hello, I will narrate your videos.',
  ja: 'こんにちは、あなたの動画のナレーターです。', ko: '안녕하세요, 영상 내레이터입니다.',
  zh: '你好，我是你的视频配音员。', ru: 'Привет, я озвучу ваши видео.',
};

/**
 * @param {{provider?:string, voiceId:string, text?:string}} req
 * @returns {Promise<{url:string, external?:boolean}>}
 * @throws {Error} with .status=400 when voiceId is missing
 */
export async function synthPreview({ provider: pid = 'edge', voiceId, text } = {}) {
  if (!voiceId) { const e = new Error('thiếu voiceId'); e.status = 400; throw e; }
  const { getProvider, providerConfig, providerExt } = await import('../../providers/voice/index.js');
  const prov = getProvider(pid);
  // ElevenLabs voices ship their own sample — no credits burned
  if (!text) {
    const cached = DB.cachedVoices(pid).find((v) => v.id === voiceId);
    if (cached && cached.preview_url) return { url: cached.preview_url, external: true };
  }
  const meta = DB.cachedVoices(pid).find((v) => v.id === voiceId);
  const custom = (text || '').trim().slice(0, 200);
  const sample = custom || SAMPLES[meta?.lang] || SAMPLES.en;
  const hash = createHash('md5').update(pid + voiceId + (custom || '__preview__')).digest('hex').slice(0, 10);
  const dir = join(DIRS.data, 'voice-previews');
  mkdirSync(dir, { recursive: true });
  const out = join(dir, `${pid}_${voiceId.replace(/[^\w.-]/g, '_')}_${hash}${providerExt(pid)}`);
  if (!existsSync(out)) {
    const cfg = providerConfig(DB.aiSettings().tts, pid);
    // Providers with previewSynthesize decide themselves: null text → fetch the voice's
    // hosted preview_url (0 credits, with correct auth/origin); only custom text runs a paid job.
    if (typeof prov.previewSynthesize === 'function') await prov.previewSynthesize(custom || null, voiceId, cfg, out);
    else {
      // The 5th argument was missing, so a multilingual provider fell back to its own default —
      // Supertonic spoke the ENGLISH sample text in Vietnamese mode. A 'multi' voice has no
      // language of its own, so the sample's does.
      const lang = meta?.lang && meta.lang !== 'multi' ? meta.lang : detectLang(sample);
      await prov.synthesize(sample, voiceId, cfg, out, { lang });
    }
  }
  return { url: `/api/file?path=${encodeURIComponent(out)}` };
}
