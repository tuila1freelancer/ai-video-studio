// P44 — the two ENGINE steps the route diff (P42) and the UI diff (P43) could not see, because
// they are neither a route nor a button in the reference: silence removal and auto-zoom, both
// applied automatically to the user's own footage inside the edit-video lane.
// Pure/fast: the cut decision and the zoom expression are computed without ffmpeg.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceOf, indexHtml } from './_source.mjs';
import { silenceKeepRanges, zoomFilter, zoomFocus } from '../src/media/ffmpeg.js';

const span = (r) => r.reduce((s, x) => s + (x.end - x.start), 0);

test('P44: a gap is cut out of the middle and the rest of the take is kept intact', () => {
  // 20s take, one 3s pause from 8s to 11s
  const keep = silenceKeepRanges([{ start: 8, end: 11 }], 20, { keepMs: 200, padMs: 100 });
  assert.equal(keep.length, 2);
  assert.deepEqual(keep[0], { start: 0, end: 8.1 }, 'speech plus a beat of the pause');
  assert.deepEqual(keep[1], { start: 10.9, end: 20 }, 'resumes just before the speech does');
  assert.ok(span(keep) < 20, 'the take really is shorter');
  assert.equal(+span(keep).toFixed(3), 17.2, 'exactly the gap minus both pads');
});

test('P44: the kept ranges tile the source in order and never overlap', () => {
  const keep = silenceKeepRanges(
    [{ start: 3, end: 5 }, { start: 12, end: 14.5 }, { start: 20, end: 26 }], 30);
  for (let i = 1; i < keep.length; i++) {
    assert.ok(keep[i].start >= keep[i - 1].end, 'ranges ascend without overlapping');
    assert.ok(keep[i].end > keep[i].start, 'and none is empty or inverted');
  }
  assert.equal(keep[0].start, 0, 'the take starts where it started');
  assert.equal(keep[keep.length - 1].end, 30, 'and ends where it ended — no tail is lost');
});

test('P44: a pause too short to be worth a splice is left alone', () => {
  // 0.15s of quiet with 100ms pads on both sides has nothing left to remove — cutting it would
  // cost a re-encode splice and buy 0 seconds
  const keep = silenceKeepRanges([{ start: 5, end: 5.15 }], 12, { keepMs: 200, padMs: 100 });
  assert.deepEqual(keep, [{ start: 0, end: 12 }], 'one untouched range');
});

test('P44: at least keepMs of every pause survives — the cut still breathes', () => {
  // a 10-second dead stretch must NOT become a hard butt-splice
  const keep = silenceKeepRanges([{ start: 4, end: 14 }], 30, { keepMs: 200, padMs: 100 });
  const gapLeft = keep[1].start - keep[0].end;
  assert.ok(gapLeft > 0, 'time was genuinely removed');
  const kept = (keep[0].end - 4) + (14 - keep[1].start);
  assert.ok(+kept.toFixed(3) >= 0.2, `a beat of the pause is kept, got ${kept}`);
});

test('P44: nothing detected, or nothing detectable, is never a destructive edit', () => {
  assert.deepEqual(silenceKeepRanges([], 15), [{ start: 0, end: 15 }]);
  assert.deepEqual(silenceKeepRanges(null, 15), [{ start: 0, end: 15 }]);
  assert.deepEqual(silenceKeepRanges([{ start: 2, end: 1 }], 15), [{ start: 0, end: 15 }], 'inverted input ignored');
  assert.deepEqual(silenceKeepRanges([{ start: 0, end: 99 }], 0), [], 'no duration → no plan at all');
  // a silence running past the end of the file cannot produce a range outside the file
  const keep = silenceKeepRanges([{ start: 8, end: 40 }], 10);
  for (const r of keep) { assert.ok(r.start >= 0 && r.end <= 10, 'stays inside the source'); }
});

test('P44: removeSilence trims picture and sound with ONE range list, so they cannot drift', () => {
  const ff = sourceOf('src/media/ffmpeg.js');
  // the same r.start/r.end feeds trim= and atrim= in the same iteration — the reference wrote
  // N intermediate clips and concat-demuxed them, which re-encodes every segment twice
  assert.match(ff, /\[0:v\]trim=start=\$\{r\.start\}:end=\$\{r\.end\}/);
  assert.match(ff, /\[0:a\]atrim=start=\$\{r\.start\}:end=\$\{r\.end\}/);
  assert.match(ff, /concat=n=\$\{ranges\.length\}:v=1:a=1/);
  assert.match(ff, /ranges\.length > maxSegments/, 'a shredded source is refused, not spliced 500 times');
  assert.match(ff, /await copyFile\(inPath, outPath\)/, 'and the file still arrives at outPath');
});

