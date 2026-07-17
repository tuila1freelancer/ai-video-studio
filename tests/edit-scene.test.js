// P23 — edit-scene-by-prompt: one instruction rewrites the current source through the SAME
// lint gate as fresh codegen; a violating edit is rejected with defects and persists nothing;
// a clean edit persists, snapshots a take and invalidates the rendered clip.
import './_env.mjs';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import * as DB from '../src/db/index.js';
import { editSceneByPrompt } from '../src/api/services/edit-scene.js';
import { closeBrowser } from '../src/media/puppeteer.js';

after(() => closeBrowser());

function seedScene() {
  const pid = DB.createProject({ topic: 'edit test', config: { visualMode: 'hyperframe' } }).id;
  const rows = DB.replaceScenes(pid, [{ voice: 'một cảnh thử nghiệm', visual: '[MAIN FOCUS] test card' }]);
  const sc = rows[0];
  DB.updateScene(sc.id, {
    template: 'hyperframe', duration: 5,
    props: {
      css: '.x{color:#fff}', html: '<div class="hf-center"><div id="kw" class="hf-kw">THỬ</div></div>',
      script: 'FX.beat(tl, "#kw", 0.4, DUR, { in: "rise", out: "none" });',
      guide: null, beats: [{ t0: 0.4, t1: 2 }], plannedDur: 5,
    },
    video_path: '/tmp/fake-clip.mp4',
  });
  return DB.getScene(sc.id);
}

test('P23 edit-by-prompt: a clean edit persists the new spec, snapshots a take, and clears the clip', async () => {
  const sc = seedScene();
  const reply = `@@@CSS@@@\n.x{color:#FFD700}\n@@@HTML@@@\n<div class="hf-center"><div id="kw" class="hf-kw">THỬ</div></div>\n@@@SCRIPT@@@\nFX.beat(tl, "#kw", 0.4, DUR, { in: "pop", out: "none" });\n@@@END@@@`;
  const r = await editSceneByPrompt(sc.id, 'make the keyword gold', { _chat: async () => reply });
  assert.equal(r.ok, true);
  const after = DB.getScene(sc.id);
  assert.match(after.props.css, /FFD700/);
  assert.match(after.props.script, /pop/);
  assert.equal(after.video_path, null, 'clip invalidated for re-render');
  assert.ok((DB.listTakes(sc.id, 'visual') || []).length >= 1, 'take history captured');
});

test('P23 edit-by-prompt: an edit that violates the determinism lint is rejected and persists nothing', async () => {
  const sc = seedScene();
  const bad = `@@@CSS@@@\n\n@@@HTML@@@\n<div class="hf-center"><div id="kw" class="hf-kw">THỬ</div></div>\n@@@SCRIPT@@@\nsetTimeout(() => gsap.to('#kw', {x: Math.random()*100}), 50);\n@@@END@@@`;
  const r = await editSceneByPrompt(sc.id, 'animate randomly forever', { _chat: async () => bad });
  assert.equal(r.ok, false);
  assert.ok(Array.isArray(r.defects) && r.defects.length >= 1);
  const after = DB.getScene(sc.id);
  assert.match(after.props.script, /rise/, 'original spec untouched');
  assert.equal(after.video_path, '/tmp/fake-clip.mp4', 'clip untouched');
});

test('P23 edit-by-prompt: a malformed reply (no fences) is a clean rejection', async () => {
  const sc = seedScene();
  const r = await editSceneByPrompt(sc.id, 'do something', { _chat: async () => 'sorry, here is a description instead' });
  assert.equal(r.ok, false);
  assert.match(r.error, /format/);
});
