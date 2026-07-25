// AI-designed style guide from a free-text description (falls back to the default preset).
// This is the only styleguide/ file that does I/O (LLM) — kept separate so guide/theme/presets
// stay pure. providers/llm never imports styleguide, so there is no dependency cycle.
import { chatJson, llmEnabled } from '../providers/llm.js';
import { HF_DEFAULT_GUIDE, normalizeGuide } from './guide.js';
import { DISPLAY_FONTS, BODY_FONT, MONO_FONT } from './presets.js';

const HEX = /^#[0-9A-Fa-f]{6}$/;
function cleanHex(c, fallback) { return HEX.test(String(c || '').trim()) ? String(c).trim().toUpperCase() : fallback; }

/**
 * Ask the LLM to design a style guide; degrade to the default preset on any failure.
 * @param {{topic?:string,describe?:string,llm?:object|null}} opts
 * @returns {Promise<{guide:import('./guide.js').Guide, source:'llm'|'preset', error?:string}>}
 */
export async function generateStyleGuide({ topic = '', describe = '', llm = null } = {}) {
  if (!llmEnabled(llm)) return { guide: normalizeGuide(HF_DEFAULT_GUIDE), source: 'preset' };
  const sys = 'You are an art director for motion-graphics videos. Reply with pure JSON, no commentary.';
  const usr = `Design a style guide for a motion-graphics video.
Video topic: ${topic || '(unknown)'}
The user's style request: ${describe || '(free rein — premium, modern)'}

Return JSON with exactly this schema:
{
  "name": "short style name in the same language as the user's request (≤24 chars)",
  "palette": { "bg": "#RRGGBB dark or light background", "bg2": "#RRGGBB secondary background near bg", "ink": "#RRGGBB primary text with strong contrast on bg", "muted": "#RRGGBB secondary text", "accents": ["#RRGGBB primary", "#RRGGBB support", "#RRGGBB highlight"] },
  "displayFont": "oswald" | "montserrat" | "be vietnam pro",
  "motif": "mesh" | "bokeh" | "grid" | "spotlight" | "aurora" | "rays" | "dotmatrix" | "blueprint" | "gradient-wash" | "particles" | "grain",
  "textTreatment": "chrome" | "neon" | "solid" | "outline",
  "motionPersonality": "kinetic" | "energetic" | "smooth" | "calm" | "punchy" | "slow-burn",
  "semantics": { "good": "#RRGGBB", "bad": "#RRGGBB", "warn": "#RRGGBB" },
  "conceptMap": ["recurring concept of this topic → concrete visual recipe, in English (8-12 lines, e.g. 'comparison → SPLIT 2 columns, winning side gets the good border')"],
  "hud": { "kickers": ["short mono label prefix, e.g. //"], "statuses": ["decorative corner HUD tokens — NUMERIC/SYMBOLIC ONLY so they never leak a foreign language on screen, e.g. // or 100% or 01 / 99 or ◦◦◦"] },
  "sceneRules": ["3-5 hard rules applied to every scene, in English, e.g. 'exactly 1 focal element per scene'"]
}
Rules: bg/ink must clear WCAG AA contrast; accents must pop on bg; on a light bg use textTreatment="solid"; semantics are FIXED meaning colors (good/bad/warning) used consistently in every scene; conceptMap must be grounded in the DOMAIN of the video topic.`;
  try {
    const out = await chatJson([{ role: 'system', content: sys }, { role: 'user', content: usr }], { maxTokens: 1600, llm });
    const p = out.palette || {};
    const guide = normalizeGuide({
      id: 'custom', name: String(out.name || 'Phong cách AI').slice(0, 30),
      palette: {
        bg: cleanHex(p.bg, '#07070D'), bg2: cleanHex(p.bg2, '#10101F'),
        ink: cleanHex(p.ink, '#F2F5FF'), muted: cleanHex(p.muted, '#8A93AD'),
        accents: (Array.isArray(p.accents) ? p.accents : []).map((c, i) => cleanHex(c, HF_DEFAULT_GUIDE.palette.accents[i] || '#7C8CFF')).slice(0, 3),
      },
      fonts: { display: DISPLAY_FONTS[String(out.displayFont || '').toLowerCase()] || DISPLAY_FONTS.oswald, body: BODY_FONT, mono: MONO_FONT },
      motif: out.motif, textTreatment: out.textTreatment, motionPersonality: out.motionPersonality,
      semantics: out.semantics, conceptMap: out.conceptMap, hud: out.hud, sceneRules: out.sceneRules,
    });
    return { guide, source: 'llm' };
  } catch (e) {
    return { guide: normalizeGuide(HF_DEFAULT_GUIDE), source: 'preset', error: e.message };
  }
}
