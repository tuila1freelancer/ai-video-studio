// TTS façade — resolves language → (provider, voice) → synthesizes with a robust fallback chain.
// Resolution order per scene text:
//   1. langVoices[detected-lang] = { provider, voice }     (per-language defaults, set via Voice Picker)
//   2. settings provider + its chosen voice ('auto' → provider.autoVoiceFor(lang))
//   3. on failure: edge auto → say auto (never throws)
import { aiSettings } from '../db/index.js';
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

async function synthWith(pid, voice, text, s, outPath) {
  const provider = getProvider(pid);
  const cfg = providerConfig(s, pid);
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
  // langVoices are defaults, not vetoes; the user's per-video choice must win.
  const target = opts.ttsOverride?.provider
    ? { pid: opts.ttsOverride.provider, voice: opts.ttsOverride.voice || legacyVoice(s, opts.ttsOverride.provider) || 'auto' }
    : resolveTarget(s, lang);

  const chain = [target];
  if (target.pid !== 'edge') chain.push({ pid: 'edge', voice: 'auto' });
  if (target.pid !== 'say') chain.push({ pid: 'say', voice: 'auto' });

  let lastErr;
  for (let ci = 0; ci < chain.length; ci++) {
    const { pid, voice } = chain[ci];
    const tries = ci === 0 ? 3 : 1; // fight for the locked voice before switching provider
    for (let a = 0; a < tries; a++) {
      try {
        const r = await synthWith(pid, voice, text, s, outPath);
        return { ...r, provider: pid, fallback: ci > 0 };
      } catch (e) {
        lastErr = e;
        logger.warn(`TTS ${pid} failed (${e.message.slice(0, 120)})${a < tries - 1 ? '; retrying same voice' : '; trying next'}`);
        if (a < tries - 1) await sleep(1200 * (a + 1));
      }
    }
  }
  throw lastErr || new Error('all TTS providers failed');
}
