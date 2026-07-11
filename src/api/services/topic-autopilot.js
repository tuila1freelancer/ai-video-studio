// Topic autopilot — turn trend signals + the channel's Show Bible into channel-voiced
// Vietnamese topic PROPOSALS, deduped against everything the channel already made,
// already scheduled, or explicitly dismissed. Proposals are DATA: every batch is
// persisted to topic_suggestions and the owner picks which ones become videos —
// nothing here starts a paid pipeline on its own.
import * as DB from '../../db/index.js';
import { chatJson, llmEnabled } from '../../providers/llm.js';
import { fetchTrends } from '../../providers/trends.js';

const fold = DB.foldTopic;

export async function suggestTopics({ channelId = null, niche = '', count = 8, ai = null, trendsFetcher = fetchTrends } = {}) {
  const channel = channelId ? DB.getChannel(channelId) : DB.getChannel(DB.activeChannelId());
  DB.expireSuggestions({ channelId: channel?.id });
  const memory = channel ? DB.getChannelMemory(channel.id) : { bible: '', topics: [] };
  const past = new Set([
    ...memory.topics.map((t) => fold(t.t)),
    ...DB.listProjects().filter((p) => !channelId || p.channel_id === channel?.id).map((p) => fold(p.title)),
    ...DB.suggestionBlockSet(channel?.id, { includePending: true }),
  ]);
  const trends = await trendsFetcher({ niche });
  const llm = ai?.llm || null;
  const persist = (topics, origin) => {
    const rows = DB.recordSuggestionBatch({ channelId: channel?.id || null, niche, origin, topics });
    return { topics: rows, trends: trends.length, source: origin, batchId: rows[0]?.batch_id || null };
  };
  if (!llmEnabled(llm)) {
    // offline: surface raw trend titles not already covered — no scores, no fabrication
    return persist(trends.filter((t) => !past.has(fold(t.title))).slice(0, count)
      .map((t) => ({ topic: t.title, angle: '', source: t.source })), 'trends-only');
  }
  const parsed = await chatJson([
    { role: 'system', content: 'Bạn là chiến lược gia nội dung YouTube. Trả về JSON thuần.' },
    { role: 'user', content: `Kênh: ${channel?.name || 'kênh Việt'}.${memory.bible ? `\nBối cảnh kênh: ${memory.bible.slice(0, 500)}` : ''}${niche ? `\nNgách: ${niche}` : ''}
Tín hiệu xu hướng hôm nay:\n${trends.slice(0, 20).map((t) => `- ${t.title}`).join('\n') || '(không lấy được — tự đề xuất theo ngách)'}
Các chủ đề ĐÃ làm (tuyệt đối không lặp): ${[...past].slice(0, 25).join('; ') || '(chưa có)'}
Đề xuất ${count} CHỦ ĐỀ VIDEO tiếng Việt đúng giọng kênh. Với MỖI chủ đề, chấm điểm khách quan:
- viral: 1-10 (độ bám xu hướng / khả năng lan truyền hôm nay)
- evergreen: 1-10 (giá trị xem lại lâu dài)
- difficulty: 1-10 (độ khó sản xuất cho video đồ hoạ tự động: cần số liệu hiếm / hình phức tạp → điểm cao)
- why: 1 câu ≤120 ký tự giải thích điểm số
và 2 phương án tiêu đề click-worthy ≤70 ký tự (một thiên cảm xúc, một thiên lợi ích cụ thể).
JSON: {"topics":[{"topic":"tiêu đề chủ đề ≤80 ký tự","angle":"góc tiếp cận 1 câu","source":"trend đã dựa vào hoặc 'evergreen'","score":{"viral":8,"evergreen":4,"difficulty":3,"why":"..."},"titles":["...","..."]}]}` },
  ], { attempts: 2, llm, validate: (p) => Array.isArray(p.topics) && p.topics.length > 0 });
  const topics = parsed.topics
    .filter((t) => t?.topic && !past.has(fold(t.topic)))
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
