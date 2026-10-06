// The soundtrack: an LLM sound-design plan when one is usable, else the deterministic BGM + SFX bed.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import * as DB from '../../db/index.js';
import { logger } from '../../util/log.js';
import { makeAmbientBed, makeWhoosh, makeSfxBed } from '../../media/ffmpeg.js';
import { planSoundDesign, usableLibrary } from '../../audio/sound-design.js';
import { op } from '../progress.js';
import { resolveLang } from '../../util/lang.js';
import { m, tp } from '../../i18n/t.js';

/**
 * @param {{projectId:string, project:object, config:object, scenes:object[], renderDir:string, expectDur:number, lossBeforeScene:(k:number)=>number}} args
 * @returns {Promise<{sdPlan:object|null, bgmPath:string|null, sfxPath:string|null}>}
 */
export async function buildSoundtrack({ projectId, project, config, scenes, renderDir, expectDur, lossBeforeScene }) {
  // LLM sound design (reference-app parity, toggle config.soundDesign): ONE call picks a
  // BGM from the user's library and places SFX by the cue sheet. Anything short of a
  // valid plan (offline, empty library, bad reply) → sdPlan stays null and the
  // deterministic legacy audio below ships unchanged.
  let sdPlan = null;
  if (config.soundDesign !== false && expectDur > 0) {
    try {
      const ai = DB.aiSettings();
      sdPlan = await planSoundDesign({
        scenes, lossBeforeScene,
        bgm: usableLibrary(DB.listLibrary('bgm')), sfx: usableLibrary(DB.listLibrary('sfx')),
        total: expectDur, title: project.title || project.topic || '', lang: resolveLang(config, scenes),
        llm: ai.llm, onLog: (m) => op(projectId, `🎼 ${m}`),
      });
    } catch (e) { logger.warn(tp`sound design: ${e.message} — dùng audio mặc định`, { projectId }); sdPlan = null; }
  }

  // BGM: LLM plan → user-selected file → auto ambient bed (cached per project)
  let bgmPath = null;
  if (sdPlan?.bgmPath && existsSync(sdPlan.bgmPath)) bgmPath = sdPlan.bgmPath;
  else if (config.bgmPath && existsSync(config.bgmPath)) bgmPath = config.bgmPath;
  else if (config.autoBgm !== false) {
    // The synthetic bed is −41 dBFS of ambience; under the 0.22 mix and the sidechain it lands
    // around −63 dB in the gaps, which is not music, it is nothing. Real tracks are sitting in
    // the library, so reach for one before falling back to noise. The pick is deterministic
    // (project id → index) because bgmPath feeds the concat fingerprint: a random choice would
    // re-encode the whole video on every finalize.
    const lib = usableLibrary(DB.listLibrary('bgm'));
    const pick = lib.length ? lib[pickLibraryBgm(projectId, lib.length)] : null;
    if (pick) {
      bgmPath = pick.path;
      op(projectId, tp`🎵 Nhạc nền: ${pick.name}`);
    } else {
      op(projectId, m('🎵 Thư viện chưa có nhạc nền — dựng nền môi trường'));
      bgmPath = join(renderDir, 'bgm_bed.m4a');
      if (!existsSync(bgmPath)) { try { await makeAmbientBed(bgmPath, 45); } catch { bgmPath = null; } }
    }
  }

  // SFX bed: LLM-planned events (when present) + the user's per-scene picks from Scene
  // Studio (scene.props.audio = {sfx, sfxGain, sfxAt} — an explicit pick always plays) +
  // auto whooshes on chapter transitions (autoSfx gate; skipped when the LLM plan owns
  // emphasis). Any failure just skips SFX.
  let sfxPath = null;
  if (expectDur > 0) {
    let t = 0; const events = [];
    scenes.forEach((s, k) => {
      // event times land on the FINAL timeline: material time minus the xfade overlap
      // consumed by every transition before this scene's clip
      const start = Math.max(0, t - lossBeforeScene(k));
      if (!sdPlan && config.autoSfx !== false && s.template === 'chapter-break' && start > 0.5) events.push({ at: start });
      const au = s.props?.audio;
      if (au?.sfx && existsSync(au.sfx)) {
        events.push({ at: Math.max(0, start + (Number.isFinite(+au.sfxAt) ? +au.sfxAt : 0)), src: au.sfx, gain: +au.sfxGain || 0 });
      }
      t += s.duration || 0;
    });
    for (const e of sdPlan?.events || []) events.push(e);
    if (events.length) {
      try {
        op(projectId, tp`🔊 Đặt ${events.length} SFX…`);
        const whoosh = join(renderDir, 'sfx_whoosh.m4a');
        if (events.some((e) => !e.src) && !existsSync(whoosh)) await makeWhoosh(whoosh);
        sfxPath = await makeSfxBed(join(renderDir, 'sfx_bed.m4a'), { events, whooshPath: whoosh, total: expectDur });
      } catch (e) { logger.warn(tp`sfx bed: ${e.message} — bỏ SFX`, { projectId }); sfxPath = null; }
    }
  }
  return { sdPlan, bgmPath, sfxPath };
}

/** Stable library index for a project — same project, same track, every finalize. */
function pickLibraryBgm(projectId, n) {
  let h = 0;
  for (const ch of String(projectId)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % n;
}
