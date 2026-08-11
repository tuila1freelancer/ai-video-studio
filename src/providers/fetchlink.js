// Extract title / main text / images from an article URL (no external deps).
//
// This is the front of the "write a video from a link" lane: whatever it drops here is simply
// absent from the script, so its failures are invisible until the video is finished. Measured on
// real pages before this rewrite, the old `<p>`-scraper lost most of what it was pointed at:
//
//   en.wikipedia.org/wiki/Large_language_model  ~118,000 chars of article → returned exactly 8000,
//                                               cut mid-sentence ("…Megatron-Turing NLG ")
//   anthropic.com/news/…                        the navigation menu landed inside the article
//                                               ("…twice the speed.\nResearchPolicyCommi…")
//   vnexpress.net/…                             the article ended with the newsroom's street
//                                               address and "© Copyright 1997-2026 … reserved."
//   Wikipedia images                            0 of them, because every one is served from a
//                                               protocol-relative //upload.wikimedia.org URL
//
// So: decode the page in its declared charset, throw the chrome away STRUCTURALLY before looking
// for text, take blocks from the container that actually holds the article, decode entities
// properly, and resolve image URLs against the page instead of demanding they already be absolute.

/** Everything that is on the page but is not the article. Removed before any text is read. */
const CHROME_TAGS = ['script', 'style', 'noscript', 'template', 'svg', 'iframe', 'form', 'nav', 'header', 'footer', 'aside', 'figure>figcaption'];
const BLOCK_RE = /<(p|li|h1|h2|h3|h4|blockquote|pre|dd)\b[^>]*>([\s\S]*?)<\/\1>/gi;
/**
 * Containers a CMS puts the body in, in two tiers.
 *
 * SEMANTIC ones are a DECLARATION by the page ("this is the article"), so they are believed as
 * soon as they hold real prose. GUESS ones are pattern-matching on class names and have to beat
 * the whole document to be taken seriously.
 */
const SEMANTIC_HINTS = [
  /<article\b[^>]*>([\s\S]*?)<\/article>/i,
  /<main\b[^>]*>([\s\S]*?)<\/main>/i,
  /<div\b[^>]*\b(?:itemprop|role)=["'](?:articleBody|main)["'][^>]*>([\s\S]*)<\/div>/i,
];
const GUESS_HINTS = [
  /<div\b[^>]*\bclass=["'][^"']*\b(?:article-?(?:body|content|detail)|post-?(?:body|content)|entry-content|story-?body|fck_detail)\b[^"']*["'][^>]*>([\s\S]*)<\/div>/i,
];
const SEMANTIC_FLOOR = 200; // chars of <p> text before an <article> counts as holding the article
/** Lines that are site furniture wherever they appear. */
const BOILER_RE = /^(?:©|copyright\b|all rights reserved|share (?:this|on)\b|đọc thêm\b|xem thêm\b|tags?:|chia sẻ\b)/i;

const MAX_TEXT = 24000;  // the master engine's own source cap (content/master-script.js)
const MAX_IMAGES = 24;

// HTML4's Latin-1 block, in code-point order from U+00A0 — which is what makes it worth writing
// as a list instead of 96 key/value pairs. Accented names are not exotic: `&eacute;` and friends
// come out of any CMS that was ever configured for a Western European locale, and an undecoded one
// reaches the narration as the literal text "&eacute;".
// One missing name shifts every character after it (leaving `&eacute;` as è), so the table is
// pinned at both ends by tests rather than trusted by eye.
const LATIN1_NAMES = ('nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg '
  + 'plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest '
  + 'Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml '
  + 'ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig '
  + 'agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml '
  + 'eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml').split(' ');

const NAMED = {
  ...Object.fromEntries(LATIN1_NAMES.map((n, i) => [n, String.fromCharCode(0xa0 + i)])),
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  // …then the ones that are not spacing characters at all, or would read as one
  nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ', shy: '', zwj: '', zwnj: '', lrm: '', rlm: '',
  ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  sbquo: '‚', bdquo: '„', bull: '•', dagger: '†', Dagger: '‡', permil: '‰', prime: '′', Prime: '″',
  euro: '€', trade: '™', larr: '←', uarr: '↑', rarr: '→', darr: '↓', harr: '↔', minus: '−',
};

/**
 * Decode HTML entities — named, decimal AND hex.
 *
 * The old code ran `.replace(/&[a-z]+;/gi, ' ')`, which turned every `&amp;` into a space and left
 * `&#x27;` sitting raw in the text (the character class matches no `#`), so an apostrophe reached
 * the narration as five literal characters. Both were visible in the anthropic.com sample.
 */
export function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    const hit = NAMED[body] ?? NAMED[body.toLowerCase()];
    return hit === undefined ? m : hit;
  });
}

