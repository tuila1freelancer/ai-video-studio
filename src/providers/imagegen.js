// AI image generation — a provider MESH with automatic failover instead of a single
// fragile endpoint. Pollinations stays the free keyless default; a configured paid
// provider (openai-compatible /images/generations, Recraft) gets first shot and falls
// back to Pollinations, which falls back to null → caller's designed gradient.
// Always degrades gracefully: generateImage never throws.
import { writeFileSync, statSync } from 'node:fs';
import { aiSettings } from '../db/index.js';
import { chatJson, llmEnabled } from './llm.js';
import { logger } from '../util/log.js';

export const STYLE_SUFFIX = {
  Cinematic: 'cinematic photography, dramatic volumetric lighting, shallow depth of field, film grain, highly detailed, 8k',
  Minimal: 'clean minimal flat illustration, soft pastel palette, lots of negative space, elegant, vector style',
  'Neon Tech': 'futuristic neon cyberpunk, glowing accents, dark background, sci-fi, ultra detailed, octane render',
};
const DEFAULT_SUFFIX = STYLE_SUFFIX.Cinematic;
const NEG = 'no text, no words, no letters, no watermark, no logo';

export function imageGenEnabled() {
  const s = aiSettings().imageGen || {};
  return (s.provider || 'pollinations') !== 'none';
}

export function buildImagePrompt(scene, styleName) {
  const base = (scene.visual_prompt || (scene.keywords || []).join(', ') || scene.voice_text || '').slice(0, 220);
  const suffix = STYLE_SUFFIX[styleName] || DEFAULT_SUFFIX;
  return `${base}. ${suffix}. ${NEG}`;
}

/**
 * Premium prompt: LLM-translate the (Vietnamese) visual brief into a strong English photo
 * prompt and lock it to the video's style guide (palette + motif), so generated photos
 * share one visual identity with the motion graphics. Falls back to buildImagePrompt.
 */
export async function buildImagePromptSmart(scene, { styleName, guide, ai } = {}) {
  const brief = (scene.visual_prompt || (scene.keywords || []).join(', ') || scene.voice_text || '').slice(0, 500);
  if (!brief || !llmEnabled(ai?.llm)) return buildImagePrompt(scene, styleName);
  const pal = guide?.palette;
  const guideLine = pal
    ? `Color mood LOCKED to: background ${pal.bg}, accents ${(pal.accents || []).join(' ')}; motif: ${guide.motif || 'none'}.`
    : '';
  try {
    const p = await chatJson([
      { role: 'system', content: 'You are a photography art director. Reply with pure JSON.' },
      { role: 'user', content: `Turn this scene brief (may be Vietnamese) into ONE strong English text-to-image prompt for a cinematic background photo. Concrete subject, composition, lighting, atmosphere — no on-image text. ${guideLine}\nBrief: ${brief}\nJSON: {"prompt":"..."}` },
    ], { maxTokens: 400, attempts: 1, temperature: 0.5, llm: ai.llm, validate: (x) => typeof x.prompt === 'string' && x.prompt.length > 20 });
    return `${p.prompt.slice(0, 600)}. ${NEG}`;
  } catch {
    return buildImagePrompt(scene, styleName); // prompt polish is optional, never blocking
  }
}

/** Download a remote image to a local path (closes the dead remote-URL asset path). */
export async function downloadImage(url, outPath, { timeoutMs = 45000 } = {}) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': 'AIVideoStudio' } });
  if (!res.ok) throw new Error(`image download ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1500) throw new Error('downloaded image tiny/empty');
  writeFileSync(outPath, buf);
  return outPath;
}

async function viaOpenAI(prompt, { w, h, outPath, s }) {
  const size = w === h ? '1024x1024' : (w > h ? '1792x1024' : '1024x1792');
  const res = await fetch(`${(s.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '')}/images/generations`, {
    signal: AbortSignal.timeout(90000),
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.apiKey}` },
    body: JSON.stringify({ model: s.model || 'dall-e-3', prompt, size, n: 1, response_format: 'b64_json' }),
  });
  if (!res.ok) throw new Error(`OpenAI image ${res.status}`);
  const data = await res.json();
  if (data.data?.[0]?.b64_json) { writeFileSync(outPath, Buffer.from(data.data[0].b64_json, 'base64')); return outPath; }
  if (data.data?.[0]?.url) return downloadImage(data.data[0].url, outPath);
  throw new Error('OpenAI image: empty response');
}

