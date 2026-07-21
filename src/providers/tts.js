// TTS façade — resolves language → (provider, voice) → synthesizes with a robust fallback chain.
// Resolution order per scene text:
//   1. langVoices[detected-lang] = { provider, voice }     (per-language defaults, set via Voice Picker)
//   2. settings provider + its chosen voice ('auto' → provider.autoVoiceFor(lang))
//   3. on failure: edge → say, timbre-preserving: the fallback picks the cached voice
//      closest to the primary's language+gender instead of an arbitrary default (never throws)
import { aiSettings, cachedVoiceGender, nearestCachedVoice } from '../db/index.js';
import { getProvider, providerConfig, legacyVoice } from './voice/index.js';
import { logger } from '../util/log.js';
import { detectLang } from '../util/lang.js';

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

async function synthWith(pid, voice, text, s, outPath, style) {
  const provider = getProvider(pid);
  // _style: optional prosody hint ('energetic'|'calm') — read only by providers with
  // expressive controls (elevenlabs voice_settings, openai instructions); others ignore
  // it, so a malformed style can never cost the voice lock (P7).
  const cfg = style ? { ...providerConfig(s, pid), _style: style } : providerConfig(s, pid);
  let v = voice;
  if (!v || v === 'auto') v = provider.autoVoiceFor(detectLang(text));
  if (v == null && pid !== 'say') throw new Error(`${pid}: không có giọng phù hợp cho ngôn ngữ`);
  const ext = pid === 'say' ? '.m4a' : '.mp3';
  return provider.synthesize(text, v, cfg, outPath.replace(/\.\w+$/, ext));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Main entry. Always returns { path, duration, provider, fallback } — falls back rather than
// throwing. VOICE LOCK: the chosen voice defines the video's identity, so the primary target
// is retried 3× with backoff before the chain may switch provider; `fallback: true` flags a
// scene that ended up on a different voice (the runner re-tries those once at the end).
// opts.ttsOverride: per-channel/per-project tts settings merged over global (channels feature).
export async function synthesizeVoice(text, outPath, opts = {}) {
  const s = { ...aiSettings().tts, ...(opts.ttsOverride || {}) };
  const lang = detectLang(text);
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
        const r = await synthWith(pid, voice, text, s, outPath, opts.style);
        // Reject implausibly long/short audio as a FAILED attempt: same-voice retries get
        // a fresh shot first, then the timbre-preserving fallback chain — a glitched
        // stretched take must never be accepted into the video.
        const { min, max } = ttsDurationBounds(text);
        if (r.duration > max || r.duration < min) {
          throw new Error(`giọng đọc dài bất thường (${r.duration.toFixed(1)}s cho ${String(text).length} ký tự — hợp lý: ${min.toFixed(1)}–${max.toFixed(0)}s)`);
        }
        return { ...r, provider: pid, fallback: ci > 0 };
      } catch (e) {
        lastErr = e;
        logger.warn(`Giọng đọc ${pid} lỗi (${e.message.slice(0, 120)})${a < tries - 1 ? ' — thử lại cùng giọng' : ' — chuyển giọng kế tiếp'}`);
        if (a < tries - 1) await sleep(1200 * (a + 1));
      }
    }
  }
  throw lastErr || new Error('all TTS providers failed');
}
