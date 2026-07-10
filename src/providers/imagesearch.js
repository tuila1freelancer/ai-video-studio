// Image search — pluggable (Tavily). Offline fallback generates gradient placeholders
// so the feature always returns visible results.
import { join } from 'node:path';
import { aiSettings } from '../db/index.js';
import { DIRS } from '../config/paths.js';
import { makeGradientImage } from '../media/ffmpeg.js';
import { generateKeywords } from './llm.js';
import { newId } from '../util/util.js';

const PALETTES = [
  ['0x1e3a8a', '0x0f172a'], ['0x7c2d12', '0x1c1917'], ['0x064e3b', '0x052e16'],
  ['0x581c87', '0x1e1b4b'], ['0x9d174d', '0x4a044e'], ['0x155e75', '0x0c4a6e'],
];

export async function imageSearch(query, count = 6) {
  const s = aiSettings().imageSearch || {};
  const keywords = await generateKeywords(query);

  if (s.provider === 'tavily' && s.apiKey) {
    try {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: s.apiKey, query, include_images: true, max_results: count }),
      });
      if (res.ok) {
        const data = await res.json();
        const images = (data.images || []).slice(0, count).map((u) => (typeof u === 'string' ? u : u.url));
        if (images.length) return { keywords, images, source: 'tavily' };
      }
    } catch { /* fall through */ }
  }

  // offline fallback — generate gradient placeholder images labelled by keyword
  const images = [];
  for (let i = 0; i < count; i++) {
    const out = join(DIRS.uploads, `${newId('img')}.png`);
    const [c1, c2] = PALETTES[i % PALETTES.length];
    await makeGradientImage(out, { w: 800, h: 800, c1, c2 });
    images.push(`/api/file?path=${encodeURIComponent(out)}`);
  }
  return { keywords, images, source: 'placeholder' };
}
