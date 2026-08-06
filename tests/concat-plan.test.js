// The logo toggle, and how much work a re-concat is allowed to cost.
//
// Both halves of this file exist because of the same failure: assembly used to be one shape
// regardless of what changed. The logo could only ever be switched ON (the resolver had no way
// to answer "no"), and every re-concat paid for a full re-encode even when the edit touched no
// pixels at all.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveConcatLogo, logoRect } from '../src/media/logo-overlay.js';
import { concatFingerprint, needsVideoFilter, planConcat, clipStamp, TIER_LOG } from '../src/pipeline/concat-plan.js';

const SIZE = { w: 1920, h: 1080 };
const BK = (finalOverlay) => ({ brandKit: { logo: { assetPath: '/logo.png' }, finalOverlay } });

// ---------------------------------------------------------------- the logo toggle

test('turning the stamp off in the Brand Kit actually turns it off', () => {
  // THE bug. The old resolver was `if (bkLogo && !config.logo?.path) config.logo = …` — an
  // assignment with no negative branch, so once a logo had been resolved the switch was
  // one-way and re-concatting kept stamping it.
  const on = resolveConcatLogo(BK({ enabled: true, cxPct: 0.93, cyPct: 0.12, wPct: 0.075 }), SIZE);
  assert.equal(on.path, '/logo.png');
  assert.equal(resolveConcatLogo(BK({ enabled: false }), SIZE), null);
  assert.equal(resolveConcatLogo(BK({}), SIZE), null, 'a finalOverlay without enabled is off');
});

test('a project can refuse the channel logo for itself', () => {
  const bk = BK({ enabled: true, cxPct: 0.93, cyPct: 0.12, wPct: 0.075 });
  assert.equal(resolveConcatLogo({ ...bk, logo: null }, SIZE), null, 'explicit null = off');
  assert.equal(resolveConcatLogo({ ...bk, logo: { enabled: false } }, SIZE), null);
  const own = resolveConcatLogo({ ...bk, logo: { path: '/own.png', cxPct: 0.1, cyPct: 0.9, wPct: 0.2 } }, SIZE);
  assert.equal(own.path, '/own.png', 'a project override wins over the channel stamp');
});

test('an explicit finalOverlay never falls back to the legacy placement', () => {
  // The legacy branch exists so pre-stamp configs keep their logo. It must not resurrect a
  // stamp the owner just switched off — which needs `finalOverlay !== undefined` to short it.
  const legacy = { brandKit: { logo: { assetPath: '/logo.png', sizePct: 8.5 }, placement: 'always' } };
  assert.ok(resolveConcatLogo(legacy, SIZE), 'no finalOverlay key at all → migrate');
  assert.equal(
    resolveConcatLogo({ brandKit: { ...legacy.brandKit, finalOverlay: { enabled: false } } }, SIZE),
    null,
    'an explicit off beats the migration',
  );
});

test('no logo asset means no stamp, whatever the flags say', () => {
  assert.equal(resolveConcatLogo({ brandKit: { finalOverlay: { enabled: true } } }, SIZE), null);
  assert.equal(resolveConcatLogo({}, SIZE), null);
  assert.equal(resolveConcatLogo(undefined, SIZE), null);
});

test('the resolved stamp still lands where the Brand Kit preview drew it', () => {
  // resolveConcatLogo must not quietly re-normalise the geometry: the preview and the burn
  // share logoRect, and TheMoneyUncle's saved placement is a 144px square inset 58px.
  const fo = resolveConcatLogo(BK({ enabled: true, cxPct: 0.9323, cyPct: 0.1204, wPct: 0.075, opacity: 0.95 }), SIZE);
  const r = logoRect(fo, { W: 1920, H: 1080, logoW: 600, logoH: 600 });
  assert.equal(r.lw, 144);
  assert.equal(r.y, 58);
  assert.equal(1920 - (r.x + r.lw), 58);
});

// ---------------------------------------------------------------- how much work

let dir;
let CLIPS;
const clip = (name, body) => {
  const p = join(dir, name);
  writeFileSync(p, body);
  return p;
};
test.before(() => {
  dir = mkdtempSync(join(tmpdir(), 'avs-concat-'));
  // written ONCE: clipStamp keys on mtime, so re-creating the files between two fingerprints
  // would make identical inputs look changed (which is exactly the behaviour it is there for)
  CLIPS = [clip('a.mp4', 'aaa'), clip('b.mp4', 'bbb')];
});
test.after(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });

const base = () => ({
  clips: CLIPS,
  size: SIZE, fps: 30, transitions: null, logo: null, watermark: null, assText: null,
  masterFade: true, encoder: 'quality', bgmPath: null, sfxPath: null, bgmVol: null,
});

