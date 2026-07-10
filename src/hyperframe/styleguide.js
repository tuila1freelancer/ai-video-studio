// HyperFrame style guides — one visual identity per video ("Phong cách video").
// A guide pins everything the LLM must NOT improvise: palette, fonts, background motif,
// keyword text treatment and motion personality. It is stored in project config
// (config.hyperframe = { styleId } or { styleId:'custom', guide }) and embedded into every
// scene codegen prompt, so all scenes of a video share one look.
import { chatJson, llmEnabled } from '../providers/llm.js';
import { HF_DEFAULT_GUIDE, normalizeGuide } from '../animation/templates/hyperframe.js';

// Only families that exist in vendor/fonts/fonts.css may appear in a guide.
const DISPLAY_FONTS = {
  oswald: `'Oswald', 'Be Vietnam Pro', sans-serif`,
  montserrat: `'Montserrat', 'Be Vietnam Pro', sans-serif`,
  'be vietnam pro': `'Be Vietnam Pro', -apple-system, sans-serif`,
};
const BODY_FONT = `'Be Vietnam Pro', -apple-system, sans-serif`;
const MONO_FONT = `'JetBrains Mono', ui-monospace, monospace`;

export const HF_PRESETS = [
  HF_DEFAULT_GUIDE, // chrome-kinetic — HyperFrames-style chrome kinetic typography
  {
    // Distilled from the @TuiLa1Freelancer channel (docs/quality-bar.md): dark HUD "system
    // screen" language — deep-navy space, semantic neon accents, mono kickers, corner statuses.
    id: 'tuila1-hud-cyber', name: 'TuiLa1 HUD Cyber',
    palette: { bg: '#0A0E1A', bg2: '#111731', ink: '#EAF2FF', muted: '#8B93B0', accents: ['#22D3EE', '#FF2E88', '#8B5CF6'] },
    fonts: { display: DISPLAY_FONTS['be vietnam pro'], body: BODY_FONT, mono: MONO_FONT },
    motif: 'grid', textTreatment: 'neon', motionPersonality: 'energetic', iconStyle: 'line', cameraDefault: 'push',
    semantics: { good: '#34D399', bad: '#FF3B4E', warn: '#FBBF24', money: '#FBBF24', ai: '#22D3EE', risk: '#FF2E88' },
    conceptMap: [
      'AI / công nghệ / dữ liệu → node network, chip, scan-line quét qua card, terminal gõ chữ',
      'so sánh / lựa chọn / đúng-sai → SPLIT 2 cột đối xứng, bên đạt viền good + ✓, bên lỗi viền bad + ✗',
      'quy trình / các bước → stepper ngang hoặc list dọc 01/02/03, reveal TỪNG bước theo beat — không bao giờ hiện cả danh sách cùng lúc',
      'con số / thống kê → stat hero khổng lồ counter-roll + đường/bar tăng, ghost number mờ phía sau',
      'danh sách tiêu chí / checklist → grid card kính mờ viền accent 1px, mỗi card icon + keyword',
      'rủi ro / cảnh báo / sai lầm → tông risk, glitch nhẹ, tam giác cảnh báo, viền pulse',
      'thành công / kết quả / lợi ích → tông good, check circle draw-on, glow bừng rồi settle',
      'tiền / chi phí / giá trị → tông money, coin/wallet icon, counter đếm',
      'khái niệm trừu tượng → 1 ẩn dụ hình học (puzzle ghép, quỹ đạo hub-spoke, kim tự tháp, radar chart) vẽ SVG line-art',
      'lộ trình / thời gian → timeline node ngang, node active phát sáng',
      'câu hỏi / tò mò → dấu ? lớn glow + ripple đồng tâm',
      'tổng kết / recap → các keyword cũ bay về xếp thành hàng, climax nhấn keyword chính',
    ],
    hud: {
      kickers: ['//', '[ ]', '01 /', 'SYS_', '>>'],
      statuses: ['SYSTEM: ACTIVE', 'DATA_SYNC 100%', 'AGENT_STATE: OK', 'ANALYSIS_MODE', 'TARGET_LOCKED', 'STATUS_ERROR'],
    },
    sceneRules: [
      'Mỗi cảnh ĐÚNG 1 focal element, negative space ≥50%',
      'Cảnh hero/keyword khoá 1 accent duy nhất; riêng cảnh list/grid được xoay màu theo số thứ tự (01 cyan → 02 hồng → 03 tím/lá)',
      'Kicker mono UPPERCASE nhỏ (letter-spacing ≥0.2em, tiền tố // hoặc [ ]) đặt ngay trên heading',
      'Glitch/RGB-split CHỈ dùng cho cảnh lỗi/cảnh báo',
      'Không nền sáng — mọi cảnh trên nền deep-navy của guide',
    ],
  },
  {
    id: 'neon-tech', name: 'Neon Tech',
    palette: { bg: '#0A0E1E', bg2: '#0D1226', ink: '#EAF2FF', muted: '#8FA3C8', accents: ['#00E5FF', '#FF2D78', '#FFB020'] },
    fonts: { display: DISPLAY_FONTS['be vietnam pro'], body: BODY_FONT, mono: MONO_FONT },
    motif: 'grid', textTreatment: 'neon', motionPersonality: 'energetic', iconStyle: 'line', cameraDefault: 'push',
  },
  {
    id: 'minimal-editorial', name: 'Minimal Editorial',
    palette: { bg: '#F5F6FA', bg2: '#FFFFFF', ink: '#0F172A', muted: '#64748B', accents: ['#2563EB', '#E11D48', '#D97706'] },
    fonts: { display: DISPLAY_FONTS.montserrat, body: BODY_FONT, mono: MONO_FONT },
    motif: 'grain', textTreatment: 'solid', motionPersonality: 'calm', iconStyle: 'line', cameraDefault: 'pan',
  },
  {
    id: 'glass-aurora', name: 'Glass Aurora',
    palette: { bg: '#0B1220', bg2: '#101A30', ink: '#EDF4FF', muted: '#93A5C4', accents: ['#34D399', '#818CF8', '#F472B6'] },
    fonts: { display: DISPLAY_FONTS['be vietnam pro'], body: BODY_FONT, mono: MONO_FONT },
    motif: 'mesh', textTreatment: 'solid', motionPersonality: 'smooth', iconStyle: 'line', cameraDefault: 'drift',
  },
  {
    id: 'bold-poster', name: 'Bold Poster',
    palette: { bg: '#0E0E10', bg2: '#17171B', ink: '#FFFFFF', muted: '#9CA3AF', accents: ['#FACC15', '#FF4D4D', '#3B82F6'] },
    fonts: { display: DISPLAY_FONTS.oswald, body: BODY_FONT, mono: MONO_FONT },
    motif: 'grain', textTreatment: 'outline', motionPersonality: 'punchy', iconStyle: 'line', cameraDefault: 'push',
  },
  {
    id: 'cinematic-dark', name: 'Cinematic Dark',
    palette: { bg: '#05070C', bg2: '#0B0F18', ink: '#E7E3D8', muted: '#8B8FA0', accents: ['#C9A96A', '#8FB4D9', '#E06D5E'] },
    fonts: { display: DISPLAY_FONTS.montserrat, body: BODY_FONT, mono: MONO_FONT },
    motif: 'bokeh', textTreatment: 'solid', motionPersonality: 'slow-burn', iconStyle: 'line', cameraDefault: 'drift',
  },
].map(normalizeGuide);

