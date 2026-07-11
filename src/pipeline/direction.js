// Per-scene cinematic direction — the art-director pass between script (B2) and HyperFrame
// codegen (B5). One batched LLM pass over the scene list writes a structured visual brief per
// scene ([LAYOUT]/[ENVIRONMENT]/[MAIN FOCUS]/[CAMERA]/[MOTION FLOW]/[LIGHTING & FX]/[MOOD]),
// so long videos stop shipping `voice.slice(0,90)` as their only visual concept. Directions
// see the WHOLE batch → adjacent scenes vary layout, the climax rhymes with the hook, and the
// guide's semantic colors / concept-map recipes are applied consistently.
//
// Failure never blocks the pipeline: a batch that can't be generated keeps the scenes'
// existing visual_prompt (codegen still works, just with a weaker brief).
import { chatJson, llmEnabled } from '../providers/llm.js';

// A structured direction always carries a [MAIN FOCUS] section — used as the "already
// directed" marker so resume runs and user-edited briefs are never overwritten.
const DIRECTED = /\[MAIN FOCUS\]/i;
export function hasDirection(scene) { return DIRECTED.test(scene?.visual_prompt || ''); }

// Scene layout taxonomy distilled from the @TuiLa1Freelancer reference channel.
export const HF_LAYOUTS = [
  'hero-center',   // 1 keyword/số khổng lồ giữa màn + kicker + label
  'split-lr',      // chữ một bên, prop/diagram/icon bên kia
  'list-steps',    // list dọc đánh số 01/02/03, reveal từng item theo beat
  'compare-ab',    // 2 card/panel đối xứng (đạt vs lỗi, A vs B)
  'grid-cards',    // 2-4 card đều nhau: icon + keyword
  'timeline',      // stepper/dòng thời gian ngang, node active sáng
  'radial-hub',    // 1 core trung tâm + vệ tinh nối dây
  'stat-hero',     // con số thống kê khổng lồ + đường/bar phụ hoạ
  'terminal',      // cửa sổ mono gõ chữ typewriter
  'quote-punch',   // 1 câu/cụm ngắn nhấn mạnh, tối giản
];

const BATCH = 14; // scenes per LLM call — big enough for coherence, small enough to stay valid

function guideBrief(guide) {
  const g = guide || {};
  const pal = g.palette || {};
  const sem = Object.entries(g.semantics || {}).map(([k, v]) => `${k}=${v}`).join(' ');
  const lines = [
    `Nền ${pal.bg} · chữ ${pal.ink} · accents ${(pal.accents || []).join(' ')}${sem ? ` · màu ngữ nghĩa: ${sem}` : ''}`,
    `Motif nền: ${g.motif} · treatment chữ: ${g.textTreatment} · tính cách chuyển động: ${g.motionPersonality}`,
  ];
  if (g.sceneRules?.length) lines.push(`Quy tắc cảnh: ${g.sceneRules.join(' · ')}`);
  return lines.join('\n');
}

