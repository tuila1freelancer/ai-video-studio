// What would this edit actually cost?
//
// The app already knew. `renderFingerprint` and `ttsFingerprint` can say, exactly, which scenes a
// config change invalidates — they just were never asked before the owner committed to it. So
// changing a subtitle font either finished in a minute or took an hour, and the only way to find
// out which was to start it and watch.
//
// This asks first, and answers in the shape the owner thinks in: how many scenes, how long, and
// whether the whole thing is just a re-join.
import * as DB from '../../db/index.js';
import { ttsFingerprint, renderCurrent, fpCurrent } from '../../pipeline/fingerprint.js';
import { aiSettingsFor } from '../../core/config.js';
import { resolveConcatLogo } from '../../media/logo-overlay.js';
import { CONCAT_CONFIG_KEYS } from '../../pipeline/concat-plan.js';
import { ratioToSize } from '../../util/util.js';

import { m, tp } from '../../i18n/t.js';
// The list lives beside the fingerprint that consumes their effects (pipeline/concat-plan.js), so
// there is ONE place to add a key when a new final-stage setting appears. The copy that used to
// live here had already drifted: it was missing `enableSubtitles` and `platformCovers`.
const SUB_KEY = /^sub(?!titleLane$)/;
/** The name the owner actually sees for a config key, so the plan does not read like a diff.
 *  Resolved per call, never at import — the interface language can change while the app runs. */
const keyLabel = (k) => ({
  transitions: m('hiệu ứng chuyển cảnh'), transitionStyle: m('kiểu chuyển cảnh'),
  masterFade: m('mờ đầu/cuối video'), concatEncoder: m('tốc độ encode'),
  bgmPath: m('nhạc nền'), autoBgm: m('nhạc nền tự động'), useDefaultBgm: m('nhạc nền mặc định'),
  autoSfx: m('hiệu ứng âm thanh'), soundDesign: m('thiết kế âm thanh AI'), bgmVol: m('âm lượng nhạc nền'),
  enableSubtitles: m('bật/tắt phụ đề'), watermarkText: m('chữ watermark'),
  thumbnailAi: m('thumbnail AI'), platformCovers: m('ảnh bìa các nền tảng'),
  brandKitOverride: m('nhận diện riêng cho video này'),
})[k] || k;

/** Defaults used until a project has measured its own. Deliberately round, and labelled. */
const FALLBACK = { render: 22, tts: 6, concat: 90 };

function stat(project, key) {
  const s = project.metadata?.renderStats?.[key];
  return Number.isFinite(+s) && +s > 0 ? +s : null;
}

function changedKeys(cur, next, pick) {
  const keys = new Set([...Object.keys(cur || {}), ...Object.keys(next || {})].filter(pick));
  return [...keys].filter((k) => JSON.stringify(cur?.[k]) !== JSON.stringify(next?.[k]));
}

/**
 * @param {string} projectId
 * @param {object} nextConfig the panel's proposed config (a full config object, as gatherConfig
 *   produces — merged over the saved one so an omitted key means "unchanged", never "cleared")
 * @returns {{items:Array, totalSec:number, measured:boolean, concatOnly:boolean, mode:string}}
 */
