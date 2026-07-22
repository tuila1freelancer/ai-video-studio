// B5 — VISUALS. The LLM art-directs each scene's graphics (a structured cinematic brief pass
// first, then HyperFrame codegen against the REAL voice timeline). Single visual mode (P36):
// there is no template/image lane and NO heuristic fallback — a scene the primary model cannot
// build in 10 attempts FAILS LOUDLY (P25 no-fallback contract).
import * as DB from '../../db/index.js';
import { hub } from '../../ws/hub.js';
import { logger } from '../../util/log.js';
import { llmEnabled } from '../../providers/llm.js';
import { generateDirections, hasDirection } from '../direction.js';
import { animSize } from '../../animation/index.js';
import { generateSceneSpec } from '../../hyperframe/codegen.js';
import { densityForScene } from '../../hyperframe/prompt.js';
import { heroMediaUri } from '../../util/asset-uri.js';
import { hash32 } from '../../util/util.js';
import { resolveGuide } from '../../styleguide/index.js';
import { checkStop } from '../stop.js';
import { step, op } from '../progress.js';
import { mapPool } from '../helpers.js';

/** @param {import('../context.js').PipelineContext} ctx */
export async function runVisuals(ctx) {
  const { projectId, project, config, ai } = ctx;
  const scenes = DB.getScenes(projectId);
  // HyperFrame: the LLM art-directs each scene's graphics against the REAL voice timeline
  // (beats from srt_json word timestamps).
  step(projectId, 'b5', 'running', 'AI đạo diễn visual từng cảnh');
  DB.updateProject(projectId, { current_step: 'b5' });
  op(projectId, '✨ HyperFrame: AI dàn dựng đồ hoạ theo lời thoại…');
  const guide = resolveGuide(config);
  const hfSize = animSize(project.aspect_ratio, 1); // codegen/validate in the LOGICAL canvas — output upscales losslessly
  const totalHf = scenes.length;
  // Per-video model override for the codegen step. NO-FALLBACK CONTRACT (owner order
  // 2026-07-17): codegen runs on the PRIMARY model only — modelFallback is stripped so
  // chat() can never silently switch to a weaker model mid-scene; quality degradation is
  // a loud failure, never a quiet substitution.
  const baseLlm = ai?.llm ? { ...ai.llm } : null;
  if (baseLlm) delete baseLlm.modelFallback;
  const hfAi = baseLlm
    ? { ...ai, llm: config.hyperframe?.model ? { ...baseLlm, model: config.hyperframe.model } : baseLlm }
    : ai;
  // Art-director pass: write a structured cinematic brief per scene BEFORE codegen —
  // long videos otherwise carry only a truncated voice snippet as their visual concept.
  // Skips scenes that already have one (resume / user edits); failure keeps the old brief.
  const undirected = scenes.filter((sc) => !hasDirection(sc)
    && !(sc.template === 'hyperframe' && sc.props?.script)
    && !(sc.template === 'chapter-break' && sc.props));
  if (undirected.length && llmEnabled(hfAi?.llm)) {
    op(projectId, `🎬 AI viết chỉ đạo hình ảnh ${undirected.length} cảnh…`);
    const dirs = await generateDirections(undirected, {
      title: project.title, total: totalHf, guide, ai: hfAi, language: config.language,
      onLog: (m) => logger.info(m, { projectId }),
    });
    for (const sc of undirected) {
      const d = dirs.get(sc.idx);
      if (!d) continue;
      DB.updateScene(sc.id, { visual_prompt: d.visual });
      sc.visual_prompt = d.visual;
    }
    logger.info(`🎬 Chỉ đạo hình ảnh: ${dirs.size}/${undirected.length} cảnh có brief`, { projectId, stage: 'b5' });
  }
  const hookVisual = scenes[0]?.visual_prompt || '';
  // Image-full lane (reference-app parity): resolve each scene's master-assigned asset
  // names against config.assets [{name, path, type}] → hero-sized data URIs. Resolution
  // failures simply drop the asset (the scene designs media-free).
  const assetByName = new Map((Array.isArray(config.assets) ? config.assets : [])
    .filter((a) => a?.name && a?.path).map((a) => [String(a.name).toLowerCase(), a]));
  const mediaFor = (sc) => {
    if (config.hyperframe?.imageFull === false) return null;
    if (!assetByName.size || !Array.isArray(sc.assets) || !sc.assets.length) return null;
    const out = [];
    for (const name of sc.assets) {
      const a = assetByName.get(String(name || '').toLowerCase());
      if (!a) continue;
      const uri = heroMediaUri(a.path);
      if (uri) out.push({ name: a.name, uri });
    }
    return out.length ? out : null;
  };
  const hfConsistent = config.hyperframe?.consistent === true;
  // Concurrency 2: each codegen now also renders (renderValidate) on the shared headless
  // browser — 2 keeps throughput up without thrashing Chrome with too many parallel pages.
  // Scene-gate freeze: once the owner approved the storyboard, EVERY scene that carries a
  // plan is kept verbatim — without this, a scene would re-enter codegen on the continue
  // run and silently replace visuals the owner just signed off on.
  const approved = !!DB.getProject(projectId).scenes_approved_at;
  // NO-FALLBACK CONTRACT (owner order 2026-07-17): a scene the primary model cannot build
  // in 10 attempts FAILS LOUDLY — no fallback model, no heuristic template. Failures are
  // collected and the stage throws after the pool, so the run lands in the error state
  // with the exact scene list; resume retries ONLY those scenes (they carry no props).
  const codegenFailures = [];
  await mapPool(scenes, 2, async (sc) => {
    checkStop(projectId);
    if (approved && sc.template && sc.props) return;
    if (sc.template === 'hyperframe' && sc.props?.script) return; // resume / user-kept spec
    // chapter-break cards stay as-is: they render on the guide theme (one visual identity),
    // keep the channel's section-title punch, and anchor the transition SFX bed.
    if (sc.template === 'chapter-break' && sc.props) return;
    op(projectId, `🎨 AI dựng cảnh ${sc.idx + 1}/${totalHf}`);
    try {
      const { props, beats, tier } = await generateSceneSpec({
        scene: sc, guide, w: hfSize.w, h: hfSize.h, idx: sc.idx, total: totalHf, ai: hfAi,
        // P35: density follows the scene's ROLE (hook/proof/payoff → rich, cta → minimal);
        // the project knob is the baseline for everything else
        density: densityForScene(sc, config.hyperframe?.density),
        creativeDirection: config.hyperframe?.direction, captionsOn: config.enableSubtitles !== false,
        hookVisual: sc.idx > 0 ? hookVisual : '',
        consistent: hfConsistent, imageFullAssets: mediaFor(sc), overlay: config.overlay?.enabled === true,
        diversitySalt: hash32(String(projectId)), // P31: signature rotation differs per video
        onLog: (m) => logger.warn(m, { projectId }),
      });
      // clear any stale clip: on resume a scene that just got FRESH visuals must re-render.
      // qtier persists the render-validation verdict so finalize can surface degraded scenes.
      DB.updateScene(sc.id, { template: 'hyperframe', props: { ...props, qtier: tier || 'premium' }, status: 'html', video_path: null });
      hub.toProject(projectId, { type: 'scene', sceneId: sc.id, idx: sc.idx, status: 'html', template: 'hyperframe', beats: beats.length, tier });
    } catch (e) {
      if (e.stopped) throw e;
      logger.warn(`Cảnh ${sc.idx + 1}: codegen thất bại sau mọi lần thử với model chính: ${e.message}`, { projectId, stage: 'b5', sceneIdx: sc.idx });
      DB.updateScene(sc.id, { status: 'error', error: `codegen: ${String(e.message).slice(0, 300)}` });
      hub.toProject(projectId, { type: 'scene', sceneId: sc.id, idx: sc.idx, status: 'error', error: e.message });
      codegenFailures.push(sc.idx + 1);
    }
  });
  if (codegenFailures.length) {
    throw new Error(`HyperFrame codegen thất bại ở ${codegenFailures.length} cảnh (${codegenFailures.slice(0, 8).join(', ')}${codegenFailures.length > 8 ? '…' : ''}) sau 10 lần thử với model chính — không dùng fallback. Kiểm tra model/AI settings rồi resume để thử lại đúng các cảnh lỗi.`);
  }
  step(projectId, 'b5', 'done');
  checkStop(projectId);
}
