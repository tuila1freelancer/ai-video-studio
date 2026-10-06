// Per-platform SEO metadata through the platform table.
import { PLATFORMS, checkField } from '../../publish/platforms.js';
import { logger } from '../../util/log.js';

import { llmEnabled } from './transport.js';
import { chatJson } from './json.js';
import { topNouns } from './script.js';

// Metadata 2.0 — per-platform SEO through the robust chatJson machinery. The returned
// object keeps the OLD flat shape ({title, description, hashtags}) for every existing
// consumer, and adds `platforms` with the full per-platform payload + pinnedComment.
/**
 * @param {object} project
 * @param {string|null} stylePrompt user-defined SEO style prefix
 * @param {{ai?:object, script?:string}} opts `script` = the narration this video actually
 *   contains. Without it the model can only riff on the title, which produced generic tags and
 *   descriptions promising things the video never says (P40 audit finding).
 */
/**
 * Force the model's answer through the platform table.
 *
 * Asking for a limit is not the same as getting one. Anything past the HARD cap is trimmed on a
 * word boundary rather than shipped for the platform to cut mid-word, unknown platforms and
 * unknown fields are dropped, and list fields are normalised — hashtags always carry their `#`,
 * YouTube tags never do, because those are the forms each site expects to be pasted.
 */
export function clampPlatforms(raw) {
  const out = {};
  for (const pf of PLATFORMS) {
    const got = raw?.[pf.id];
    if (!got || typeof got !== 'object') continue;
    const row = {};
    for (const f of pf.fields) {
      let v = got[f.key];
      if (v == null) continue;
      if (f.list) {
        const items = (Array.isArray(v) ? v : String(v).split(/[,\n]+/))
          .map((x) => String(x).trim())
          .filter(Boolean)
          .map((x) => (f.key === 'tags' ? x.replace(/^#/, '') : `#${x.replace(/^#/, '').replace(/\s+/g, '')}`));
        // drop from the END until the JOINED string fits — the first items are the ones the model
        // ranked most relevant, so trimming the tail loses the least
        const kept = [];
        for (const it of items) {
          kept.push(it);
          if (!checkField(f, kept).ok) { kept.pop(); break; }
        }
        row[f.key] = kept;
      } else {
        v = String(v).trim();
        if (v.length > f.limit) {
          const cut = v.slice(0, f.limit);
          const sp = cut.lastIndexOf(' ');
          v = (sp > f.limit * 0.6 ? cut.slice(0, sp) : cut).trim();
        }
        row[f.key] = v;
      }
    }
    if (Object.keys(row).length) out[pf.id] = row;
  }
  return out;
}

export async function generateMetadata(project, stylePrompt, { ai, script = '' } = {}) {
  const llm = ai?.llm || null;
  const title = project?.title || project?.topic || 'Video';
  const body = String(script || '').trim().slice(0, 6000);
  const scriptBlock = body
    ? `\nWHAT THE VIDEO ACTUALLY SAYS (the narration — base every keyword, claim and hook on THIS, never on the title alone, and never promise something the script does not deliver):\n<<<\n${body}\n>>>\n`
    : '';
  if (llmEnabled(llm)) {
    try {
      // The per-platform brief and the limits come from ONE table (publish/platforms.js), so the
      // prompt and the panel's character counters can never describe different rules. Asking in
      // prose for "≤100 chars" and checking nowhere is how an over-long title reached the
      // clipboard and got truncated by the platform with the keyword cut off.
      const spec = PLATFORMS.map((pf) => {
        const fields = pf.fields.map((f) => `    "${f.key}": ${f.list ? '["…"]' : '"…"'}   // ${f.label}, ≤${f.sweet} ký tự${f.hint ? ` (${f.hint})` : ''}`).join('\n');
        return `  "${pf.id}": {   // ${pf.label} — ${pf.brief}\n${fields}\n  }`;
      }).join(',\n');
      const p = await chatJson([
        { role: 'system', content: 'You are a social SEO editor who writes for each platform in its own voice. Reply with pure JSON.' },
        { role: 'user', content: `${stylePrompt || ''}
Write publishing metadata for the video "${title}".
${scriptBlock}Write every user-facing text in the SAME LANGUAGE as that video title; tags and hashtags may mix in globally searched terms.
Each platform gets its OWN wording — do not paste one caption into all of them. Never promise anything the narration does not deliver.

ONE PRIMARY KEYWORD, FIVE PLACES. Pick the single phrase a viewer would actually type to find this
video — short, plain, no cleverness — then place it, spelled identically every time, in: (1) the
YouTube title, as early as it reads naturally; (2) the first two lines of the YouTube description;
(3) the FIRST YouTube tag, on its own, exactly as typed; (4) one of the first three YouTube
hashtags; (5) the first 50 characters of the TikTok caption. Everything else is supporting text.

HASHTAG RULES — these are counts, not suggestions:
- NEVER use empty reach-bait: no #fyp, #foryou, #viral, #xuhuong, #trending, #followme. Platforms
  in 2026 read a stack of generic tags as manipulation and they dilute the real topic signal.
- Every hashtag must describe THIS video's actual subject. If it would fit any video on the
  channel, it is not earning its place — except the one channel-brand tag.
- Do not ship the identical hashtag set on every video: keep one or two fixed (brand + main
  content area) and change the rest to match this specific topic.
- YouTube: only the first three hashtags are visible above the title, so put the load-bearing
  ones there. TikTok: 3-5 total. Facebook: 1-3 total, inside the post body.

Output JSON exactly in this shape:
{
${spec}
}` },
      ], { attempts: 2, llm, validate: (x) => typeof x?.youtube?.title === 'string' && x.youtube.title.length > 3 });

      // Keyword guard: the SEO title must still carry a content word of the real topic — a
      // clickbait rewrite that drops the subject entirely gets the topic prefixed back.
      const kws = topNouns(title, 3);
      const flat = (v) => String(v || '').toLowerCase();
      if (p.youtube && kws.length && !kws.some((k) => flat(p.youtube.title).includes(flat(k)))) {
        p.youtube.title = `${title.slice(0, 60)} — ${p.youtube.title}`;
      }
      const platforms = clampPlatforms(p);
      const yt = platforms.youtube || {};
      return {
        // the flat shape every existing consumer still reads
        title: yt.title || title,
        description: yt.description || '',
        hashtags: platforms.shorts?.hashtags?.length ? platforms.shorts.hashtags
          : (yt.tags || []).map((t) => '#' + String(t).replace(/^#/, '').replace(/\s+/g, '')).slice(0, 12),
        pinnedComment: yt.pinnedComment || '',
        platforms,
      };
    } catch (e) { logger.warn(`LLM metadata failed, falling back to the offline writer: ${e.message}`); }
  }

  const tags = topNouns(title, 8).map((w) => '#' + w.replace(/\s+/g, ''));
  return {
    title: `${title} | Bạn cần xem ngay!`,
    description: `${title}\n\nVideo được tạo tự động bằng AI Video Studio.`,
    // No #fyp/#viral filler even in the offline fallback: generic reach-bait dilutes the topic
    // signal on every platform, and a fallback that ships it teaches the habit by example.
    hashtags: tags.slice(0, 8),
  };
}
