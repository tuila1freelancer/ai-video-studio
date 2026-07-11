// Deterministic Vietnamese TTS text normalization + per-channel pronunciation lexicon.
//
// Scope: symbols/units/dates that neural voices mis-read ('85%', '50.000đ', '16:9',
// '15/3/2025') — NOT full digit-to-word expansion (the voices read plain numbers well).
// The expansion feeds ONLY the synthesizer; captions keep the ORIGINAL script text
// (digits stay on screen — P11 number-beat detection intact), and the forced-alignment
// engine bridges the timing: the caption word '85%' simply spans the spoken expansion.
//
// Also exports moodOf(): the per-scene prosody hint (from the art-director's [MOOD] line
// or the scene's position) that providers with expressive controls consume.

const VI_RULES = [
  // dd/mm/yyyy → "d tháng m năm yyyy" (before the ratio rule can touch it)
  [/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g, '$1 tháng $2 năm $3'],
  // percentages
  [/(\d)\s?%/g, '$1 phần trăm'],
  // currency: 50.000đ / 200 VNĐ / $100 — \b is ASCII-only in JS, so 'đ/Đ' endings need
  // an explicit Unicode lookahead instead of a word boundary
  [/(\d)\s?(?:VNĐ|VND)(?![\p{L}\p{N}])/giu, '$1 đồng'],
  [/(\d)\s?đ(?![\p{L}\p{N}])/gu, '$1 đồng'],
  [/\$\s?(\d[\d.,]*)/g, '$1 đô la'],
  // units
  [/(\d)\s?°C\b/g, '$1 độ C'],
  [/(\d)\s?km\/h\b/gi, '$1 ki lô mét một giờ'],
  [/(\d)\s?m2\b/gi, '$1 mét vuông'],
  // aspect/score ratios: 16:9 → 16 trên 9 (only digit:digit, so times like 15:30 with
  // context "giờ" stay rare edge cases the voices already read acceptably)
  [/\b(\d{1,2}):(\d{1,2})\b/g, '$1 trên $2'],
];

/**
 * @param {string} text the script line as written
 * @param {{lang?:string, lexicon?:Record<string,string>|null}} opts
 *   lexicon: per-channel pronunciation map { "AI": "ây ai", "ChatGPT": "chát gi pi ti" } —
 *   applied first (longest key wins), word-boundary, case-insensitive.
 * @returns {string} what the synthesizer should SPEAK (captions keep the original)
 */
export function normalizeForTts(text, { lang = 'vi', lexicon = null } = {}) {
  let out = String(text || '');
  if (!out.trim()) return out;
  if (lexicon && typeof lexicon === 'object') {
    // ONE alternation pass (longest key first): sequential per-key replaces would re-match
    // inside earlier replacements ("AI" → "ây ai" then "ai" matching its own output)
    const keys = Object.keys(lexicon)
      .filter((k) => k.trim() && typeof lexicon[k] === 'string')
      .sort((a, b) => b.length - a.length).slice(0, 64);
    if (keys.length) {
      const alt = keys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
      const map = new Map(keys.map((k) => [k.toLowerCase(), lexicon[k]]));
      out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])(?:${alt})(?![\\p{L}\\p{N}])`, 'giu'),
        (m) => map.get(m.toLowerCase()) ?? m);
    }
  }
  if (lang === 'vi') for (const [re, rep] of VI_RULES) out = out.replace(re, rep);
  return out;
}

// Direction-pass [MOOD] words → a coarse prosody class providers can express.
const ENERGETIC = /epic|urgent|energetic|intense|power|bold|exciting|dramatic|tension|climax|hào hứng|quyết liệt|mạnh/i;
const CALM = /calm|serene|soft|gentle|warm|hopeful|reflective|nhẹ nhàng|êm|sâu lắng/i;

/**
 * Per-scene prosody hint: 'energetic' | 'calm' | null (neutral).
 * Pure function of (scene.visual_prompt, idx, total) → deterministic.
 */
export function moodOf(scene, total = 0) {
  const m = /\[MOOD\]\s*([^\n[]{2,40})/i.exec(scene?.visual_prompt || '');
  const word = m ? m[1] : '';
  if (ENERGETIC.test(word)) return 'energetic';
  if (CALM.test(word)) return 'calm';
  if (!word) {
    if (scene?.idx === 0) return 'energetic'; // the hook must land with energy
    if (total > 2 && scene?.idx === total - 1) return 'calm'; // warm sign-off
  }
  return null;
}
