// Trend-source parsing invariants — pure fixture strings, zero network.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRssTitles, parseAtomTitles, FEED_PACKS } from '../src/providers/trends.js';

const RSS = `<?xml version="1.0"?><rss><channel><title>Feed</title>
<item><title><![CDATA[Tin nóng &amp; đáng chú ý]]></title><link>x</link></item>
<item><title>Bài về &quot;AI&quot; &#39;mới&#39;</title></item>
<item><title>ab</title></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
<title>r/freelance</title>
<entry><title type="html">Reddit post about invoicing</title></entry>
<entry><title>Second entry &lt;tagged&gt;</title></entry>
</feed>`;

test('parseRssTitles: item-scoped, CDATA stripped, entities decoded, short titles dropped', () => {
  const t = parseRssTitles(RSS, { skipFirst: false });
  assert.deepEqual(t, ['Tin nóng & đáng chú ý', 'Bài về "AI" \'mới\''], 'the 2-char title is filtered out');
});

test('parseAtomTitles: entry-scoped with attributed <title> (Reddit/YouTube shape)', () => {
  const t = parseAtomTitles(ATOM);
  assert.deepEqual(t, ['Reddit post about invoicing', 'Second entry <tagged>']);
  assert.ok(!t.includes('r/freelance'), 'feed-level title never leaks in');
});

test('FEED_PACKS: curated packs are https feeds with a source label', () => {
  for (const [key, feeds] of Object.entries(FEED_PACKS)) {
    assert.ok(feeds.length >= 1, `pack ${key} is not empty`);
    for (const f of feeds) {
      assert.match(f.url, /^https:\/\//, `${key}: ${f.url} must be https`);
      assert.ok(f.source && f.source.length <= 40, `${key}: source label present`);
    }
  }
  assert.ok(FEED_PACKS['vn-news'] && FEED_PACKS['vn-tech'], 'the core VN packs exist');
});
