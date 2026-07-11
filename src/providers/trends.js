// Trend signals — dependency-free RSS/Atom pulls (same spirit as fetchlink): Google Trends
// daily RSS + Google News search RSS by default, plus optional feed PACKS (curated VN
// sources) and the owner's custom feeds. Never throws; every feed degrades to empty.
// Results are DATA for the owner to pick from — nothing here auto-commits a pipeline.

function stripCdata(s) { return String(s || '').replace(/^<!\[CDATA\[|\]\]>$/g, '').trim(); }
function decodeEntities(t) {
  return t.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

export function parseRssTitles(xml, { skipFirst = true } = {}) {
  const out = [];
  const re = /<item>[\s\S]*?<title>([\s\S]*?)<\/title>/g;
  let m;
  while ((m = re.exec(xml))) out.push(stripCdata(m[1]));
  // channel-level <title> precedes items only in some feeds; the regex above already
  // scopes to <item>, so skipFirst is unnecessary there — kept for odd feeds
  return (skipFirst && out.length && /google|trends/i.test(out[0]) ? out.slice(1) : out)
    .map(decodeEntities)
    .filter((t) => t.length > 2);
}

/** Atom feeds (Reddit, YouTube) use <entry> with an attributed <title>. */
export function parseAtomTitles(xml) {
  const out = [];
  const re = /<entry>[\s\S]*?<title[^>]*>([\s\S]*?)<\/title>/g;
  let m;
  while ((m = re.exec(xml))) out.push(stripCdata(m[1]));
  return out.map(decodeEntities).filter((t) => t.length > 2);
}

// Curated dependency-free packs the owner can toggle in the assistant's source settings.
// 'reddit' is niche-driven: it expands to the subreddit named by the niche when it looks
// like a subreddit token, otherwise it is skipped (no guessing).
export const FEED_PACKS = {
  'vn-news': [
    { url: 'https://vnexpress.net/rss/tin-moi-nhat.rss', source: 'vnexpress' },
    { url: 'https://tuoitre.vn/rss/tin-moi-nhat.rss', source: 'tuoitre' },
  ],
  'vn-tech': [
    { url: 'https://vnexpress.net/rss/so-hoa.rss', source: 'vnexpress-tech' },
    { url: 'https://genk.vn/rss/home.rss', source: 'genk' },
  ],
  'vn-business': [
    { url: 'https://vnexpress.net/rss/kinh-doanh.rss', source: 'vnexpress-biz' },
    { url: 'https://cafef.vn/trang-chu.rss', source: 'cafef' },
  ],
};

async function pull(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'AIVideoStudio' } });
  if (!res.ok) throw new Error(`RSS ${res.status}`);
  return res.text();
}

function parseAny(xml, { skipFirst } = {}) {
  return xml.includes('<entry>') ? parseAtomTitles(xml) : parseRssTitles(xml, { skipFirst });
}

/**
 * @param {{geo?:string, niche?:string, packs?:string[], feeds?:{url:string,label?:string}[]}} opts
 *   niche: a topic query to bias news results; packs: FEED_PACKS keys; feeds: owner's custom RSS/Atom URLs
 * @returns {Promise<{title:string, source:string}[]>} up to ~40 signals, deduped
 */
export async function fetchTrends({ geo = 'VN', niche = '', packs = [], feeds = [] } = {}) {
  const jobs = [
    pull(`https://trends.google.com/trending/rss?geo=${encodeURIComponent(geo)}`)
      .then((xml) => parseRssTitles(xml).map((t) => ({ title: t, source: 'google-trends' }))).catch(() => []),
  ];
  if (niche.trim()) {
    jobs.push(pull(`https://news.google.com/rss/search?q=${encodeURIComponent(niche)}&hl=vi&gl=VN&ceid=VN:vi`)
      .then((xml) => parseRssTitles(xml, { skipFirst: false }).map((t) => ({ title: t, source: 'google-news' }))).catch(() => []));
  }
  for (const key of packs) {
    for (const f of FEED_PACKS[key] || []) {
      jobs.push(pull(f.url).then((xml) => parseAny(xml, { skipFirst: false }).map((t) => ({ title: t, source: f.source }))).catch(() => []));
    }
  }
  for (const f of feeds) {
    if (!/^https?:\/\//i.test(f?.url || '')) continue;
    const label = String(f.label || new URL(f.url).hostname).slice(0, 40);
    jobs.push(pull(f.url).then((xml) => parseAny(xml, { skipFirst: false }).map((t) => ({ title: t, source: label }))).catch(() => []));
  }
  const all = (await Promise.all(jobs)).flat();
  const seen = new Set();
  return all.filter((x) => {
    const k = x.title.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 40);
}
