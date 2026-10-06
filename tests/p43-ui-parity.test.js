// P43 — UI-surface capabilities that live only on the client, which a route-level test (P42)
// cannot see. These pin two of them. Pure/fast: no browser, no ffmpeg, no LLM.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { planTransitions, TRANSITION_STYLES } from '../src/pipeline/render.js';
import { classifyDrop } from '../public/js/features/dragdrop.js';
import { sourceOf, indexHtml } from './_source.mjs';

const SCENES = [{ visual_prompt: '[ROLE] hook' }, { visual_prompt: '[ROLE] proof' }, { visual_prompt: '[ROLE] payoff' }, { visual_prompt: '[ROLE] cta' }];
const plan = (style) => planTransitions({ scenes: SCENES, clipCount: 4, style }).map((t) => t.type);

test('P43: the user can name ONE transition look, or keep the storytelling doctrine', () => {
  // 'auto' is the default and must keep the role-driven plan exactly as it was
  assert.deepEqual(plan('auto'), ['fadeblack', 'zoomin', 'fadeblack'], 'the doctrine is untouched');
  assert.deepEqual(plan(undefined), ['fadeblack', 'zoomin', 'fadeblack'], 'and it is what you get by default');
  // an explicit style overrides it for every boundary
  assert.deepEqual(plan('circleopen'), ['circleopen', 'circleopen', 'circleopen']);
  assert.deepEqual(plan('none'), ['cut', 'cut', 'cut']);
  // 'varied' rotates DETERMINISTICALLY — the same video must always cut the same way
  assert.deepEqual(plan('varied'), plan('varied'));
  assert.equal(new Set(plan('varied')).size, 3, 'and it actually varies');
  // an unknown style falls back to the doctrine rather than emitting a bad ffmpeg filter
  assert.deepEqual(plan('not-a-transition'), ['fadeblack', 'zoomin', 'fadeblack']);
});

test('P43: every offered style is a real xfade transition the render can execute', () => {
  // these names go straight into `xfade=transition=${type}` — a typo would fail the whole concat
  const FFMPEG_XFADE = new Set(['fade', 'dissolve', 'slideleft', 'slideright', 'circlecrop', 'circleopen',
    'smoothleft', 'smoothright', 'zoomin', 'pixelize', 'radial', 'wipeleft', 'fadeblack', 'fadewhite']);
  for (const s of TRANSITION_STYLES) {
    if (s === 'auto' || s === 'varied' || s === 'none') continue;
    assert.ok(FFMPEG_XFADE.has(s), `${s} must be a real xfade transition`);
  }
  // the UI only offers what the planner accepts
  const html = indexHtml();
  // attribute-tolerant: options carry a data-i18n key now, and the guarantee here is about the
  // VALUES the picker offers, never about what else is on the tag.
  const offered = [...html.matchAll(/<option value="([a-z]+)"[^>]*>(?:[^<]*)<\/option>/g)]
    .map((m) => m[1]).filter((v) => TRANSITION_STYLES.includes(v));
  assert.ok(offered.length >= 8, `the picker offers a real choice, got ${offered.length}`);
  assert.match(sourceOf('public/js/views/config.js'), /transitionStyle: \$\('#cfgTransStyle'\)\?\.value \|\| 'auto'/);
  assert.match(sourceOf('src/pipeline/stages/finalize.js'), /style: config\.transitionStyle \|\| 'auto'/);
});

test('P43: a dropped file is routed by WHAT IT IS, and nothing vanishes silently', () => {
  const k = classifyDrop(['a.png', 'b.JPG', 'clip.mp4', 'song.mp3', 'brand.otf', 'notes.txt', 'x.webp']);
  assert.deepEqual(k.images, ['a.png', 'b.JPG', 'x.webp']);
  assert.deepEqual(k.videos, ['clip.mp4']);
  assert.deepEqual(k.audio, ['song.mp3']);
  assert.deepEqual(k.fonts, ['brand.otf']);
  assert.deepEqual(k.unknown, ['notes.txt'], 'an unsupported file is reported, not dropped on the floor');
  const dd = sourceOf('public/js/features/dragdrop.js');
  assert.match(dd, /bỏ qua \$\{kinds\.unknown\.length\} file không hỗ trợ/, 'and the user is told');
  // dragenter/leave fire per element — without depth counting the overlay flickers across the page
  assert.match(dd, /depth = Math\.max\(0, depth - 1\)/);
  assert.match(sourceOf('public/js/main.js'), /initDragDrop\(\)/, 'wired into the app');
});

