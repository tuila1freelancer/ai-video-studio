// What each platform actually accepts — the one table both the metadata writer and the panel read.
//
// It exists because the limits were previously nowhere: the prompt asked for "≤100 chars" in prose
// and nothing checked, so an over-long title reached the clipboard and got truncated by YouTube
// with the keyword cut off. A number a machine can enforce beats a number in a sentence.
//
// `limit` is the hard cap the platform imposes. `sweet` is where the text still reads well in the
// places it is actually shown (a search result, a feed row) and is what the writer aims at — a
// title at exactly the cap is a title that ends mid-word in every listing.

/** Thumbnail/cover canvases, in true pixels. Grouped by ORIENTATION, which is what a design fits. */
export const COVER_SIZES = [
  { id: 'youtube', label: 'YouTube', w: 1280, h: 720, orient: 'landscape' },
  { id: 'facebook', label: 'Facebook', w: 1200, h: 630, orient: 'landscape' },
  { id: 'x', label: 'X / Twitter', w: 1600, h: 900, orient: 'landscape' },
  { id: 'shorts', label: 'Shorts / TikTok / Reels', w: 1080, h: 1920, orient: 'portrait' },
  { id: 'ig_feed', label: 'Instagram feed', w: 1080, h: 1350, orient: 'portrait' },
  { id: 'square', label: 'Vuông (1:1)', w: 1080, h: 1080, orient: 'square' },
];

/** The orientation a design must be authored for to fill `size` without reflowing into nonsense. */
export function orientationOf({ w, h }) {
  if (w > h * 1.15) return 'landscape';
  if (h > w * 1.15) return 'portrait';
  return 'square';
}

export const PLATFORMS = [
  {
    id: 'youtube', label: 'YouTube', icon: '▶️',
    fields: [
      { key: 'title', label: 'Tiêu đề', limit: 100, sweet: 70, lines: 1 },
      { key: 'description', label: 'Mô tả', limit: 5000, sweet: 1200, lines: 8 },
      { key: 'tags', label: 'Thẻ (tags)', limit: 500, sweet: 400, list: true, hint: 'tổng ≤500 ký tự, không có dấu #' },
      { key: 'pinnedComment', label: 'Bình luận ghim', limit: 10000, sweet: 220, lines: 3 },
    ],
    // 2 lines before "show more" on desktop, ~3 on mobile — the keywords have to be up there
    brief: 'Long-form. Title ≤70 chars carrying the main keyword; the FIRST TWO LINES of the description carry the keywords because that is all that shows before "show more"; 10-15 search tags without the # prefix; one pinned question that invites a real answer.',
  },
  {
    id: 'shorts', label: 'YouTube Shorts', icon: '⚡',
    fields: [
      { key: 'title', label: 'Tiêu đề', limit: 100, sweet: 55, lines: 1 },
      { key: 'description', label: 'Mô tả', limit: 5000, sweet: 300, lines: 4 },
      { key: 'hashtags', label: 'Hashtag', limit: 300, sweet: 120, list: true, hint: 'phải có #shorts' },
    ],
    brief: 'Vertical short. Title ≤55 chars, hook first. #shorts must be present. Keep the description to a line or two — nobody expands it.',
  },
  {
    id: 'tiktok', label: 'TikTok', icon: '🎵',
    fields: [
      { key: 'caption', label: 'Caption', limit: 2200, sweet: 150, lines: 4 },
      { key: 'hashtags', label: 'Hashtag', limit: 300, sweet: 100, list: true },
    ],
    brief: 'Caption ≤150 chars including a hook that works with sound off; 3-5 hashtags mixing one broad and two niche; conversational, no corporate voice.',
  },
  {
    id: 'instagram', label: 'Instagram (Reels + Feed)', icon: '📸',
    fields: [
      { key: 'caption', label: 'Caption', limit: 2200, sweet: 300, lines: 5 },
      { key: 'hashtags', label: 'Hashtag', limit: 500, sweet: 250, list: true, hint: 'tối đa 30 thẻ' },
      { key: 'altText', label: 'Alt text (trợ năng)', limit: 100, sweet: 90, lines: 2 },
    ],
    brief: 'Reels + feed. The first line is the only one shown before "more", so it carries the hook; 8-15 hashtags, never 30; one alt-text line describing what is literally on screen.',
  },
  {
    id: 'facebook', label: 'Facebook', icon: '📘',
    fields: [
      { key: 'caption', label: 'Nội dung bài', limit: 63206, sweet: 400, lines: 5 },
      { key: 'hashtags', label: 'Hashtag', limit: 200, sweet: 80, list: true, hint: '1-3 thẻ là đủ' },
    ],
    brief: 'Written for a scrolling feed: a first line that stands alone, 2-4 short lines of substance, 1-3 hashtags at most — Facebook readers treat hashtag walls as spam.',
  },
];

export const PLATFORM_IDS = PLATFORMS.map((p) => p.id);

/** One platform's spec, or null. */
export function platform(id) {
  return PLATFORMS.find((p) => p.id === id) || null;
}

/**
 * Length of a field's value the way the platform counts it.
 *
 * A list field (tags, hashtags) is capped on the JOINED string, not the item count, because that
 * is what the platform's box actually holds — 15 long tags can blow a 500-character budget that
 * 15 short ones sit inside comfortably.
 */
export function fieldLength(field, value) {
  if (field.list) return (Array.isArray(value) ? value : String(value || '').split(/[,\s]+/).filter(Boolean)).join(field.key === 'tags' ? ', ' : ' ').length;
  return String(value || '').length;
}

/** `{ ok, len, limit }` — `ok` is false only past the HARD cap, where the platform truncates. */
export function checkField(field, value) {
  const len = fieldLength(field, value);
  return { len, limit: field.limit, sweet: field.sweet, ok: len <= field.limit, tight: len > field.sweet };
}