export function presetById(id) {
  return HF_PRESETS.find((p) => p.id === id) || null;
}

// Resolve the guide for a project config (config.hyperframe from the client).
export function resolveGuide(config) {
  const hf = config?.hyperframe || {};
  if (hf.guide && typeof hf.guide === 'object') return normalizeGuide(hf.guide);
  return presetById(hf.styleId) || normalizeGuide(HF_DEFAULT_GUIDE);
}

// Map a guide onto the render THEME shape (harness/canvas/captions/progress bar all follow
// the guide instead of the classic config.theme) — the whole page speaks one language.
export function themeFromGuide(g) {
  const [a0, a1, a2] = g.palette.accents;
  const light = isLight(g.palette.bg);
  const glow = light ? () => 'none' : (c) => `0 0 14px ${c}AA, 0 0 44px ${c}55`;
  const glowSoft = light ? () => 'none' : (c) => `0 0 10px ${c}66, 0 0 30px ${c}2E`;
  return {
    name: `HF ${g.name}`,
    bg: g.palette.bg, bg2: g.palette.bg2,
    panel: light ? 'rgba(255,255,255,0.8)' : 'rgba(16,22,44,0.55)',
    panelBorder: light ? 'rgba(15,23,42,0.10)' : 'rgba(120,160,255,0.16)',
    ink: g.palette.ink, muted: g.palette.muted, dim: light ? '#B6C0D4' : '#4A5878',
    accents: [a0, a1, a2, a0, a1],
    gradBar: `linear-gradient(90deg,${a0},${a1})`,
    glow, glowSoft,
    font: g.fonts.body, mono: g.fonts.mono,
    particles: g.motif === 'particles' ? 70 : g.motif === 'grain' ? 0 : light ? 0 : 30,
    grid: false, // the hyperframe motif layer draws its own grid when asked
    streak: false, // the persistent diagonal streak reads as a scratch over the rich HF foreground;
                   // flourishes come from the on-demand .hf-beam (FX.beamSweep) instead.
    vignette: light ? 0 : 0.5,
    noise: 0,
  };
}

function isLight(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return false;
  const v = parseInt(m[1], 16);
  const r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) > 150;
}

const HEX = /^#[0-9A-Fa-f]{6}$/;
function cleanHex(c, fallback) { return HEX.test(String(c || '').trim()) ? String(c).trim().toUpperCase() : fallback; }

// AI-designed guide from a free-text description (falls back to the default preset).
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
