// Per-platform metadata and cover art.
//
// The limits live in ONE table (src/publish/platforms.js) because they were previously nowhere:
// the prompt asked for "≤100 chars" in prose and nothing checked, so an over-long title reached
// the clipboard and the platform cut it — with the keyword in the part that got cut.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PLATFORMS, COVER_SIZES, platform, checkField, orientationOf } from '../src/publish/platforms.js';
import { clampPlatforms } from '../src/providers/llm.js';

test('every platform the owner publishes to has a spec', () => {
  const ids = PLATFORMS.map((p) => p.id);
  assert.deepEqual(ids, ['youtube', 'shorts', 'tiktok', 'instagram', 'facebook']);
  for (const p of PLATFORMS) {
    assert.ok(p.fields.length, `${p.id} has no fields`);
    assert.ok(p.brief && p.brief.length > 40, `${p.id} has no brief for the writer`);
    for (const f of p.fields) {
      assert.ok(f.limit > 0 && f.sweet > 0, `${p.id}.${f.key} has no limits`);
      // the sweet spot is where the text still reads well in a listing; the cap is where the
      // platform truncates. A sweet spot at the cap would be no guidance at all.
      assert.ok(f.sweet <= f.limit, `${p.id}.${f.key} aims past its own cap`);
    }
  }
});

test('a field is measured the way the platform measures it', () => {
  const tags = platform('youtube').fields.find((f) => f.key === 'tags');
  // a list is capped on the JOINED string, not the item count — 15 long tags blow a 500-char
  // budget that 15 short ones sit inside
  assert.equal(checkField(tags, ['ai', 'video']).len, 'ai, video'.length);
  assert.equal(checkField(tags, Array(40).fill('x'.repeat(20))).ok, false);
  const title = platform('youtube').fields.find((f) => f.key === 'title');
  assert.equal(checkField(title, 'x'.repeat(80)).tight, true, 'past the sweet spot');
  assert.equal(checkField(title, 'x'.repeat(80)).ok, true, 'but still inside the cap');
});

test('the model is not trusted — its answer goes through the table', () => {
  const out = clampPlatforms({
    youtube: { title: 'A'.repeat(140), description: 'ok', tags: ['#alpha', 'beta'], pinnedComment: 'q?' },
    shorts: { title: 'ngắn', hashtags: ['shorts', 'ai'] },
    tiktok: { caption: 'hook', hashtags: ['#fyp'] },
    linkedin: { caption: 'a platform we do not publish to' },
  });
  assert.equal(out.youtube.title.length, 100, 'trimmed to the hard cap');
  // …and the two list conventions each site expects to be pasted
  assert.deepEqual(out.youtube.tags, ['alpha', 'beta'], 'YouTube tags carry no #');
  assert.deepEqual(out.shorts.hashtags, ['#shorts', '#ai'], 'hashtags always do');
  assert.ok(!('linkedin' in out), 'an unknown platform is dropped, not passed through');
});

test('cover sizes are real platform pixels, grouped by the orientation a design can fill', () => {
  const by = Object.fromEntries(COVER_SIZES.map((c) => [c.id, `${c.w}x${c.h}`]));
  assert.equal(by.youtube, '1280x720');
  assert.equal(by.shorts, '1080x1920');
  assert.equal(by.ig_feed, '1080x1350');
  assert.equal(by.facebook, '1200x630');
  assert.equal(by.square, '1080x1080');
  // Every size declares the orientation it belongs to, and it has to be the true one: a design
  // authored landscape and re-shot at 9:16 turns a headline into a strip across the middle, so
  // the grouping is what stops one design being stretched across orientations.
  for (const c of COVER_SIZES) assert.equal(c.orient, orientationOf(c), `${c.id} is mis-grouped`);
  assert.equal(new Set(COVER_SIZES.map((c) => c.orient)).size, 3, 'three designs cover everything');
});