export function planChanges(projectId, nextConfig = {}) {
  const project = DB.getProject(projectId);
  if (!project) throw new Error('project not found');
  const cur = project.config || {};
  const next = { ...cur, ...nextConfig };
  const scenes = DB.getScenes(projectId);
  const channel = DB.channelOf(projectId);
  const ai = aiSettingsFor(channel);

  // Which scenes stop matching their own stamp? Only artefacts that EXIST can go stale; a scene
  // that was never voiced is not "invalidated by this edit", it is simply not done yet.
  const ttsStale = scenes.filter((s) => s.audio_path
    && !fpCurrent(s, 'tts', ttsFingerprint(s, { config: next, channel, ai })));
  // renderCurrent, not the raw digest: a scene stamped under an older digest DEFINITION is
  // not stale, and quoting it as work to be done would be the same lie in the other direction.
  // `cur` is the bridge between the two digest spaces: a clip stamped before the concat-only
  // brand keys were dropped is described by the SAVED config under the old rules, so the real
  // question is whether the proposed config differs from that one under the new rules.
  const renderStale = scenes.filter((s) => s.video_path && !renderCurrent(s, { config: next, project }, cur).ok);

  const size = ratioToSize(project.aspect_ratio);
  // What the video on disk actually contains vs what the next join would stamp.
  //
  // Both halves used to read `project.config`, and both were wrong about branding. finalize
  // resolves brand identity LIVE from the channel (unless the project overrode it), so a logo
  // edited in the Brand Kit never appears in either snapshot — and the plan answered "không có
  // gì thay đổi" at the exact moment the owner most needed to be told there was work to do.
  //
  // BEFORE is the config of the last non-variant export, which finalize records AFTER resolving
  // the live brand kit and the concat logo: it is literally what was assembled. A variant is a
  // second deliverable from the same clips, so it can never describe the main video.
  const lastExport = (DB.listRenders(projectId) || []).find((r) => !r.variant)?.config || cur;
  const liveBrand = next.brandKitOverride ? null : (channel?.config?.brandKit || null);
  const after = liveBrand ? { ...next, brandKit: liveBrand } : next;
  const logoBefore = resolveConcatLogo(lastExport, size);
  const logoAfter = resolveConcatLogo(after, size);
  const logoMoved = JSON.stringify(logoBefore) !== JSON.stringify(logoAfter);
  const wmBefore = lastExport.brandKit?.watermark || null;
  const wmAfter = after.brandKit?.watermark || null;
  const wmMoved = JSON.stringify(wmBefore) !== JSON.stringify(wmAfter);
  const concatChanged = changedKeys(cur, next, (k) => CONCAT_CONFIG_KEYS.includes(k));
  // On the final lane the subtitle settings are a CONCAT input, so they belong on this side of
  // the ledger — that reclassification is the entire point of the lane.
  const finalLane = next.subtitleLane === 'final';
  const subMoved = finalLane ? changedKeys(cur, next, (k) => SUB_KEY.test(k)) : [];
  const laneMoved = cur.subtitleLane !== next.subtitleLane;

  const perRender = stat(project, 'render') ?? FALLBACK.render;
  const perTts = stat(project, 'tts') ?? FALLBACK.tts;
  const concatSec = stat(project, 'concat') ?? FALLBACK.concat;
  const measured = !!(stat(project, 'render') || stat(project, 'concat'));

  const items = [];
  if (ttsStale.length) {
    items.push({
      kind: 'tts',
      label: tp`Lồng tiếng lại ${ttsStale.length} cảnh`,
      detail: m('lời thoại hoặc giọng đọc đã đổi — bước này TỐN TIỀN API'),
      scenes: ttsStale.length,
      seconds: Math.round(ttsStale.length * perTts),
      costly: true,
    });
  }
  if (renderStale.length) {
    items.push({
      kind: 'render',
      label: tp`Render lại ${renderStale.length} cảnh`,
      detail: laneMoved && finalLane
        ? m('chuyển phụ đề sang bước cuối — phải dựng lại clip KHÔNG có phụ đề (chỉ một lần duy nhất)')
        : m('thiết lập ảnh hưởng tới nội dung từng cảnh'),
      scenes: renderStale.length,
      seconds: Math.round(renderStale.length * perRender),
    });
  }
  const joinReasons = [
    logoMoved && (logoAfter ? m('đóng dấu logo') : m('bỏ logo')),
    wmMoved && (wmAfter?.enabled ? m('đổi watermark') : m('bỏ watermark')),
    // …in the owner's words. `đổi concatEncoder` is a diff line, not a reason.
    ...concatChanged.filter((k) => k !== 'logo' && k !== 'brandKit').map((k) => tp`đổi ${keyLabel(k)}`),
    subMoved.length && tp`đổi phụ đề (${subMoved.length} thiết lập, in ở bước cuối)`,
    (ttsStale.length || renderStale.length) && m('ghép lại sau khi dựng cảnh'),
  ].filter(Boolean);
  if (joinReasons.length) {
    items.push({
      kind: 'concat',
      label: m('Ghép lại video'),
      detail: joinReasons.join(' · '),
      seconds: concatSec,
    });
  }

  const concatOnly = items.length > 0 && items.every((i) => i.kind === 'concat');
  return {
    items,
    totalSec: items.reduce((a, i) => a + i.seconds, 0),
    measured,
    concatOnly,
    // what to hand POST /render once the owner says yes
    mode: renderStale.length || ttsStale.length ? 'all' : 'concat',
    sceneIds: renderStale.map((s) => s.id),
    // the master fade is the one thing standing between a concat-only edit and a stream copy
    fadeBlocksFastJoin: concatOnly && next.masterFade !== false,
  };
}