/** Which charset is this page really in? Header first, then the document's own declaration. */
export function charsetOf(contentType, headBytes) {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType || '')?.[1];
  if (fromHeader) return fromHeader.toLowerCase();
  // The declaration is inside the bytes we have not decoded yet, so read it as latin1 — every
  // charset a browser accepts is ASCII-compatible in the <head>.
  const head = Buffer.from(headBytes).toString('latin1');
  return (/<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1]
    || /<meta[^>]+content=["'][^"']*charset=([\w-]+)/i.exec(head)?.[1] || 'utf-8').toLowerCase();
}

/** Strip the page furniture, so no text search can ever reach it. */
function stripChrome(html) {
  let out = html.replace(/<!--[\s\S]*?-->/g, ' ');
  for (const tag of CHROME_TAGS) {
    const name = tag.includes('>') ? tag.split('>')[1] : tag;
    out = out.replace(new RegExp(`<${name}\\b[^>]*>[\\s\\S]*?<\\/${name}>`, 'gi'), ' ');
  }
  return out;
}

// Tags become spaces, so an inline link (`an <a>LLM</a> is`) leaves gaps around punctuation:
// "( LLM )". Harmless to read, but this text is narration source — a TTS engine pauses at it.
const textOf = (html) => decodeEntities(String(html).replace(/<[^>]+>/g, ' '))
  .replace(/\s+/g, ' ')
  .replace(/\s+([,.;:!?%…”’)\]}])/g, '$1')
  .replace(/([([{“‘])\s+/g, '$1')
  .trim();

/**
 * The container that actually holds the article.
 *
 * Scored by how much text sits inside its own `<p>` elements, because that is the one thing a
 * navigation column never has. An `<article>` element is believed the moment it holds real prose:
 * scoring it against the whole document instead loses to any page whose comment thread or
 * related-stories rail is longer than the story, and those live in sections nothing strips.
 */
export function pickMain(html) {
  const score = (s) => [...String(s).matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].reduce((a, m) => a + textOf(m[1]).length, 0);
  const best = SEMANTIC_HINTS
    .map((re) => re.exec(html)?.[1]).filter(Boolean)
    .map((h) => ({ h, s: score(h) }))
    .sort((a, b) => b.s - a.s)[0];
  if (best && best.s >= SEMANTIC_FLOOR) return best.h;
  const body = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] || html;
  const floor = score(body) * 0.6; // a class-name guess has to clearly beat the whole document
  const guess = GUESS_HINTS.map((re) => re.exec(html)?.[1]).filter(Boolean)
    .map((h) => ({ h, s: score(h) })).sort((a, b) => b.s - a.s)[0];
  if (guess && guess.s > floor) return guess.h;
  return best?.h || body; // a short <article> still beats the whole page
}

/** html → the article's ordered text blocks. The one path fetchLink and the tests both take. */
export function articleBlocks(html) {
  return extractBlocks(pickMain(stripChrome(html)));
}

/**
 * Article text as ordered blocks.
 *
 * Link density is the filter that structural stripping cannot do: a `<p>` of six links inside the
 * article body is a related-stories rail, and it reads as plausible prose once the tags are gone.
 */
export function extractBlocks(mainHtml) {
  const out = [];
  const seen = new Set();
  for (const m of mainHtml.matchAll(BLOCK_RE)) {
    const tag = m[1].toLowerCase();
    const inner = m[2];
    const text = textOf(inner);
    if (!text || BOILER_RE.test(text)) continue;
    const heading = /^h[1-4]$/.test(tag);
    if (text.length < (heading ? 3 : 25)) continue;
    const linkChars = [...inner.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)].reduce((a, x) => a + textOf(x[1]).length, 0);
    if (!heading && linkChars > text.length * 0.6) continue; // a link rail, not a paragraph
    const key = text.slice(0, 120).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

/**
 * Join blocks up to the cap, on a BLOCK boundary.
 *
 * The old cap was a bare `.slice(0, 8000)`, which ended the Wikipedia sample mid-word. A script
 * written from a half-sentence is a script with a hole in it, and nothing downstream can tell.
 */
export function joinCapped(blocks, max = MAX_TEXT) {
  const kept = [];
  let n = 0;
  for (const b of blocks) {
    if (n + b.length + 1 > max) return { text: kept.join('\n'), truncated: true, dropped: blocks.length - kept.length };
    kept.push(b);
    n += b.length + 1;
  }
  return { text: kept.join('\n'), truncated: false, dropped: 0 };
}

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

/** Every way a page names an image, resolved against the page itself. */
export function extractImages(html, pageUrl, mainHtml = '') {
  const push = (set, raw) => {
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
    set.add(upgradeThumb(abs));
  };
  const meta = (prop) => metaContent(html, prop);
  // article images first — they are the ones about the story
  const inArticle = new Set();
  const rest = new Set();
  for (const [scope, set] of [[mainHtml, inArticle], [html, rest]]) {
    if (!scope) continue;
    for (const m of scope.matchAll(/<(?:img|source)\b[^>]*>/gi)) {
      const tagText = m[0];
      const srcset = /\bsrcset=["']([^"']+)["']/i.exec(tagText)?.[1];
      if (srcset) push(set, widestSrc(srcset)); // a 320w thumbnail is not worth putting in a video
      for (const attr of ['src', 'data-src', 'data-original', 'data-lazy-src', 'data-srcset']) {
        push(set, new RegExp(`\\b${attr}=["']([^"']+)["']`, 'i').exec(tagText)?.[1]);
      }
    }
  }
  // Only the meta tags still need normalising — the two sets above already hold clean, upgraded
  // URLs. Running them through `push` a second time re-applied the rules to their own output,
  // which is how an upgraded Wikipedia thumbnail got thrown away by the .svg filter.
  const metas = new Set();
  push(metas, meta('og:image'));
  push(metas, meta('twitter:image'));
  return [...new Set([...metas, ...inArticle, ...rest])].slice(0, MAX_IMAGES);
}

/**
 * A `<meta>` value, whichever order the attributes are written in.
 *
 * The old pattern demanded `content=` come AFTER `property=`, so any page that writes
 * `<meta content="…" property="og:title">` — a common CMS output — silently had no og: data at all.
 */
export function metaContent(html, prop) {
  const p = prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const after = new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]*\\scontent=["']([^"']*)["']`, 'i');
  const before = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${p}["']`, 'i');
  return decodeEntities(after.exec(html)?.[1] || before.exec(html)?.[1] || '').trim();
}

/**
 * @param {string} url
 * @returns {Promise<{title:string, description:string, text:string, images:string[], url:string,
 *   siteName:string, chars:number, truncated:boolean, blocks:number}>}
 */
export async function fetchLink(url) {
  if (!/^https?:\/\//i.test(url || '')) throw new Error('URL không hợp lệ');
  const res = await fetch(url, {
    headers: {
      // Some publishers serve a stub to anything that does not look like a browser; the old
      // "Mozilla/5.0 AIVideoStudio" was exactly the shape those filters look for.
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'vi,en;q=0.9',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Fetch ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const charset = charsetOf(res.headers.get('content-type'), bytes.subarray(0, 2048));
  let html;
  try { html = new TextDecoder(charset).decode(bytes); }
  catch { html = bytes.toString('utf8'); } // an unknown label is not a reason to fail the fetch
  const finalUrl = res.url || url;

  const titleTag = decodeEntities((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1] || '').replace(/\s+/g, ' ').trim();
  const title = metaContent(html, 'og:title') || titleTag || finalUrl;
  const description = metaContent(html, 'og:description') || metaContent(html, 'description') || '';
  const siteName = metaContent(html, 'og:site_name');

  const main = pickMain(stripChrome(html));
  const blocks = extractBlocks(main);
  // The description is the article's own summary and usually opens it; keep it only when the body
  // does not already say the same thing.
  const head = description && !blocks.some((b) => b.startsWith(description.slice(0, 40))) ? [description] : [];
  const { text, truncated, dropped } = joinCapped([...head, ...blocks]);

  return {
    title: title.trim(),
    description: description.trim(),
    text,
    images: extractImages(html, finalUrl, main),
    url: finalUrl,
    siteName,
    chars: text.length,
    blocks: blocks.length,
    truncated,
    dropped,
  };
}
