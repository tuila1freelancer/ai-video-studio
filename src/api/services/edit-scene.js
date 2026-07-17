// Edit-scene-by-prompt (reference-app parity, its prompt #55): the owner types a plain
// instruction ("make the number gold", "move the chart left, add a warning badge") and ONE
// LLM call rewrites the scene's CURRENT effective {css,html,script} accordingly. The result
// passes the same lint + syntax + render-validation gates as fresh codegen — a bad edit is
// rejected with actionable defects, never persisted. Take history snapshots the pre-edit
// state, so every edit is one-click revertible in Scene Studio.
import * as DB from '../../db/index.js';
import { chat } from '../../providers/llm.js';
import { parseSpec, normalizeSpec } from '../../hyperframe/codegen.js';
import { lintSpec } from '../../hyperframe/lint.js';
import { renderValidate } from '../../hyperframe/validate.js';
import { extractBeats } from '../../hyperframe/beats.js';
import { resolveGuide, normalizeGuide } from '../../styleguide/index.js';
import { sceneTemplateSource, animSize } from '../../animation/index.js';

const SYS = `You are an expert motion-graphics HTML editor. You receive ONE scene's current source ({css, html, script} that runs on a GSAP stage: script is the body of function(gsap, tl, S, rng) on a PAUSED timeline scrubbed by a renderer) and ONE edit instruction. Apply the instruction faithfully and keep everything else intact: same structure, ids, classes, FX.* calls, timing and determinism rules (no gsap.* direct calls, no wall-clock, no Math.random, transforms/opacity/filter only, finite repeats). Reply with EXACTLY:
@@@CSS@@@
(full css after the edit)
@@@HTML@@@
(full html after the edit)
@@@SCRIPT@@@
(full script after the edit)
@@@END@@@
No commentary, no markdown fences, no omissions ("rest unchanged" is forbidden — always return the complete blocks).`;

/**
 * Apply a natural-language edit to a scene's visuals.
 * @returns {{ok:true, tier:string}|{ok:false, error:string, defects?:string[]}}
 */
export async function editSceneByPrompt(sceneId, editPrompt, { _chat = chat } = {}) {
  const sc = DB.getScene(sceneId);
  if (!sc) return { ok: false, error: 'scene not found' };
  const prompt = String(editPrompt || '').trim();
  if (!prompt) return { ok: false, error: 'empty edit prompt' };
  const project = DB.getProject(sc.project_id);
  const config = project.config || {};
  const src = sceneTemplateSource(sc, project, config);
  const user = `EDIT INSTRUCTION:\n"${prompt}"\n\nCURRENT SCENE SOURCE:\n@@@CSS@@@\n${src.css}\n@@@HTML@@@\n${src.html}\n@@@SCRIPT@@@\n${src.script}\n@@@END@@@`;
  const raw = await _chat([
    { role: 'system', content: SYS },
    { role: 'user', content: user },
  ], { maxTokens: 9000, temperature: 0.3 });
  const spec = parseSpec(raw);
  if (!spec) return { ok: false, error: 'the model reply did not match the fenced format' };

  const isHf = sc.template === 'hyperframe';
  const guide = isHf ? normalizeGuide(sc.props?.guide) : resolveGuide(config);
  const duration = Math.max(1.5, sc.duration || config.sceneDuration || 6);
  normalizeSpec(spec, { guide, duration });
  const { errors } = lintSpec(spec);
  if (errors.length) return { ok: false, error: 'edit rejected by lint', defects: errors };
  const { w, h } = animSize(project.aspect_ratio, 1);
  const beats = isHf && Array.isArray(sc.props?.beats) ? sc.props.beats : extractBeats(sc.srt_json, sc.keywords, duration);
  const rv = await renderValidate({
    spec: { ...spec, guide }, guide, w, h,
    duration: isHf ? (sc.props?.plannedDur || duration) : duration,
    beats, narration: sc.voice_text || '', captionsOn: config.enableSubtitles !== false,
  });
  if (!rv.ok && !rv.skipped) return { ok: false, error: 'edit rejected by render validation', defects: rv.defects };

  try { DB.snapshotTake(sc, 'visual'); } catch { /* history is best-effort */ }
  if (isHf) {
    const props = { ...sc.props, css: spec.css, html: spec.html, script: spec.script, qtier: rv.skipped ? 'unverified' : 'premium' };
    DB.updateScene(sc.id, { props, status: 'html', video_path: null, fp: { ...(sc.fp || {}), render: null } });
  } else {
    const props = { ...(sc.props || {}), __custom: { html: spec.html, css: spec.css, script: spec.script } };
    DB.updateScene(sc.id, { props, status: 'html', video_path: null, fp: { ...(sc.fp || {}), render: null } });
  }
  try { DB.snapshotTake(DB.getScene(sc.id), 'visual', { active: true }); } catch { /* best-effort */ }
  return { ok: true, tier: rv.skipped ? 'unverified' : 'premium' };
}
