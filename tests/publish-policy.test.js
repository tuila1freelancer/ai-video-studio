import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as DB from '../src/db/index.js';
import { assertPublishAllowed, clampPrivacy, publishPolicy } from '../src/publish/policy.js';
import { quotaAllowsUpload, quotaToday, recordQuota, UNITS } from '../src/publish/quota.js';

const channelWith = (policy) => DB.createChannel({ name: `pol-${Math.random().toString(36).slice(2, 8)}`, config: { publishPolicy: policy } });
const projectIn = (ch) => DB.createProject({ title: 'p', topic: 't', inputType: 'text', aspectRatio: '16:9', config: {}, channelId: ch.id });

test('a channel with no policy keeps the behaviour that already shipped', () => {
  const p = publishPolicy(null);
  assert.equal(p.maxPrivacy, 'public', 'no ceiling declared means no ceiling imposed');
  assert.equal(p.perDay, 0);
  assert.equal(p.requireVerdict, false);
  const project = projectIn(channelWith(undefined));
  const { privacy } = assertPublishAllowed({ projectId: project.id, privacy: 'private' });
  assert.equal(privacy, 'private', 'and private stays the default the caller asked for');
});

test('privacy is clamped to the ceiling, never refused for asking', () => {
  const policy = publishPolicy({ config: { publishPolicy: { maxPrivacy: 'unlisted' } } });
  assert.equal(clampPrivacy('public', policy), 'unlisted');
  assert.equal(clampPrivacy('private', policy), 'private');
  assert.equal(clampPrivacy('nonsense', policy), 'private');
  const project = projectIn(channelWith({ maxPrivacy: 'unlisted' }));
  assert.equal(assertPublishAllowed({ projectId: project.id, privacy: 'public' }).privacy, 'unlisted');
});

test('the verdict gate refuses, and force is the way past it', () => {
  const project = projectIn(channelWith({ requireVerdict: true }));
  const bad = { publishable: false, reasons: [{ code: 'video.missing', severity: 'blocker' }] };
  let err;
  try { assertPublishAllowed({ projectId: project.id, verdict: bad }); } catch (e) { err = e; }
  assert.equal(err.code, 'verdict_failed');
  assert.equal(err.status, 409);
  assert.deepEqual(err.reasons, bad.reasons, 'the refusal carries the reasons that decided it');
  assert.equal(assertPublishAllowed({ projectId: project.id, verdict: bad, force: true }).privacy, 'private');
  assert.equal(assertPublishAllowed({ projectId: project.id, verdict: { publishable: true, reasons: [] } }).privacy, 'private');
});

test('an hour window and a daily cap are both refusals with their own code', () => {
  const now = new Date(2026, 0, 15, 14, 0, 0).getTime();
  const windowed = projectIn(channelWith({ hours: [8, 9] }));
  let err;
  try { assertPublishAllowed({ projectId: windowed.id, now }); } catch (e) { err = e; }
  assert.equal(err.code, 'publish_outside_window');
  assert.doesNotThrow(() => assertPublishAllowed({ projectId: windowed.id, now: new Date(2026, 0, 15, 8, 30).getTime() }));

  const capped = channelWith({ perDay: 1 });
  const first = projectIn(capped);
  const second = projectIn(capped);
  const rec = DB.recordPublish({ projectId: first.id, platform: 'youtube', privacy: 'private' });
  DB.settlePublish(rec, { status: 'done', videoId: 'v1', url: 'u' });
  let capErr;
  try { assertPublishAllowed({ projectId: second.id }); } catch (e) { capErr = e; }
  assert.equal(capErr.code, 'publish_daily_cap');
});

test('platform quota is counted in units and refuses before the platform does', () => {
  const ch = channelWith({});
  const project = projectIn(ch);
  assert.equal(quotaAllowsUpload(ch.id).ok, true);
  // 10,000 units a day against 1,650 for an upload (insert + thumbnail) — five fit, the sixth does not.
  for (let i = 0; i < 5; i += 1) recordQuota({ projectId: project.id, channelId: ch.id, operation: 'videos.insert' });
  assert.equal(quotaToday(ch.id).used, UNITS['videos.insert'] * 5);
  assert.equal(quotaAllowsUpload(ch.id).ok, true, '8,000 used still leaves room for one');
  recordQuota({ projectId: project.id, channelId: ch.id, operation: 'videos.insert' });
  assert.equal(quotaAllowsUpload(ch.id).ok, false, 'no room for another insert today');
  let err;
  try { assertPublishAllowed({ projectId: project.id }); } catch (e) { err = e; }
  assert.equal(err.code, 'publish_quota_exhausted');
  assert.equal(err.status, 429);
});
