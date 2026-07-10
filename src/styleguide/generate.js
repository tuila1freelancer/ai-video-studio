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
  const sys = 'Bạn là art director cho video motion graphics. Trả về JSON thuần, không giải thích.';
  const usr = `Thiết kế "style guide" cho một video motion graphics.
Chủ đề video: ${topic || '(không rõ)'}
Yêu cầu phong cách từ người dùng: ${describe || '(tự do sáng tạo, sang trọng, hiện đại)'}

Trả về JSON đúng schema:
{
  "name": "tên phong cách ngắn (tiếng Việt, ≤24 ký tự)",
  "palette": { "bg": "#RRGGBB nền tối hoặc sáng", "bg2": "#RRGGBB nền phụ gần bg", "ink": "#RRGGBB chữ chính tương phản mạnh với bg", "muted": "#RRGGBB chữ phụ", "accents": ["#RRGGBB chủ đạo", "#RRGGBB bổ trợ", "#RRGGBB nhấn"] },
  "displayFont": "oswald" | "montserrat" | "be vietnam pro",
  "motif": "mesh" | "bokeh" | "grid" | "particles" | "grain",
  "textTreatment": "chrome" | "neon" | "solid" | "outline",
  "motionPersonality": "kinetic" | "energetic" | "smooth" | "calm" | "punchy" | "slow-burn",
  "semantics": { "good": "#RRGGBB", "bad": "#RRGGBB", "warn": "#RRGGBB" },
  "conceptMap": ["khái niệm thường gặp của chủ đề → công thức hình ảnh cụ thể (8-12 dòng, vd 'so sánh → SPLIT 2 cột, bên đạt viền good')"],
  "hud": { "kickers": ["tiền tố label mono ngắn, vd //"], "statuses": ["chuỗi HUD trang trí góc màn, vd SYSTEM: ACTIVE"] },
  "sceneRules": ["3-5 quy tắc cứng áp mọi cảnh, vd 'mỗi cảnh đúng 1 focal element'"]
}
Quy tắc: bg/ink phải đủ tương phản (WCAG AA); accents rực rỡ nổi trên bg; nền sáng thì textTreatment="solid"; semantics là màu NGỮ NGHĨA cố định (đúng/sai/cảnh báo) dùng nhất quán mọi cảnh; conceptMap phải bám DOMAIN của chủ đề video.`;
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
