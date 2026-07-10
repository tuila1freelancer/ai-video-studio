// Render entry used by POST /render (mode: all | scenes | concat) — re-renders scene clips
// (optionally a subset) then, unless mode='scenes', re-finalizes the whole video.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import * as DB from '../db/index.js';
import { hub } from '../ws/hub.js';
import { logger } from '../util/log.js';
import { ratioToSize } from '../util/util.js';
import { renderAnimationScene } from '../animation/index.js';
import { renderScene } from './render.js';
import { buildSceneBackground } from './visuals.js';
import { clearStop, checkStop } from './stop.js';
import { step, op, progressPlan } from './progress.js';
import { mapPool, visualOpts, subtitleStyleFrom } from './helpers.js';
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
  try {
    step(projectId, 'b6', 'running', 'Render');
    const visualMode = config.visualMode || 'animation';
    const allScenes = DB.getScenes(projectId);
    let scenes = allScenes;
    if (mode === 'scenes' && sceneIds.length) scenes = scenes.filter((s) => sceneIds.includes(s.id));
    const subtitleStyle = subtitleStyleFrom(config);
    const animLike = visualMode !== 'image';
    const rC = animLike
      ? parseInt(config.renderConcurrency || 3, 10)
      : (config.parallelRender ? parseInt(config.renderConcurrency || 2, 10) : 1);
    const pp = progressPlan(allScenes, config);
    await mapPool(scenes, rC, async (sc) => {
      checkStop(projectId);
      op(projectId, `🎬 Render cảnh ${sc.idx + 1}`);
      let path, duration, preview = null;
      if (animLike) {
        const r = await renderAnimationScene(sc, project, config, {
          dir: join(dir, 'render'), progressStart: pp.offsets[sc.idx] || 0, progressTotal: pp.total, total: allScenes.length,
        });
        path = r.path; duration = r.duration; preview = r.preview;
      } else {
        if (!sc.image_path || !existsSync(sc.image_path)) {
          sc.image_path = await buildSceneBackground(sc, project, size, visualOpts(config, dir));
          DB.updateScene(sc.id, { image_path: sc.image_path });
        }
        const r = await renderScene(sc, project, { dir: join(dir, 'render'), size, subtitleStyle, renderMode: config.renderMode });
        path = r.path; duration = r.duration;
      }
      DB.updateScene(sc.id, { video_path: path, duration, status: 'rendered', ...(preview ? { image_path: preview } : {}) });
      hub.toProject(projectId, { type: 'scene', sceneId: sc.id, idx: sc.idx, status: 'rendered', video: `/api/file?path=${encodeURIComponent(path)}`, ...(preview ? { image: `/api/file?path=${encodeURIComponent(preview)}` } : {}) });
    });
    step(projectId, 'b6', 'done');
    if (mode !== 'scenes') await finalize(projectId, { dir, size, config });
    DB.updateProject(projectId, { status: 'done' });
    const fin = DB.getProject(projectId);
    hub.toProject(projectId, { type: 'done', video: fin.video_path ? `/api/file?path=${encodeURIComponent(fin.video_path)}` : null,
      thumb: fin.thumb_path ? `/api/file?path=${encodeURIComponent(fin.thumb_path)}` : null });
  } catch (e) {
    if (e.stopped) { DB.updateProject(projectId, { status: 'paused' }); hub.toProject(projectId, { type: 'status', status: 'paused' }); }
    else { DB.updateProject(projectId, { status: 'error', error: e.message }); hub.toProject(projectId, { type: 'error', msg: e.message }); }
  } finally { clearStop(projectId); }
}
