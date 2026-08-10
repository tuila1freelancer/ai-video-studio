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
  assert.match(service, /logoRect\(logo, \{ W: size\.w, H: size\.h/);
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
  assert.match(service, /abs\.find\(\(c\) => t >= c\.start && t <= c\.end\)/);
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
