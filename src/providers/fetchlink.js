// Extract title / main text / images from an article URL (no external deps).
export async function fetchLink(url) {
  if (!/^https?:\/\//i.test(url || '')) throw new Error('URL không hợp lệ');
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 AIVideoStudio' }, redirect: 'follow', signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`Fetch ${res.status}`);
  const html = await res.text();

  const meta = (prop) => {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i');
    const m = html.match(re); return m ? m[1] : '';
  };
  const titleTag = (html.match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1] || '';
  const title = meta('og:title') || titleTag || url;
  const description = meta('og:description') || meta('description') || '';

  // crude main-text extraction: strip script/style, take <p> text
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const paras = [...body.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => m[1].replace(/<[^>]+>/g, '').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim())
    .filter((t) => t.length > 40);
  const text = [description, ...paras].join('\n').slice(0, 8000);

  // images
  const ogImg = meta('og:image');
  const imgs = [...html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1])
    .filter((s) => /^https?:\/\//.test(s) && /\.(jpg|jpeg|png|webp)/i.test(s));
  const images = [...new Set([ogImg, ...imgs].filter(Boolean))].slice(0, 12);

  return { title: title.trim(), description: description.trim(), text, images, url };
}