test('P44: the zoom alternates direction per scene and lands exactly on 1.0 at a boundary', () => {
  const even = zoomFilter({ index: 0, durationSec: 7, w: 1920, h: 1080, fps: 30 });
  const odd = zoomFilter({ index: 1, durationSec: 7, w: 1920, h: 1080, fps: 30 });
  assert.match(even, /^zoompan=z='min\(/, 'even scenes push in');
  assert.match(odd, /^zoompan=z='max\(1,/, 'odd scenes pull out');
  // both must start (push-in) or end (pull-out) at exactly 1.0, or the cut between two scenes
  // shows a visible jump in scale
  const maxZ = parseFloat(/min\(([\d.]+),/.exec(even)[1]);
  const amt = parseFloat(/1\+([\d.]+)\*on/.exec(even)[1]);
  assert.ok(Math.abs(maxZ - (1 + amt)) < 1e-6, 'push-in starts at 1.0 and ends at max');
  const outMax = parseFloat(/max\(1,([\d.]+)-/.exec(odd)[1]);
  const outAmt = parseFloat(/-([\d.]+)\*on/.exec(odd)[1]);
  assert.ok(Math.abs(outMax - (1 + outAmt)) < 1e-6, 'pull-out starts at max and ends at 1.0');
});

test('P44: the zoom is framed at the REAL output size — not the reference hardcoded 1920x1080', () => {
  // the reference writes s=1920x1080 unconditionally, so a 9:16 video it zooms comes back
  // squashed into landscape. Ours takes the caller's frame.
  assert.match(zoomFilter({ w: 1080, h: 1920, fps: 30 }), /:s=1080x1920:fps=30$/);
  assert.match(zoomFilter({ w: 1080, h: 1080, fps: 24 }), /:s=1080x1080:fps=24$/);
  // the ramp is measured in OUTPUT frames, so it completes over the scene at any fps
  assert.match(zoomFilter({ index: 0, durationSec: 10, fps: 30 }), /\*on\/300\)/);
  assert.match(zoomFilter({ index: 0, durationSec: 10, fps: 24 }), /\*on\/240\)/);
});

test('P44: zoom intensity is clamped, so no setting can produce a grotesque crop', () => {
  const zoomOf = (s) => parseFloat(/min\(([\d.]+),/.exec(zoomFilter({ index: 0, intensity: s }))[1]);
  assert.ok(zoomOf(0) >= 1.05 && zoomOf(0) <= 1.1, 'the gentlest setting still moves');
  assert.ok(zoomOf(1) <= 1.25, 'the strongest setting is still cinema, not a punch-in');
  assert.ok(zoomOf(99) <= 1.4 && zoomOf(-99) >= 1.0, 'out-of-range input cannot escape the clamp');
  assert.ok(zoomOf(1) > zoomOf(0), 'and the dial actually does something');
  // the focus point rotates so four consecutive scenes are not the same move
  assert.deepEqual(zoomFocus('face'), ['0.5', '0.35']);
  assert.notDeepEqual(zoomFilter({ index: 1 }), zoomFilter({ index: 3 }), 'rotation, not repetition');
});

test('P44: zoom rides the footage only — the keyed graphics on top stay still', () => {
  const ff = sourceOf('src/media/ffmpeg.js');
  // the expression is spliced into the [0:v] (footage) chain, ahead of tpad; [1:v] is the
  // rendered scene and must be untouched, or the whole overlay would swim
  assert.match(ff, /const zoomExpr = zoom \? `\$\{zoomFilter\(/);
  assert.match(ff, /\$\{cropExpr\},fps=\$\{fps\},\$\{zoomExpr\}tpad=/);
  assert.ok(!/\[1:v\][^;]*zoompan/.test(ff), 'the graphics layer never gets a zoompan');
  // no zoom requested → the filter string is byte-identical to what it always was
  assert.match(ff, /zoom = null,/);
});

test('P44: silence is cut BEFORE the transcript, and the whole project follows the new file', () => {
  const ev = sourceOf('src/pipeline/edit-video.js');
  // ORDER IS THE POINT. The reference splits scenes from the transcript first and removes
  // silence after, so each scene then reads the shortened footage at its old timestamp.
  const cut = ev.indexOf('await maybeRemoveSilence(ctx, src)');
  const transcribe = ev.indexOf('await transcribeWords(useSrc');
  assert.ok(cut > 0 && transcribe > cut, 'the cut happens first');
  assert.match(ev, /transcribeWords\(useSrc,/, 'and whisper only ever sees the final footage');
  // both the lane and the compositor must be repointed, or the graphics land on the old cut
  assert.match(ev, /config\.editVideo = \{ \.\.\.config\.editVideo, source: path, processed: path \}/);
  assert.match(ev, /config\.overlay = \{ \.\.\.\(config\.overlay \|\| \{\}\), source: path \}/);
  assert.match(ev, /DB\.updateProject\(projectId, \{ config \}\)/, 'and it survives a resume');
  assert.match(ev, /existsSync\(out\) && config\.editVideo\.processed === out/, 'a resume reuses the cut file');
  // a failure must never cost the user the job
  assert.match(ev, /— dùng video gốc/);
});

test('P44: both switches reach the engine from the panel', () => {
  const html = indexHtml();
  assert.ok(html.includes('id="evCutSilence"'));
  assert.ok(html.includes('id="evZoom"'));
  assert.match(sourceOf('public/js/views/editvideo.js'), /removeSilence: !!\$\('#evCutSilence'\)\?\.checked/);
  assert.match(sourceOf('public/js/views/editvideo.js'), /autoZoom: !!\$\('#evZoom'\)\?\.checked/);
  const ev = sourceOf('src/pipeline/edit-video.js');
  assert.match(ev, /zoom: config\.autoZoom \? \{ intensity: \+config\.autoZoomIntensity \|\| 0\.5 \} : null/);
  assert.match(sourceOf('src/animation/index.js'), /zoom: config\.overlay\.zoom \? \{ \.\.\.config\.overlay\.zoom, index: scene\.idx \} : null/);
  // and neither is on by default — a user who does not tick them gets the old render exactly
  assert.match(ev, /if \(!config\.removeSilence\) return src;/);
});
