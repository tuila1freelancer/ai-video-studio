// The extractor: entity decoding, charset sniffing, chrome stripping, picking the main node, block extraction and the capped join.

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
export const MAX_IMAGES = 24;
export const AI_BUDGET_MS = 40000; // the longest a "Lấy thông tin" click may wait on the model

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
