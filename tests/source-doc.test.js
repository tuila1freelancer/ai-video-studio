// A fetched article is RESEARCH, and the app has to keep treating it as research.
//
// The engine already knew this — master-script.js: "a long article is research material for a NEW
// script, never a detailed owner script to polish" — and picks its mode from the input type. The
// Studio was the thing breaking it: "Lấy thông tin" pasted the article into the topic box, which
// turned a url input into a text input, which sent the whole thing down the polish path. The video
// then narrated the article's own sentences instead of being written from them.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMasterPrompt, SCRIPT_MODE_MIN_WORDS } from '../src/content/master-script.js';
import { detectInputType, wordCount } from '../src/util/util.js';
import { searchTerms } from '../src/providers/imagesearch.js';
import { sourceOf, indexHtml } from './_source.mjs';

const PLAN = {
  sceneCount: 8, videoDuration: 60, sceneDuration: 8, wordsPerScene: 24, minWords: 18, maxWords: 30,
  structureGuide: 'hook → steps → payoff + CTA',
};

test('the two modes are genuinely different products, and only one of them fits an article', () => {
  const article = 'Đây là nội dung bài báo đã lấy về từ một trang tin tức.';
  const asSource = buildMasterPrompt({ mode: 'source', input: 'https://a.example/x', plan: PLAN, sourceDoc: { title: 'Bài báo', text: article } })[1].content;
  const asScript = buildMasterPrompt({ mode: 'script', input: article, plan: PLAN })[1].content;
  assert.match(asSource, /REWRITE, NEVER COPY/);
  assert.match(asSource, /THE SOURCE ARTICLE \(research material/);
  assert.match(asScript, /Keep ≥90% of the original wording/);
  assert.match(asScript, /THE OWNER'S SCRIPT \(source of truth\)/);
  // …so which one runs is not a detail. It is decided by the input type, which is decided by what
  // is left in the topic box.
  assert.equal(detectInputType('https://a.example/x'), 'url');
  assert.equal(detectInputType(`Bài báo\n${'từ '.repeat(200)}`), 'text');
  assert.ok(wordCount('từ '.repeat(200)) >= SCRIPT_MODE_MIN_WORDS, 'a fetched article always clears the polish threshold');
});

test('the article never goes back into the topic box', () => {
  const studio = sourceOf('public/js/views/studio.js');
  // THE bug, in one line: `$('#topic').value = (r.title ? r.title + '\n' : '') + (r.text || '')`.
  assert.doesNotMatch(studio, /#topic'\)\.value\s*=\s*\(r\.title/);
  assert.match(studio, /export function setSourceDoc\(doc\)/);
  assert.match(studio, /setSourceDoc\(r\);/, 'the fetch result lands in its own panel');
  // and the panel is a real one, not a hidden variable
  const html = indexHtml();
  for (const id of ['srcDoc', 'srcTitle', 'srcMeta', 'srcText', 'srcClear']) {
    assert.match(html, new RegExp(`id="${id}"`), `${id} is missing from the markup`);
  }
});

test('what the owner saw is what the video is written from', () => {
  const studio = sourceOf('public/js/views/studio.js');
  // the panel is editable, and the edit is the thing that ships
  assert.match(studio, /if \(state\.sourceDoc\) state\.sourceDoc\.text = \$\('#srcText'\)\.value;/);
  assert.match(studio, /config\.sourceDoc = \{ url: d\.url \|\| topic, title: d\.title \|\| '', text: d\.text\.trim\(\) \}/);
  // …and the stage prefers it over a fresh fetch, which would write from whatever the page serves
  // at that second instead of what was reviewed
  const stage = sourceOf('src/pipeline/stages/script.js');
  assert.match(stage, /const saved = config\.sourceDoc;/);
  assert.match(stage, /if \(String\(saved\?\.text \|\| ''\)\.trim\(\)\) \{[\s\S]{0,200}fetched = \{/);
  assert.match(stage, /\} else if \(project\.input_type === 'url'\) \{/, 'paste-a-link-and-go still works');
  // reopening a project shows the material it was written from
  assert.match(studio, /setSourceDoc\(project\.config\?\.sourceDoc \|\| null\)/);
});

test('a search result can be looked at before it is committed to a video', () => {
  const studio = sourceOf('public/js/views/studio.js');
  // The old grid was 46×46 squares whose ONLY interaction was "click = download into assets".
  assert.doesNotMatch(studio, /width:46px;height:46px/);
  assert.match(studio, /function openImageViewer\(items, startAt\)/);
  assert.match(studio, /img\.addEventListener\('click', \(\) => openImageViewer\(/);
  // adding is now its own button, so looking and committing are different gestures
  assert.match(studio, /add\.addEventListener\('click', \(e\) => \{ e\.stopPropagation\(\); addImageAsset\(url, cell\); \}\)/);
  // a thumbnail is for looking, the full URL is what gets downloaded — the grid must not pull
  // twelve multi-megabyte originals to draw twelve 72px tiles
  assert.match(studio, /const src = it\.thumb \|\| url;/);
  assert.match(studio, /addImageAsset\(items\[i\]\.url\)/);
  const html = indexHtml();
  for (const id of ['imgViewer', 'ivImg', 'ivPrev', 'ivNext', 'ivAdd', 'ivOpen']) {
    assert.match(html, new RegExp(`id="${id}"`), `${id} is missing from the viewer`);
  }
});

test('the model decides what is article, and the route gives it a model to decide with', () => {
  // Structure finds the REGION; inside it every site has its own furniture (author bios,
  // newsletter boxes, "read more" tiles, photo credits) and no pattern list survives the next
  // site. Measured on anthropic.com/news: the structural pass ended the "article" with a teaser
  // for a DIFFERENT story; the model pass ends it on the article's own last sentence.
  const provider = sourceOf('src/providers/fetchlink.js');
  assert.match(provider, /export async function refineArticle\(/);
  assert.match(provider, /chatJson\(messages, \{/);
  // …and it CLASSIFIES, never rewrites — the shipped text is the original, assembled by code
  assert.match(provider, /idx\.map\(\(i\) => blocks\[i\]\)/);
  // the route is the one caller that could not reach a model before, so the button never used it
  assert.match(sourceOf('src/api/routes.js'), /fetchLink\(req\.body\.url, \{ llm: DB\.aiSettings\(\)\.llm \}\)/);
  assert.match(sourceOf('src/pipeline/stages/script.js'), /fetchLink\(project\.topic\.trim\(\)\.split\(\/\\s\+\/\)\[0\], \{\s*\n\s*llm: ai\?\.llm,/);
  // and the panel says which pass produced what it is showing
  assert.match(sourceOf('public/js/views/studio.js'), /d\.ai \? '🤖 AI đã lọc bỏ phần thừa' : '⚙️ lọc theo cấu trúc trang'/);
});

test('a search that finds nothing tries a shorter question before giving up', () => {
  // Openverse matches on the whole phrase, so length is fatal, not merely unhelpful. Measured
  // against the live API on 2026-08-11: "large language model neural network" → 0 results,
  // "large language model" → 240. The old ladder had two rungs, both usually full phrases, so a
  // search with hundreds of good matches available fell through to gradient placeholders.
  const t = searchTerms('Large language model - Wikipedia', ['how large language models learn from text']);
  assert.equal(t[0], 'how large language models learn from text', 'the sharpest phrase still goes first');
  assert.ok(t.includes('Large language model'), 'the title, minus its site suffix');
  assert.ok(t.includes('how large language'), 'and progressively shorter rungs after it');
  assert.ok(t.includes('Large language'));
  assert.equal(new Set(t.map((s) => s.toLowerCase())).size, t.length, 'no rung is searched twice');
  // a query that is already short adds no rungs of its own
  assert.deepEqual(searchTerms('cà phê', []), ['cà phê']);
});

test('the search providers report something worth showing', () => {
  const provider = sourceOf('src/providers/imagesearch.js');
  // Openverse `url` is the original (often megabytes); `thumbnail` is what a grid should load
  assert.match(provider, /item\(\{ url: r\.url, thumb: r\.thumbnail, title: r\.title, page: r\.foreign_landing_url/);
  // Tavily moved its key to a bearer header; older keys still work in the body, so both go
  assert.match(provider, /Authorization: `Bearer \$\{s\.apiKey\}`/);
  // …and neither provider may hang the button: an unreachable host used to ride the client's
  // 120-second ceiling with nothing on screen
  assert.equal((provider.match(/AbortSignal\.timeout\(/g) || []).length, 2, 'every outbound call is bounded');
  // the old shape stays on the wire so nothing that reads `images` breaks
  assert.match(provider, /images: items\.map\(\(i\) => i\.url\)/);
});

test('falling back to gradients says why it fell back', () => {
  // Seen live: Openverse answers 429 after a burst of queries, every rung of the ladder swallowed
  // it, and the owner got six coloured squares with no explanation — indistinguishable from "there
  // are no pictures of this".
  const provider = sourceOf('src/providers/imagesearch.js');
  assert.match(provider, /if \(res\.status === 429\) \{/);
  assert.match(provider, /note = 'Openverse đang giới hạn truy cập \(429\)/);
  assert.match(provider, /break;/, 'the limit is per client, so the other rungs would only buy more 429s');
  assert.match(provider, /source: 'placeholder', note/);
  // …and the panel repeats it instead of celebrating a successful search
  const studio = sourceOf('public/js/views/studio.js');
  assert.match(studio, /if \(r\.note\) toast\(`⚠ \$\{r\.note\} — đang dùng ảnh nền tạm`, 'error'\)/);
});