function batchPrompt({ batch, title, total, guide, hookSummary, language }) {
  const conceptMap = (guide?.conceptMap || []).map((c) => `• ${c}`).join('\n');
  const list = batch.map((sc) => `${sc.idx}. "${String(sc.voice_text || '').trim().slice(0, 360)}"`).join('\n');
  const sys = 'Bạn là đạo diễn nghệ thuật (art director) cho video motion-graphics cao cấp kiểu Apple-keynote. Trả về JSON thuần, không giải thích.';
  const usr = `Video "${title}" (${total} cảnh, lời thoại ${language || 'tiếng Việt'}). Phong cách KHOÁ toàn video:
${guideBrief(guide)}

Viết CHỈ ĐẠO HÌNH ẢNH cho từng cảnh dưới đây. Mỗi cảnh trả về:
- "idx": số cảnh (giữ nguyên như input)
- "layout": chọn 1 trong: ${HF_LAYOUTS.join(' | ')} — đúng bản chất nội dung, KHÔNG lặp cùng layout quá 2 cảnh liên tiếp
- "visual": mô tả tiếng Anh NGẮN GỌN theo ĐÚNG khung (mỗi phần 1 dòng):
[ENVIRONMENT] far=…, mid=…, near=… + atmosphere (bám motif của phong cách)
[MAIN FOCUS] MỘT chủ thể chính là ẨN DỤ HÌNH ẢNH đúng nghĩa lời thoại (object/diagram/stat/metaphor vẽ được bằng SVG line-art + div — KHÔNG phải "display text X"), vị trí + scale (dominant/subtle)
[CAMERA] slow zoom in 3-5% | zoom out | pan | parallax shift
[MOTION FLOW] Entry: … Idle: … Exit: …
[LIGHTING & FX] glow/light-sweep/depth-blur bằng màu của phong cách (khái niệm tốt→good, rủi ro/sai→bad, cảnh báo→warn)
[MOOD] 1-2 từ

QUY TẮC:
- Tối đa 2-3 yếu tố động chính mỗi cảnh, ĐÚNG 1 focal element. Cảnh phức tạp quá = code lỗi.
- Cảnh đầu video (hook) = ấn tượng nhất.${hookSummary ? `\n- Cảnh CUỐI batch này nếu là cảnh kết video: NHẮC LẠI motif của cảnh hook ("${hookSummary.slice(0, 160)}") ở scale lớn hơn + glow mạnh hơn (visual rhyme).` : ''}
- KHÔNG mô tả layout tĩnh kiểu website. Mục tiêu: cinematic motion graphics.${conceptMap ? `\n- CÔNG THỨC THEO KHÁI NIỆM (khái niệm khớp thì dùng đúng công thức):\n${conceptMap}` : ''}

Các cảnh (idx. "lời thoại"):
${list}

JSON: {"scenes":[{"idx":${batch[0].idx},"layout":"…","visual":"[ENVIRONMENT] …"}]}  — đúng ${batch.length} phần tử, idx khớp input.`;
  return [{ role: 'system', content: sys }, { role: 'user', content: usr }];
}

function cleanDirection(d) {
  const layout = HF_LAYOUTS.includes(String(d.layout || '').trim()) ? String(d.layout).trim() : 'hero-center';
  let visual = String(d.visual || '').trim().slice(0, 1400);
  if (!DIRECTED.test(visual)) return null;
  if (!/^\[LAYOUT\]/i.test(visual)) visual = `[LAYOUT] ${layout}\n${visual}`;
  return { layout, visual };
}

/**
 * Generate directions for scenes that need one. Returns Map<idx, {layout, visual}> —
 * missing entries mean "keep the existing visual_prompt". Never throws.
 */
export async function generateDirections(scenes, { title = '', total = 0, guide = null, ai = null, language = '', onLog = () => {} } = {}) {
  const out = new Map();
  const llm = ai?.llm || null;
  if (!scenes.length || !llmEnabled(llm)) return out;
  const hookSummary = (scenes[0]?.idx === 0 ? scenes[0]?.voice_text : '') || '';
  for (let i = 0; i < scenes.length; i += BATCH) {
    const batch = scenes.slice(i, i + BATCH);
    try {
      const parsed = await chatJson(
        batchPrompt({ batch, title, total: total || scenes.length, guide, language,
          hookSummary: batch.some((s) => s.idx >= (total || scenes.length) - 1) ? hookSummary : '' }),
        {
          maxTokens: batch.length * 460 + 500, attempts: 2, llm,
          validate: (p) => Array.isArray(p.scenes) && p.scenes.length > 0,
        },
      );
      let got = 0;
      for (const d of parsed.scenes) {
        const idx = Number(d.idx);
        if (!batch.some((s) => s.idx === idx)) continue;
        const clean = cleanDirection(d);
        if (clean) { out.set(idx, clean); got++; }
      }
      onLog(`direction: batch ${Math.floor(i / BATCH) + 1} — ${got}/${batch.length} cảnh có chỉ đạo`);
    } catch (e) {
      onLog(`direction: batch ${Math.floor(i / BATCH) + 1} lỗi (${String(e.message).slice(0, 80)}) — giữ visual prompt cũ`);
    }
  }
  return out;
}

// Single-scene variant for regenerate-one flows.
export async function generateSceneDirection(scene, opts = {}) {
  const dirs = await generateDirections([scene], { ...opts, total: opts.total || 1 });
  return dirs.get(scene.idx) || null;
}