test('the cover set spends one generation per orientation, not one per platform', () => {
  const src = readFileSync(new URL('../src/pipeline/thumbnail-codegen.js', import.meta.url), 'utf8');
  // designed once per orientation…
  assert.match(src, /for \(const \[orient, group\] of byOrient\)/);
  assert.match(src, /if \(!frags\[orient\]\)/, 'a design already made is reused, never re-bought');
  // …then every canvas of that orientation re-shot from the same fragment
  assert.match(src, /for \(const s of group\) \{[\s\S]{0,240}renderThumbnailFragment\(frags\[orient\]/);
  // the design is authored against the BIGGEST canvas of its group, so every re-shoot scales down
  assert.match(src, /group\.slice\(\)\.sort\(\(a, b\) => b\.w \* b\.h - a\.w \* a\.h\)\[0\]/);
  // and the video's own orientation is seeded from the thumbnail already made
  assert.match(readFileSync(new URL('../src/pipeline/stages/finalize.js', import.meta.url), 'utf8'),
    /const seed = thumbHtml \? \{ \[orientationOf\(size\)\]: thumbHtml \} : \{\};/);
});

test('cover art is captured at double the platform pixels, as a JPEG', () => {
  // Every platform re-encodes what it is handed, and the sharpest result comes from giving it more
  // detail than it keeps. It is a DEVICE scale, not a layout scale: the design is still laid out in
  // the platform's own coordinate space, so a 96px headline is still 96 authored px — doubling the
  // viewport instead would halve the relative size of everything the model wrote.
  const shot = readFileSync(new URL('../src/media/puppeteer.js', import.meta.url), 'utf8');
  assert.match(shot, /deviceScaleFactor: Math\.max\(1, Math\.min\(4, \+scale \|\| 1\)\)/);
  // …and the format follows the extension. It was PNG unconditionally while every caller named its
  // file `.jpg` — untidy at 1×, disqualifying at 2×: measured on the six cover sizes, 1× PNG ran
  // 225–460 KB while 2× JPEG runs 77–111 KB, and YouTube refuses a thumbnail over 2 MB.
  assert.match(shot, /const jpeg = \/\\\.jpe\?g\$\/i\.test\(out\);/);
  assert.match(shot, /jpeg \? \{ type: 'jpeg', quality:/);
  const tc = readFileSync(new URL('../src/pipeline/thumbnail-codegen.js', import.meta.url), 'utf8');
  assert.match(tc, /export const COVER_SCALE = 2;/);
  assert.match(tc, /scale: COVER_SCALE/, 'the video-orientation thumbnail is captured the same way');
  // the chip must report the file's REAL pixels, not the spec it was authored against
  assert.match(tc, /px: \{ w: s\.w \* COVER_SCALE, h: s\.h \* COVER_SCALE \}/);
  assert.match(readFileSync(new URL('../public/js/views/studio.js', import.meta.url), 'utf8'),
    /2× của \$\{c\.w\}×\$\{c\.h\}/);
});

test('covers can be looked at, and put where the owner uploads from', () => {
  const studio = readFileSync(new URL('../public/js/views/studio.js', import.meta.url), 'utf8');
  // the same viewer the image search uses — "is this actually good" is the same question
  assert.match(studio, /openImageViewer\(coverList\.map/);
  // a cover already on this machine has nothing to add to the project's assets
  assert.match(studio, /\$\('#ivAdd'\)\.classList\.toggle\('hidden', !!it\.path\)/);
  const routes = readFileSync(new URL('../src/api/routes.js', import.meta.url), 'utf8');
  assert.match(routes, /r\.post\('\/projects\/:id\/covers\/export'/);
  // a WKWebView has no File System Access API, so the folder is chosen natively
  assert.match(routes, /choose folder with prompt/);
  assert.match(routes, /if \(!dir\) dir = p\.outputDir \|\| DB\.projectDirFor\(p\.id\);/, 'and defaults to the project folder');
  // six files called cover_youtube.jpg from three videos in one folder is not a set anyone can use
  assert.match(routes, /\$\{slug\}_anh-bia/);
  assert.match(routes, /\$\{slug\}_\$\{c\.id\}_\$\{px\.w\}x\$\{px\.h\}\.jpg/);
});
