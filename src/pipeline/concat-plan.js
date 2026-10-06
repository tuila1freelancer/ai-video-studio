// How much work does this concat actually need?
//
// Assembly used to be one shape: build a filter graph, re-encode the whole programme with
// `libx264 -crf 18 -preset medium`. That is minutes of encoding for an eleven-minute video, and
// it was paid in full even when the change was "turn the logo off" — which needs no video filter
// at all — or "swap the background music", which does not touch a single pixel.
//
// Everything that decides the final file is hashed into two halves. The VIDEO half covers the
// clips, the logo, the watermark, the burned subtitles, the transition plan, the frame size and
// the encoder; the AUDIO half covers the music bed, the SFX bed and the mix levels. Comparing
// each half against what produced the file already on disk picks the cheapest correct route:
//
//   skip    nothing moved                      → reuse the existing file
//   audio   only the audio half moved          → copy the video stream, re-encode audio
//   copy    no video filter is needed at all   → concat demuxer, copy the video stream
//   encode  anything else                      → the full graph, as before
//
// Every tier announces itself. A silent shortcut is how "why didn't my video update?" bugs are
// born, and this module exists to take shortcuts.
import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { m } from '../i18n/t.js';

const digest = (o) => createHash('sha1').update(JSON.stringify(o)).digest('hex').slice(0, 16);

/**
 * Config keys that change ONLY the final assembly — the join, not the clips.
 *
 * This list lives here, next to the fingerprint that consumes their effects, because it has one
 * job: to be complete. Every key on it means "editing this costs one concat instead of ninety-five
 * renders", and a key MISSING from it means the opposite of a wrong estimate — it means the change
 * queue reports "không có gì thay đổi" and the user cannot apply the edit at all.
 *
 * That is not hypothetical. `enableSubtitles` was absent, and it is what finalize checks before
 * burning captions (`config.subtitleLane === 'final' && config.enableSubtitles !== false`), so
 * turning subtitles OFF on a finished video was unreachable: the panel accepted it, the plan said
 * nothing had changed, and the captions stayed. `platformCovers` was absent the same way.
 *
 * The per-key `sub*` family is NOT here — it belongs to the clips or the join depending on
 * `subtitleLane`, which only planChanges knows how to ask.
 */
export const CONCAT_CONFIG_KEYS = [
  // branding, stamped onto the assembled programme
  'brandKit', 'brandKitOverride', 'logo', 'watermark', 'watermarkText',
  // the audio bed and how it is built
  'bgmPath', 'autoBgm', 'useDefaultBgm', 'autoSfx', 'soundDesign', 'bgmVol',
  // the picture the join itself makes
  'transitions', 'transitionStyle', 'masterFade', 'concatEncoder',
  // captions are a concat input on the final lane, and this is the switch that silences them
  'enableSubtitles',
  // deliverables made from the finished file
  'thumbnailAi', 'platformCovers',
];

/**
 * Identify clips by content, not just by path: a re-rendered scene keeps its filename in some
 * flows, and a stale-but-same-named clip would otherwise read as unchanged.
 */
export function clipStamp(paths) {
  return (paths || []).map((p) => {
    try {
      const st = statSync(p);
      return `${p}|${st.size}|${Math.round(st.mtimeMs)}`;
    } catch {
      return `${p}|missing`;
    }
  });
}

/**
 * @returns {{video:string, audio:string, all:string}}
 */
