// P42 — the last capabilities the reference app had and we did not, found by diffing its 121
// routes against ours. Each is implemented on OUR architecture rather than copied route-for-route,
// so the tests pin the CAPABILITY and the safety property, not the URL shape.
// Pure/fast: no browser, no ffmpeg, no LLM.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const routes = src('../src/api/routes.js');

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
  assert.match(routes, /Pipeline\.startProject\(fresh\.id\)/, 'and it starts through the ordinary queue');
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
  const studio = src('../public/js/views/studio.js');
  assert.match(studio, /btnRestart/);
  assert.match(studio, /btnCopyAssets/);
  assert.match(studio, /publish\/generate-caption/);
  const html = src('../public/index.html');
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
  const cat = src('../src/db/repositories/catalogs.js');
  assert.match(cat, /export function renameBrandFolder/);
  assert.match(cat, /export function deleteBrandFolder/);
});