test('P43: capabilities that existed only as routes are now reachable in the UI', () => {
  // "Sửa HTML với AI" — POST /scenes/:id/edit-html shipped long ago and nothing ever called it
  const ss = sourceOf('public/js/features/scene-studio.js');
  assert.match(ss, /api\.post\(`\/scenes\/\$\{cur\.id\}\/edit-html`, \{ prompt \}\)/, 'the AI edit lane is wired');
  assert.match(ss, /htmlLoaded = false;/, 'and the editor reloads so the user sees the result');
  assert.ok(indexHtml().includes('id="ssEditPrompt"'));

  // the Facebook Page registry (P42) had no UI at all
  const set = sourceOf('public/js/features/settings.js');
  assert.match(set, /export async function loadFbPages/);
  assert.match(set, /\/publish\/pages\/\$\{b\.dataset\.fbchk\}\/check/, 'token health is checkable per Page');
  assert.match(set, /r\.neverExpires \? '✅ token không hết hạn'/, 'and "never expires" is not shown as expired');

  // named SEO styles could be created but never removed
  assert.match(sourceOf('public/js/views/config.js'), /api\.del\(`\/styles\/\$\{id\}`\)/);
  // brand folders: rename/delete reachable, and the delete states the count it is about to destroy
  const lib = sourceOf('public/js/views/library.js');
  assert.match(lib, /libBrandRename/);
  assert.match(lib, /file trong thư mục này sẽ bị xoá vĩnh viễn/, 'the dialog says what is destroyed');
  assert.match(lib, /confirm=\$\{n\}/, 'and echoes the count the server demands');
  assert.match(lib, /e\.status === 409/, 'a stale count is reported, not swallowed — api.del THROWS on 409');
});

