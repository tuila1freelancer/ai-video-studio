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
import { backdropForScene } from '../../animation/backdrop.js';
import { brandCatalog, brandFolderFor, castBrandAssets, sceneMediaResolver } from '../brand-assets.js';
import { heroMediaUri } from '../../util/asset-uri.js';
import { hash32 } from '../../util/util.js';
import { resolveGuide } from '../../styleguide/index.js';
import { checkStop } from '../stop.js';
import { step, op } from '../progress.js';
import { mapPool } from '../helpers.js';
import { resolveLang } from '../../util/lang.js';

import { m, tp } from '../../i18n/t.js';
/** @param {import('../context.js').PipelineContext} ctx */
export async function runVisuals(ctx) {
  const { projectId, project, config, ai } = ctx;
  const scenes = DB.getScenes(projectId);
  const videoLang = resolveLang(config, scenes); // one answer for the art brief AND the codegen
  // HyperFrame: the LLM art-directs each scene's graphics against the REAL voice timeline
  // (beats from srt_json word timestamps).
  step(projectId, 'b5', 'running', m('AI đạo diễn visual từng cảnh'));
  DB.updateProject(projectId, { current_step: 'b5' });
  op(projectId, m('✨ HyperFrame: AI dàn dựng đồ hoạ theo lời thoại…'));
  const guide = resolveGuide(config);
  const hfSize = animSize(project.aspect_ratio, 1); // codegen/validate in the LOGICAL canvas — output upscales losslessly
  const totalHf = scenes.length;
  // Per-video model override for the codegen step. NO-FALLBACK CONTRACT (P25): codegen runs on the PRIMARY model only — modelFallback is stripped so
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
    op(projectId, tp`🎬 AI viết chỉ đạo hình ảnh ${undirected.length} cảnh…`);
    const dirs = await generateDirections(undirected, {
      title: project.title, total: totalHf, guide, ai: hfAi, language: videoLang,
      onLog: (m) => logger.info(m, { projectId }),
    });
    for (const sc of undirected) {
      const d = dirs.get(sc.idx);
      if (!d) continue;
      DB.updateScene(sc.id, { visual_prompt: d.visual });
      sc.visual_prompt = d.visual;
    }
    logger.info(tp`🎬 Chỉ đạo hình ảnh: ${dirs.size}/${undirected.length} cảnh có brief`, { projectId, stage: 'b5' });
  }
  const hookVisual = scenes[0]?.visual_prompt || '';
  // Image-full lane (reference-app parity): resolve each scene's master-assigned asset
  // names against config.assets [{name, path, type}] → hero-sized data URIs. Resolution
  // failures simply drop the asset (the scene designs media-free).
  // P40 brand casting: the brand's own artwork (mascot cutouts + concept art) joins the SAME
  // lane, so a cast asset is just another {{asset:NAME}} the codegen model may place. One LLM
  // call for the whole video; no LLM / empty folder / unparseable reply → nothing cast and the
  // video renders exactly as it did before this feature. Scenes the master script already gave
  // assets to are left alone — an explicit assignment outranks the cast.
  const brandFolder = config.hyperframe?.imageFull === false ? null : brandFolderFor(config);
  const catalog = brandFolder ? brandCatalog(brandFolder) : [];
  const uncast = catalog.length ? scenes.filter((sc) => !(Array.isArray(sc.assets) && sc.assets.length)) : [];
  if (uncast.length) {
    op(projectId, tp`🎭 AI chọn asset thương hiệu cho ${uncast.length} cảnh…`);
    const cast = await castBrandAssets({
      scenes: uncast, catalog, title: project.title, llm: hfAi?.llm,
      onLog: (m) => logger.info(m, { projectId, stage: 'b5' }),
    });
    // The model numbered the list IT was given (1..uncast.length), which is NOT scene.idx+1
    // whenever some scenes already carried assets — map back by position, never by scene index.
    uncast.forEach((sc, k) => {
      const picks = cast.get(k + 1);
      if (!picks?.length) return;
      sc.assets = picks;
      DB.updateScene(sc.id, { assets: picks }); // persists for regen/resume
    });
  }
  const mediaFor = sceneMediaResolver(config, { heroMediaUri });
  const hfConsistent = config.hyperframe?.consistent === true;
  // Concurrency 2: each codegen now also renders (renderValidate) on the shared headless
  // browser — 2 keeps throughput up without thrashing Chrome with too many parallel pages.
  // Scene-gate freeze: once the owner approved the storyboard, EVERY scene that carries a
  // plan is kept verbatim — without this, a scene would re-enter codegen on the continue
  // run and silently replace visuals the owner just signed off on.
  const approved = !!DB.getProject(projectId).scenes_approved_at;
  // NO-FALLBACK CONTRACT (P25): a scene the primary model cannot build
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
    op(projectId, tp`🎨 AI dựng cảnh ${sc.idx + 1}/${totalHf}`);
    try {
      const { props, beats } = await generateSceneSpec({
        scene: sc, guide, w: hfSize.w, h: hfSize.h, idx: sc.idx, total: totalHf, ai: hfAi,
        language: videoLang, // decides the ON-SCREEN language, and what counts as dev-decor
        // P35: density follows the scene's ROLE (hook/proof/payoff → rich, cta → minimal);
        // the project knob is the baseline for everything else
        density: densityForScene(sc, config.hyperframe?.density),
        creativeDirection: config.hyperframe?.direction, captionsOn: config.enableSubtitles !== false,
        hookVisual: sc.idx > 0 ? hookVisual : '',
        consistent: hfConsistent, imageFullAssets: mediaFor(sc),
        // 'edit' tells the codegen the footage is the owner's OWN video (its own captions/titles
        // are already burned in) — plain overlay stays B-roll under a narrated scene.
        overlay: config.overlay?.enabled === true ? (config.overlay.mode === 'edit' ? 'edit' : true) : false,
        diversitySalt: hash32(String(projectId)), // P31: signature rotation differs per video
        onLog: (m) => logger.warn(m, { projectId }),
      });
      // P38: per-scene backdrop rotation — palette/fonts stay LOCKED to the guide, only the
      // background STYLE varies scene to scene (unless backgroundVariety is off → guide.motif).
      const backdrop = config.hyperframe?.backgroundVariety !== false
        ? backdropForScene(sc, sc.idx, hash32(String(projectId))) : null;
      // clear any stale clip: on resume a scene that just got FRESH visuals must re-render.
      DB.updateScene(sc.id, { template: 'hyperframe', props: { ...props, ...(backdrop ? { backdrop } : {}) }, status: 'html', video_path: null });
      hub.toProject(projectId, { type: 'scene', sceneId: sc.id, idx: sc.idx, status: 'html', template: 'hyperframe', beats: beats.length });
    } catch (e) {
      if (e.stopped) throw e;
      logger.warn(tp`Cảnh ${sc.idx + 1}: codegen thất bại sau mọi lần thử với model chính: ${e.message}`, { projectId, stage: 'b5', sceneIdx: sc.idx });
      DB.updateScene(sc.id, { status: 'error', error: `codegen: ${String(e.message).slice(0, 300)}` });
      hub.toProject(projectId, { type: 'scene', sceneId: sc.id, idx: sc.idx, status: 'error', error: e.message });
      codegenFailures.push(sc.idx + 1);
    }
  });
  if (codegenFailures.length) {
    throw new Error(tp`HyperFrame codegen thất bại ở ${codegenFailures.length} cảnh (${codegenFailures.slice(0, 8).join(', ')}${codegenFailures.length > 8 ? '…' : ''}) sau 10 lần thử với model chính — không dùng fallback. Kiểm tra model/AI settings rồi resume để thử lại đúng các cảnh lỗi.`);
  }
  step(projectId, 'b5', 'done');
  checkStop(projectId);
}
