// Image search — pluggable (Tavily). Offline fallback generates gradient placeholders
// so the feature always returns visible results.
//
// Results are ITEMS, not bare URLs. A bare URL cannot be looked at: the panel had nothing to show
// but a 46px square and nothing to say about where it came from, so the only way to find out what
// a picture was, was to download it into the video. Every provider now reports a display thumbnail
// (fast, small) alongside the full-size URL (what actually gets downloaded), plus a title and the
// page it came from.
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

const httpUrl = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : null);

/**
 * Search terms, longest first, each one shorter than the last.
 *
 * Openverse matches the whole phrase, so length is fatal rather than merely unhelpful. Measured
 * against the live API on 2026-08-11: "large language model neural network" returns 0 results;
 * "large language model" returns 240; "language model" returns 240. The old ladder had two rungs —
 * the sharpest generated keyword, then the owner's words — and both are usually full phrases, so a
 * search with perfectly good matches available fell all the way through to gradient placeholders.
 *
 * Titles get their site suffix cut first ("Large language model - Wikipedia"), because that suffix
 * is two more words of guaranteed mismatch.
 */
export function searchTerms(query, keywords = []) {
  const clean = (s) => String(s || '').split(/\s+[|—–-]\s+|\s*\|\s*/)[0].replace(/[^\p{L}\p{N}\s]+/gu, ' ').replace(/\s+/g, ' ').trim();
  const out = [];
  const seen = new Set();
  const add = (t) => {
    const v = clean(t);
    const k = v.toLowerCase();
    if (v.length < 2 || seen.has(k)) return;
    seen.add(k);
    out.push(v);
  };
  add(keywords?.[0]);
  add(query);
  for (const base of [keywords?.[0], query]) {
    const w = clean(base).split(' ').filter(Boolean);
    for (const n of [3, 2]) if (w.length > n) add(w.slice(0, n).join(' '));
  }
  return out;
}

/** {url, thumb, title, page, provider} — thumb defaults to the full image when there is no smaller one. */
function item({ url, thumb, title, page, provider }) {
  const full = httpUrl(url) || url;
  if (!full) return null;
  return { url: full, thumb: httpUrl(thumb) || full, title: String(title || '').slice(0, 120), page: httpUrl(page) || '', provider };
}

export async function imageSearch(query, count = 6) {
  const s = aiSettings().imageSearch || {};
  const keywords = await generateKeywords(query);
  const n = Math.min(40, Math.max(1, +count || 6));

  if (s.provider === 'tavily' && s.apiKey) {
    try {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        // Tavily moved the key to a bearer header; `api_key` in the body is the deprecated form
        // and newer accounts reject it outright. Both are sent so either vintage of key works.
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.apiKey}` },
        body: JSON.stringify({ api_key: s.apiKey, query, include_images: true, include_image_descriptions: true, max_results: n }),
        // Without this the request had no ceiling of its own and rode the browser's 120s timeout,
        // so an unreachable provider froze the button for two minutes.
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) {
        const data = await res.json();
        const items = (data.images || []).slice(0, n)
          .map((im) => (typeof im === 'string'
            ? item({ url: im, provider: 'tavily' })
            : item({ url: im.url, title: im.description, provider: 'tavily' })))
          .filter(Boolean);
        if (items.length) return { keywords, items, images: items.map((i) => i.url), source: 'tavily' };
      }
    } catch { /* fall through */ }
  }

  // Openverse (P40): a REAL web image search that needs no key — the catalog of openly-licensed
  // images behind WordPress.org. Without this, a user with no Tavily key got gradient
  // placeholders and no way to find a picture at all. Commercial+modification licenses only, so
  // anything it returns is safe to put in a video.
  // Why the real search did not answer. Falling back to gradients is correct; doing it in silence
  // is not — the owner sees six coloured squares and no reason, which reads as "there are no
  // pictures of this" rather than "the catalogue is throttling us, try again in a minute".
  let note = null;
  for (const term of searchTerms(query, keywords)) {
    try {
      const q = new URLSearchParams({
        q: term,
        page_size: String(Math.min(40, n * 2)),
        license_type: 'commercial,modification',
        mature: 'false',
      });
      const res = await fetch(`https://api.openverse.org/v1/images/?${q}`, {
        headers: { Accept: 'application/json', 'User-Agent': 'AI-Video-Studio/1.0' },
        signal: AbortSignal.timeout(15000),
      });
      if (res.status === 429) {
        // The limit is per CLIENT, not per query, so the remaining rungs would each buy another
        // 429 and another wait.
        note = 'Openverse đang giới hạn truy cập (429) — thử lại sau ít phút';
        break;
      }
      if (!res.ok) { note = `Openverse trả về lỗi ${res.status}`; continue; }
      const data = await res.json();
      const items = (data.results || [])
        // `url` is the ORIGINAL, which is what a scene should use — often several MB, which is why
        // it must not also be what a grid of twelve tiles loads. `thumbnail` is for looking.
        .map((r) => item({ url: r.url, thumb: r.thumbnail, title: r.title, page: r.foreign_landing_url, provider: 'openverse' }))
        .filter(Boolean)
        .slice(0, n);
      if (items.length) return { keywords, items, images: items.map((i) => i.url), source: 'openverse' };
      note = note || `không có ảnh nào khớp “${term}”`;
    } catch (e) {
      // offline → the deterministic placeholders below, but say which wall we hit
      note = e.name === 'TimeoutError' ? 'Openverse không phản hồi trong 15 giây' : 'không kết nối được Openverse (offline?)';
    }
  }

  // last resort, fully offline — gradient placeholders so the feature always returns something
  const items = [];
  for (let i = 0; i < Math.min(n, 8); i++) {
    const out = join(DIRS.uploads, `${newId('img')}.png`);
    const [c1, c2] = PALETTES[i % PALETTES.length];
    await makeGradientImage(out, { w: 800, h: 800, c1, c2 });
    const url = `/api/file?path=${encodeURIComponent(out)}`;
    items.push({ url, thumb: url, title: `Nền chuyển sắc ${i + 1}`, page: '', provider: 'placeholder' });
  }
  return { keywords, items, images: items.map((i) => i.url), source: 'placeholder', note };
}