test('P43: subtitle colour is no longer limited to the nine swatches', () => {
  const cfg = sourceOf('public/js/views/config.js');
  assert.match(cfg, /const custom = \$\('#cfgSubColorCustom'\);/);
  assert.match(cfg, /custom\.oninput = \(\) => \{ state\.subColor = custom\.value;/, 'any colour applies live');
  assert.match(cfg, /\/\^#\[0-9a-f\]\{6\}\$\/i\.test\(state\.subColor\)/, 'a non-hex saved value cannot break the input');
});

test('P43: the voice catalog no longer renders chips that filter to nothing', async () => {
  // MEASURED bug: the chip row was built from all 7 registered providers while the catalog loaded
  // only 4, so ElevenLabs / OpenAI / Supertonic each showed a live-looking chip and 0 voices.
  const { catalogProviders } = await import('../src/api/services/voice-catalog.js');
  const listProviders = () => ([
    { id: 'edge', needsNetwork: true }, { id: 'say', needsNetwork: false },
    { id: 'vbee', needsNetwork: true }, { id: 'larvoice', needsNetwork: true },
    { id: 'supertonic', needsNetwork: false },
    { id: 'elevenlabs', needsNetwork: true }, { id: 'openai', needsNetwork: true },
  ]);
  const cfgOf = (settings) => (s, id) => (settings[id] || {});
  // a LOCAL engine is always listed — its roster costs nothing to produce
  let got = catalogProviders({}, listProviders, cfgOf({}));
  assert.ok(got.includes('supertonic'), 'the local engine is always in the catalog');
  assert.ok(!got.includes('elevenlabs'), 'a keyed provider with no key stays out');
  // once a key exists, the provider joins
  got = catalogProviders({}, listProviders, cfgOf({ elevenlabs: { apiKey: 'k' } }));
  assert.ok(got.includes('elevenlabs'), 'a configured key brings the provider in');
  got = catalogProviders({}, listProviders, cfgOf({ vbee: { token: 't' } }));
  assert.ok(got.includes('vbee'));
  // and the picker greys out what the catalog cannot show, instead of a chip that finds nothing
  const vp = sourceOf('public/js/features/voicepicker.js');
  assert.match(vp, /const present = new Set\(\(state\.voiceCatalog \|\| \[\]\)\.map\(\(v\) => v\.provider\)\)/);
  assert.match(vp, /Chưa có API key cho/, 'the reason is shown, not hidden');
});

test('P43: publishing shows the exact post text, lets it be edited, and can be scheduled', async () => {
  const { quickToUnix } = await import('../public/js/ui/dialog.js');
  const now = new Date('2026-08-03T10:00:00');
  assert.equal(quickToUnix('', now), null, 'no pick = publish now');
  assert.equal(quickToUnix('1h', now), Math.floor(now.getTime() / 1000) + 3600);
  assert.equal(quickToUnix('3h', now), Math.floor(now.getTime() / 1000) + 10800);
  // "tonight 20h" must roll to tomorrow once tonight has passed, or it schedules into the past
  assert.ok(quickToUnix('tonight', now) > Math.floor(now.getTime() / 1000));
  assert.ok(quickToUnix('tonight', new Date('2026-08-03T22:00:00')) > Math.floor(new Date('2026-08-03T22:00:00').getTime() / 1000));
  const t9 = quickToUnix('tmr9', now), t20 = quickToUnix('tmr20', now);
  assert.ok(t9 > Math.floor(now.getTime() / 1000), 'tomorrow 9h is in the future');
  assert.ok(t20 - t9 === 11 * 3600, 'tomorrow 20h is eleven hours after tomorrow 9h');
  const studio = sourceOf('public/js/views/studio.js');
  assert.match(studio, /publishDialog\(\{/, 'the composer replaces the privacy menu');
  assert.match(studio, /scheduledAt: form\.when \|\| undefined/);
  assert.match(studio, /caption: form\.caption, title: form\.title/);
  // and the server treats the typed text as final
  assert.match(sourceOf('src/api/routes.js'), /String\(req\.body\?\.caption \|\| ''\)\.trim\(\) \|\| md\.captions/);
});

test('P43: the reframe crop can be biased, and centre stays byte-identical', async () => {
  const { reframeOffsetX } = await import('../src/media/ffmpeg.js');
  // a 16:9 source scaled to cover a 1080-wide output has 840px of horizontal slack
  assert.equal(reframeOffsetX('center', 1920, 1080), 420, 'centre = exactly what bare crop= does');
  assert.equal(reframeOffsetX('left', 1920, 1080), 0);
  assert.equal(reframeOffsetX('right', 1920, 1080), 840);
  // auto puts the DETECTED subject in the middle of the output window, clamped to real slack
  assert.equal(reframeOffsetX('auto', 1920, 1080, 0.2), 0, 'a subject at the far left cannot pull the crop negative');
  assert.equal(reframeOffsetX('auto', 1920, 1080, 0.8), 840, 'nor past the right edge');
  assert.equal(reframeOffsetX('auto', 1920, 1080, 0.5), 420, 'a centred subject lands where centre would');
  assert.equal(reframeOffsetX('auto', 1920, 1080, null), 420, 'detection failed → centre, never a guess');
  assert.equal(reframeOffsetX('right', 1080, 1080), 0, 'no slack → no offset');

  const ff = sourceOf('src/media/ffmpeg.js');
  // 'center' must not even build a different filter string — old renders stay byte-identical
  assert.match(ff, /let cropExpr = `crop=\$\{w\}:\$\{h\}`;/);
  assert.match(ff, /if \(position && position !== 'center'\)/);
  // the scale factor must mirror force_original_aspect_ratio=increase or the offset is wrong
  assert.match(ff, /const k = Math\.max\(w \/ size\.w, h \/ size\.h\);/);
  assert.match(ff, /export async function detectSubjectX/);
  // and the choice reaches ffmpeg from the UI
  assert.match(sourceOf('src/animation/index.js'), /position: config\.overlay\.position \|\| 'center'/);
  assert.match(sourceOf('src/pipeline/edit-video.js'), /config\.reframePosition \|\| config\.overlay\?\.position \|\| 'center'/);
  assert.match(sourceOf('public/js/views/editvideo.js'), /reframePosition: \$\('#evReframe'\)\?\.value/);
});
