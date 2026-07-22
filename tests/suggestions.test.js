// Suggestion-history invariants: persistence, lifecycle guards, dedupe contract, and the
// owner decision services — all against a throwaway sqlite, offline, no paid calls.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as DB from '../src/db/index.js';
import { suggestTopics, normalizeScore, normalizeTitles } from '../src/api/services/topic-autopilot.js';
import { acceptSuggestion, scheduleSuggestion } from '../src/api/services/assistant.js';

const OFFLINE = { llm: { enabled: false } };
const fakeTrends = (titles) => async () => titles.map((t) => ({ title: t, source: 'fixture' }));

test('recordSuggestionBatch: shared batch_id, insertion order, JSON round-trip', () => {
  const rows = DB.recordSuggestionBatch({ channelId: null, niche: 'n1', origin: 'llm', topics: [
    { topic: 'Batch topic one', score: { viral: 8, evergreen: 4, difficulty: 3, why: 'x' }, titles: ['A', 'B'] },
    { topic: 'Batch topic two' },
    { topic: 'Batch topic three' },
  ] });
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => r.batch_id === rows[0].batch_id), 'one batch id for the whole call');
  assert.deepEqual(rows.map((r) => r.topic), ['Batch topic one', 'Batch topic two', 'Batch topic three'], 'insertion order preserved');
  assert.deepEqual(rows[0].score, { viral: 8, evergreen: 4, difficulty: 3, why: 'x' });
  assert.deepEqual(rows[0].titles, ['A', 'B']);
  assert.equal(rows[1].score, null, 'missing score stays null — never fabricated');
});

test('status transitions: only legal moves change rows; restore clears linkage', () => {
  const [r] = DB.recordSuggestionBatch({ topics: [{ topic: 'Lifecycle guard topic' }] });
  assert.equal(DB.setSuggestionStatus(r.id, 'dismissed'), 1);
  assert.equal(DB.setSuggestionStatus(r.id, 'accepted'), 0, 'dismissed cannot jump to accepted');
  assert.equal(DB.setSuggestionStatus(r.id, 'suggested'), 1, 'restore from dismissed');
  assert.equal(DB.setSuggestionStatus(r.id, 'accepted', { projectId: 'p1' }), 1);
  assert.equal(DB.setSuggestionStatus(r.id, 'dismissed'), 0, 'accepted is final');
  assert.equal(DB.getSuggestion(r.id).project_id, 'p1');
});

test('suggestionBlockSet: used+dismissed always; pending only with includePending; expired re-suggestable', () => {
  const rows = DB.recordSuggestionBatch({ topics: [
    { topic: 'Blockset accepted topic' }, { topic: 'Blockset dismissed topic' },
    { topic: 'Blockset pending topic' }, { topic: 'Blockset expired topic' },
  ] });
  DB.setSuggestionStatus(rows[0].id, 'accepted');
  DB.setSuggestionStatus(rows[1].id, 'dismissed');
  DB.setSuggestionStatus(rows[3].id, 'expired');
  const base = DB.suggestionBlockSet();
  assert.ok(base.has(DB.foldTopic('Blockset accepted topic')));
  assert.ok(base.has(DB.foldTopic('Blockset dismissed topic')));
  assert.ok(!base.has(DB.foldTopic('Blockset pending topic')), 'pending excluded by default');
  assert.ok(!base.has(DB.foldTopic('Blockset expired topic')), 'expired returns to the pool');
  const withPending = DB.suggestionBlockSet(null, { includePending: true });
  assert.ok(withPending.has(DB.foldTopic('Blockset pending topic')));
});

test('expireSuggestions flips only stale pending rows', () => {
  const [r] = DB.recordSuggestionBatch({ topics: [{ topic: 'Expiry candidate topic' }] });
  assert.equal(DB.expireSuggestions({ olderThanMs: 14 * 864e5 }), 0, 'fresh rows stay');
  // a window in the past expires every pending row this file created so far
  assert.ok(DB.expireSuggestions({ olderThanMs: -1000 }) >= 1, 'window in the past expires it');
  assert.equal(DB.getSuggestion(r.id).status, 'expired');
});

