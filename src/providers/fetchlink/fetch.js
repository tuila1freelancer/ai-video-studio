// Meta tags and fetchLink() — fetch, decode, extract, optionally refine.
import { m } from '../../i18n/t.js';
import { MAX_IMAGES, decodeEntities, charsetOf, stripChrome, pickMain, dropTrailingOverlay, extractBlocks, joinCapped } from './extract.js';
import { imageCandidates } from './images.js';
import { refineArticle } from './refine.js';

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
  if (!/^https?:\/\//i.test(url || '')) throw new Error(m('URL không hợp lệ'));
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
