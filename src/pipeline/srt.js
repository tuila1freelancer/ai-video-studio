// Subtitle file builders: SRT (plain text) + cue time-shifting for the whole-video export.
// The karaoke ASS builder was removed with the `image` visual mode (P36): animation/hyperframe
// scenes render their captions as DOM in the harness, never through libass, so ASS burning had
// exactly one consumer (the deleted Ken-Burns renderer).

function pad(n, l = 2) { return String(Math.floor(n)).padStart(l, '0'); }
function srtTime(t) {
  const ms = Math.round((t % 1) * 1000);
  const s = Math.floor(t) % 60, m = Math.floor(t / 60) % 60, h = Math.floor(t / 3600);
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

export function buildSrt(cues) {
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join('\n');
}

// shift cue/word times by `offset` seconds (for building a whole-video SRT)
export function shiftCues(cues, offset) {
  return cues.map((c) => ({
    start: c.start + offset, end: c.end + offset,
    text: c.text,
    words: (c.words || []).map((w) => ({ ...w, start: w.start + offset, end: w.end + offset })),
  }));
}
