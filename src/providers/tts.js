// TTS façade — resolves language → (provider, voice) → synthesizes with a robust fallback chain.
// The language is the CALLER's to declare (opts.lang): the pipeline already knows what the user
// picked, and sniffing the text instead answered 'en' for every unaccented Latin script, so a
// French video could never reach langVoices['fr']. Detection stays only for callers that have
// nothing to declare — a voice preview, a one-off snippet.
// Resolution order per scene text:
//   1. langVoices[lang] = { provider, voice }              (per-language defaults, set via Voice Picker)
//   2. settings provider + its chosen voice ('auto' → provider.autoVoiceFor(lang))
//   3. on failure: edge → say, timbre-preserving: the fallback picks the cached voice
//      closest to the primary's language+gender instead of an arbitrary default (never throws)
import { aiSettings, cachedVoiceGender, nearestCachedVoice } from '../db/index.js';
import { getProvider, providerConfig, legacyVoice, providerExt } from './voice/index.js';
import { logger } from '../util/log.js';
import { detectLang } from '../util/lang.js';

import { m, tp } from '../i18n/t.js';
import { sleep } from '../util/util.js';
import { assertSpendAllowed } from '../core/spend-guard.js';
// Re-exported so existing importers of detectLang keep working.
export { detectLang };

function resolveTarget(s, lang) {
  // 1) explicit per-language default
  const lv = s.langVoices && s.langVoices[lang];
  if (lv && lv.provider) return { pid: lv.provider, voice: lv.voice || 'auto' };
  // 2) main provider + its configured voice
  const pid = s.provider || 'edge';
  const voice = legacyVoice(s, pid) || 'auto';
  return { pid, voice };
}

// The user's pinned per-language voice, but only when it belongs to the given provider.
function pinnedVoice(s, pid, lang) {
  const lv = s.langVoices && s.langVoices[lang];
  return lv && lv.provider === pid && lv.voice ? lv.voice : null;
}

/**
 * Resolve (provider, voice) for a synthesis call. A per-project/per-channel override wins on
 * the PROVIDER, but a provider-only override (channel says "use larvoice", no voice picked)
 * must NOT discard the user's pinned per-language voice for that SAME provider — dropping to
 * 'auto' hands the pick to catalog order, i.e. an arbitrary voice.
 */
export function resolveVoiceTarget(s, lang, override) {
  if (override?.provider) {
    return {
      pid: override.provider,
      voice: override.voice || pinnedVoice(s, override.provider, lang) || legacyVoice(s, override.provider) || 'auto',
    };
  }
  return resolveTarget(s, lang);
}

/**
 * Plausibility bounds (seconds) for synthesized speech of `text`. Duration-inferring TTS
 * models (LarVoice/F5 style) can glitch into stretched or repeated audio many times longer
 * than the text — accepting one turns a 10s scene into 2 minutes of slow-motion voice.
 * Floor rates sit far below real speech (latin ≥3.5 chars/s spoken vs ~15 normal; CJK ≥1.5),
 * so a healthy slow voice or a 0.5× speed setting never trips the gate.
 */
export function ttsDurationBounds(text) {
  const raw = String(text || '');
  const chars = raw.replace(/\s+/g, '').length;
  const cjk = /[぀-ヿ㐀-鿿가-힣]/.test(raw);
  return { min: Math.min(2, chars / 60), max: Math.max(12, chars / (cjk ? 1.5 : 3.5)) };
}

// A credential field may hold SEVERAL keys, newline/comma/semicolon separated — the same pool
// shape the LLM lane already accepts (P40). A paid TTS voice runs out of credit mid-video far
// more often than it fails outright, so one exhausted key must not cost the video its voice.
const KEY_FIELDS = ['apiKey', 'token'];
export function keyPool(cfg = {}) {
  for (const field of KEY_FIELDS) {
    const raw = cfg[field];
    if (typeof raw !== 'string' || !raw.includes('\n') && !/[,;]/.test(raw)) continue;
    const keys = raw.split(/[\n,;]+/).map((k) => k.trim()).filter(Boolean);
    if (keys.length > 1) return { field, keys };
  }
  return null;
}
/** A quota/credit/auth refusal — the next key might work; anything else is not key-related. */
function keyExhausted(e) {
  return /\b(401|402|403|429)\b|quota|credit|balance|insufficient|unauthor|rate limit|hết|hạn mức/i.test(String(e?.message || e));
}

