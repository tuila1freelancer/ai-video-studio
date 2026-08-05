// Render entry used by POST /render (mode: all | scenes | concat) — re-renders scene clips
// (optionally a subset) then, unless mode='scenes', re-finalizes the whole video.
import { join } from 'node:path';
import * as DB from '../db/index.js';
import { hub } from '../ws/hub.js';
import { ratioToSize } from '../util/util.js';
import { renderAnimationScene } from '../animation/index.js';
import { clearStop, checkStop } from './stop.js';
import { step, op, progressPlan } from './progress.js';
import { jlog } from './journal.js';
import { mapPool } from './helpers.js';
import { finalize } from './stages/finalize.js';

export async function renderOnly(projectId, { mode = 'all', sceneIds = [] }) {
  clearStop(projectId);
  const project = DB.getProject(projectId);
  if (!project) throw new Error('project not found');
  const config = project.config || {};
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
    if (renderPass) {
      step(projectId, 'b6', 'running', 'Render');
      const rC = parseInt(config.renderConcurrency || 3, 10);
      const pp = progressPlan(allScenes, config);
      await mapPool(scenes, rC, async (sc) => {
        checkStop(projectId);
        op(projectId, `🎬 Render cảnh ${sc.idx + 1}`);
        const r = await renderAnimationScene(sc, project, config, {
          dir: join(dir, 'render'), progressStart: pp.offsets[sc.idx] || 0, progressTotal: pp.total, total: allScenes.length,
        });
        const { path, duration, preview } = r;
        DB.updateScene(sc.id, { video_path: path, duration, status: 'rendered', ...(preview ? { image_path: preview } : {}) });
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
    if (mode !== 'scenes' && stillUnvoiced) {
      op(projectId, '⏭️ Bỏ qua ghép — còn cảnh chưa có lồng tiếng; hoàn tất lồng tiếng rồi ghép sau');
    } else if (mode !== 'scenes') {
      await finalize(projectId, { dir, size, config });
    }
    // A render during a hold (scene gate 'scenes' / review gate 'review') must not destroy
    // the hold: 'done' here would let the owner think the video finished prematurely.
    const endStatus = ['scenes', 'review'].includes(project.status) ? project.status
      : (mode !== 'scenes' && stillUnvoiced ? 'paused' : 'done');
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
      DB.updateProject(projectId, { status: 'paused' }); hub.toProject(projectId, { type: 'status', status: 'paused' });
      jlog(projectId, { kind: 'status', msg: '⏹ Đã dừng render theo yêu cầu' });
    } else {
      DB.updateProject(projectId, { status: 'error', error: e.message }); hub.toProject(projectId, { type: 'error', msg: e.message });
      jlog(projectId, { kind: 'error', level: 'error', msg: `⛔ Render lỗi: ${e.message}` });
    }
  } finally { clearStop(projectId); }
}
