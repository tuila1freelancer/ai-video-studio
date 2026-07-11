// Topic autopilot — turn trend signals + the channel's Show Bible into channel-voiced
// Vietnamese topic PROPOSALS, deduped against everything the channel already made.
// Proposals are DATA: the owner picks which ones become videos (batch/calendar) —
// nothing here starts a paid pipeline on its own.
import * as DB from '../../db/index.js';
import { chatJson, llmEnabled } from '../../providers/llm.js';
import { fetchTrends } from '../../providers/trends.js';

function fold(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

export async function suggestTopics({ channelId = null, niche = '', count = 8, ai = null } = {}) {
  const channel = channelId ? DB.getChannel(channelId) : DB.getChannel(DB.activeChannelId());
  const memory = channel ? DB.getChannelMemory(channel.id) : { bible: '', topics: [] };
  const past = new Set([
    ...memory.topics.map((t) => fold(t.t)),
    ...DB.listProjects().filter((p) => !channelId || p.channel_id === channel?.id).map((p) => fold(p.title)),
  ]);
  const trends = await fetchTrends({ niche });
  const llm = ai?.llm || null;
  if (!llmEnabled(llm)) {
    // offline: surface raw trend titles not already covered
    return { topics: trends.filter((t) => !past.has(fold(t.title))).slice(0, count)
      .map((t) => ({ topic: t.title, angle: '', source: t.source })), trends: trends.length, source: 'trends-only' };
  }
  const parsed = await chatJson([
    { role: 'system', content: 'Bạn là chiến lược gia nội dung YouTube. Trả về JSON thuần.' },
    { role: 'user', content: `Kênh: ${channel?.name || 'kênh Việt'}.${memory.bible ? `\nBối cảnh kênh: ${memory.bible.slice(0, 500)}` : ''}${niche ? `\nNgách: ${niche}` : ''}
Tín hiệu xu hướng hôm nay:\n${trends.slice(0, 20).map((t) => `- ${t.title}`).join('\n') || '(không lấy được — tự đề xuất theo ngách)'}
Các chủ đề ĐÃ làm (tuyệt đối không lặp): ${[...past].slice(0, 25).join('; ') || '(chưa có)'}
Đề xuất ${count} CHỦ ĐỀ VIDEO tiếng Việt đúng giọng kênh, mỗi cái kèm góc tiếp cận riêng.
JSON: {"topics":[{"topic":"tiêu đề chủ đề ≤80 ký tự","angle":"góc tiếp cận 1 câu","source":"trend đã dựa vào hoặc 'evergreen'"}]}` },
  ], { attempts: 2, llm, validate: (p) => Array.isArray(p.topics) && p.topics.length > 0 });
  const topics = parsed.topics
    .filter((t) => t?.topic && !past.has(fold(t.topic)))
    .slice(0, count)
    .map((t) => ({ topic: String(t.topic).slice(0, 100), angle: String(t.angle || '').slice(0, 200), source: String(t.source || '').slice(0, 80) }));
  return { topics, trends: trends.length, source: 'llm' };
}
