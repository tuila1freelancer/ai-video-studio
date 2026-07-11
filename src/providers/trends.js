// Trend signals — dependency-free RSS pulls (same spirit as fetchlink): Google Trends
// daily RSS + Google News search RSS, Vietnamese defaults. Never throws; empty on failure.
// Results are DATA for the owner to pick from — nothing here auto-commits a pipeline.

function stripCdata(s) { return String(s || '').replace(/^<!\[CDATA\[|\]\]>$/g, '').trim(); }
function parseRssTitles(xml, { skipFirst = true } = {}) {
  const out = [];
  const re = /<item>[\s\S]*?<title>([\s\S]*?)<\/title>/g;
  let m;
  while ((m = re.exec(xml))) out.push(stripCdata(m[1]));
  // channel-level <title> precedes items only in some feeds; the regex above already
  // scopes to <item>, so skipFirst is unnecessary there — kept for odd feeds
  return (skipFirst && out.length && /google|trends/i.test(out[0]) ? out.slice(1) : out)
    .map((t) => t.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"'))
    .filter((t) => t.length > 2);
}

async function pull(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'AIVideoStudio' } });
  if (!res.ok) throw new Error(`RSS ${res.status}`);
  return res.text();
}

/**
 * @param {{geo?:string, niche?:string}} opts niche: a topic query to bias news results
 * @returns {Promise<{title:string, source:string}[]>} up to ~30 signals, deduped
 */
export async function fetchTrends({ geo = 'VN', niche = '' } = {}) {
  const jobs = [
    pull(`https://trends.google.com/trending/rss?geo=${encodeURIComponent(geo)}`)
      .then((xml) => parseRssTitles(xml).map((t) => ({ title: t, source: 'google-trends' }))).catch(() => []),
  ];
  if (niche.trim()) {
    jobs.push(pull(`https://news.google.com/rss/search?q=${encodeURIComponent(niche)}&hl=vi&gl=VN&ceid=VN:vi`)
      .then((xml) => parseRssTitles(xml, { skipFirst: false }).map((t) => ({ title: t, source: 'google-news' }))).catch(() => []));
  }
  const all = (await Promise.all(jobs)).flat();
  const seen = new Set();
  return all.filter((x) => {
    const k = x.title.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 30);
}