test('suggestTopics offline: persists trends-only rows, dedupes dismissed AND pending', async () => {
  const fetcher = fakeTrends(['Ý tưởng alpha thử nghiệm', 'Ý tưởng beta thử nghiệm']);
  const r1 = await suggestTopics({ ai: OFFLINE, trendsFetcher: fetcher, niche: 'test-offline' });
  assert.equal(r1.source, 'trends-only');
  assert.equal(r1.topics.length, 2);
  assert.ok(r1.topics.every((t) => t.id && t.status === 'suggested' && t.score === null));
  DB.setSuggestionStatus(r1.topics[0].id, 'dismissed');
  const r2 = await suggestTopics({ ai: OFFLINE, trendsFetcher: fetcher, niche: 'test-offline' });
  assert.equal(r2.topics.length, 0, 'dismissed is blocked, pending is not duplicated');
  // diacritic-folded match blocks disguised repeats too
  const r3 = await suggestTopics({ ai: OFFLINE, trendsFetcher: fakeTrends(['Y tuong beta thu nghiem']), niche: 'x' });
  assert.equal(r3.topics.length, 0, 'accent-stripped variant of a pending topic is a repeat');
});

test('acceptSuggestion: reviewed config + assistantBrief + title variant reach the project', () => {
  const [r] = DB.recordSuggestionBatch({ topics: [
    { topic: 'Chủ đề nhận video ngay', angle: 'Góc A', source: 'evergreen', titles: ['Tiêu đề biến thể X'] },
  ] });
  const { projectId } = acceptSuggestion(r.id, {
    config: { aspectRatio: '16:9', tts: { provider: 'larvoice', voice: 'public:3' } },
    title: 'Tiêu đề biến thể X',
  });
  // neutralize the queued job synchronously — the scheduler tick fires on a later macrotask
  const job = DB.activeJobFor(projectId, 'pipeline');
  if (job) DB.settleJob(job.id, 'cancelled', 'test cleanup');
  const p = DB.getProject(projectId);
  assert.equal(p.title, 'Tiêu đề biến thể X', 'the picked A/B variant becomes the title');
  assert.equal(p.config.aspectRatio, '16:9');
  assert.deepEqual(p.config.tts, { provider: 'larvoice', voice: 'public:3' }, 'per-video voice override lane');
  assert.equal(p.config.assistantBrief.suggestionId, r.id);
  assert.equal(p.config.assistantBrief.angle, 'Góc A');
  const row = DB.getSuggestion(r.id);
  assert.equal(row.status, 'accepted');
  assert.equal(row.project_id, projectId);
  assert.equal(DB.setSuggestionStatus(r.id, 'dismissed'), 0, 'decided rows are locked');
});

test('scheduleSuggestion → cancel slot: config rides the slot, cancellation restores the idea', () => {
  const [r] = DB.recordSuggestionBatch({ topics: [{ topic: 'Chủ đề hẹn lịch thử', angle: 'Góc B' }] });
  const { slot } = scheduleSuggestion(r.id, { dueAt: Date.now() + 3600e3, config: { visualMode: 'hyperframe' } });
  assert.equal(slot.status, 'queued');
  assert.equal(slot.config.visualMode, 'hyperframe');
  assert.equal(slot.config.assistantBrief.suggestionId, r.id);
  assert.equal(DB.getSuggestion(r.id).status, 'scheduled');
  assert.equal(DB.getSuggestion(r.id).slot_id, slot.id);
  DB.cancelSlot(slot.id);
  assert.equal(DB.restoreSuggestionBySlot(slot.id), 1);
  const back = DB.getSuggestion(r.id);
  assert.equal(back.status, 'suggested');
  assert.equal(back.slot_id, null);
});

test('linkSuggestionProject ties a promoted slot to its suggestion', () => {
  const [r] = DB.recordSuggestionBatch({ topics: [{ topic: 'Chủ đề slot promote thử' }] });
  const { slot } = scheduleSuggestion(r.id, { dueAt: Date.now() + 3600e3 });
  assert.equal(DB.linkSuggestionProject(slot.id, 'proj_x'), 1);
  assert.equal(DB.getSuggestion(r.id).project_id, 'proj_x');
  assert.equal(DB.linkSuggestionProject(slot.id, 'proj_y'), 0, 'never overwrites an existing link');
});

test('normalizeScore/normalizeTitles: clamp, truncate, degrade to null', () => {
  assert.deepEqual(normalizeScore({ viral: 99, evergreen: 0, difficulty: 3.7, why: 'w' }),
    { viral: 10, evergreen: 1, difficulty: 4, why: 'w' });
  assert.equal(normalizeScore({ viral: 'garbage' }), null);
  assert.equal(normalizeScore('nope'), null);
  assert.deepEqual(normalizeTitles(['  A  ', '', 'B', 'C']), ['A', 'B'], 'max 2, trimmed, empties dropped');
  assert.equal(normalizeTitles('not-an-array'), null);
});
