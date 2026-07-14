// Assistant actions — the OWNER's explicit decisions on persisted topic suggestions.
// acceptSuggestion is the only function here that starts a (paid) pipeline, and it runs
// solely from a confirmed click in the UI; scheduleSuggestion/planWeek only create
// calendar slots (data) that the scheduler promotes at the owner-chosen time.
import * as DB from '../../db/index.js';
import { startBatch } from './batch.js';
import { chatJson, llmEnabled } from '../../providers/llm.js';

function loadPending(id) {
  const row = DB.getSuggestion(id);
  if (!row) { const e = new Error('gợi ý không tồn tại'); e.status = 404; throw e; }
  if (row.status !== 'suggested') { const e = new Error(`gợi ý đã ở trạng thái '${row.status}'`); e.status = 400; throw e; }
  return row;
}

/** Owner clicked "make it now": create the project (with reviewed config) and mark the row. */
export function acceptSuggestion(id, { config = {}, title = null } = {}) {
  const row = loadPending(id);
  const topicText = (title || row.topic).trim();
  const request = { ...config, assistantBrief: { suggestionId: row.id, angle: row.angle || '', source: row.source || '' } };
  const { projects } = startBatch({ topics: [topicText], config: request });
  DB.setSuggestionStatus(id, 'accepted', { projectId: projects[0] });
  return { projectId: projects[0] };
}

/** Owner scheduled it: create a calendar slot carrying the reviewed config. No job here. */
export function scheduleSuggestion(id, { dueAt, config = {}, title = null } = {}) {
  const row = loadPending(id);
  const request = { ...config, assistantBrief: { suggestionId: row.id, angle: row.angle || '', source: row.source || '' } };
  const slot = DB.addSlot({ channelId: row.channel_id, topic: (title || row.topic).trim(), config: request, dueAt });
  DB.setSuggestionStatus(id, 'scheduled', { slotId: slot.id });
  return { slot };
}

/**
 * Fill the coming days with pending suggestions (best viral score first) at the owner's
 * preferred times. Creates SLOTS ONLY — the owner confirmed the whole plan in one dialog,
 * and each slot promotes at its due time exactly like a hand-made one.
 */
export function planWeek({ channelId = null, days = 7, perDay = 1, times = ['08:00'], startAt = Date.now(), config = {}, topicIds = null } = {}) {
  const chId = channelId || DB.activeChannelId();
  let candidates;
  if (Array.isArray(topicIds) && topicIds.length) {
    candidates = topicIds.map((id) => DB.getSuggestion(id)).filter((r) => r && r.status === 'suggested');
  } else {
    candidates = DB.listSuggestions({ channelId: chId, status: 'suggested', limit: 500 })
      .sort((a, b) => (b.score?.viral ?? -1) - (a.score?.viral ?? -1) || b.created_at - a.created_at);
  }
  // Build the due-time grid: days × times, skipping moments already in the past.
  const base = new Date(startAt);
  const grid = [];
  for (let d = 0; d < days; d++) {
    for (const t of times) {
      const [hh, mm] = String(t).split(':').map((n) => parseInt(n, 10));
      if (!Number.isFinite(hh)) continue;
      const due = new Date(base.getFullYear(), base.getMonth(), base.getDate() + d, hh, mm || 0);
      if (due.getTime() > startAt) grid.push(due.getTime());
    }
  }
  grid.sort((a, b) => a - b);
  const want = Math.min(candidates.length, days * perDay, grid.length);
  const slots = [];
  for (let i = 0; i < want; i++) {
    const row = candidates[i];
    const request = { ...config, assistantBrief: { suggestionId: row.id, angle: row.angle || '', source: row.source || '' } };
    const slot = DB.addSlot({ channelId: row.channel_id || chId, topic: row.topic, config: request, dueAt: grid[i] });
    DB.setSuggestionStatus(row.id, 'scheduled', { slotId: slot.id });
    slots.push(slot);
  }
  return { slots, planned: slots.length, skipped: candidates.length - slots.length };
}

/**
 * Design a mini-series (N standalone episodes with open loops) around a seed topic and
 * persist each episode as a pending suggestion (origin 'series'). LLM required — with it
 * off we refuse rather than fabricate a series. Creates suggestion rows ONLY.
 */
export async function buildSeries({ suggestionId = null, seed = '', episodes = 5, ai = null } = {}) {
  const llm = ai?.llm || null;
  if (!llmEnabled(llm)) { const e = new Error('cần bật LLM để lên series'); e.status = 400; throw e; }
  let seedTopic = String(seed || '').trim();
  let seedAngle = '';
  let channelId = DB.activeChannelId();
  if (suggestionId) {
    const row = DB.getSuggestion(suggestionId);
    if (!row) { const e = new Error('gợi ý không tồn tại'); e.status = 404; throw e; }
    seedTopic = row.topic; seedAngle = row.angle || ''; channelId = row.channel_id || channelId;
  }
  if (seedTopic.length < 4) { const e = new Error('thiếu chủ đề gốc cho series'); e.status = 400; throw e; }
  const channel = channelId ? DB.getChannel(channelId) : null;
  const memory = channel ? DB.getChannelMemory(channel.id) : { bible: '', topics: [] };
  const n = Math.min(10, Math.max(2, parseInt(episodes, 10) || 5));
  const parsed = await chatJson([
    { role: 'system', content: 'You are a YouTube content strategist. Reply with pure JSON.' },
    { role: 'user', content: `From the seed topic: "${seedTopic}"${seedAngle ? ` (angle: ${seedAngle})` : ''}.${memory.bible ? `\nChannel context: ${memory.bible.slice(0, 400)}` : ''}
Design ONE ${n}-episode YouTube MINI-SERIES in the same language as the seed topic: each episode stands alone but hooks into the next (an open loop at the end of each episode), covering DIFFERENT facets of the topic, no overlap.
JSON: {"series":{"name":"series name ≤60 chars","description":"1-2 sentences","episodes":[{"order":1,"topic":"episode title ≤80 chars","angle":"the episode's unique angle, 1 sentence","hook":"one-line opener"}]}}` },
  ], { attempts: 2, llm, validate: (p) => Array.isArray(p.series?.episodes) && p.series.episodes.length >= 2 });
  const block = DB.suggestionBlockSet(channelId, { includePending: true });
  const eps = parsed.series.episodes
    .filter((ep) => ep?.topic && !block.has(DB.foldTopic(ep.topic)))
    .slice(0, n)
    .map((ep, i) => ({
      topic: String(ep.topic).slice(0, 100),
      angle: [String(ep.angle || '').slice(0, 150), String(ep.hook || '').slice(0, 100)].filter(Boolean).join(' — '),
      source: `series #${ep.order || i + 1}`,
    }));
  if (!eps.length) { const e = new Error('mọi tập đề xuất đều trùng chủ đề đã có'); e.status = 400; throw e; }
  const series = DB.createSeries({ channelId, name: parsed.series.name || seedTopic, description: parsed.series.description || '' });
  const rows = DB.recordSuggestionBatch({
    channelId, niche: `📚 ${series.name}`, origin: 'series', seriesId: series.id, topics: eps,
  });
  return { series, suggestions: rows };
}
