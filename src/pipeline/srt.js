// Subtitle file builders: SRT (plain text) + cue time-shifting for the whole-video export.
//
// The ASS builder is back (src/subtitles/ass.js), this time for the FINAL-PASS lane rather than
// the deleted Ken-Burns renderer: captions burned once onto the assembled program so that
// editing them costs a concat instead of a re-render per scene.
//
// `shiftCues` moved to src/subtitles/timeline.js, next to the offset arithmetic it is always
// used with — shifting cues by a guessed offset was the bug that module exists to prevent. It is
// re-exported here so existing importers keep working.
export { shiftCues } from '../subtitles/timeline.js';

function pad(n, l = 2) { return String(Math.floor(n)).padStart(l, '0'); }
function srtTime(t) {
  const ms = Math.round((t % 1) * 1000);
  const s = Math.floor(t) % 60, m = Math.floor(t / 60) % 60, h = Math.floor(t / 3600);
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

export function buildSrt(cues) {
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join('\n');
}
