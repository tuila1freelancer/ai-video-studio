// Changing a logo or a subtitle on a finished video: a way in, and something to watch.
//
// Requirement: changing a channel's logo or subtitles must offer to re-render the finished video,
// with a live processing log that shows progress in real time.
//
// Everything needed already existed and none of it was reachable or visible:
//   - finalize reads the brand kit LIVE from the channel, so a new logo costs one join — but
//     saving the Brand Kit ended with a toast about FUTURE videos and nothing else;
//   - the change queue could price the work — but it compared two snapshots that a Brand Kit edit
//     never touches, so it answered "nothing changed" at the exact moment something had;
//   - the journal is live over the websocket — but the join, the longest step in the app, ran at
//     `-loglevel error` and said nothing at all from start to finish.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as DB from '../src/db/index.js';
import { ffProgress } from '../src/pipeline/render.js';
import { planChanges } from '../src/api/services/change-plan.js';
import { sourceOf, indexHtml } from './_source.mjs';


test('the encode reports how far it has got', () => {
  const seen = [];
  const tick = ffProgress(200, (p) => seen.push(p));
  tick('frame=1\nout_time_us=N/A\n');                 // the first block or two carry no time
  assert.deepEqual(seen, []);
  tick('out_time_us=20000000\nspeed=1.2x\n');         // 20s of 200s
  tick('out_time_us=20400000\n');                     // 10.2% → still 10 after rounding, no line
  tick('out_time_us=30000000\n');
  assert.deepEqual(seen, [10, 15]);
  tick('out_time_us=25000000\n');                     // never goes backwards
  assert.deepEqual(seen, [10, 15]);
  // ffmpeg writes several blocks per chunk when the pipe buffers; the LAST one is the truth
  tick('out_time_us=40000000\nprogress=continue\nout_time_us=60000000\nprogress=continue\n');
  assert.deepEqual(seen, [10, 15, 30]);
  tick('out_time_us=200000000\n');                    // the file is not done until ffmpeg exits
  assert.equal(seen.at(-1), 99);
  assert.deepEqual(ffProgress(0, () => assert.fail('no duration, no percentage'))('out_time_us=1'), undefined);
});

test('the percentages reach the ticker and stay out of the journal', () => {
  const render = sourceOf('src/pipeline/render.js');
  assert.match(render, /args\.unshift\('-progress', 'pipe:1', '-nostats'\);/);
  assert.match(render, /onLog: ffProgress\(cut, \(pct\) => note\?\.\(`\$\{label\} · \$\{pct\}%`\), onLog\),/);
  // …and the two lines that bracket it carry no percentage, so they DO reach the journal: the
  // ticker gets the live count, the journal keeps the record of what ran and how long it took.
  assert.match(render, /note\?\.\(`\$\{label\} — \$\{sceneVideos\.length\} clip/);
  assert.match(render, /note\?\.\(`✅ Ghép xong sau \$\{Math\.round\(\(Date\.now\(\) - t0\) \/ 1000\)\}s/);
  assert.ok(!/·\s*\d{1,3}%\s*$/.test('✅ Ghép xong sau 41s → video.mp4'));
  // op() drops `· NN%` lines from the persistent journal on purpose — a fifteen-minute join would
  // otherwise write a hundred rows into it. The message format has to keep matching that filter.
  assert.match('🎞 Mã hoá video hoàn chỉnh · 42%', /·\s*\d{1,3}%\s*$/);
  assert.match(sourceOf('src/pipeline/progress.js'), /if \(!\/·\\s\*\\d\{1,3\}%\\s\*\$\/\.test\(text\)\) jlog/);
});

test('a logo edited on the channel is work the plan can see', () => {
  const ch = DB.createChannel({ name: 'brandy', config: {} });
  const p = DB.createProject({
    title: 'đã xuất', topic: 't', channelId: ch.id, aspectRatio: '16:9',
    config: { subtitleLane: 'final', masterFade: false },
  });
  DB.updateProject(p.id, { video_path: '/tmp/out.mp4' });
  // what the file on disk was made from: no stamp
  DB.recordRender({ projectId: p.id, path: '/tmp/out.mp4', duration: 60, tier: 'encode', config: { logo: null } });
  assert.deepEqual(planChanges(p.id, { subtitleLane: 'final', masterFade: false }).items, [],
    'nothing has moved yet');

  // the user turns the stamp on in the Brand Kit — which lives on the CHANNEL, and never
  // touches the project config the plan used to compare
  DB.updateChannel(ch.id, {
    config: {
      brandKit: {
        logo: { assetPath: '/tmp/logo.png' },
        finalOverlay: { enabled: true, cxPct: 0.9, cyPct: 0.1, wPct: 0.1, opacity: 0.9 },
      },
    },
  });
  const plan = planChanges(p.id, { subtitleLane: 'final', masterFade: false });
  assert.deepEqual(plan.items.map((i) => i.kind), ['concat'], 'one join, no scene renders');
  assert.match(plan.items[0].detail, /đóng dấu logo/);
  assert.equal(plan.concatOnly, true);
  assert.equal(plan.mode, 'concat');
});

test('the plan compares against the file it actually made, not a variant of it', () => {
  const ch = DB.createChannel({ name: 'variants', config: {} });
  const p = DB.createProject({ title: 'v', topic: 't', channelId: ch.id, aspectRatio: '16:9', config: { masterFade: false } });
  DB.updateProject(p.id, { video_path: '/tmp/main.mp4' });
  DB.recordRender({ projectId: p.id, path: '/tmp/main.mp4', duration: 60, tier: 'encode', config: { logo: { path: '/tmp/l.png', wPct: 0.1 } } });
  // a "no logo" cut, exported afterwards — a second deliverable, never a description of the main
  // video. Reading it as the baseline would report "đóng dấu logo" on a video that already has one.
  DB.recordRender({ projectId: p.id, path: '/tmp/nologo.mp4', duration: 60, tier: 'copy', config: { logo: null }, variant: 'Không logo' });
  assert.deepEqual(planChanges(p.id, { logo: { path: '/tmp/l.png', wPct: 0.1 }, masterFade: false }).items, []);
});

test('every place the user edits a logo or a subtitle offers the re-render', () => {
  assert.match(sourceOf('public/js/features/brandkit.js'),
    /await offerRerender\('Đã đổi nhận diện thương hiệu của kênh'\);/);
  assert.match(indexHtml(), /id="btnSubApply"/);
  assert.match(sourceOf('public/js/views/config.js'), /\$\('#btnSubApply'\)\?\.addEventListener/);
  // both doors lead to the SAME place — the cost table — so nothing starts without a price on it
  const cp = sourceOf('public/js/features/changeplan.js');
  assert.match(cp, /export async function offerRerender\(reason\)/);
  assert.match(cp, /if \(!p\?\.id \|\| !p\.video_path\) return false;/, 'nothing finished, nothing to offer');
  assert.match(cp, /if \(\['running', 'queued'\]\.includes\(p\.status\)\) return false;/);
  assert.match(cp, /if \(ok\) await openChangePlan\(\);/);
});

test('starting the work puts the live log in front of the user', () => {
  const cp = sourceOf('public/js/features/changeplan.js');
  assert.match(cp, /switchPage\('studio'\);\s*\n\s*showJournal\(\);/);
  const jr = sourceOf('public/js/features/journal.js');
  assert.match(jr, /export function showJournal\(\)/);
  assert.match(jr, /p\.classList\.remove\('closed'\);/);
  // the panel was already live — rows arrive as WS 'journal' events, deduped by id
  assert.match(jr, /export function onJournalEvent\(e\)/);
});
