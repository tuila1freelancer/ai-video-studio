import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as DB from '../src/db/index.js';
import { projectVerdict } from '../src/api/services/verdict.js';
import { mountRoutes } from '../src/api/routes.js';
import { errorHandler } from '../src/api/http.js';

const codes = (v) => v.reasons.map((r) => r.code);

function project({ status = 'done', videoPath = null, config = {}, voice = 'một cảnh bình thường' } = {}) {
  const p = DB.createProject({ title: 'v', topic: 't', inputType: 'text', aspectRatio: '9:16', config });
  DB.replaceScenes(p.id, [{ voice, visualPrompt: '' }]);
  DB.updateProject(p.id, { status, ...(videoPath ? { video_path: videoPath } : {}) });
  return DB.getProject(p.id);
}

test('an unfinished project is never publishable, and says why', async () => {
  const p = project({ status: 'running' });
  const v = await projectVerdict(p.id);
  assert.equal(v.publishable, false);
  assert.ok(codes(v).includes('project.not_done'));
  assert.ok(codes(v).includes('video.missing'));
  assert.ok(v.score < 100);
});

test('a finished project with no file on disk is refused on the file, not on the row', async () => {
  const p = project({ status: 'done', videoPath: '/nowhere/at/all/final.mp4' });
  const v = await projectVerdict(p.id);
  assert.equal(v.publishable, false);
  assert.deepEqual(codes(v).filter((c) => c.startsWith('project.')), [], 'the row says done, and that part is fine');
  assert.ok(codes(v).includes('video.missing'));
  assert.equal(v.checks.video.ok, false);
});

test('a real finished video passes, and the join report is trusted when it is newer', async () => {
  const p = project({ status: 'done' });
  const dir = DB.projectDirFor(p.id);
  const video = join(dir, 'final.mp4');
  writeFileSync(video, 'not really an mp4, but the report below is what speaks for it');
  DB.updateProject(p.id, { video_path: video });
  writeFileSync(join(dir, 'qc_report.json'), JSON.stringify({ qc: { ok: true, duration: 21.4, expectDur: 21, issues: [] } }));
  const v = await projectVerdict(p.id);
  assert.equal(v.publishable, true, `unexpected blockers: ${JSON.stringify(v.reasons)}`);
  assert.equal(v.checks.video.duration, 21.4);
  // The fixture scene carries no design, which the artifact scan notes — a warning, not a refusal.
  assert.ok(v.score >= 90, `score ${v.score}`);
  assert.deepEqual(v.reasons.filter((r) => r.severity === 'blocker'), []);
  assert.ok(v.cost, 'the bill travels with the verdict');
});

test('a channel with the script contract on can refuse its own script', async () => {
  const bad = 'As a financial advisor I recommend you buy before it is too late.';
  const p = project({ status: 'done', config: { scriptAudit: { mode: 'block' } }, voice: bad });
  const dir = DB.projectDirFor(p.id);
  const video = join(dir, 'final.mp4');
  writeFileSync(video, 'x');
  writeFileSync(join(dir, 'qc_report.json'), JSON.stringify({ qc: { ok: true, duration: 10, issues: [] } }));
  DB.updateProject(p.id, { video_path: video });
  const v = await projectVerdict(p.id);
  assert.equal(v.publishable, false);
  assert.ok(codes(v).includes('script.audit'));
  assert.equal(v.reasons.find((r) => r.code === 'script.audit').severity, 'blocker');

  // The same script under 'warn' is a note, not a refusal.
  const warned = project({ status: 'done', config: { scriptAudit: 'warn' }, voice: bad });
  const wdir = DB.projectDirFor(warned.id);
  writeFileSync(join(wdir, 'final.mp4'), 'x');
  writeFileSync(join(wdir, 'qc_report.json'), JSON.stringify({ qc: { ok: true, duration: 10, issues: [] } }));
  DB.updateProject(warned.id, { video_path: join(wdir, 'final.mp4') });
  const wv = await projectVerdict(warned.id);
  assert.equal(wv.publishable, true);
  assert.equal(wv.reasons.find((r) => r.code === 'script.audit').severity, 'warning');
});

test('over HTTP, with the same shape an agent branches on', async () => {
  const app = express();
  app.use('/api', express.json({ limit: '2mb' }));
  mountRoutes(app, { version: 'test' });
  app.use('/api', errorHandler);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  try {
    const p = project({ status: 'draft' });
    const r = await fetch(`${base}/projects/${p.id}/verdict`);
    const body = await r.json();
    assert.equal(r.status, 200);
    assert.equal(body.publishable, false);
    assert.equal(typeof body.score, 'number');
    assert.ok(Array.isArray(body.reasons));
    const missing = await fetch(`${base}/projects/nope/verdict`);
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).code, 'not_found');
  } finally { server.close(); }
});

test('the vision review is off unless a channel turns it on, and never fails a video by breaking', async () => {
  const { visionSettings, visionReview } = await import('../src/api/services/vision-review.js');
  assert.equal(visionSettings({}).enabled, false);
  assert.equal(visionSettings({ visionReview: { enabled: true } }).minScore, 6, 'a default bar');
  assert.equal(visionSettings({ visionReview: { enabled: true, minScore: 99 } }).minScore, 10, 'clamped to the scale');

  const p = project({ status: 'done' });
  assert.equal(await visionReview(p.id, {}), null, 'off means no call at all');
  // Turned on with no usable model: the review reports itself unavailable rather than failing the video.
  assert.equal(await visionReview(p.id, { visionReview: { enabled: true } }, { llm: { enabled: false } }), null);
  const v = await projectVerdict(p.id);
  assert.equal(v.checks.video.vision, null);
  assert.ok(!v.reasons.some((r) => r.code === 'video.vision_score'));
});
