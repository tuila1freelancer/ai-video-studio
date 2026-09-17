// The API as the interface sees it: the app mounted in-process on an ephemeral port, real
// requests, real JSON. Shapes asserted here are the ones public/js reads.
import './_env.mjs';
process.env.TOOLS_LICENSE_BYPASS = '1';
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mountRoutes } from '../src/api/routes.js';
import { errorHandler } from '../src/api/http.js';
import * as DB from '../src/db/index.js';

let base;
const app = express();
app.use('/api', express.json({ limit: '2mb' }));
mountRoutes(app, { version: 'test' });
app.use('/api', errorHandler);
const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
base = `http://127.0.0.1:${server.address().port}/api`;
test.after(() => server.close());

const get = async (p) => { const r = await fetch(base + p); return { status: r.status, body: await r.json() }; };

test('GET /boot carries everything the first paint needs, in one reply', async () => {
  const { status, body } = await get('/boot');
  assert.equal(status, 200);
  for (const k of ['version', 'uiLang', 'deps', 'settings', 'channels', 'activeChannel', 'projects', 'presets']) assert.ok(k in body, k);
  assert.equal(body.version, 'test');
  assert.ok(Array.isArray(body.channels) && body.channels.length >= 1, 'the Default channel exists on a fresh DB');
  assert.equal(body.activeChannel, body.channels[0].id);
  assert.equal(JSON.stringify(body.settings).includes('sk-'), false, 'secrets never leave masked');
});

test('GET /projects is a summary: no config, no metadata', async () => {
  const p = DB.createProject({ title: 'Lite', topic: 't', aspectRatio: '16:9', config: { language: 'vi', big: 'x'.repeat(5000) } });
  DB.updateProject(p.id, { metadata: { thumbnail: { html: '<div>' + 'y'.repeat(5000) + '</div>' }, title: 'Lite' } });
  const { body } = await get('/projects');
  const row = body.projects.find((x) => x.id === p.id);
  assert.ok(row, 'listed');
  assert.equal(row.title, 'Lite');
  assert.equal(row.aspect_ratio, '16:9');
  assert.equal('config' in row, false);
  assert.equal('metadata' in row, false);
  assert.ok(JSON.stringify(row).length < 600, 'a list row is a few hundred bytes');
});

test('GET /projects/:id?scenes=lite strips the generated page but keeps what the list renders', async () => {
  const p = DB.createProject({ title: 'Scenes', topic: 't', aspectRatio: '9:16', config: {} });
  DB.replaceScenes(p.id, [{ voice_text: 'xin chào', visual_prompt: '[HOOK]', keywords: ['a'] }]);
  const sc = DB.getScenes(p.id)[0];
  DB.updateScene(sc.id, {
    props: { html: '<b>' + 'h'.repeat(3000) + '</b>', css: 'c'.repeat(2000), script: 's'.repeat(2000), guide: { x: 1 }, beats: [{ t: 0 }, { t: 1 }], audio: { sfx: 'whoosh' }, __custom: { css: 'x' } },
    fp: { a: 1 }, srt_json: [{ start: 0, end: 1, text: 'xin chào', words: [] }], duration: 1.2, status: 'html',
  });
  const full = (await get(`/projects/${p.id}`)).body;
  assert.equal(full.scenes[0].props.html.length > 3000, true, 'default stays full — the CLI scripts read props.html');
  const lite = (await get(`/projects/${p.id}?scenes=lite`)).body;
  const s = lite.scenes[0];
  assert.equal(s.props.html, undefined);
  assert.equal(s.props.script, undefined);
  assert.equal(s.props._lite, true, 'marked so an editor never writes it back over the full row');
  assert.equal(s.hfBeats, 2);
  assert.deepEqual(s.props.audio, { sfx: 'whoosh' }, 'the props the scene studio reads survive');
  assert.equal(s.props.__custom.css, 'x');
  assert.equal(s.fp, undefined);
  assert.equal(s.duration, 1.2);
  assert.equal(s.srt_json.length, 1, 'cues stay: the SRT editor and the rough-cut player read them');
  assert.ok(JSON.stringify(s).length < JSON.stringify(full.scenes[0]).length / 3);
  const none = (await get(`/projects/${p.id}?scenes=0`)).body;
  assert.equal(none.project.id, p.id);
  assert.equal('scenes' in none, false);
  const one = (await get(`/scenes/${sc.id}`)).body;
  assert.equal(one.scene.props.html.length > 3000, true, 'GET /scenes/:id is the full row');
});

