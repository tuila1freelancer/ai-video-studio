// Built-in style presets ("Phong cách video") + resolution from a project config.
// Depends only on ./guide.js — no animation/ or hyperframe/ deps (keeps the graph acyclic).
import { HF_DEFAULT_GUIDE, normalizeGuide } from './guide.js';

// Only families that exist in vendor/fonts/fonts.css may appear in a guide.
export const DISPLAY_FONTS = {
  oswald: `'Oswald', 'Be Vietnam Pro', sans-serif`,
  montserrat: `'Montserrat', 'Be Vietnam Pro', sans-serif`,
  'be vietnam pro': `'Be Vietnam Pro', -apple-system, sans-serif`,
};
export const BODY_FONT = `'Be Vietnam Pro', -apple-system, sans-serif`;
export const MONO_FONT = `'JetBrains Mono', ui-monospace, monospace`;

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

/** Look up a preset by id (null if unknown). */
export function presetById(id) {
  return HF_PRESETS.find((p) => p.id === id) || null;
}

/**
 * Resolve the guide for a project config (config.hyperframe from the client).
 * @param {object} config project config; reads config.hyperframe.{guide|styleId}
 * @returns {import('./guide.js').Guide}
 */
export function resolveGuide(config) {
  const hf = config?.hyperframe || {};
  if (hf.guide && typeof hf.guide === 'object') return normalizeGuide(hf.guide);
  return presetById(hf.styleId) || normalizeGuide(HF_DEFAULT_GUIDE);
}