async function viaRecraft(prompt, { w, h, outPath, s }) {
  const size = w === h ? '1024x1024' : (w > h ? '1820x1024' : '1024x1820');
  const res = await fetch('https://external.api.recraft.ai/v1/images/generations', {
    signal: AbortSignal.timeout(90000),
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.apiKey}` },
    body: JSON.stringify({ prompt: prompt.slice(0, 1000), style: s.model || 'realistic_image', size, n: 1 }),
  });
  if (!res.ok) throw new Error(`Recraft ${res.status}`);
  const data = await res.json();
  if (!data.data?.[0]?.url) throw new Error('Recraft: empty response');
  return downloadImage(data.data[0].url, outPath);
}

async function viaPollinations(prompt, { w, h, seed, outPath, model }) {
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}`
    + `?width=${w}&height=${h}&seed=${seed}&nologo=true&model=${model || 'flux'}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(70000), headers: { 'User-Agent': 'AIVideoStudio' } });
  if (!res.ok) throw new Error(`Pollinations ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1500) throw new Error('Pollinations returned tiny/empty image');
  writeFileSync(outPath, buf);
  return outPath;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One provider attempt loop (paid: 2 tries; pollinations: 5 with model fallback to turbo).
async function tryProvider(provider, prompt, { w, h, seed, outPath, s }) {
  const attempts = provider === 'pollinations' ? 5 : 2;
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      if (provider === 'openai') return await viaOpenAI(prompt, { w, h, outPath, s });
      if (provider === 'recraft') return await viaRecraft(prompt, { w, h, outPath, s });
      const model = i < 2 ? (s.model || 'flux') : 'turbo';
      return await viaPollinations(prompt, { w, h, seed: seed + i * 1000, outPath, model });
    } catch (e) { lastErr = e; if (i < attempts - 1) await sleep(1200 + i * 1800); }
  }
  throw lastErr || new Error(`${provider} failed`);
}

/**
 * Generate one image through the failover mesh (configured provider → pollinations).
 * opts.bestOf (settings.imageGen.bestOf, max 3): N candidates at different seeds, keep the
 * most detailed one (largest encoded size — a cheap sharpness/detail proxy). Paid flag —
 * defaults to 1. Returns outPath on success, null on persistent failure (never throws).
 */
export async function generateImage(prompt, { w, h, seed = 1, outPath } = {}) {
  const s = aiSettings().imageGen || {};
  const provider = s.provider || 'pollinations';
  if (provider === 'none') return null;
  const chain = provider === 'pollinations' ? ['pollinations'] : [provider, 'pollinations'];
  const bestOf = Math.max(1, Math.min(3, parseInt(s.bestOf, 10) || 1));

  for (const p of chain) {
    if ((p === 'openai' || p === 'recraft') && !s.apiKey) continue; // unconfigured paid tier
    try {
      if (bestOf === 1) return await tryProvider(p, prompt, { w, h, seed, outPath, s });
      const candidates = [];
      for (let n = 0; n < bestOf; n++) {
        const candPath = outPath.replace(/(\.\w+)$/, `_c${n}$1`);
        try {
          await tryProvider(p, prompt, { w, h, seed: seed + n * 97, outPath: candPath, s });
          candidates.push(candPath);
        } catch { /* candidate lost — keep going */ }
      }
      if (candidates.length) {
        const best = candidates.sort((a, b) => statSync(b).size - statSync(a).size)[0];
        writeFileSync(outPath, (await import('node:fs')).readFileSync(best));
        return outPath;
      }
      throw new Error('all best-of candidates failed');
    } catch (e) {
      logger.warn(`image-gen (${p}) gave up: ${e.message}${p !== chain[chain.length - 1] ? ' — failing over' : ''}`);
    }
  }
  return null;
}
