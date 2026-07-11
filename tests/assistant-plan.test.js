// planWeek + slot editing + recurrence templates — throwaway sqlite, no network, no jobs.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as DB from '../src/db/index.js';
import { planWeek } from '../src/api/services/assistant.js';

test('planWeek: viral-first order, past times skipped, slots carry config, rows flip to scheduled', () => {
  const rows = DB.recordSuggestionBatch({ channelId: DB.activeChannelId(), topics: [
    { topic: 'Plan topic low viral', score: { viral: 3, evergreen: 5, difficulty: 2, why: '' } },
    { topic: 'Plan topic high viral', score: { viral: 9, evergreen: 5, difficulty: 2, why: '' } },
    { topic: 'Plan topic no score' },
  ] });
  // fixed reference: today 12:00 local → 08:00 today is past, 19:30 today is future
  const ref = new Date(); ref.setHours(12, 0, 0, 0);
  const { slots, planned, skipped } = planWeek({
    days: 2, perDay: 2, times: ['08:00', '19:30'], startAt: ref.getTime(),
    config: { aspectRatio: '16:9' },
  });
  assert.equal(planned, 3, 'grid has 3 future cells (today 19:30 + both tomorrow)');
  assert.equal(skipped, 0);
  assert.equal(slots[0].topic, 'Plan topic high viral', 'best viral score gets the earliest slot');
  const d0 = new Date(slots[0].due_at);
  assert.equal(`${d0.getHours()}:${d0.getMinutes()}`, '19:30', 'today 08:00 was skipped as past');
  for (const s of slots) {
    assert.equal(s.config.aspectRatio, '16:9', 'shared config rides every slot');
    assert.ok(s.config.assistantBrief.suggestionId, 'provenance kept');
  }
  const statuses = rows.map((r) => DB.getSuggestion(r.id).status);
  assert.deepEqual(statuses.sort(), ['scheduled', 'scheduled', 'scheduled']);
});

test('planWeek with topicIds schedules exactly those, in the given order', () => {
  const rows = DB.recordSuggestionBatch({ channelId: DB.activeChannelId(), topics: [
    { topic: 'Series ep một thử' }, { topic: 'Series ep hai thử' },
  ] });
  const ref = new Date(); ref.setHours(6, 0, 0, 0);
  const { planned, slots } = planWeek({
    days: 3, perDay: 1, times: ['09:00'], startAt: ref.getTime(),
    topicIds: rows.map((r) => r.id),
  });
  assert.equal(planned, 2);
  assert.deepEqual(slots.map((s) => s.topic), ['Series ep một thử', 'Series ep hai thử']);
});

test('updateSlot: edits queued slots only', () => {
  const slot = DB.addSlot({ topic: 'Slot chỉnh sửa thử', dueAt: Date.now() + 3600e3 });
  assert.equal(DB.updateSlot(slot.id, { config: { fps: 60 }, dueAt: slot.due_at + 60000 }), 1);
  const edited = DB.listSlots().find((s) => s.id === slot.id);
  assert.equal(edited.config.fps, 60);
  assert.equal(edited.due_at, slot.due_at + 60000);
  DB.cancelSlot(slot.id);
  assert.equal(DB.updateSlot(slot.id, { dueAt: Date.now() }), 0, 'cancelled slots are immutable');
  assert.equal(DB.updateSlot(slot.id, {}), 0, 'no fields → no-op');
});

test('recurrences: validated CRUD; templates carry no execution machinery', () => {
  assert.throws(() => DB.addRecurrence({ weekday: 9, time: '08:00' }), /không hợp lệ/);
  assert.throws(() => DB.addRecurrence({ weekday: 1, time: 'morning' }), /không hợp lệ/);
  const rec = DB.addRecurrence({ channelId: DB.activeChannelId(), weekday: 1, time: '08:00', config: { fps: 30 } });
  assert.equal(rec.weekday, 1);
  assert.deepEqual(rec.config, { fps: 30 });
  assert.ok(DB.listRecurrences(DB.activeChannelId()).some((r) => r.id === rec.id));
  assert.equal(DB.deleteRecurrence(rec.id), 1);
  assert.ok(!DB.listRecurrences().some((r) => r.id === rec.id));
});
