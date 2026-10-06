// The article extractor.
//
// Every case here is a real defect measured on a real page before the rewrite, reproduced against
// a fixture so it stays fixed offline. The numbers in the comments are what the OLD extractor
// returned for those pages; they are the reason each assertion exists.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceOf } from './_source.mjs';
import {
  decodeEntities, metaContent, articleBlocks, pickMain, extractBlocks, joinCapped, extractImages,
  charsetOf, widestSrc, parseRanges, refineArticle, imageCandidates, stripChrome,
} from '../src/providers/fetchlink.js';

const PAGE = `<!doctype html><html><head>
<meta charset="utf-8">
<meta content="Cách AI đổi cách làm việc" property="og:title">
<meta property="og:description" content="Tóm tắt bài viết &amp; vì sao nó quan trọng">
<meta property="og:image" content="/static/hero.jpg">
</head><body>
<nav><p>Trang chủ Kinh doanh Công nghệ Thể thao Giải trí Sức khoẻ</p></nav>
<header><p>Đăng ký nhận bản tin mỗi sáng để không bỏ lỡ tin nào cả nhé bạn ơi</p></header>
<article>
  <h2>Phần một</h2>
  <p>Đoạn mở đầu nói về việc AI đang thay đổi quy trình làm việc của rất nhiều công ty.</p>
  <p>Đoạn thứ hai dùng dấu &#x27;nháy&#x27; và ký hiệu R&amp;D cùng &quot;ngoặc kép&quot; đầy đủ.</p>
  <p><a href="/a">Bài liên quan một</a> <a href="/b">Bài liên quan hai</a> <a href="/c">Ba</a></p>
  <li>Một gạch đầu dòng đủ dài để được giữ lại trong phần nội dung chính.</li>
  <p>ngắn</p>
  <img srcset="/img/small.jpg 320w, /img/big.jpg 1600w" src="/img/fallback.jpg">
  <img data-src="//cdn.example.com/lazy.jpg">
  <img src="/img/sprite-icons.png">
</article>
<footer><p>© Copyright 1997-2026 Toà soạn, 10 Phạm Văn Bách, Cầu Giấy, Hà Nội. All rights reserved.</p></footer>
</body></html>`;

test('entities decode — named, decimal and hex alike', () => {
  // The old code was `.replace(/&[a-z]+;/gi, ' ')`: it turned "&amp;" into a SPACE and could not
  // match "&#x27;" at all, so an apostrophe reached the narration as five literal characters.
  assert.equal(decodeEntities('R&amp;D'), 'R&D');
  assert.equal(decodeEntities('&#x27;a&#39;'), "'a'");
  assert.equal(decodeEntities('caf&eacute; &mdash; 5&nbsp;kg'), 'café — 5 kg');
  assert.equal(decodeEntities('&notreal; stays'), '&notreal; stays');
  // The Latin-1 names are stored as an ordered list, so ONE omission silently shifts every
  // character after it — `&reg;` was missing on the first pass and `&eacute;` came out as è.
  // Both ends and both sides of the gap are pinned.
  assert.equal(decodeEntities('&iquest;|&Agrave;|&szlig;|&agrave;|&yuml;'), '\u00BF|\u00C0|\u00DF|\u00E0|\u00FF');
  assert.equal(decodeEntities('&copy;&reg;&trade;&deg;&frac12;'), '©®™°½');
});

test('a meta tag is read whichever order its attributes are written in', () => {
  // `<meta content="…" property="og:title">` is ordinary CMS output and the old pattern, which
  // demanded content= come second, silently found no og: data on those pages at all.
  assert.equal(metaContent(PAGE, 'og:title'), 'Cách AI đổi cách làm việc');
  assert.equal(metaContent(PAGE, 'og:description'), 'Tóm tắt bài viết & vì sao nó quan trọng');
  assert.equal(metaContent(PAGE, 'og:missing'), '');
});

