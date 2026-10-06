// The AI pass: the model classifies numbered blocks and pictures by range; code assembles the original text.
import { m, tp } from '../../i18n/t.js';
import { AI_BUDGET_MS } from './extract.js';

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
 * the user is right that a pattern list is what this was.
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
  const { chatJson, llmEnabled } = await import('../llm.js');
  if (!llmEnabled(llm)) return fallback(m('AI chưa bật — lọc theo cấu trúc trang'));

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
    if (!idx.length) return fallback(m('AI không chọn được đoạn nào — giữ bản lọc theo cấu trúc'));
    const share = keptShare(blocks, idx);
    if (share < 0.25) {
      // Not "aggressive" — wrong. A body that is a fifth of its own candidates means the model
      // misread the list, and shipping that would delete most of the article in silence.
      return fallback(tp`AI chỉ giữ ${Math.round(share * 100)}% nội dung — nghi lọc sai, giữ bản theo cấu trúc`);
    }
    const keepImg = Array.isArray(raw.images)
      ? raw.images.map((n) => images[+n]).filter(Boolean)
      : images.filter((c) => c.inArticle);
    onLog?.(tp`AI lọc bài: giữ ${idx.length}/${blocks.length} đoạn · ${keepImg.length}/${images.length} ảnh${raw.why ? ` — ${String(raw.why).slice(0, 90)}` : ''}`);
    return { blocks: idx.map((i) => blocks[i]), images: keepImg, ai: true, note: null, kind: raw.kind || 'article' };
  } catch (e) {
    const secs = Math.round((Date.now() - t0) / 1000);
    const why = /\b429\b|rate.?limit|too many/i.test(e.message)
      ? m('AI đang bị giới hạn truy cập (429)')
      : tp`AI lọc lỗi (${e.message.slice(0, 60)})`;
    return fallback(tp`${why} sau ${secs}s — giữ bản lọc theo cấu trúc`);
  }
}
