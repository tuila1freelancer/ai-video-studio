// The canonical scenes-JSON export (P18) and the CTA floor + pipeline shape every generated spec passes through (P33).
import { topNouns } from '../../providers/llm.js';
import { auditCtas, stripCtaSentences } from '../cta-audit.js';
import { safeJson } from '../../util/util.js';
import { tp } from '../../i18n/t.js';
import { synthThumbnail } from './validate.js';

// ---------------------------------------------------------------- canonical export builder
/** Build the canonical factory-format JSON from DB rows (DB stays the source of truth). */
export function scenesJsonFromRows(project, rows) {
  const md = project?.metadata && typeof project.metadata === 'object' ? project.metadata : safeJson(project?.metadata, {}) || {};
  const thumbnail = synthThumbnail({ thumbnail: md.thumbnail }, project?.title || project?.topic || '');
  return {
    thumbnail,
    scenes: (rows || []).map((r, i) => ({
      stt: i + 1,
      voice: String(r.voice_text || ''),
      visual: String(r.visual_prompt || ''),
      assets: Array.isArray(r.assets) ? r.assets : [],
    })),
  };
}

// ---------------------------------------------------------------- orchestrator
// P33 deterministic floor — a farewell BEFORE the final scene can never ship, in ANY mode
// (topic/source/script LLM output and zero-LLM json imports alike; the factory's own files
// carry 8 goodbye blocks per 200 scenes). Farewell sentences are standalone by nature, so
// a plain strip reads clean; a farewell-ONLY scene is DROPPED (P18 precedent). Mid-video
// CTA excess is left to the editorial LLM rewrite (nicer prose) — b2.5 owns that.
function enforceCtaFloor(scenes, onLog = () => {}) {
  // the FAREWELL_MID defect already encodes the closing-zone rule — reuse it verbatim
  const fw = auditCtas(scenes.map((s) => s.voice)).defects.find((d) => d.code === 'FAREWELL_MID');
  const mid = new Set(fw ? fw.idx : []);
  if (!mid.size) return scenes;
  const out = [];
  scenes.forEach((sc, i) => {
    if (!mid.has(i)) { out.push(sc); return; }
    const { voice, removed, gutted } = stripCtaSentences(sc.voice, { farewellOnly: true });
    if (gutted) {
      onLog(tp`Kỷ luật CTA: cảnh ${i + 1} chỉ là lời chào tạm biệt giữa video — XOÁ cảnh (video vẫn còn tiếp diễn)`);
      return;
    }
    onLog(tp`Kỷ luật CTA: cảnh ${i + 1} — bỏ câu tạm biệt giữa video: "${removed.join(' | ').slice(0, 90)}"`);
    out.push({ ...sc, voice });
  });
  return out.map((s, i) => ({ ...s, stt: i + 1 }));
}

export function toPipelineShape(spec, { mode, defects = [], onLog = () => {} } = {}) {
  const scenes = enforceCtaFloor(spec.scenes, onLog);
  return {
    title: (spec.title || spec.thumbnail?.title || scenes[0]?.voice || 'Video mới').slice(0, 64),
    thumbnail: spec.thumbnail,
    scenes: scenes.map((s) => ({
      voice: s.voice,
      visualPrompt: s.visual, // [MAIN FOCUS] inside → direction pass skips this scene
      keywords: topNouns(s.voice, 3),
    })),
    raw: { thumbnail: spec.thumbnail, scenes },
    mode,
    warnings: defects,
  };
}
