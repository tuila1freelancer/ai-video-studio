// Per-scene prompt blocks: density, the style guide, overlay mode, the verbatim script text rule (P19).
import { lang as langRow, isSupported } from '../../i18n/languages.js';
import { classifyLang } from '../../util/lang.js';

export const DENSITY_NOTE = {
  minimal: 'DENSITY: minimal — a clean hero and generous calm negative space; let the idea breathe, skip decorative extras.',
  balanced: 'DENSITY: balanced — a hero plus a supporting element or two, with tasteful detail; rich enough to feel crafted, calm enough to read.',
  rich: 'DENSITY: rich — a full, layered composition with living craft detail (textures, ticks, depth pieces), yet reveals stay one-at-a-time and motion stays calm — a dense, hand-crafted frame, never cluttered or busy.',
};

/**
 * P35 — role-aware per-scene density. The art-director pass writes [ROLE] into the brief;
 * high-stakes roles (hook/proof/payoff) render RICH, the cta breather renders MINIMAL, the
 * rest keep the project's own knob as the baseline. One project-wide prose note used to be
 * the only density lever — a hook and a titlecard got the same instruction.
 */
export function densityForScene(scene, baseDensity) {
  const m = /\[ROLE\]\s*([a-z-]+)/i.exec(String(scene?.visual_prompt || ''));
  const role = m ? m[1].toLowerCase() : '';
  if (role === 'hook' || role === 'proof' || role === 'payoff') return 'rich';
  if (role === 'cta') return 'minimal';
  return baseDensity || 'balanced';
}

// v2 guide blocks — semantic colors, concept→visual recipes, HUD vocabulary and per-video
// scene rules travel with every prompt so all scenes speak one visual language.
export function guideV2Block(guide) {
  const parts = [];
  const sem = Object.entries(guide.semantics || {});
  if (sem.length) parts.push(`- SEMANTIC COLORS (fixed meaning — use for anything with this meaning, never decoratively): ${sem.map(([k, v]) => `${k}=${v}`).join(' · ')}`);
  if (guide.fontSizes) parts.push(`- TYPE LADDER (px on this canvas): ${Object.entries(guide.fontSizes).map(([k, v]) => `${k} ${v}px`).join(' · ')} — hero/headline may flex ±15% to fit.`);
  if (guide.effects?.length) parts.push(`- TEXT EFFECT PRESETS (the channel's named treatments — pick per beat):\n${guide.effects.map((e) => `  • ${e}`).join('\n')}`);
  if (guide.ambient?.length) parts.push(`- AMBIENT NOTES:\n${guide.ambient.map((e) => `  • ${e}`).join('\n')}`);
  if (guide.hud?.kickers?.length || guide.hud?.statuses?.length) {
    parts.push(`- HUD LANGUAGE (optional, use SPARINGLY — never a fixed frame stamped on every scene): a small mono uppercase kicker (prefix like ${(guide.hud.kickers || ['//']).join(' or ')}, class .hf-label) may sit near a headline on SOME scenes; skip it on others and vary where it sits. Never a corner status tag or page counter.`);
  }
  if (guide.sceneRules?.length) parts.push(`- SCENE RULES (hard):\n${guide.sceneRules.map((r) => `  • ${r}`).join('\n')}`);
  if (guide.conceptMap?.length) parts.push(`- CONCEPT → VISUAL IDEAS (inspiration when the narration matches a concept — adapt freely, never copy verbatim):\n${guide.conceptMap.map((c) => `  • ${c}`).join('\n')}`);
  return parts.length ? `\n${parts.join('\n')}` : '';
}