test('the article is found, and the chrome around it never reaches the text', () => {
  // Measured leaks: anthropic.com put its nav menu inside the first paragraph
  // ("…twice the speed.\nResearchPolicyCommi…"), and vnexpress.net ended the article with the
  // newsroom's street address and copyright line.
  const joined = articleBlocks(PAGE).join('\n');
  assert.match(joined, /Đoạn mở đầu/);
  assert.match(joined, /gạch đầu dòng/, 'list items are content too');
  assert.match(joined, /Phần một/, 'headings survive the length floor');
  assert.doesNotMatch(joined, /Trang chủ Kinh doanh/, 'nav');
  assert.doesNotMatch(joined, /Đăng ký nhận bản tin/, 'header');
  assert.doesNotMatch(joined, /All rights reserved|Phạm Văn Bách/, 'footer');
  assert.doesNotMatch(joined, /Bài liên quan/, 'a paragraph of links is a related-stories rail');
  assert.doesNotMatch(joined, /^ngắn$/m, 'a three-letter paragraph is not a paragraph');
  assert.match(joined, /R&D/, 'entities are decoded inside blocks');
  assert.doesNotMatch(joined, /&\w+;|&#/, 'and nothing raw is left');
});

test('the cap ends on a block boundary and says how much it left behind', () => {
  // The old cap was `.slice(0, 8000)` and it ended the Wikipedia sample mid-word
  // ("…Megatron-Turing NLG "). A script written from half a sentence has a hole nothing downstream
  // can see.
  const blocks = ['a'.repeat(50), 'b'.repeat(50), 'c'.repeat(50)];
  const full = joinCapped(blocks, 24000);
  assert.equal(full.truncated, false);
  assert.equal(full.dropped, 0);
  const cut = joinCapped(blocks, 120);
  assert.equal(cut.text, `${'a'.repeat(50)}\n${'b'.repeat(50)}`);
  assert.equal(cut.truncated, true);
  assert.equal(cut.dropped, 1, 'the caller can tell the owner what was dropped');
});

test('image URLs are resolved against the page, not required to be absolute already', () => {
  // Wikipedia returned ZERO images: every one is served from a protocol-relative
  // //upload.wikimedia.org URL, and the old http(s)-only filter threw them all away.
  const imgs = extractImages(PAGE, 'https://site.example/news/ai-work', pickMain(PAGE));
  assert.equal(imgs[0], 'https://site.example/static/hero.jpg', 'og:image leads, and it was relative');
  assert.ok(imgs.includes('https://site.example/img/big.jpg'), 'srcset picks the widest descriptor');
  assert.ok(!imgs.includes('https://site.example/img/small.jpg'), 'not the 320w one');
  assert.ok(imgs.includes('https://cdn.example.com/lazy.jpg'), 'lazy-loaded data-src, protocol-relative');
  assert.ok(!imgs.some((u) => /sprite/.test(u)), 'sprites and icons are page chrome');
  assert.equal(new Set(imgs).size, imgs.length, 'no duplicates');
});

test('an image URL is a URL, not HTML — and not a 250px thumbnail', () => {
  // Both seen live in the viewer on the Wikipedia sample. An attribute value is HTML, so its query
  // string arrives as `?a=1&amp;b=2`; downloading that verbatim asks for a parameter called
  // "amp;b". And MediaWiki's `src` is a 250-pixel render, which is not an asset for a 4K video.
  const img = (src) => `<article><p>${'x'.repeat(260)}</p><img src="${src}"></article>`;
  const one = (src) => extractImages(img(src), 'https://en.wikipedia.org/wiki/X', '')[0];
  // a thumbnail OF A VECTOR keeps whatever the page served. Asking commons for a bigger render is
  // the obvious move and it does not work: measured 2026-08-11, of 800/1024/1280/2560px only 1280
  // answered — the rest returned `400 … Use thumbnail sizes listed on …`, and the width that works
  // is per-file. widestSrc has already taken the largest render the page itself lists.
  assert.equal(
    one('https://upload.wikimedia.org/wikipedia/commons/thumb/9/9b/Chart.svg/250px-Chart.svg.png?a=1&amp;b=2'),
    'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9b/Chart.svg/250px-Chart.svg.png?a=1&b=2');
  // a thumbnail of a RASTER file: the original is the real thing
  assert.equal(
    one('https://upload.wikimedia.org/wikipedia/commons/thumb/1/12/Photo.jpg/250px-Photo.jpg'),
    'https://upload.wikimedia.org/wikipedia/commons/1/12/Photo.jpg');
  // anything else is left exactly as the page wrote it
  assert.equal(one('https://cdn.site.example/a/b/hero.jpg'), 'https://cdn.site.example/a/b/hero.jpg');
});

test('a srcset is measured on the right scale', () => {
  // `640w` is a pixel width and `2x` a density multiplier. Ranking both with parseInt makes "2x"
  // score 2 and lose to the 320w entry — so the widest-wins rule picked the smallest image.
  assert.equal(widestSrc('/a.jpg 320w, /b.jpg 1600w, /c.jpg 800w'), '/b.jpg');
  assert.equal(widestSrc('/a.jpg 1x, /b.jpg 2x'), '/b.jpg');
  assert.equal(widestSrc('/only.jpg'), '/only.jpg');
});

test('the page is decoded in the charset it declares', () => {
  // res.text() assumes UTF-8; a windows-1258 Vietnamese page came back as mojibake and the
  // narration inherited it.
  assert.equal(charsetOf('text/html; charset=Windows-1258', Buffer.from('')), 'windows-1258');
  assert.equal(charsetOf('text/html', Buffer.from('<meta charset="ISO-8859-1">', 'latin1')), 'iso-8859-1');
  assert.equal(charsetOf(null, Buffer.from('<html><head>')), 'utf-8', 'a sane default, not a crash');
});

test('an <article> element is believed, even when the page around it is longer', () => {
  // Scoring the article against the whole document loses to any page whose comment thread or
  // related-stories rail outweighs the story — and those sit in sections no chrome-strip removes.
  const story = 'Nội dung thật của bài viết, đủ dài để vượt ngưỡng hai trăm ký tự và được engine coi là phần thân bài chính thức của trang này. '.repeat(2);
  const html = `<body><article><p>${story}</p></article>`
    + `<section id="comments">${'<p>Bình luận của độc giả về bài viết, dài dòng và lặp đi lặp lại nhiều lần.</p>'.repeat(12)}</section></body>`;
  const joined = articleBlocks(html).join('\n');
  assert.match(joined, /Nội dung thật/);
  assert.doesNotMatch(joined, /Bình luận/, 'the comment thread is not the article');
});

// ---- the AI pass: the model classifies, the code assembles ----

test('index ranges expand, and rubbish in them does not', () => {
  // The model answers in ranges because an article body is a contiguous run with a few intrusions,
  // and a 370-element JSON array is an answer a token limit truncates long before it goes wrong.
  assert.deepEqual(parseRanges('0-3,7,10-12', 100), [0, 1, 2, 3, 7, 10, 11, 12]);
  assert.deepEqual(parseRanges('5-2', 100), [2, 3, 4, 5], 'a backwards range is still a range');
  assert.deepEqual(parseRanges('8-12', 10), [8, 9], 'nothing past the end of the list');
  assert.deepEqual(parseRanges('', 10), []);
  assert.deepEqual(parseRanges('all of them', 10), [], 'prose is not a range');
  assert.deepEqual(parseRanges('2,2,2', 10), [2], 'and no index twice');
});

test('a refusal or a bad answer keeps the structural result, and says so', async () => {
  const blocks = ['a'.repeat(300), 'b'.repeat(300), 'c'.repeat(300)];
  const images = [{ url: 'x', alt: '', inArticle: true }, { url: 'y', alt: '', inArticle: false }];
  // no LLM configured → the structural answer, unchanged, with a reason attached
  const off = await refineArticle({ blocks, images, llm: { enabled: false } });
  assert.deepEqual(off.blocks, blocks);
  assert.equal(off.ai, false);
  assert.match(off.note, /AI chưa bật/);
  // …and the image set still narrows to what sat inside the article
  assert.deepEqual(off.images.map((i) => i.url), ['x']);
});

test('a model that deletes the article is treated as wrong, not as decisive', async () => {
  // The guard that matters. A selection keeping a fifth of its own candidates means the model
  // misread the list; shipping it would delete most of the article in silence, and the video would
  // be written from the remains without anyone seeing a thing.
  const blocks = Array.from({ length: 10 }, (_, i) => `block ${i} `.repeat(20));
  const share = (idx) => idx.reduce((a, i) => a + blocks[i].length, 0) / blocks.reduce((a, b) => a + b.length, 0);
  assert.ok(share([0]) < 0.25, 'one block of ten is under the floor');
  assert.ok(share([0, 1, 2, 3]) > 0.25, 'four of ten is a plausible edit');
  const src = sourceOf('src/providers/fetchlink.js');
  assert.match(src, /if \(share < 0\.25\) \{/);
  assert.match(src, /nghi lọc sai, giữ bản theo cấu trúc/);
  // and the model is never asked to REWRITE — only to choose, so the shipped text is the original
  assert.match(src, /idx\.map\(\(i\) => blocks\[i\]\)/);
  assert.doesNotMatch(src, /return.*raw\.text/);
});

test('an image that never sat inside the article is not an illustration', () => {
  // Images outside the article body are not illustrations. The old order was og:image, then in-article,
  // then EVERYTHING ELSE on the page, so related-story tiles and promos rode along.
  const html = '<article><p>' + 'x'.repeat(260) + '</p>'
    + '<img src="/img/chart.jpg" alt="Biểu đồ tăng trưởng"></article>'
    + '<div class="related"><img src="/img/other-story.jpg" alt="Bài khác"></div>';
  const main = pickMain(stripChrome(html));
  const cands = imageCandidates(html, 'https://s.example/a', main);
  assert.equal(cands.find((c) => c.url.includes('chart')).inArticle, true);
  assert.equal(cands.find((c) => c.url.includes('other-story')).inArticle, false);
  assert.equal(cands.find((c) => c.url.includes('chart')).alt, 'Biểu đồ tăng trưởng', 'alt is what the model judges on');
  assert.deepEqual(extractImages(html, 'https://s.example/a', main), ['https://s.example/img/chart.jpg']);
  // …but a page whose article container was never found must not return nothing at all
  const noArticle = '<body><div><img src="/img/only.jpg"></div></body>';
  assert.deepEqual(extractImages(noArticle, 'https://s.example/a', ''), ['https://s.example/img/only.jpg']);
});

test('inline tags do not leave gaps around punctuation', () => {
  // Tags become spaces, so `an <a>LLM</a> is` produced "( LLM )". This text is narration source —
  // a TTS engine pauses at a space before a comma.
  const [b] = extractBlocks('<p>An <a href="#">LLM</a> (a <b>neural net</b>), roughly.</p>');
  assert.equal(b, 'An LLM (a neural net), roughly.');
});

test('an overlay the CMS appended inside the article is not the end of the article', () => {
  // base.vn/blog ends its <article> with a WordPress popup plugin (ays_pb_*), so the structural
  // pass closed the "story" with four support-widget blocks and "This will close in 2000 seconds".
  // Matched on the element's declared ROLE, never on its words — the AI pass is still the real
  // filter; this is the floor for when the model is rate-limited, offline or switched off.
  const body = `<p>${'Nội dung bài viết thật sự, đủ dài để vượt ngưỡng. '.repeat(12)}</p>`;
  const tail = '<div class="ays_pb_description"><p>Giải đáp các câu hỏi về triển khai, go-live và support cho bạn.</p>'
    + '<p>This will close in 2000 seconds and it is definitely not part of the article body.</p></div>';
  const joined = articleBlocks(`<body><article>${body}${tail}</article></body>`).join('\n');
  assert.match(joined, /Nội dung bài viết thật sự/);
  assert.doesNotMatch(joined, /This will close|go-live/, 'the popup is chrome, wherever it was injected');
  // …but an overlay in the MIDDLE must not truncate the rest of the story
  const mid = `<body><article><p>Mở bài đủ dài để tính là một khối nội dung thật sự của bài viết.</p>`
    + `<div class="modal-demo"><p>Hộp minh hoạ nằm giữa bài, không được cắt phần còn lại đi.</p></div>`
    + `${body}</article></body>`;
  assert.match(articleBlocks(mid).join('\n'), /Nội dung bài viết thật sự/, 'the article continues past it');
});

test('the model pass is bounded, because a human is waiting on this button', () => {
  // Measured on base.vn against a rate-limited proxy: chat()'s 429 ladder backs off 8s + 20s + 45s
  // per key and chatJson runs it twice — 163 SECONDS, which reads as the feature being broken. The
  // budget brings the same failure back in 33s with the reason on screen.
  const src = sourceOf('src/providers/fetchlink.js');
  assert.match(src, /const AI_BUDGET_MS = 40000;/);
  assert.match(src, /budgetMs: AI_BUDGET_MS,/);
  assert.match(src, /AI đang bị giới hạn truy cập \(429\)/, 'a rate limit is named as a rate limit');
  assert.match(src, /sau \$\{secs\}s/, 'and the wait is reported, not hidden');
  // the ceiling covers the whole ladder, and one request may not outlive it
  const llm = sourceOf('src/providers/llm.js');
  assert.match(llm, /budgetMs = Infinity/, 'every existing caller is unchanged by default');
  assert.match(llm, /timeoutMs: Math\.min\(timeoutMs, Math\.max\(1000, left\(\)\)\)/);
  assert.match(llm, /const wait = \(ms\) => \(ms < left\(\) \? new Promise/);
});
