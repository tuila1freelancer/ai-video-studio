// Subtitles are printed onto the finished video. Never before it. (Owner order 2026-08-06.)
//
// The app used to offer a choice, and the other option was a trap: captions drawn inside a scene
// page are an INPUT to that scene's clip. Choosing it meant every later subtitle edit — a font, a
// colour, one word of a cue — cost one render per scene, and once the pixels were baked in there
// was no way to take them back out. The only honest way to make subtitles editable is to put them
// on last.
//
// These tests fence the three things that has to mean:
//   1. new projects are born on the final lane, and the panel does not offer the old one;
//   2. the clip underneath still LEAVES ROOM for the captions it will receive;
//   3. nothing prints captions anywhere except the join.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolveProjectConfig } from '../src/core/config.js';
import { renderFingerprint, renderCurrent } from '../src/pipeline/fingerprint.js';

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('a new project is born with its subtitles on the far side of the concat', () => {
  assert.equal(resolveProjectConfig({}).subtitleLane, 'final');
  assert.equal(resolveProjectConfig({ channel: { config: { subtitleFont: 'Anton' } } }).subtitleLane, 'final');
  // The layer sits UNDERNEATH channel/preset/request, which is what keeps it away from projects
  // that already have clips: resolveProjectConfig runs at creation and nowhere else, so no stored
  // config is rewritten and no render fingerprint moves.
  assert.equal(resolveProjectConfig({ request: { subtitleLane: 'scene' } }).subtitleLane, 'scene',
    'the old lane survives as a code-level escape hatch, not as a button');
});

test('the panel states the lane instead of offering it', () => {
  const html = src('../public/index.html');
  assert.ok(!/id="cfgSubLane"/.test(html), 'the picker is gone');
  assert.match(html, /id="subLaneHint"/, 'and what happens instead is written where it stood');
  const cfg = src('../public/js/views/config.js');
  assert.match(cfg, /subtitleLane: 'final',/, 'gatherConfig sends it as a fact');
  // Sent as the literal, never as `undefined`: an omitted key would let a channel or preset layer
  // carrying the old lane win the merge, and the panel would show one thing while the video did
  // another.
  assert.ok(!/subtitleLane:.*undefined/.test(cfg));
  // A project made before the rule is TOLD what its next save costs rather than finding out.
  assert.match(cfg, /dựng lại clip <em>không có<\/em> phụ đề/);
});

test('a clip made on the old lane reads as stale the moment the burn is switched on', () => {
  // This is what pays for the switch, and it is real work: captions already in the pixels cannot
  // be removed by a filter. The point of the test is that the app KNOWS, so the change queue can
  // price it and finalize can refuse to print a second row of subtitles over the first.
  const project = { id: 'p1', aspect_ratio: '16:9' };
  const scene = { id: 's1', idx: 0, template: 'kinetic-statement', props: { heading: 'X' }, video_path: '/tmp/x.mp4' };
  const scenecfg = { enableSubtitles: true, subtitleFont: 'Anton', subtitleFontSize: 80 };
  const finalcfg = { ...scenecfg, subtitleLane: 'final' };
  const baked = { ...scene, fp: { render: renderFingerprint(scene, { config: scenecfg, project }) } };
  assert.equal(renderCurrent(baked, { config: finalcfg, project }, scenecfg).ok, false);

  // Once it is rebuilt bare, subtitle settings stop touching it at all — which is the payoff.
  const bare = { ...scene, fp: { render: renderFingerprint(scene, { config: finalcfg, project }) } };
  assert.equal(renderCurrent(bare, { config: finalcfg, project }, finalcfg).ok, true);
  for (const edit of [{ subtitleFont: 'Bebas Neue' }, { subtitleFontSize: 96 }, { subtitleColor: '#FF0000' },
    { subtitlePosition: { preset: 'top' } }, { subtitleMode: 'plain' }, { enableSubtitles: false }]) {
    const next = { ...finalcfg, ...edit };
    assert.equal(renderCurrent(bare, { config: next, project }, finalcfg).ok, true,
      `${Object.keys(edit)[0]} must cost one join, not one render per scene`);
  }
});

test('finalize rebuilds a clip it cannot vouch for before printing on it', () => {
  const fin = src('../src/pipeline/stages/finalize.js');
  // The cheap ways in here — a concat-only "ghép lại", a variant export — skip the render stage
  // entirely. Without this, one of them on a project that just moved lanes would print captions
  // onto clips that already draw their own, and ship a video with two rows of subtitles.
  assert.match(fin, /const burnLane = config\.subtitleLane === 'final' && config\.enableSubtitles !== false;/);
  assert.match(fin, /const stale = burnLane\s*\n\s*\? all\.filter\(\(s\) => !missingIds\.has\(s\.id\) && !renderCurrent\(s, \{ config, project \}, project\.config\)\.ok\)/);
  // …and the repair STAMPS what it made. Leaving the old fingerprint next to a new file would
  // make the very next join find the same scene stale and rebuild it all over again.
  assert.match(fin, /fp: fpStamp\(sc, 'render', renderFingerprint\(sc, \{ config, project \}\)\)/);
});

test('nothing writes a subtitle onto anything except the assembled programme', () => {
  // buildAss is the only thing in the app that produces burnable subtitles. If it is ever called
  // from a per-scene path, the rule is broken no matter what the config says.
  const dir = new URL('../src/', import.meta.url);
  const walk = (u) => readdirSync(u, { withFileTypes: true }).flatMap((e) => (e.isDirectory()
    ? walk(new URL(`${e.name}/`, u))
    : (e.name.endsWith('.js') ? [new URL(e.name, u)] : [])));
  const callers = walk(dir)
    .filter((u) => /\bbuildAss\s*\(/.test(readFileSync(u, 'utf8')))
    .map((u) => u.pathname.split('/src/')[1]);
  assert.deepEqual(callers.sort(),
    // the concat itself, the builder, and the preview that pulls ONE frame back out of the
    // already-joined video to show what the next join will look like
    ['api/services/frame-preview.js', 'pipeline/render.js', 'subtitles/ass.js'],
    'only the concat and the preview of the concat build an ASS document');
  assert.match(src('../src/api/services/frame-preview.js'), /project\.video_path/,
    'and the preview reads the FINISHED video, so it cannot be a per-scene lane in disguise');
  // and the concat builds it from the offsets it has just computed, so the caption timeline and
  // the picture cannot disagree
  assert.match(src('../src/pipeline/render.js'), /const cues = programCues\(subtitles\.scenes, starts,/);
});