// Overlay-mode doctrine (the reference app's 19 KB overlay prompt distilled): the scene
// composites onto REAL FOOTAGE via colorkey, so the design rules flip from "build a stage"
// to "decorate a living picture without hiding it".
export function overlayBlock({ edit = false } = {}) {
  // An EVEN frame outranks avoiding whatever text the footage already burned in. No band is reserved here — the balance doctrine owns placement.
  const editNote = edit
    ? `
- THIS FOOTAGE IS THE OWNER'S OWN VIDEO and the narration you are given is what it ALREADY SAYS out loud at this moment. Your graphics ANNOTATE it — a keyword, a number, a label — they never restate the sentence.`
    : '';
  return `OVERLAY MODE ACTIVE (this scene composites ON TOP of the owner's real footage — the themed stage is NOT rendered; your background is keyed transparent):${editNote}
- KEEP THE CENTER ~40-50% OF THE FRAME CLEAR — the viewer must see the footage. Design with edges, corners, top bar, lower-third and side columns; a keyword may CROSS the center only during a brief entrance/exit.
- FORBIDDEN (breaks the key or hides the footage): solid panels/cards with filled backgrounds, backdrop-filter of any kind, any filled rectangle covering >30% of the frame, any element with opacity >0.5 that is not text / a thin line (≤4px) / an icon (≤80px). A "container" is border-only (≤2px, opacity ≤0.4), never filled.
- TEXT MUST READ OVER VIDEO: active text at opacity 1.0, solid fill (white or a bright accent) + a 3-layer shadow (tight glow, wide glow, dark drop — e.g. 0 0 15px rgba(255,255,255,.8), 0 0 30px rgba(255,255,255,.4), 0 4px 12px rgba(0,0,0,.9)). Outline-only text is an entrance state ONLY (≤0.3s, then fill).
- AMBIENT stays subtle: a few drifting dots at the margins, corner brackets that breathe, one thin light-streak sweep every ~5-7s. Never a full-frame wash.
- Per-beat protocol is unchanged (one keyword enters on its word, holds alive, exits before the next; position rotation; final climax + callback) — but keep each beat's element NEAR the edges/thirds, never parked dead-center.`;
}

// Script-specific typography rules (reference-app per-language textRule parity): a script whose
// marks leave the line box clips without extra line-height.
//
// Dispatched on the video's DECLARED language where there is one, and on the narration only as a
// fallback. Sniffing the text alone misfires both ways: a Vietnamese product name inside an
// English video triggered the Vietnamese rule, and an English-heavy Thai script triggered none.
export function scriptTextRule(voiceText, language) {
  // langRow() answers with the house default for a code it does not know, which would hand a
  // Greek video the Vietnamese rule. An unsupported code falls back to reading the text.
  const script = isSupported(language) ? langRow(language).script : scriptOfText(voiceText);
  const L = langRow(language).lineHeightMin;
  switch (script) {
    case 'devanagari':
      return `\nSCRIPT RULE (Devanagari): matras extend far above/below the baseline — every text element needs line-height ≥${Math.max(1.8, L)} and padding-top ~0.2em; NEVER overflow:hidden on text. Do NOT letter-space: it breaks the conjuncts.`;
    case 'thai':
      return `\nSCRIPT RULE (Thai): stacked tone marks need line-height ≥${Math.max(1.7, L)} and extra top padding; NEVER overflow:hidden on text. Do NOT letter-space, and do not rely on automatic line breaking — Thai writes no spaces between words.`;
    case 'cjk-sc': case 'cjk-tc': case 'japanese': case 'korean':
      return '\nSCRIPT RULE (CJK): avoid aggressive letter-spacing on body text; character wrapping is natural; keep display weights ≥500 so strokes stay crisp. text-transform does nothing — do not rely on it for emphasis.';
    case 'cyrillic':
      return '\nSCRIPT RULE (Cyrillic): Д Ц Щ carry descenders a Latin capital does not, so an uppercase line needs line-height ≥1.3; words run longer than their English equivalents, so leave a headline room to breathe rather than shrinking it.';
    case 'greek':
      return '\nSCRIPT RULE (Greek): accented capitals (Ά Έ Ή Ό) sit higher than plain Latin capitals — line-height ≥1.3 on uppercase display text.';
    case 'vietnamese':
      return '\nSCRIPT RULE (Vietnamese): capitals carrying a stacked mark (Ẵ Ộ Ặ Ế Ữ) reach up to 44% higher above the baseline than Latin capitals, and UPPERCASE display text is where that bites.'
        + ' Every text element needs line-height ≥1.35 (never below 1.25, never 1 or 0.9).'
        + ' NEVER overflow:hidden on a box that holds text.'
        + ' If you use background-clip:text for a gradient headline, the gradient only paints INSIDE the box — add padding:0.22em 0 0.10em or the marks are simply never drawn.';
    default:
      return '';
  }
}

/**
 * The script of a piece of text, when no language was declared.
 *
 * classifyLang already answers this correctly, and writing a second sniffer here repeated the
 * exact bug it was fixed for: Greek "Καλημέρα" decomposes to η + a combining acute, so a
 * hand-rolled Vietnamese mark test claimed it as Vietnamese.
 */
function scriptOfText(voiceText) {
  return langRow(classifyLang(voiceText).code).script;
}
