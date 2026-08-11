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
const AI_BUDGET_MS = 40000; // the longest a "Lấy thông tin" click may wait on the model

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
export function stripChrome(html) {
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

/**
 * An overlay the CMS APPENDED inside the article container — a popup box, a cookie bar, a
 * newsletter drawer. Matched on the element's declared ROLE (its class/id), never on its words.
 *
 * The AI pass is the real filter and this does not try to be it. This is the floor for when the
 * model cannot run — rate-limited, offline, switched off — and it was measurably too low:
 * base.vn/blog ends its `<article>` with a WordPress popup plugin (`ays_pb_*`) whose four blocks
 * came out as article text, closing the "story" with "This will close in 2000 seconds".
 *
 * Only an overlay in the TAIL truncates. A legitimate `class="modal-demo"` figure in the middle of
 * a story must not delete the rest of it, and appended chrome is by definition at the end.
 */
const OVERLAY_RE = /<(?:div|section|aside|dialog)\b[^>]*\b(?:class|id)=["'][^"']*\b(?:ays[_-]?pb[\w-]*|popup|modal|lightbox|overlay|offcanvas|drawer|newsletter|subscribe|cookie[-_]?(?:bar|notice|consent))[\w-]*[^"']*["']/gi;
export function dropTrailingOverlay(html) {
  const s = String(html);
  const floor = s.length * 0.6;
  for (const m of s.matchAll(OVERLAY_RE)) if (m.index > floor) return s.slice(0, m.index);
  return s;
}

/** html → the article's ordered text blocks. The one path fetchLink and the tests both take. */
export function articleBlocks(html) {
  return extractBlocks(dropTrailingOverlay(pickMain(stripChrome(html))));
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

/**
 * Expand "3-58,61,70-94" into indexes. The model answers in ranges because an article body is a
 * contiguous run with a few intrusions, and a 370-element JSON array is an answer that gets
 * truncated by a token limit long before it gets wrong.
 */
export function parseRanges(spec, max) {
  const out = new Set();
  for (const part of String(spec || '').split(',')) {
    const m = /^\s*(\d+)\s*(?:[-–]\s*(\d+))?\s*$/.exec(part);
    if (!m) continue;
    const a = +m[1];
    const b = m[2] === undefined ? a : +m[2];
    for (let i = Math.min(a, b); i <= Math.max(a, b) && i < max; i++) if (i >= 0) out.add(i);
  }
  return [...out].sort((x, y) => x - y);
}

/** How much of the candidate text a selection keeps — the guard against a model that answers "1-3". */
const keptShare = (blocks, idx) => {
  const total = blocks.reduce((a, b) => a + b.length, 0) || 1;
  return idx.reduce((a, i) => a + (blocks[i]?.length || 0), 0) / total;
};

/**
 * THE AI PASS: which of these blocks are the article, and which pictures belong to it.
 *
 * Structure gets close and no closer. Stripping `<nav>`/`<footer>` and scoring containers is how
 * this file finds the right REGION, but inside that region every site has its own furniture — an
 * author bio, a newsletter box, "read more" tiles, a subscription pitch, a photo credit, a related
 * rail rendered as ordinary paragraphs. No pattern list survives contact with the next site, and
 * the owner is right that a pattern list is what this was.
 *
 * The model CLASSIFIES; it never rewrites. It is shown a numbered preview of each block and
 * answers with the ranges that are the article body, so the text that ships is the ORIGINAL text,
 * assembled by code. A model asked to echo 24,000 characters back paraphrases, drops paragraphs and
 * hits its token ceiling; a model asked "which of these 370 are the article" does one cheap pass
 * and cannot damage a single sentence.
 *
 * Two guards, because a wrong answer here is silent data loss:
 *   - a selection keeping under a quarter of the candidate text is treated as a failed
 *     classification, not as a very aggressive one
 *   - any failure at all (no LLM, bad JSON, timeout) keeps the structural result and SAYS so
 *
 * @returns {Promise<{blocks:string[], images:object[], ai:boolean, note:string|null}>}
 */
export async function refineArticle({ title = '', url = '', blocks, images, llm = null, onLog = null } = {}) {
  const fallback = (note) => ({ blocks, images: images.filter((c) => c.inArticle).length ? images.filter((c) => c.inArticle) : images, ai: false, note });
  if (!blocks.length) return fallback(null);
  const { chatJson, llmEnabled } = await import('./llm.js');
  if (!llmEnabled(llm)) return fallback('AI chưa bật — lọc theo cấu trúc trang');

  // A preview is all a classifier needs, and its LENGTH is what decides whether a long page is
  // affordable. Fixed at 110 characters, base.vn's 112 blocks made a 15,000-character prompt;
  // scaling the preview to the block count keeps every page inside roughly the same budget, and a
  // 50-character opening is still plenty to tell a paragraph from a newsletter box.
  const per = Math.max(45, Math.min(110, Math.round(6500 / Math.max(1, blocks.length))));
  const list = blocks.map((b, i) => `${i}| ${b.length}c | ${b.slice(0, per).replace(/\s+/g, ' ')}`).join('\n');
  const imgList = images.slice(0, 40)
    .map((c, i) => `${i}| ${c.inArticle ? 'in-body' : 'outside'} | alt="${c.alt.slice(0, 70)}" | ${c.url.slice(0, 90)}`).join('\n') || '(none)';
  const messages = [
    {
      role: 'system',
      content: 'You separate the BODY of a web article from the page furniture around it. Reply with pure JSON only.',
    },
    {
      role: 'user',
      content: `PAGE: ${title}${url ? `\nURL: ${url}` : ''}

BLOCKS (index | length | preview) — these are candidate text blocks in document order:
${list}

IMAGES (index | where the tag sat | alt | url):
${imgList}

Return the blocks that are the ARTICLE ITSELF — the prose and headings a reader came for, in order.

DROP anything that is not the article, even when it reads like prose:
- navigation, breadcrumbs, category lists, tag lists
- "related articles", "read more", "most popular", teasers for OTHER stories
- newsletter and subscription pitches, app-download prompts, survey invitations
- author bios, editorial disclaimers, photo credits, timestamps standing alone
- comments, social prompts, share instructions, advertising copy
- site footers: addresses, copyright, licence notices, contact details

KEEP the article's own headings, list items, quotes and captions — a subheading is part of the body.
If the page is a LISTING (a homepage or category index) rather than one article, keep only the
blocks that genuinely describe its subject, and say so in "kind".

For IMAGES keep only pictures that ILLUSTRATE THIS ARTICLE. Drop logos, avatars, author portraits,
advertising, and thumbnails belonging to other stories. An image whose tag sat outside the body is
almost never an illustration — keep one only if its alt text clearly describes this article.

Reply exactly:
{"kind":"article"|"listing","body":"<index ranges, e.g. 4-58,61,70-96>","images":[<indexes>],"why":"<one short sentence>"}`,
    },
  ];

  const t0 = Date.now();
  try {
    const raw = await chatJson(messages, {
      llm,
      // A human is watching this button. Without a ceiling the retry ladder in chat() backs off
      // 8s + 20s + 45s per key on a 429, twice over — measured 163 SECONDS on base.vn against a
      // rate-limited proxy, which reads as the feature being broken rather than the model being
      // busy. Past the budget the structural result ships, with the reason on screen.
      budgetMs: AI_BUDGET_MS,
      maxTokens: 700,
      temperature: 0.1,
      // chatJson's validate is a PREDICATE — truthy means the shape is good
      validate: (o) => typeof o?.body === 'string' && o.body.trim().length > 0,
    });
    const idx = parseRanges(raw.body, blocks.length);
    if (!idx.length) return fallback('AI không chọn được đoạn nào — giữ bản lọc theo cấu trúc');
    const share = keptShare(blocks, idx);
    if (share < 0.25) {
      // Not "aggressive" — wrong. A body that is a fifth of its own candidates means the model
      // misread the list, and shipping that would delete most of the article in silence.
      return fallback(`AI chỉ giữ ${Math.round(share * 100)}% nội dung — nghi lọc sai, giữ bản theo cấu trúc`);
    }
    const keepImg = Array.isArray(raw.images)
      ? raw.images.map((n) => images[+n]).filter(Boolean)
      : images.filter((c) => c.inArticle);
    onLog?.(`AI lọc bài: giữ ${idx.length}/${blocks.length} đoạn · ${keepImg.length}/${images.length} ảnh${raw.why ? ` — ${String(raw.why).slice(0, 90)}` : ''}`);
    return { blocks: idx.map((i) => blocks[i]), images: keepImg, ai: true, note: null, kind: raw.kind || 'article' };
  } catch (e) {
    const secs = Math.round((Date.now() - t0) / 1000);
    const why = /\b429\b|rate.?limit|too many/i.test(e.message)
      ? 'AI đang bị giới hạn truy cập (429)'
      : `AI lọc lỗi (${e.message.slice(0, 60)})`;
    return fallback(`${why} sau ${secs}s — giữ bản lọc theo cấu trúc`);
  }
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
 * @param {{llm?:object|null, ai?:boolean, onLog?:Function}} [opts] `ai:false` skips the model pass
 *   (the tests, and anyone who wants the structural answer only)
 * @returns {Promise<{title:string, description:string, text:string, images:string[], url:string,
 *   siteName:string, chars:number, truncated:boolean, blocks:number, ai:boolean, note:string|null}>}
 */
export async function fetchLink(url, { llm = null, ai = true, onLog = null } = {}) {
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

  // Structure first: it finds the REGION and costs nothing. The model then decides what inside that
  // region is actually the article — the judgement no pattern list can make for the next site.
  const main = dropTrailingOverlay(pickMain(stripChrome(html)));
  const found = extractBlocks(main);
  const candidates = imageCandidates(html, finalUrl, main);
  const refined = ai
    ? await refineArticle({ title, url: finalUrl, blocks: found, images: candidates, llm, onLog })
    : { blocks: found, images: candidates.filter((c) => c.inArticle).length ? candidates.filter((c) => c.inArticle) : candidates, ai: false, note: null };

  // The description is the article's own summary and usually opens it; keep it only when the body
  // does not already say the same thing.
  const head = description && !refined.blocks.some((b) => b.startsWith(description.slice(0, 40))) ? [description] : [];
  const { text, truncated, dropped } = joinCapped([...head, ...refined.blocks]);

  return {
    title: title.trim(),
    description: description.trim(),
    text,
    images: refined.images.map((c) => c.url).slice(0, MAX_IMAGES),
    url: finalUrl,
    siteName,
    chars: text.length,
    blocks: refined.blocks.length,
    // what the structural pass offered before the model narrowed it — the owner can see the work
    found: found.length,
    foundImages: candidates.length,
    ai: refined.ai,
    kind: refined.kind || 'article',
    note: refined.note,
    truncated,
    dropped,
  };
}
