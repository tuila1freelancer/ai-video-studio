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
      // Only the first three render above the title, so the panel says so — the rest still index.
      { key: 'hashtags', label: 'Hashtag', limit: 300, sweet: 140, list: true, hint: '8–10 cái; chỉ 3 cái đầu hiện trên tiêu đề' },
      { key: 'pinnedComment', label: 'Bình luận ghim', limit: 10000, sweet: 220, lines: 3 },
    ],
    // 2 lines before "show more" on desktop, ~3 on mobile — the keywords have to be up there
    brief: 'Long-form. Title ≤70 chars carrying the main keyword AS EARLY AS POSSIBLE; the FIRST TWO LINES of the description restate that keyword in a natural sentence, because that is all that shows before "show more"; 8-12 search tags without the # prefix and THE FIRST TAG MUST BE THE PRIMARY KEYWORD SPELLED EXACTLY AS A VIEWER WOULD TYPE IT — it is the single most load-bearing tag; 8-10 hashtags where the FIRST THREE are the load-bearing ones because only those show above the title; one pinned question that invites a real answer.',
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
    brief: 'Caption ≤150 chars whose FIRST 50 CHARACTERS carry the primary keyword — that is all that shows before "more"; a hook that works with sound off; EXACTLY 3-5 hashtags, all genuinely about this video; conversational, no corporate voice.',
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
  {
    // COVER_SIZES has carried an X canvas since it was written; there was no platform to put it on.
    id: 'x', label: 'X (Twitter)', icon: '𝕏',
    fields: [
      { key: 'caption', label: 'Nội dung bài', limit: 280, sweet: 200, lines: 3 },
      { key: 'hashtags', label: 'Hashtag', limit: 60, sweet: 30, list: true, hint: '1-2 thẻ là đủ' },
    ],
    brief: 'A 280-character post. The FIRST sentence has to stand alone in a timeline, because a video card pushes everything else below the fold; state the single most surprising thing the video proves rather than teasing it. 1-2 hashtags at most — more reads as spam here and suppresses reach.',
  },
  {
    id: 'linkedin', label: 'LinkedIn', icon: '💼',
    fields: [
      { key: 'caption', label: 'Nội dung bài', limit: 3000, sweet: 600, lines: 6 },
      { key: 'hashtags', label: 'Hashtag', limit: 200, sweet: 60, list: true, hint: '3-5 thẻ chuyên ngành' },
    ],
    brief: 'Professional feed. Only the first ~200 characters show before "see more", so the opening two lines carry the whole argument and name the concrete outcome. Write in first person about what was learned or measured, never as an advertisement; 3-5 industry hashtags, never trend hashtags.',
  },
];


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