test('clips are identified by content, not just by name', () => {
  const p = clip('same.mp4', 'one');
  const before = clipStamp([p]);
  writeFileSync(p, 'a different body entirely');
  assert.notDeepEqual(clipStamp([p]), before, 'a re-rendered clip must not read as unchanged');
  assert.match(clipStamp(['/does/not/exist.mp4'])[0], /missing$/);
});

test('the fingerprint splits video work from audio work', () => {
  const a = concatFingerprint(base());
  // swapping the music bed moves ONLY the audio half — that is what makes the cheap tier legal
  const b = concatFingerprint({ ...base(), bgmPath: clip('bgm.m4a', 'music') });
  assert.equal(a.video, b.video);
  assert.notEqual(a.audio, b.audio);
  assert.notEqual(a.all, b.all);
  // adding a logo moves the video half
  const c = concatFingerprint({ ...base(), logo: { path: '/l.png', cxPct: 0.9, cyPct: 0.1, wPct: 0.08, opacity: 0.9 } });
  assert.notEqual(a.video, c.video);
});

test('the burned subtitle text is hashed, not its filename', () => {
  // the .ass file is rewritten on every run, so a path would always look "changed"
  const a = concatFingerprint({ ...base(), assText: 'Dialogue: one' });
  const b = concatFingerprint({ ...base(), assText: 'Dialogue: one' });
  const c = concatFingerprint({ ...base(), assText: 'Dialogue: two' });
  assert.equal(a.video, b.video, 'same captions → same video');
  assert.notEqual(a.video, c.video, 'edited captions → re-burn');
});

test('the encoder choice is part of the video identity', () => {
  assert.notEqual(
    concatFingerprint({ ...base(), encoder: 'quality' }).video,
    concatFingerprint({ ...base(), encoder: 'fast' }).video,
    'switching encoders must actually re-encode, not reuse the old file',
  );
});

test('the master fade is the one filter standing between us and a stream copy', () => {
  assert.equal(needsVideoFilter({ masterFade: true }), true);
  assert.equal(needsVideoFilter({ masterFade: false }), false);
  assert.equal(needsVideoFilter({ masterFade: false, logo: { path: '/l.png' } }), true);
  assert.equal(needsVideoFilter({ masterFade: false, assText: 'x' }), true);
  assert.equal(needsVideoFilter({ masterFade: false, watermark: { text: 'x' } }), true);
  // hard cuts need no graph; a blend does
  assert.equal(needsVideoFilter({ masterFade: false, transitions: [{ type: 'cut' }, { type: 'cut' }] }), false);
  assert.equal(needsVideoFilter({ masterFade: false, transitions: [{ type: 'cut' }, { type: 'fade', dur: 0.5 }] }), true);
});

test('an unchanged re-concat does nothing at all', () => {
  const fp = concatFingerprint(base());
  const out = clip('final.mp4', 'video');
  assert.equal(planConcat({ fp, prev: fp, prevPath: out, videoFilter: true }).tier, 'skip');
  // …but only when there is something to skip TO
  assert.equal(planConcat({ fp, prev: fp, prevPath: join(dir, 'gone.mp4'), videoFilter: true }).tier, 'encode');
  // On the first assembly of a run, "nothing changed" must not stand in for doing the work — a
  // no-op pipeline would look successful. It drops to the audio tier instead, which still
  // writes a new file; it just declines to re-encode a picture that is provably identical.
  assert.equal(planConcat({ fp, prev: fp, prevPath: out, videoFilter: true, allowSkip: false }).tier, 'audio');
});

test('changing only the music copies the picture through', () => {
  const before = concatFingerprint(base());
  const after = concatFingerprint({ ...base(), bgmPath: clip('bgm2.m4a', 'other music') });
  const out = clip('final2.mp4', 'video');
  const { tier } = planConcat({ fp: after, prev: before, prevPath: out, videoFilter: true });
  assert.equal(tier, 'audio');
});

test('with no video filter needed the clips are simply joined', () => {
  const fp = concatFingerprint({ ...base(), masterFade: false });
  assert.equal(planConcat({ fp, prev: null, prevPath: null, videoFilter: false }).tier, 'copy');
});

test('anything else pays for the full encode', () => {
  const fp = concatFingerprint({ ...base(), logo: { path: '/l.png', wPct: 0.08 } });
  assert.equal(planConcat({ fp, prev: null, prevPath: null, videoFilter: true }).tier, 'encode');
});

test('every tier has a line the owner will actually see', () => {
  for (const t of ['skip', 'audio', 'copy', 'encode']) {
    assert.ok(TIER_LOG[t] && TIER_LOG[t].length > 8, `${t} announces itself`);
  }
});
