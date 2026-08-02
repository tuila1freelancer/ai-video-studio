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

  // Openverse (P40): a REAL web image search that needs no key — the catalog of openly-licensed
  // images behind WordPress.org. Without this, a user with no Tavily key got gradient
  // placeholders and no way to find a picture at all. Commercial+modification licenses only, so
  // anything it returns is safe to put in a video.
  // Search terms narrow to nothing if they are concatenated: the generated keywords are whole
  // PHRASES, and joining four of them makes a 20-word query that matches no photograph. Try the
  // sharpest phrase first, then the owner's own words.
  for (const term of [keywords?.[0], query].filter(Boolean)) {
    try {
      const q = new URLSearchParams({
        q: term,
        page_size: String(Math.min(20, count * 2)),
        license_type: 'commercial,modification',
        mature: 'false',
      });
      const res = await fetch(`https://api.openverse.org/v1/images/?${q}`, {
        headers: { Accept: 'application/json', 'User-Agent': 'AI-Video-Studio/1.0' },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const images = (data.results || [])
        .map((r) => r.url || r.thumbnail).filter((u) => typeof u === 'string' && /^https?:\/\//.test(u))
        .slice(0, count);
      if (images.length) return { keywords, images, source: 'openverse' };
    } catch { /* offline → the deterministic placeholders below */ }
  }

  // last resort, fully offline — gradient placeholders so the feature always returns something
  const images = [];
  for (let i = 0; i < count; i++) {
    const out = join(DIRS.uploads, `${newId('img')}.png`);
    const [c1, c2] = PALETTES[i % PALETTES.length];
    await makeGradientImage(out, { w: 800, h: 800, c1, c2 });
    images.push(`/api/file?path=${encodeURIComponent(out)}`);
  }
  return { keywords, images, source: 'placeholder' };
}