test('GET /tasks resolves project titles in one query', async () => {
  const p = DB.createProject({ title: 'Titled', topic: 't', aspectRatio: '9:16', config: {} });
  DB.enqueueJob({ kind: 'render', projectId: p.id });
  const { body } = await get('/tasks');
  const job = body.jobs.find((j) => j.project_id === p.id);
  assert.equal(job.projectTitle, 'Titled');
});

test('the API answers a bad body with JSON, not an HTML stack trace', async () => {
  const r = await fetch(`${base}/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{nope' });
  assert.equal(r.status, 400);
  assert.match(r.headers.get('content-type'), /application\/json/);
  assert.ok((await r.json()).error);
});

test('the route table is exactly the one pinned before routes.js was split', async () => {
  const { readFileSync } = await import('node:fs');
  const pinned = JSON.parse(readFileSync(new URL('./fixtures/route-table.json', import.meta.url), 'utf8'));
  const api = app._router.stack.find((l) => l.name === 'router' && l.regexp.test('/api/'));
  const rows = [];
  for (const layer of api.handle.stack) {
    if (!layer.route) continue;
    for (const m of Object.keys(layer.route.methods)) rows.push(`${m.toUpperCase()} ${layer.route.path}`);
  }
  assert.deepEqual(rows.sort(), pinned, 'a route vanished or changed its path in the split');
});

test('PUT /projects/:id ignores fields the pipeline owns', async () => {
  const p = DB.createProject({ title: 'Guarded', topic: 't', aspectRatio: '9:16', config: {} });
  const r = await fetch(`${base}/projects/${p.id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Renamed', status: 'done', scenes_approved_at: Date.now(), video_path: '/etc/passwd' }),
  });
  assert.equal(r.status, 200);
  const row = DB.getProject(p.id);
  assert.equal(row.title, 'Renamed');
  assert.equal(row.status, 'draft', 'status is the pipeline\'s to write');
  assert.equal(row.scenes_approved_at, null, 'the scene gate has exactly one approver (P17)');
  assert.equal(row.video_path, null);
});

test('POST /styles never accepts a client-supplied builtin flag', async () => {
  const r = await fetch(`${base}/styles`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Mine', kind: 'metadata', prompt: 'p', builtin: 1 }) });
  const { style } = await r.json();
  assert.equal(style.builtin, 0);
  DB.deleteStyle(style.id);
  assert.equal(DB.listStyles('metadata').some((s) => s.id === style.id), false, 'so it can be deleted');
  const bad = await fetch(`${base}/styles`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(bad.status, 400);
});

test('GET /file coerces a repeated path parameter instead of throwing', async () => {
  const { status, body } = await get('/file?path=/etc/hosts&path=/etc/passwd');
  assert.equal(status, 403);
  assert.equal(body.error, 'forbidden');
});

test('moveFile falls back to copy+unlink on EXDEV', async () => {
  const { moveFile } = await import('../src/util/fs.js');
  const fs = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = fs.mkdtempSync(join(tmpdir(), 'avs-mv-'));
  const a = join(dir, 'a'); const b = join(dir, 'b');
  fs.writeFileSync(a, 'x');
  moveFile(a, b);
  assert.equal(fs.existsSync(a), false); assert.equal(fs.readFileSync(b, 'utf8'), 'x');
});

test('GET /thumb serves a downscaled, cacheable copy of an allowed image', async () => {
  const { PATHS, DIRS } = await import('../src/config/paths.js');
  const { execFileSync } = await import('node:child_process');
  const { join } = await import('node:path');
  const { existsSync } = await import('node:fs');
  if (!PATHS.ffmpeg) return; // nothing to scale with
  const src = join(DIRS.tmp, 'thumb-src.jpg');
  execFileSync(PATHS.ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=1280x720', '-frames:v', '1', src]);
  const r = await fetch(`${base}/thumb?path=${encodeURIComponent(src)}&w=320&v=1`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('cache-control'), /max-age=86400/);
  const small = Buffer.from(await r.arrayBuffer());
  const big = (await import('node:fs')).statSync(src).size;
  assert.ok(small.length < big, `downscaled ${small.length} < ${big}`);
  assert.ok(existsSync(join(DIRS.tmp, 'thumbs')), 'cached under data/tmp/thumbs');
});
