// Topic autopilot — turn trend signals + the channel's Show Bible into channel-voiced
// Vietnamese topic PROPOSALS, deduped against everything the channel already made,
// already scheduled, or explicitly dismissed. Proposals are DATA: every batch is
// persisted to topic_suggestions and the user picks which ones become videos —
// nothing here starts a paid pipeline on its own.
import * as DB from '../../db/index.js';
import { chatJson, llmEnabled } from '../../providers/llm.js';
import { fetchTrends } from '../../providers/trends.js';
import { declaredLang, langName, DEFAULT_LANG } from '../../util/lang.js';


export async function suggestTopics({ channelId = null, niche = '', count = 8, ai = null, sources = {}, trendsFetcher = fetchTrends } = {}) {
  const channel = channelId ? DB.getChannel(channelId) : DB.getChannel(DB.activeChannelId());
  DB.expireSuggestions({ channelId: channel?.id });
  const memory = channel ? DB.getChannelMemory(channel.id) : { bible: '', topics: [] };
  const past = new Set([
    ...memory.topics.map((t) => DB.foldTopic(t.t)),
    ...DB.listProjects().filter((p) => !channelId || p.channel_id === channel?.id).map((p) => DB.foldTopic(p.title)),
    ...DB.suggestionBlockSet(channel?.id, { includePending: true }),
  ]);
  // The channel's own language decides which market's trends are research material. Without it,
  // an English channel asked Google News in Vietnamese and got Vietnamese headlines to write from.
  const chLang = declaredLang(channel?.config) || DEFAULT_LANG;
  const trends = await trendsFetcher({
    niche, packs: sources.packs || [], feeds: sources.feeds || [],
    language: chLang, geo: sources.geo || '',
  });
  const llm = ai?.llm || null;
  const persist = (topics, origin) => {
    const rows = DB.recordSuggestionBatch({ channelId: channel?.id || null, niche, origin, topics });
    return { topics: rows, trends: trends.length, source: origin, batchId: rows[0]?.batch_id || null };
  };
  if (!llmEnabled(llm)) {
    // offline: surface raw trend titles not already covered — no scores, no fabrication
    return persist(trends.filter((t) => !past.has(DB.foldTopic(t.title))).slice(0, count)
      .map((t) => ({ topic: t.title, angle: '', source: t.source })), 'trends-only');
  }
  // P34: propose in the CHANNEL's language, not hard-coded Vietnamese
  const langLabel = langName(chLang);
  const parsed = await chatJson([
    { role: 'system', content: 'You are a YouTube content strategist. Reply with pure JSON.' },
    { role: 'user', content: `Channel: ${channel?.name || `${langLabel} channel`}.${memory.bible ? `\nChannel context: ${memory.bible.slice(0, 500)}` : ''}${niche ? `\nNiche: ${niche}` : ''}
Today's trend signals:\n${trends.slice(0, 20).map((t) => `- ${t.title}`).join('\n') || '(unavailable — propose from the niche yourself)'}
Topics ALREADY covered (never repeat any): ${[...past].slice(0, 25).join('; ') || '(none yet)'}
Propose ${count} VIDEO TOPICS in ${langLabel}, in the channel's voice (topic, angle, why and titles all in ${langLabel}). For EACH topic, score it objectively:
- viral: 1-10 (how strongly it rides today's trends / spread potential)
- evergreen: 1-10 (long-term rewatch value)
- difficulty: 1-10 (production difficulty for an automated motion-graphics video: rare data / complex visuals → higher)
- why: 1 sentence ≤120 chars explaining the scores
plus 2 click-worthy title options ≤70 chars (one emotional, one concrete-benefit).
JSON: {"topics":[{"topic":"topic title ≤80 chars","angle":"one-sentence angle","source":"the trend it rides, or 'evergreen'","score":{"viral":8,"evergreen":4,"difficulty":3,"why":"..."},"titles":["...","..."]}]}` },
  ], { attempts: 2, llm, validate: (p) => Array.isArray(p.topics) && p.topics.length > 0 });
  const topics = parsed.topics
    .filter((t) => t?.topic && !past.has(DB.foldTopic(t.topic)))
    .slice(0, count)
    .map((t) => ({
      topic: String(t.topic).slice(0, 100),
      angle: String(t.angle || '').slice(0, 200),
      source: String(t.source || '').slice(0, 80),
      score: normalizeScore(t.score),
      titles: normalizeTitles(t.titles),
    }));
  return persist(topics, 'llm');
}

// Scores/titles are best-effort bonuses from the same LLM call — malformed input
// degrades to null (UI hides the badges) instead of fabricated numbers.
export function normalizeScore(s) {
  if (!s || typeof s !== 'object') return null;
  const clamp = (v) => { const n = Math.round(+v); return Number.isFinite(n) ? Math.min(10, Math.max(1, n)) : null; };
  const viral = clamp(s.viral); const evergreen = clamp(s.evergreen); const difficulty = clamp(s.difficulty);
  if (viral === null && evergreen === null && difficulty === null) return null;
  return { viral, evergreen, difficulty, why: String(s.why || '').slice(0, 160) };
}

export function normalizeTitles(t) {
  if (!Array.isArray(t)) return null;
  const titles = t.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim().slice(0, 80)).slice(0, 2);
  return titles.length ? titles : null;
}
