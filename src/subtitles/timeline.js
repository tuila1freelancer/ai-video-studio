// Where each scene actually starts in the finished video, and the whole-video cue list built
// from that.
//
// This exists because "cumulative scene duration" is NOT the timeline. Every crossfade overlaps
// two clips, so each blend steals its own duration back out of the running total — and the steal
// is clamped per join (`min(planned, clip-0.2, elapsed-0.2)`), so it is not even a constant.
// Guessing the offsets makes subtitles drift a little at first and badly by the end; the app has
// been shipping exactly that guess in the whole-video SRT export (`TD * ordinal`).
//
// So the offsets are computed ONCE, by the same arithmetic the concat graph uses, and everything
// downstream reads them: the burned captions, the SRT export, and the player's click-to-scene
// jump. `concatScenes` calls `planOffsets` rather than repeating the loop, which is the only way
// the two can be guaranteed to agree.
import { rechunkCues } from './chunk.js';

/** Default crossfade length — mirrors `TD` in pipeline/render.js. */
export const XFADE_DUR = 0.5;

/**
 * Shift cue and word times by `offset` seconds.
 * (Lives here rather than in pipeline/srt.js so the subtitle modules keep their no-upward-imports
 * property; srt.js re-exports it for the existing callers.)
 */
export function shiftCues(cues, offset) {
  return (cues || []).map((c) => ({
    start: c.start + offset,
    end: c.end + offset,
    text: c.text,
    words: (c.words || []).map((w) => ({ ...w, start: w.start + offset, end: w.end + offset })),
  }));
}

/**
 * @param {number[]} durations per-clip durations, in program order
 * @param {Array|null} plan transition plan as concatScenes resolved it — `null` for the
 *   concat-demuxer path (no overlaps at all), which is also what a >24-clip video gets
 * @returns {{starts:number[], total:number}} each clip's start on the final timeline
 */
export function planOffsets(durations, plan) {
  const durs = (durations || []).map((d) => Math.max(0, +d || 0));
  if (!durs.length) return { starts: [], total: 0 };
  const starts = [0];
  let acc = durs[0];
  for (let i = 1; i < durs.length; i++) {
    const tr = (Array.isArray(plan) ? plan[i - 1] : null) || { type: 'cut', dur: 0 };
    if (tr.type === 'cut') {
      starts.push(acc);
      acc += durs[i];
    } else {
      // identical clamp to the xfade branch of concatScenes — a blend can never eat more than
      // the incoming clip or the material already assembled
      const d = Math.min(tr.dur || XFADE_DUR, Math.max(0.2, durs[i] - 0.2), Math.max(0.2, acc - 0.2));
      starts.push(acc - d);
      acc += durs[i] - d;
    }
  }
  return { starts, total: acc };
}

/** Display cues for one scene — the same re-chunking the DOM lane applies. */
export function sceneCues(scene, config = {}) {
  if (config.enableSubtitles === false) return [];
  return rechunkCues(scene?.srt_json || [], {
    chunk: config.subtitleChunk,
    wordsPerCue: config.subtitleWordsPerCue,
    text: scene?.voice_text,
    lang: config.subtitleLang || config.language,
  });
}

/**
 * Whole-video cue list, in program time.
 *
 * Cues are clamped to their own scene's slot. Without that, a caption running to the end of a
 * clip would still be on screen after the next clip's first caption appeared — libass stacks
 * simultaneous lines, so the video would briefly show two rows of subtitles at every crossfade.
 * Ending the outgoing caption at the cut instead is both correct and what the DOM lane does
 * (each scene page only ever draws its own cues).
 *
 * @param {Array} scenes scene rows in program order, aligned with `starts`
 * @param {number[]} starts from planOffsets
 * @param {object} config project config (subtitle chunking + on/off)
 * @param {number} total program duration, used to clamp the final scene
 */
export function programCues(scenes, starts, config = {}, total = Infinity) {
  const out = [];
  (scenes || []).forEach((sc, i) => {
    const start = Math.max(0, starts[i] ?? 0);
    const limit = Math.min(i + 1 < starts.length ? starts[i + 1] : total, total);
    for (const cue of shiftCues(sceneCues(sc, config), start)) {
      const end = Math.min(cue.end, limit);
      if (!(end > cue.start)) continue;
      out.push(end === cue.end ? cue : {
        ...cue,
        end,
        words: (cue.words || []).filter((w) => w.start < end).map((w) => (w.end > end ? { ...w, end } : w)),
      });
    }
  });
  return out.sort((a, b) => a.start - b.start);
}

/**
 * The compact timeline stored on the project (`metadata.timeline`) so the UI can map a moment in
 * the finished video back to the scene that produced it without re-deriving any of this.
 */
export function buildTimeline(scenes, starts, durations) {
  return (scenes || []).map((sc, i) => ({
    sceneId: sc.id,
    idx: sc.idx,
    start: +(starts[i] ?? 0).toFixed(3),
    end: +((starts[i] ?? 0) + (durations[i] ?? 0)).toFixed(3),
  }));
}
