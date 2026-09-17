// Which pictures on the page belong to the article: skip lists, thumbnail upgrades, srcset, ranking.

import { MAX_IMAGES, decodeEntities } from './extract.js';

import { metaContent } from './fetch.js';

const SKIP_IMG = /(?:^|\/)(?:sprite|icon|favicon|avatar|pixel|blank|spacer|placeholder|loading|logo[-_.])/i;

/**
 * MediaWiki serves `/thumb/8/81/File.png/250px-File.png`; the original is the same path without
 * `/thumb` and without the size segment. A 250-pixel chart is not an asset for a 4K video, and
 * Wikipedia is the single likeliest thing this feature gets pointed at.
 *
 * Only RASTER files are upgraded, and only to their true original — a URL that is guaranteed to
 * exist. Asking for a bigger render of a vector file looks equally reasonable and is not: measured
 * against commons on 2026-08-11, of 800 / 1024 / 1280 / 2560 px only 1280 answered, the rest
 * returned `400 … Use thumbnail sizes listed on …`. The width that works is per-file, so there is
 * nothing to guess with. An SVG-backed thumbnail keeps whatever the page served, and `widestSrc`
 * has already taken the largest render the page itself offers.
 */
function upgradeThumb(u) {
  const m = /^(https?:\/\/[^/]*wikimedia\.org)\/(.+?)\/thumb\/(.+?)\/\d+px-[^/]+$/i.exec(u);
  if (!m) return u;
  const [, host, ns, file] = m;
  return /\.svg$/i.test(file) ? u : `${host}/${ns}/${file}`;
}

/**
 * The widest candidate in a srcset.
 *
 * Descriptors come in two flavours and mixing them up picks the smallest image: `640w` is a pixel
 * width, `2x` is a density multiplier. Sorting `parseInt` over both makes "2x" score 2 and lose to
 * every `w` entry — including the 320w one.
 */
export function widestSrc(srcset) {
  const parts = String(srcset).split(',').map((p) => p.trim()).filter(Boolean).map((p) => {
    const [u, d = ''] = p.split(/\s+/);
    const n = parseFloat(d) || 0;
    return { u, w: /x$/i.test(d) ? n * 1000 : n }; // density → a comparable scale, never below a real width
  });
  return parts.sort((a, b) => b.w - a.w)[0]?.u || null;
}

/**
 * Every way a page names an image, resolved against the page itself, WITH the context needed to
 * judge it: its alt text and whether the tag sat inside the article container at all.
 *
 * The judging is the AI pass's job (`refineArticle`). This only has to make sure it is judging the
 * right things — a URL with no alt text and no idea where it came from is not something anyone,
 * model or regex, can classify.
 */
export function imageCandidates(html, pageUrl, mainHtml = '') {
  const out = [];
  const seen = new Set();
  const push = (raw, { alt = '', inArticle = false, source = 'img' } = {}) => {
    if (!raw) return;
    // An attribute value is HTML, so a query string arrives as `?a=1&amp;b=2`. Handing that to the
    // downloader verbatim fetches a URL whose parameters are named "amp;b" — seen live on a
    // Wikipedia thumbnail carrying utm parameters.
    const candidate = decodeEntities(String(raw).trim()).split(/\s+/)[0];
    if (!candidate || /^data:/i.test(candidate)) return;
    let abs;
    // Relative and protocol-relative URLs were dropped outright by the old http(s)-only filter,
    // which is every image on Wikipedia and most of them on any CMS.
    try { abs = new URL(candidate, pageUrl).href; } catch { return; }
    if (!/^https?:/i.test(abs)) return;
    if (SKIP_IMG.test(new URL(abs).pathname)) return;
    if (/\.svg(\?|$)/i.test(abs)) return; // vector chrome, never article art
    const url = upgradeThumb(abs);
    if (seen.has(url)) return;
    seen.add(url);
    out.push({ url, alt: alt.slice(0, 140), inArticle, source });
  };
  // The article's own lead image, named by the page itself — in-article by definition.
  push(metaContent(html, 'og:image'), { inArticle: true, source: 'og:image' });
  push(metaContent(html, 'twitter:image'), { inArticle: true, source: 'twitter:image' });
  for (const [scope, inArticle] of [[mainHtml, true], [html, false]]) {
    if (!scope) continue;
    for (const m of scope.matchAll(/<(?:img|source)\b[^>]*>/gi)) {
      const tagText = m[0];
      const alt = decodeEntities(/\balt=["']([^"']*)["']/i.exec(tagText)?.[1] || '').trim();
      const srcset = /\bsrcset=["']([^"']+)["']/i.exec(tagText)?.[1];
      if (srcset) push(widestSrc(srcset), { alt, inArticle }); // a 320w thumbnail is not for a video
      for (const attr of ['src', 'data-src', 'data-original', 'data-lazy-src', 'data-srcset']) {
        push(new RegExp(`\\b${attr}=["']([^"']+)["']`, 'i').exec(tagText)?.[1], { alt, inArticle });
      }
    }
  }
  return out;
}

/**
 * The URLs alone, article images first.
 *
 * `inArticle` is the difference between an illustration and the sidebar: an image whose tag never
 * sat inside the article container is a related-story tile, an ad, or a promo, and putting it in a
 * video about the article is simply wrong. Everything else is a fallback for the case where no
 * article container was found at all — without it a page we failed to parse would return nothing.
 */
export function extractImages(html, pageUrl, mainHtml = '') {
  const all = imageCandidates(html, pageUrl, mainHtml);
  const inside = all.filter((c) => c.inArticle);
  return (inside.length ? inside : all).map((c) => c.url).slice(0, MAX_IMAGES);
}
