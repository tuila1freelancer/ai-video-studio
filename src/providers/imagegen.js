// AI image generation — Pollinations.ai by default (free, keyless). Optional OpenAI images.
// Always degrades gracefully: returns null on failure → caller falls back to a designed gradient.
import { writeFileSync } from 'node:fs';
import { aiSettings } from '../db/index.js';
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

async function viaOpenAI(prompt, { w, h, outPath, s }) {
  const size = w === h ? '1024x1024' : (w > h ? '1792x1024' : '1024x1792');
  const res = await fetch(`${(s.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '')}/images/generations`, {
    signal: AbortSignal.timeout(90000),
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.apiKey}` },
    body: JSON.stringify({ model: s.model || 'dall-e-3', prompt, size, n: 1, response_format: 'b64_json' }),
  });
  if (!res.ok) throw new Error(`OpenAI image ${res.status}`);
  const data = await res.json();
  writeFileSync(outPath, Buffer.from(data.data[0].b64_json, 'base64'));
  return outPath;
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

// Generate one image, with retries (Pollinations free tier rate-limits / occasionally 5xx).
// Returns outPath on success, null on persistent failure (never throws).
export async function generateImage(prompt, { w, h, seed = 1, outPath } = {}) {
  const s = aiSettings().imageGen || {};
  const provider = s.provider || 'pollinations';
  if (provider === 'none') return null;
  const attempts = provider === 'openai' ? 2 : 5;
  for (let i = 0; i < attempts; i++) {
    try {
      if (provider === 'openai' && s.apiKey) return await viaOpenAI(prompt, { w, h, outPath, s });
      // try the preferred model first, then fall back to the faster/more-reliable 'turbo'
      const model = i < 2 ? (s.model || 'flux') : 'turbo';
      return await viaPollinations(prompt, { w, h, seed: seed + i * 1000, outPath, model });
    } catch (e) {
      if (i === attempts - 1) { logger.warn(`image-gen (${provider}) gave up after ${attempts}: ${e.message}`); return null; }
      await sleep(1200 + i * 1800);
    }
  }
  return null;
}
