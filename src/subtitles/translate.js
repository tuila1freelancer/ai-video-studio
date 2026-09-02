// The same video, captioned in another language — without re-rendering a single frame.
//
// YouTube accepts one subtitle track per language on an existing upload, so a finished video can
// reach twelve audiences for the cost of some text. It is the cheapest reach in the whole app, and
// it was not possible at all: the only export was the narration language's own cue sheet.
//
// The timings are NOT up for negotiation. They came from real word timestamps and they belong to
// audio that already exists, so translation may change the words inside a cue and nothing else —
// same count, same start, same end. That is the P20 lesson applied to a second lane: a model told
// to "translate these subtitles" will happily merge two cues into one better sentence, and the
// result desyncs from the voice for the rest of the video.
import { chatJson, llmEnabled } from '../providers/llm.js';
import { langName } from '../util/lang.js';

const BATCH = 30;

/** `00:00:01,240` — SRT's own timestamp shape. */
function srtTime(s) {
  const ms = Math.max(0, Math.round(s * 1000));
  const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
  const m = String(Math.floor(ms / 60000) % 60).padStart(2, '0');
  const sec = String(Math.floor(ms / 1000) % 60).padStart(2, '0');
  return `${h}:${m}:${sec},${String(ms % 1000).padStart(3, '0')}`;
}

/** WebVTT, which is what YouTube's caption editor and every browser player prefer. */
export function buildVtt(cues) {
  const body = (cues || []).map((c, i) => `${i + 1}\n${srtTime(c.start).replace(',', '.')} --> ${srtTime(c.end).replace(',', '.')}\n${String(c.text || '').trim()}`);
  return `WEBVTT\n\n${body.join('\n\n')}\n`;
}

/**
 * Translate a cue sheet, preserving its shape exactly.
 *
 * @param {{start:number,end:number,text:string}[]} cues
 * @param {{from:string, to:string, llm:object, onLog?:function}} opts
 * @returns {Promise<{start:number,end:number,text:string}[]>}
 * @throws when the model returns a different number of lines — a partial translation that
 *   silently drops cues is worse than none, because nothing downstream would notice.
 */
export async function translateCues(cues, { from, to, llm, onLog = () => {} } = {}) {
  const list = Array.isArray(cues) ? cues : [];
  if (!list.length) return [];
  if (!llmEnabled(llm)) throw new Error('cần bật LLM để dịch phụ đề');
  if (from === to) return list.map((c) => ({ ...c }));

  const out = list.map((c) => ({ ...c }));
  for (let i = 0; i < list.length; i += BATCH) {
    const slice = list.slice(i, i + BATCH);
    const numbered = Object.fromEntries(slice.map((c, j) => [String(i + j), String(c.text || '')]));
    const reply = await chatJson([
      { role: 'system', content: `You translate video subtitles from ${langName(from)} into ${langName(to)}.

RULES:
- Return a JSON object with EXACTLY the same keys you were given. Never merge, split, drop or add one.
- Each value is one subtitle line, and it is shown for a fixed number of seconds that you cannot
  change — so keep it close to the source's length. A line 50% longer than its source cannot be read.
- These lines were cut mid-sentence on purpose, to follow the speech. Translate each one as its own
  fragment and let them read as a sequence; do NOT rewrite them into complete sentences.
- Keep numbers, names and product names exactly as they are.` },
      { role: 'user', content: JSON.stringify(numbered, null, 1) },
    ], {
      maxTokens: 400 + slice.length * 90,
      temperature: 0.2,
      llm,
      validate: (p) => p && Object.keys(p).length === slice.length,
    });
    let filled = 0;
    for (let j = 0; j < slice.length; j++) {
      const v = reply?.[String(i + j)];
      if (typeof v === 'string' && v.trim()) { out[i + j].text = v.trim(); filled++; }
    }
    if (filled < slice.length) throw new Error(`dịch phụ đề: thiếu ${slice.length - filled} dòng — bỏ, không ghép tạm`);
    onLog(`phụ đề ${langName(to)}: ${Math.min(i + BATCH, list.length)}/${list.length} dòng`);
  }
  // The contract, asserted rather than trusted.
  if (out.length !== list.length) throw new Error('dịch phụ đề: số dòng thay đổi');
  for (let i = 0; i < list.length; i++) {
    if (out[i].start !== list[i].start || out[i].end !== list[i].end) throw new Error('dịch phụ đề: mốc thời gian bị đổi');
  }
  return out;
}
