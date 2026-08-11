// Checking a logo used to mean re-concatenating the whole video and watching it — fifteen
// minutes to find out a badge was four pixels too high.
//
// The value of this preview is entirely in the word "same". It is not a mock-up: the stamp goes
// through resolveConcatLogo + logoRect (what pipeline/render.js calls) and the caption through
// burnStyleFrom + buildAss + libass with the fontsdir the burn would use. If it looks right here
// it will look right in the video, because it is the same code answering the same question. A
// preview that merely approximated the pipeline would be worse than none: it would licence
// skipping the render on evidence that does not hold.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const service = src('../src/api/services/frame-preview.js');

test('the stamp is placed by the concat\'s own arithmetic, not a lookalike', () => {
  assert.match(service, /import \{ resolveConcatLogo, logoRect \}/);
  // …and against the SOURCE CLIP's own pixels, which is what "the concat's own arithmetic" means
  // now. This used to pin `W: size.w`, and that pin was holding a real bug in place: `size` is the
  // logical 1080-class canvas, so on a resolutionScale=2 project both the preview and the concat
  // drew a rect computed for 1920×1080 onto a 3840×2160 frame — half the width, at half the
  // fraction. Measured on a finished 4K video, a stamp stored at cx=0.936 rendered at cx=0.468.
  assert.match(service, /const fsz = \(await probeImageSize\(source\)\) \|\| size;/);
  assert.match(service, /logoRect\(logo, \{ W: fsz\.w, H: fsz\.h/);
  // the caption stays in the logical space on purpose — ASS carries its own PlayRes
  assert.match(service, /buildAss\(cues, style, \{ w: size\.w, h: size\.h \}/);
  // the same clamp and the same default the concat applies
  assert.match(service, /Math\.min\(1, Math\.max\(0\.2, Number\.isFinite\(\+logo\.opacity\) \? \+logo\.opacity : 0\.9\)\)/);
  assert.match(service, /scale=\$\{rect\.lw\}:\$\{rect\.lh\}:flags=lanczos/);
});

test('the caption is burned by libass, from the cue really spoken at that moment', () => {
  assert.match(service, /import \{ buildAss[^}]*\}/);
  assert.match(service, /burnStyleFrom/);
  assert.match(service, /prepareBurnFontDir/);
  // …including the text measurement, or a preview would draw a caption box the video will not
  assert.match(service, /measureCaptions/);
  assert.match(service, /ass=filename=/);
  assert.match(service, /useAss \? ffmpegAss : ffmpeg/, 'libass lives only in the vendored build');
  // a real cue, not lorem ipsum: the point is to see this video's own words in this font
  assert.match(service, /cues\.find\(\(c\) => t >= c\.start && t <= c\.end\)/);
  // …clamped by the SAME function the burn uses, so a cue overrunning its scene slot cannot
  // preview with more words — and a wider drawn box — than the video will carry
  assert.match(service, /programCues\(\[scene\], \[start\]/);
});

test('the preview never draws over a frame that is already stamped', () => {
  // `project.video_path` has the captions and the logo burned in. Sampling a frame from it and
  // drawing them again is what put two subtitles on screen; the bare clip is the only source that
  // shows the config being edited and nothing else.
  assert.match(service, /const source = bare \? scene\.video_path : finished;/);
  assert.match(service, /const logo = bare \? resolveConcatLogo\(config, size\) : null;/,
    'the logo is stamped at concat too, so it doubles the same way');
  assert.match(service, /if \(bare && config\.enableSubtitles !== false/);
  // and when there IS no clip left, the fallback says so instead of pretending
  assert.match(service, /phụ đề và logo đã in sẵn, không xem trước thay đổi được/);
});

test('the frame is shown at its real program time, not at the cue opening', () => {
  // `-ss` before `-i` rebases the frame to ~0 and `setpts=PTS-STARTPTS` pinned it exactly there,
  // so libass always drew the cue in its opening state: karaoke lit word 1 whatever `t` was,
  // progressive reveal showed one word, and a fade-in rendered the caption invisible.
  assert.match(service, /setpts=PTS-STARTPTS\+\$\{shown\.toFixed\(3\)\}\/TB/);
  assert.doesNotMatch(service, /setpts=PTS-STARTPTS,/, 'the un-offset form is the bug');
  // a silent gap moves to the nearest cue and SAYS so, rather than drawing the scene's first line
  assert.match(service, /không có phụ đề — đang xem tại/);
  // and the seek is clamped AFTER the offset, or a cue near the end pushes it past EOF
  assert.match(service, /Math\.min\(at \+ \(shown - t\), Math\.max\(0, dur - 0\.05\)\)/);
});

test('the frame is found through the timeline the concat actually assembled', () => {
  // scene.duration sums are wrong the moment a crossfade exists — that is the whole reason
  // metadata.timeline is written
  assert.match(service, /project\.metadata\?\.timeline/);
  assert.match(service, /t >= s\.start && t < s\.end/);
  assert.match(service, /Better a\s*\/\/ slightly-off caption in a preview than no preview at all/,
    'the fallback for older projects is documented rather than silent');
});

test('a missing font degrades to a note, never to a quiet substitution', () => {
  // the preview must not block the owner, but a preview drawn in the wrong face is the exact
  // lie the feature exists to prevent — so it says so
  assert.match(service, /note = e\.message/);
  assert.match(service, /if \(!note \|\| isSystemFamily\(style\.font\)\)/);
  const routes = src('../src/api/routes.js');
  assert.match(routes, /X-Preview-Note/);
  assert.match(src('../public/js/views/config.js'), /X-Preview-Note/);
});

test('the preview reflects what the panel shows RIGHT NOW, not what was saved', () => {
  const cfg = src('../public/js/views/config.js');
  assert.match(cfg, /JSON\.stringify\(gatherConfig\(\)\)/, 'live panel values');
  assert.match(service, /const config = \{ \.\.\.\(project\.config \|\| \{\}\), \.\.\.overrides \}/);
});

test('it is offered only when there is a frame to preview', () => {
  const cfg = src('../public/js/views/config.js');
  assert.match(cfg, /state\.current\?\.video_path/);
  assert.match(cfg, /box\.classList\.toggle\('hidden', !ok\)/);
});
