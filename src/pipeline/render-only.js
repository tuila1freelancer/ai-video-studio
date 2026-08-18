// Render entry used by POST /render (mode: all | scenes | concat) — re-renders scene clips
// (optionally a subset) then, unless mode='scenes', re-finalizes the whole video.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import * as DB from '../db/index.js';
import { renderCurrent, renderFingerprint, ttsFingerprint, fpCurrent, fpStamp, stampRendered } from './fingerprint.js';
import { aiSettingsFor } from '../core/config.js';
import { hub } from '../ws/hub.js';
import { ratioToSize } from '../util/util.js';
import { renderAnimationScene } from '../animation/index.js';
import { clearStop, checkStop } from './stop.js';
import { step, op, progressPlan } from './progress.js';
import { jlog } from './journal.js';
import { mapPool } from './helpers.js';
import { finalize } from './stages/finalize.js';

export async function renderOnly(projectId, { mode = 'all', sceneIds = [], configOverrides = null, variantName = null, alsoJoin = false }) {
  clearStop(projectId);
  const project = DB.getProject(projectId);
  if (!project) throw new Error('project not found');
  // A variant export layers settings over the project's config for THIS run only — it is a
  // second deliverable from the same clips (no logo, no music, different music), not a change of
  // mind about the video, so nothing is written back.
  const config = configOverrides ? { ...(project.config || {}), ...configOverrides } : (project.config || {});
  if (configOverrides) op(projectId, `🎛 Xuất bản biến thể — ${Object.keys(configOverrides).join(', ')}`);
  const size = ratioToSize(project.aspect_ratio);
  const dir = DB.projectDirFor(projectId);
  DB.updateProject(projectId, { status: 'running' });
  hub.toProject(projectId, { type: 'status', status: 'running' });
  jlog(projectId, { kind: 'status', msg: `🎬 Bắt đầu render lại (${mode === 'scenes' ? `${sceneIds.length} cảnh đã chọn` : mode === 'concat' ? 'ghép lại' : 'toàn bộ'})` });
  try {
    const allScenes = DB.getScenes(projectId);
    let scenes = allScenes;
    // 'concat' means CONCAT ONLY — it re-uses the clips already on disk. This used to fall
    // through to the full mapPool below (the subset filter only ever applied to 'scenes'), so
    // "ghép lại" silently re-rendered every clip in the project: on a 95-scene video, ~95
    // needless renders to join files that were already correct. finalize() still repairs any
    // scene missing a clip (its own missing-clip pass), so nothing is skipped by doing less here.
    const renderPass = mode !== 'concat';
    if (mode === 'scenes' && sceneIds.length) scenes = scenes.filter((s) => sceneIds.includes(s.id));
    // `alsoJoin`, not `join` — this module imports `join` from node:path, and a parameter of that
    // name shadows it inside the whole function. The render loop then calls a boolean.
    // A subset normally stops at the clips: picking scenes by hand means inspecting them next.
    // `join` is for the caller that already knows the whole list it wants and wants the video at
    // the end of it — two queued jobs would give the owner two progress bars and a window in
    // between where the video on disk is a mix of repaired and unrepaired clips.
    const doJoin = mode !== 'scenes' || alsoJoin;
    // Scenes-first order: an unvoiced scene only carries an ESTIMATED duration — rendering
    // it would bake a silent clip cut to the estimate, which the real TTS then invalidates.
    // Voice first (continue past the scene gate or regen-voice), render after.
    const unvoiced = renderPass ? scenes.filter((s) => !s.audio_path) : [];
    if (unvoiced.length) {
      scenes = scenes.filter((s) => s.audio_path);
      op(projectId, `⏭️ Bỏ qua ${unvoiced.length} cảnh chưa có lồng tiếng — hãy lồng tiếng trước rồi render`);
      if (!scenes.length) {
        // Nothing renderable — exit CLEANLY (before any b6 step event, so the progress bar
        // never jumps) and restore the entry status: flipping a scene-gate hold to 'error'
        // would read as a crashed run in the UI. Only a RENDER pass can be empty this way;
        // a concat of a fully-voiced project with clips on disk is perfectly valid work.
        op(projectId, '🎙 Chưa cảnh nào có lồng tiếng — bấm "Lồng tiếng & Render" (hoặc tạo giọng từng cảnh) trước');
        const back = project.status === 'running' ? 'paused' : project.status;
        DB.updateProject(projectId, { status: back });
        hub.toProject(projectId, { type: 'status', status: back });
        return;
      }
    }
    // Render only what is no longer current.
    //
    // "Render + Ghép" rendered every clip in the project, every time. On a 46-scene 4K video that
    // is most of an hour to change one scene — and the app already knew better: `renderCurrent`
    // is the same predicate the pipeline's own resume uses, and finalize uses it again to decide
    // which clips to repair before burning captions. This path simply never asked.
    //
    // Two things make a clip stale, and they are exactly the two the owner named:
    //   voice — both re-voice paths (stages/tts.js, regen.js) already NULL `video_path` with the
    //           comment "the clip carries the old voice", so a re-voiced scene has no clip to keep
    //   HTML  — a new spec/template/props moves `renderFingerprint`, which is what renderCurrent
    //           compares; a config key that shapes the picture moves it too
    // So no new stamp is needed: "no clip on disk" OR "fingerprint moved" IS the answer.
    //
    // An explicitly SELECTED subset (mode 'scenes') stays unconditional. Picking a scene by hand
    // is an instruction, not a question, and it is also the escape hatch when a clip is wrong in
    // a way no hash can see.
    let skipped = 0;
    if (renderPass && mode !== 'scenes') {
      const clipCfg = project.config || config; // a variant's overlay never described the clips
      const fresh = [];
      for (const s of scenes) {
        if (!(s.video_path && existsSync(s.video_path))) { fresh.push(s); continue; }
        const cur = renderCurrent(s, { config: clipCfg, project }, clipCfg);
        if (!cur.ok) { fresh.push(s); continue; }
        // Stamped under an older digest DEFINITION: the clip is fine, our idea of the hash moved.
        // Carry it forward so this costs one comparison rather than one per run, forever.
        if (cur.migrate) DB.updateScene(s.id, { fp: fpStamp(s, 'render', cur.want) });
        skipped++;
      }
      scenes = fresh;
      op(projectId, skipped
        ? `♻️ ${scenes.length}/${skipped + scenes.length} cảnh cần dựng lại — giữ nguyên ${skipped} cảnh không đổi`
        : `♻️ Tất cả ${scenes.length} cảnh đều cần dựng lại`);
      // "Render + Ghép" does not run TTS. A scene whose LINE was edited but never re-voiced would
      // therefore be skipped here and sound unchanged in the finished video — correctly, since its
      // clip still matches the audio on disk, but silently. Say it, or the owner reads a no-op as
      // a bug.
      const channel = DB.channelOf(projectId);
      const ai = aiSettingsFor(channel);
      const unvoicedEdits = allScenes.filter((s) => s.audio_path
        && !fpCurrent(s, 'tts', ttsFingerprint(s, { config, channel, ai })));
      if (unvoicedEdits.length) {
        op(projectId, `⚠️ ${unvoicedEdits.length} cảnh có lời thoại/giọng đã đổi nhưng CHƯA thu âm lại — bước này không tự lồng tiếng, hãy dùng "Voice đã chọn"`);
      }
    }
    if (renderPass && scenes.length) {
      step(projectId, 'b6', 'running', 'Render');
      const rC = parseInt(config.renderConcurrency || 3, 10);
      const pp = progressPlan(allScenes, config);
      await mapPool(scenes, rC, async (sc) => {
        checkStop(projectId);
        op(projectId, `🎬 Render cảnh ${sc.idx + 1}`);
        const r = await renderAnimationScene(sc, project, config, {
          dir: join(dir, 'render'), progressStart: pp.offsets[sc.idx] || 0, progressTotal: pp.total, total: allScenes.length,
          onLog: (s) => op(projectId, `cảnh ${sc.idx + 1}: ${s}`),
        });
        const { path, duration, preview } = r;
        // STAMP the clip. Without this the fresh file keeps the OLD fingerprint, so the skip above
        // would find the same scene stale on every single run and the incremental pass would never
        // converge — it would just re-render everything with extra steps. finalize's repair pass
        // learned this the same way and carries the same note.
        DB.updateScene(sc.id, {
          video_path: path, duration, status: 'rendered', ...(preview ? { image_path: preview } : {}),
          fp: stampRendered(DB.getScene(sc.id), renderFingerprint(sc, { config: project.config || config, project })),
        });
        hub.toProject(projectId, { type: 'scene', sceneId: sc.id, idx: sc.idx, status: 'rendered', video: `/api/file?path=${encodeURIComponent(path)}`, ...(preview ? { image: `/api/file?path=${encodeURIComponent(preview)}` } : {}) });
      }, { pool: 'render' }); // same process-wide bound as pipeline renders
      step(projectId, 'b6', 'done');
    } else {
      op(projectId, `🔗 Ghép lại từ ${allScenes.filter((s) => s.video_path).length} clip đã có — không render lại`);
    }
    // finalize's missing-clip repair renders EVERY clip-less scene — including unvoiced
    // ones, as silent clips cut to their estimate — so concat is only allowed once every
    // scene carries a real voice. Otherwise a partially-voiced gate hold would ship a
    // half-silent "final" video.
    const stillUnvoiced = DB.getScenes(projectId).some((s) => !s.audio_path);
    if (doJoin && stillUnvoiced) {
      op(projectId, '⏭️ Bỏ qua ghép — còn cảnh chưa có lồng tiếng; hoàn tất lồng tiếng rồi ghép sau');
    } else if (doJoin) {
      // mode:'concat' skips the scene loop above entirely, so without this the "ghép lại" path
      // reached finalize without ever having asked whether the owner still wanted it.
      checkStop(projectId);
      await finalize(projectId, { dir, size, config, variantName });
    }
    checkStop(projectId);
    // A render during a hold (scene gate 'scenes' / review gate 'review') must not destroy
    // the hold: 'done' here would let the owner think the video finished prematurely.
    const endStatus = ['scenes', 'review'].includes(project.status) ? project.status
      : (doJoin && stillUnvoiced ? 'paused' : 'done');
    DB.updateProject(projectId, { status: endStatus });
    if (endStatus !== 'done') {
      hub.toProject(projectId, { type: 'status', status: endStatus });
      jlog(projectId, { kind: 'status', msg: `✓ Render xong — trạng thái: ${endStatus}` });
    } else {
      const fin = DB.getProject(projectId);
      hub.toProject(projectId, { type: 'done', video: fin.video_path ? `/api/file?path=${encodeURIComponent(fin.video_path)}` : null,
        thumb: fin.thumb_path ? `/api/file?path=${encodeURIComponent(fin.thumb_path)}` : null });
      jlog(projectId, { kind: 'done', level: 'success', msg: '🎉 Render + ghép hoàn tất' });
    }
  } catch (e) {
    if (e.stopped) {
      DB.updateProject(projectId, { status: 'paused' });
      DB.clearStopRequest(projectId); // honoured — a later start must not be cancelled at boot
      hub.toProject(projectId, { type: 'status', status: 'paused' });
      jlog(projectId, { kind: 'status', msg: '⏹ Đã dừng render theo yêu cầu' });
    } else {
      DB.updateProject(projectId, { status: 'error', error: e.message }); hub.toProject(projectId, { type: 'error', msg: e.message });
      jlog(projectId, { kind: 'error', level: 'error', msg: `⛔ Render lỗi: ${e.message}` });
    }
  } finally { clearStop(projectId); }
}