export function concatFingerprint({
  clips, size, frame, fps, transitions, logo, watermark, assText, masterFade, encoder,
  bgmPath, sfxPath, bgmVol,
}) {
  // The PHYSICAL frame the overlays are drawn on, folded into the two entries it can move and
  // nowhere else.
  //
  // It belongs in the hash because it is now an input to logoRect and to the watermark geometry:
  // every 4K video finished before that fix carries a stamp at half size in the middle of the
  // frame, and without this the re-join would read as "nothing changed" and hand the same wrong
  // file back. Folding it into `logo`/`wm` rather than adding a top-level key keeps the digest
  // byte-identical for the projects that stamp nothing at all — which is most of them, and none
  // of them have anything to re-encode.
  const px = frame ? [frame.w || 0, frame.h || 0] : null;
  const video = digest({
    clips: clipStamp(clips),
    size: [size?.w || 0, size?.h || 0],
    fps: fps || 0,
    tr: Array.isArray(transitions) ? transitions.map((t) => [t.type, +(t.dur || 0).toFixed(3)]) : !!transitions,
    logo: logo ? [logo.path, logo.cxPct, logo.cyPct, logo.wPct, logo.opacity, logo.size, logo.position, px] : null,
    wm: watermark ? [watermark.path || null, watermark.text || null, watermark.speed, watermark.opacity, watermark.wPct, watermark.hPct, watermark.marginPct, px] : null,
    // the ASS document itself, not its path — the file is rewritten every run
    ass: assText ? digest(assText) : null,
    fade: masterFade !== false,
    enc: encoder || 'quality',
  });
  // The music bed is keyed by path + size: an auto-generated bed lands at the same filename
  // every time, and its content is what matters.
  const stamp = (p) => {
    if (!p) return null;
    try { const st = statSync(p); return `${p}|${st.size}`; } catch { return `${p}|missing`; }
  };
  const audio = digest({
    clips: clipStamp(clips), // scene audio comes from the clips too
    bgm: stamp(bgmPath),
    sfx: stamp(sfxPath),
    vol: Number.isFinite(+bgmVol) ? +(+bgmVol).toFixed(3) : null,
  });
  return { video, audio, all: digest({ video, audio }) };
}

/**
 * Does the video stream need any filtering at all?
 *
 * A blend transition needs the xfade graph; a logo, watermark or burned subtitle needs an
 * overlay; the master fade-to-black needs a filter of its own. With none of them, the clips can
 * be joined by the concat demuxer and the video copied through untouched.
 */
export function needsVideoFilter({ logo, watermark, assText, transitions, masterFade }) {
  if (logo || watermark || assText) return true;
  if (masterFade !== false) return true;
  if (Array.isArray(transitions)) return transitions.some((t) => t && t.type !== 'cut');
  return !!transitions;
}

/**
 * @param {object} a
 * @param {{video:string,audio:string,all:string}} a.fp this run's fingerprint
 * @param {{video?:string,audio?:string,all?:string}|null} a.prev the one that made `prevPath`
 * @param {string|null} a.prevPath the existing final video, if any
 * @param {boolean} a.videoFilter from needsVideoFilter
 * @param {boolean} [a.allowSkip] false during the first finalize of a run the user asked for
 * @returns {{tier:'skip'|'audio'|'copy'|'encode', why:string}}
 */
export function planConcat({ fp, prev, prevPath, videoFilter, allowSkip = true }) {
  const havePrev = !!(prevPath && existsSync(prevPath));
  if (allowSkip && havePrev && prev?.all && prev.all === fp.all) {
    return { tier: 'skip', why: m('không có gì thay đổi so với bản đã xuất') };
  }
  if (havePrev && prev?.video && prev.video === fp.video) {
    return { tier: 'audio', why: m('chỉ phần âm thanh thay đổi — giữ nguyên hình') };
  }
  if (!videoFilter) {
    return { tier: 'copy', why: m('không cần filter hình nào — ghép thẳng, không encode lại') };
  }
  return { tier: 'encode', why: m('cần dựng lại hình') };
}

/** One line for the user's log, per tier. Built per call — the interface language can change. */
export function tierLog(tier) {
  return {
    skip: m('⏭️ Không có gì thay đổi — giữ nguyên video đã xuất'),
    audio: m('🔊 Chỉ ghép lại âm thanh — hình giữ nguyên, không encode lại'),
    copy: m('⚡ Ghép nhanh — không encode lại hình'),
    encode: m('🎞 Dựng lại toàn bộ hình'),
  }[tier];
}
