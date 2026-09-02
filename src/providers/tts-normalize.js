// Deterministic TTS text normalization + per-channel pronunciation lexicon.
//
// Scope: symbols/units/dates that neural voices mis-read ('85%', '50.000đ', '16:9',
// '15/3/2025') — NOT full digit-to-word expansion (the voices read plain numbers well).
// The rules themselves live per language in src/i18n/tts-rules.js; a language with none is
// left alone, which used to be true of every language except Vietnamese.
// The expansion feeds ONLY the synthesizer; captions keep the ORIGINAL script text
// (digits stay on screen — P11 number-beat detection intact), and the forced-alignment
// engine bridges the timing: the caption word '85%' simply spans the spoken expansion.
//
// Also exports moodOf(): the per-scene prosody hint (from the art-director's [MOOD] line
// or the scene's position) that providers with expressive controls consume.

import { rulesFor } from '../i18n/tts-rules.js';

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
  for (const [re, rep] of rulesFor(lang)) out = out.replace(re, rep);
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