async function synthWith(pid, voice, text, s, outPath, style, lang) {
  const provider = getProvider(pid);
  // _style: optional prosody hint ('energetic'|'calm') — read only by providers with
  // expressive controls (elevenlabs voice_settings, openai instructions); others ignore
  // it, so a malformed style can never cost the voice lock (P7).
  const cfg = style ? { ...providerConfig(s, pid), _style: style } : providerConfig(s, pid);
  let v = voice;
  if (!v || v === 'auto') v = provider.autoVoiceFor(lang);
  if (v == null && pid !== 'say') throw new Error(tp`${pid}: không có giọng phù hợp cho ngôn ngữ`);
  // Container follows what the provider actually writes — a wrong extension would make
  // ffprobe/concat guess. The provider declares it, so adding one needs no edit here.
  const out = outPath.replace(/\.\w+$/, providerExt(pid));
  // The language is passed through for providers whose API takes it explicitly (Supertonic is
  // one multilingual model, so the voice alone does not pick the language).
  const call = (c) => provider.synthesize(text, v, c, out, { lang });
  const pool = keyPool(cfg);
  if (!pool) return call(cfg);
  let lastErr;
  for (let i = 0; i < pool.keys.length; i++) {
    try { return await call({ ...cfg, [pool.field]: pool.keys[i] }); }
    catch (e) {
      lastErr = e;
      if (!keyExhausted(e) || i === pool.keys.length - 1) throw e;
      logger.warn(tp`${pid}: key ${i + 1}/${pool.keys.length} không dùng được (${e.message.slice(0, 80)}) — đổi key`);
    }
  }
  throw lastErr;
}


// Main entry. Always returns { path, duration, provider, fallback } — falls back rather than
// throwing. VOICE LOCK: the chosen voice defines the video's identity, so the primary target
// is retried 3× with backoff before the chain may switch provider; `fallback: true` flags a
// scene that ended up on a different voice (the runner re-tries those once at the end).
// opts.ttsOverride: per-channel/per-project tts settings merged over global (channels feature).
// opts.lang: the video's declared language — always pass it when the caller knows it.
export async function synthesizeVoice(text, outPath, opts = {}) {
  assertSpendAllowed(); // the other place money leaves the building
  const s = { ...aiSettings().tts, ...(opts.ttsOverride || {}) };
  const lang = opts.lang || detectLang(text);
  // An EXPLICIT per-project/per-channel provider pick beats the per-language default —
  // langVoices are defaults, not vetoes; the user's per-video choice must win. But a
  // provider-only override still inherits the pinned voice for that provider (see
  // resolveVoiceTarget) instead of degrading to catalog order.
  const target = resolveVoiceTarget(s, lang, opts.ttsOverride);

  // Timbre-preserving fallback: instead of an arbitrary default voice, the fallback
  // provider picks its cached voice closest to the primary's language + gender, so a
  // provider outage changes the VOICE as little as the listener can notice.
  const targetGender = cachedVoiceGender(target.pid, target.voice);
  const near = (pid) => { try { return nearestCachedVoice(pid, lang, targetGender) || 'auto'; } catch { return 'auto'; } };
  const chain = [target];
  if (target.pid !== 'edge') chain.push({ pid: 'edge', voice: near('edge') });
  if (target.pid !== 'say') chain.push({ pid: 'say', voice: 'auto' });

  let lastErr;
  for (let ci = 0; ci < chain.length; ci++) {
    const { pid, voice } = chain[ci];
    const tries = ci === 0 ? 3 : 1; // fight for the locked voice before switching provider
    for (let a = 0; a < tries; a++) {
      try {
        const r = await synthWith(pid, voice, text, s, outPath, opts.style, lang);
        // Reject implausibly long/short audio as a FAILED attempt: same-voice retries get
        // a fresh shot first, then the timbre-preserving fallback chain — a glitched
        // stretched take must never be accepted into the video.
        const { min, max } = ttsDurationBounds(text);
        if (r.duration > max || r.duration < min) {
          throw new Error(tp`giọng đọc dài bất thường (${r.duration.toFixed(1)}s cho ${String(text).length} ký tự — hợp lý: ${min.toFixed(1)}–${max.toFixed(0)}s)`);
        }
        return { ...r, provider: pid, fallback: ci > 0 };
      } catch (e) {
        lastErr = e;
        logger.warn(tp`Giọng đọc ${pid} lỗi (${e.message.slice(0, 120)})${a < tries - 1 ? ` — ${m('thử lại cùng giọng')}` : ` — ${m('chuyển giọng kế tiếp')}`}`);
        if (a < tries - 1) await sleep(1200 * (a + 1));
      }
    }
  }
  throw lastErr || new Error('all TTS providers failed');
}
