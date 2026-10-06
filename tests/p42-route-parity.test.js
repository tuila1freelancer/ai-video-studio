// P42 — the last capabilities the reference app had and we did not, found by diffing its 121
// routes against ours. Each is implemented on OUR architecture rather than copied route-for-route,
// so the tests pin the CAPABILITY and the safety property, not the URL shape.
// Pure/fast: no browser, no ffmpeg, no LLM.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceOf, indexHtml } from './_source.mjs';

const routes = sourceOf('src/api/routes.js');

test('P42: assets can be borrowed from another project, by path and without duplicating files', () => {
  assert.match(routes, /'\/projects\/:id\/copy-assets-from\/:sourceId'/);
  assert.match(routes, /normalizeAssets\(src\.config\?\.assets\)\.filter\(\(a\) => existsSync\(a\.path\)\)/,
    'a source asset that no longer exists on disk is never carried over');
  assert.match(routes, /from\.filter\(\(a\) => !have\.has\(a\.path\)\)/, 'and the same file is never added twice');
});

test('P42: restart makes a NEW project — one click can never destroy a finished video', () => {
  assert.match(routes, /'\/projects\/:id\/restart'/);
  assert.match(routes, /const fresh = DB\.createProject\(\{/, 'a fresh project, not an in-place wipe');
  assert.ok(!/deleteProject\(p\.id\)/.test(routes.slice(routes.indexOf("'/projects/:id/restart'"), routes.indexOf("'/projects/:id/restart'") + 900)),
    'the previous attempt survives for comparison');
  assert.match(routes, /Pipeline\.startProject\(fresh\.id[,)]/, 'and it starts through the ordinary queue');
});

test('P42: the publish caption is written from the narration and outranks the description', () => {
  assert.match(routes, /'\/publish\/generate-caption'/);
  assert.match(routes, /What the video actually says/, 'the script is what the caption is drawn from');
  assert.match(routes, /Never promise anything the script does not deliver/);
  assert.match(routes, /captions: \{ \.\.\.\(md\.captions \|\| \{\}\), \[platform\]: caption \}/, 'saved per platform');
  assert.match(routes, /md\.captions\?\.\[pub\.id\] \|\| md\.description \|\| ''/, 'and preferred at publish time');
  // no LLM → a clear message, never a silent empty caption
  assert.match(routes, /chưa bật LLM trong AI Setting/);
});

test('P42: a logo preset carries its PLACEMENT, not just the file', () => {
  assert.match(routes, /'\/logo-presets'/);
  assert.match(routes, /kind: 'logo'/, 'stored in the shared styles table — no new table');
  assert.match(routes, /cxPct|cyPct|wPct|opacity/, 'geometry travels with the file');
  // a preset may not point at an arbitrary path on the machine
  assert.match(routes, /inAllowedRoots\(resolve\(assetPath\)\) \|\| !existsSync\(assetPath\)/);
});

test('P42: all four are reachable from the UI, not just from curl', () => {
  const studio = sourceOf('public/js/views/studio.js');
  assert.match(studio, /btnRestart/);
  assert.match(studio, /btnCopyAssets/);
  assert.match(studio, /publish\/generate-caption/);
  const html = indexHtml();
  for (const id of ['btnRestart', 'btnCopyAssets']) assert.ok(html.includes(`id="${id}"`), `${id} exists in the markup`);
});

test('P42: brand-folder rename and delete are pinned inside the library and refuse Default', () => {
  assert.match(routes, /r\.put\('\/brands\/rename'/);
  assert.match(routes, /r\.delete\('\/brands\/:name'/);
  // the guard: a name is stripped of separators and '..', then the resolved path MUST still be
  // under DIRS.brand — a traversal or a typo can never reach anything else on the machine
  assert.match(routes, /replace\(\/\[\\\/\\\\\]\/g, ''\)\.replace\(\/\\\.\\\.\/g, ''\)/, 'separators and .. stripped');
  assert.match(routes, /resolve\(dir\)\.startsWith\(resolve\(DIRS\.brand\) \+ '\/'\)/, 'and the result must stay inside the library');
  assert.match(routes, /clean === 'Default'/, "the Default folder cannot be renamed or deleted");
  // a delete states what it is about to destroy and refuses until the caller echoes the count
  assert.match(routes, /req\.query\.confirm !== String\(files\.length\)/);
  assert.match(routes, /status\(409\)/);
  // and the library rows follow the folder instead of pointing at art that moved
  const cat = sourceOf('src/db/repositories/catalogs.js');
  assert.match(cat, /export function renameBrandFolder/);
  assert.match(cat, /export function deleteBrandFolder/);
});

test('P42: per-scene SRT keeps each scene on its OWN zero, unlike the whole-project export', () => {
  assert.match(routes, /'\/projects\/:id\/scenes-srt'/);
  assert.match(routes, /buildSrt\(sc\.srt_json \|\| \[\]\)/, 'cues are used as stored — not shifted onto the final timeline');
  assert.match(routes, /Content-Disposition/, 'and it can be downloaded as one file');
  // the whole-project export must still do the shifting — the two are different tools
  assert.match(routes, /shiftCues/, 'the timeline-shifted export survives');
});

test('P42: a file can be transcribed without starting a project', () => {
  assert.match(routes, /r\.post\('\/edit-video\/transcribe'/);
  assert.match(routes, /inAllowedRoots\(src\) \|\| !existsSync\(src\)/, 'the path is still gated');
  assert.match(routes, /granularity: 'segment'/, 'same decoding accuracy as the edit-video lane');
  assert.match(routes, /req\.body\?\.repair !== false/, 'AI spelling repair on by default, switchable off');
  // no project is created — that is the whole point of the endpoint
  const block = routes.slice(routes.indexOf("'/edit-video/transcribe'"), routes.indexOf("'/edit-video/transcribe'") + 1400);
  assert.ok(!/createProject|createEditVideoProject/.test(block), 'nothing is created, nothing is spent but CPU');
});

test('P42: Facebook Pages are a registry with token health, not one silent slot', async () => {
  const fb = (await import('../src/publish/facebook.js')).default;
  for (const fn of ['listPages', 'selectPage', 'removePage', 'checkToken', 'extendToken']) {
    assert.equal(typeof fb[fn], 'function', `${fn} exists`);
  }
  const f = sourceOf('src/publish/facebook.js');
  // the single-slot config from before the registry must keep working
  assert.match(f, /if \(!pages\.length && c\.pageId\)/, 'a pre-registry config is still the active page');
  assert.match(f, /debug_token/, 'token validity comes from Graph, not from a guess');
  assert.match(f, /d\.expires_at === 0/, '0 means never expires — not "expired today"');
  assert.match(f, /grant_type: 'fb_exchange_token'/, 'renewal is the documented long-lived exchange');
  assert.match(f, /cần App ID \+ App Secret/, 'and it says what it needs instead of failing vaguely');
  for (const p of ['/publish/pages', '/publish/pages/:pageId/check', '/publish/pages/:pageId/extend', '/publish/published-ids']) {
    assert.ok(routes.includes(p), `${p} is exposed`);
  }
});

test('P42: a saved preset can be put BACK, and a style can be renamed', () => {
  assert.match(routes, /'\/logo-presets\/:id\/apply'/, 'a preset nothing can apply is worthless');
  assert.match(routes, /finalOverlay: \{ enabled: true, \.\.\.payload\.placement \}/, 'placement is restored, not just the file');
  assert.match(routes, /file logo của preset không còn trên đĩa/, 'a preset pointing at a deleted file fails clearly');
  assert.match(routes, /r\.patch\('\/styles\/:id'/);
  assert.match(sourceOf('src/db/repositories/catalogs.js'), /export function renameStyle/);
});

test('P42: the LLM endpoint and the local voice engine can be checked/installed from the app', () => {
  assert.match(routes, /r\.post\('\/llm\/test'/);
  assert.match(routes, /String\(b\.apiKey\)\.includes\('••'\)/, 'the masked round-trip keeps the saved key');
  assert.match(routes, /maxTokens: 8/, 'the check costs a token, not a paragraph');
  assert.match(routes, /r\.post\('\/tts\/server\/install'/);
  assert.match(routes, /'-m', 'pip', 'install', '--upgrade', 'supertonic'/);
  assert.match(routes, /EXPLICIT button, never automatic/, 'installing on the user\'s machine is never implicit');
  const settings = sourceOf('public/js/features/settings.js');
  assert.match(settings, /btnTestLlm/);
  assert.match(settings, /ttsSrvInstall/);
});

test('P42: a thumbnail can be edited BY INSTRUCTION, keeping everything else', async () => {
  const { editThumbnailFragment } = await import('../src/pipeline/thumbnail-codegen.js');
  // no LLM / no design / no instruction → null, never a mangled thumbnail
  assert.equal(await editThumbnailFragment('<div>x</div>', 'to hơn', { llm: { enabled: false } }), null);
  assert.equal(await editThumbnailFragment('', 'to hơn', { llm: { enabled: true, apiKey: 'k', baseUrl: 'u', model: 'm' } }), null);
  assert.equal(await editThumbnailFragment('<div>x</div>', '', { llm: { enabled: true, apiKey: 'k', baseUrl: 'u', model: 'm' } }), null);
  const t = sourceOf('src/pipeline/thumbnail-codegen.js');
  assert.match(t, /YOU ARE EDITING an existing thumbnail, not designing a new one/);
  assert.match(t, /Apply ONLY what is asked and change nothing else/);
  // a reply that collapsed the design is a failed edit, not one worth shipping
  assert.match(t, /next\.length < Math\.max\(80, current\.length \* 0\.4\)/);
  assert.match(routes, /'\/projects\/:id\/thumbnail\/edit-html'/);
  assert.match(routes, /chưa có thiết kế thumbnail để sửa/, 'editing needs something to edit');
});

test('P42: the subtitle position select finally moves the captions — without shifting old videos', async () => {
  const { captionStyleFrom } = await import('../src/subtitles/presets.js');
  const theme = { accents: ['#F7B500'], ink: '#fff' };
  const at = (cfg) => captionStyleFrom(cfg, theme, { w: 1920, h: 1080 }).bottomPct;
  // it was dead: bottomPct read only marginV, and the panel always sends 0.12
  assert.equal(at({ subtitlePosition: { preset: 'mid', marginV: 0.12 } }), 45, 'giữa now renders in the middle');
  assert.equal(at({ subtitlePosition: { preset: 'top', marginV: 0.12 } }), 80, 'trên now renders high');
  // BYTE-COMPAT: everything that already worked must produce the same number as before
  assert.equal(at({}), undefined, 'no position → the harness default, untouched');
  assert.equal(at({ subtitlePosition: { preset: 'bot', marginV: 0.12 } }), undefined, 'dưới → unchanged');
  assert.equal(at({ subtitlePreset: 'karaoke-vang', subtitlePosition: { preset: 'bot', marginV: 0.12 } }), undefined,
    'with a subtitle preset, dưới keeps the value it always had');
  assert.equal(at({ subtitlePreset: 'karaoke-vang', subtitlePosition: { preset: 'top', marginV: 0.12 } }), 80);
});
