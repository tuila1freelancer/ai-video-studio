// P34 — assistant upgrades: the researched TOPIC is never replaced by a click-title
// (titleOverride is display metadata end-to-end), a failed slot promotion returns the idea
// to the pool, suggestions speak the CHANNEL's language, the sheet's durationMode clobber
// is fixed, and the script-approval gate is a first-class sheet option.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as DB from '../src/db/index.js';
import { scheduleSuggestion } from '../src/api/services/assistant.js';
import { suggestTopics } from '../src/api/services/topic-autopilot.js';
import { promoteDueSlots } from '../src/pipeline/scheduler.js';

const FAKE_LLM = { enabled: true, apiKey: 'k', baseUrl: 'http://fake.local', model: 'fake-m' };
const okResponse = (payload) => ({
  ok: true,
  text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }),
});
const src = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');

test('P34 schedule: slot topic = researched topic; click-title rides as titleOverride', () => {
  const [r] = DB.recordSuggestionBatch({ topics: [{ topic: 'P34 chủ đề nghiên cứu gốc về lãi kép', titles: ['Bí Mật Ngân Hàng Giấu Bạn!'] }] });
  const { slot } = scheduleSuggestion(r.id, { dueAt: Date.now() + 3600e3, config: {}, title: 'Bí Mật Ngân Hàng Giấu Bạn!' });
  assert.equal(slot.topic, 'P34 chủ đề nghiên cứu gốc về lãi kép', 'the script engine gets the topic');
  assert.equal(slot.config.titleOverride, 'Bí Mật Ngân Hàng Giấu Bạn!', 'the title is metadata');
  assert.equal(slot.config.assistantBrief.suggestionId, r.id);
});

test('P34 promote: due slot → project titled by the override, topic intact; job stays queued', () => {
  const [r] = DB.recordSuggestionBatch({ topics: [{ topic: 'P34 chủ đề promote thử nghiệm dài hạn' }] });
  const { slot } = scheduleSuggestion(r.id, { dueAt: Date.now() - 1000, config: {}, title: 'Tiêu Đề Hiển Thị' });
  promoteDueSlots(); // direct call — no tick, so the enqueued job is never claimed/executed
  const s2 = DB.getSuggestion(r.id);
  const project = DB.getProject(DB.listProjects().find((p) => p.topic === 'P34 chủ đề promote thử nghiệm dài hạn')?.id);
  assert.ok(project, 'project created from the due slot');
  assert.equal(project.title, 'Tiêu Đề Hiển Thị');
  assert.equal(project.topic, 'P34 chủ đề promote thử nghiệm dài hạn');
  assert.equal(s2.status, 'scheduled', 'suggestion status keeps its scheduled linkage');
  const cancelled = DB.cancelQueuedJobs(project.id);
  assert.equal(cancelled, 1, 'the promoted job was queued (and is now cleaned up)');
});

test('P34 suggestions speak the channel language', async () => {
  const ch = DB.createChannel({ name: 'EN Channel P34', config: { language: 'en' } });
  const bodies = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    bodies.push(JSON.parse(init.body));
    return okResponse({ topics: [{ topic: 'P34 English topic about compounding', angle: 'a', source: 'evergreen' }] });
  };
  try {
    const out = await suggestTopics({ channelId: ch.id, niche: 'finance', count: 4, ai: { llm: FAKE_LLM }, trendsFetcher: async () => [] });
    assert.equal(out.topics.length, 1);
    const prompt = bodies[0].messages[1].content;
    assert.match(prompt, /VIDEO TOPICS in English/, 'prompt follows channel.config.language');
    assert.ok(!prompt.includes('in Vietnamese'), 'no hard-coded Vietnamese');
  } finally { globalThis.fetch = realFetch; }
});

test('P34 source pins: sheet fixes + accept path + promote restore + estimate-cost route', () => {
  const sheet = src('../public/js/features/assistant-sheet.js');
  assert.match(sheet, /if \(v\('vd'\)\) \{ config\.videoDuration = \+v\('vd'\); config\.durationMode = 'target'; \}/,
    'durationMode applies ONLY with an explicit duration pick (the clobber bug)');
  assert.match(sheet, /data-a="gate"/, 'script-approval gate checkbox exists');
  assert.match(sheet, /config\.sceneGate = /, 'gate reaches the request config');
  assert.match(sheet, /openProject\(r\.projectId\)/, 'accept lands the owner on the new project');
  assert.match(sheet, /estimate-cost/, 'cost preview wired');
  const svc = src('../src/api/services/assistant.js');
  assert.match(svc, /topics: \[row\.topic\.trim\(\)\]/, 'accept feeds the researched topic to B2');
  assert.match(svc, /titleOverride/, 'accept carries the click-title as metadata');
  const sched = src('../src/pipeline/scheduler.js');
  assert.match(sched, /restoreSuggestionBySlot\(slot\.id\)/, 'promote failure returns the idea to the pool');
  assert.match(sched, /config\.titleOverride \|\| slot\.topic/, 'promoted project titled by the override');
  const routes = src('../src/api/routes.js');
  assert.equal((routes.match(/r\.post\('\/estimate'/g) || []).length, 1, 'the duration-estimate route is not shadowed');
  assert.equal((routes.match(/r\.post\('\/estimate-cost'/g) || []).length, 1, 'the cost route exists once');
  const scriptStage = src('../src/pipeline/stages/script.js');
  assert.match(scriptStage, /config\.titleOverride \|\| script\.title/, 'owner-picked title beats the engine title');
});
