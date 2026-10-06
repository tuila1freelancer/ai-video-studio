// P33 — CTA discipline + pinned-arc batching.
// The measured defect this kills: batched (>30-scene) videos wrote a subscribe block at
// every 25-scene boundary + a full farewell at scene 175/200, because every batch reused
// the whole-video head (3 CTA sources) and nothing detected spoken goodbyes. Now:
// (a) partial-span prompts defer to an explicit per-span CTA PLAN (prohibition included),
// (b) the pinned outline keeps batch 2+ on batch 1's arc,
// (c) a deterministic detector + strip/drop floor guarantees the contract in EVERY input
//     mode — including zero-LLM json imports of the factory's own goodbye-ridden files,
// (d) ≤30-scene single-call prompts stay byte-identical (pinned here).
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceOf } from './_source.mjs';
import { classifyCta, auditCtas, stripCtaSentences } from '../src/content/cta-audit.js';
import {
  buildMasterPrompt, batchNoteFor, ctaPlanFor, normalizeChapters, planScenes,
  generateMasterScenes,
} from '../src/content/master-script.js';
import { scoreScript } from '../src/content/scorer.js';

const mkVisual = (focus) => `[ENVIRONMENT] deep space [MAIN FOCUS] ${focus} [CAMERA] slow zoom [MOTION FLOW] rises [LIGHTING & FX] glow [TEXT STYLE] bold [ON-SCREEN TEXT] nhãn [MOOD] calm`;

test('P33 lexicon: Vietnamese + English CTA/farewell phrases classify per sentence', () => {
  assert.deepEqual(classifyCta('Hôm nay mình nói về RAG.'), { cta: false, farewell: false, phrases: [] });
  assert.ok(classifyCta('Các bạn nhớ đăng ký kênh để không bỏ lỡ nhé.').cta);
  assert.ok(classifyCta('Đừng quên nhấn chuông thông báo.').cta);
  assert.ok(classifyCta('Hãy chia sẻ video này cho bạn bè.').cta);
  assert.ok(classifyCta('Please subscribe and hit the bell.').cta);
  assert.ok(classifyCta('Hẹn gặp lại các bạn trong video sau!').farewell);
  assert.ok(classifyCta('Cảm ơn các bạn đã theo dõi trọn vẹn video.').farewell);
  assert.ok(classifyCta('Thanks for watching, see you next time!').farewell);
  // content look-alikes must NOT trip: no channel context near the verb
  assert.ok(!classifyCta('Bạn cần đăng ký khóa học kế toán trước kỳ thi.').cta);
  assert.ok(!classifyCta('Ngân hàng yêu cầu đăng ký thông tin sinh trắc học.').cta);
  // a mixed line keeps both classifications
  const mixed = classifyCta('RAG giúp AI tra cứu tài liệu. Cảm ơn các bạn đã xem.');
  assert.ok(mixed.farewell && mixed.phrases.length === 1);
});

test('P33 auditCtas: the measured 200-scene disease → exact defect set', () => {
  const texts = Array.from({ length: 200 }, (_, i) => `Cảnh ${i + 1} dạy một ý cụ thể về chủ đề.`);
  // batch-tail subscribe blocks (the real pmru7hr pattern) + a mid farewell at scene 175
  for (const stt of [25, 50, 75, 100, 125, 150]) texts[stt - 1] += ' Các bạn nhớ đăng ký kênh ngay nhé.';
  texts[174] += ' Hẹn gặp lại các bạn trong các video tiếp theo.';
  texts[199] += ' Đăng ký kênh để không bỏ lỡ video sau.';
  const { defects } = auditCtas(texts);
  const farewell = defects.find((d) => d.code === 'FAREWELL_MID');
  assert.ok(farewell && farewell.idx.includes(174), 'scene 175 farewell caught');
  const excess = defects.find((d) => d.code === 'CTA_EXCESS');
  assert.ok(excess && excess.idx.length >= 5, 'batch-tail CTAs beyond the budget flagged');
  assert.ok(!excess.idx.includes(199), 'the closing CTA is allowed');
  const kept = [25, 50, 75, 100, 125, 150].map((s) => s - 1).filter((i) => !excess.idx.includes(i));
  assert.equal(kept.length, 1, 'exactly ONE mid CTA survives (nearest 30%)');
  assert.equal(kept[0], 49, 'scene 50 is nearest 0.3×200=60 among the tails');
});

test('P33 auditCtas: a clean short script passes untouched', () => {
  const texts = [
    'RAG là cách cho AI tra cứu tài liệu.',
    'Hệ thống tìm đoạn liên quan nhất.',
    'Nếu thấy hữu ích, các bạn lưu lại video này nhé.',
    'Ví dụ: đội kế toán giảm 40% thời gian tra cứu.',
    'Vậy nên hãy dọn tài liệu trước. Đăng ký kênh để xem phần hai nhé.',
  ];
  assert.deepEqual(auditCtas(texts).defects, []);
});

test('P33 strip floor: farewell sentence stripped, farewell-only scene gutted', () => {
  const r = stripCtaSentences('RAG giúp AI trả lời đúng hơn. Hẹn gặp lại các bạn ở video sau!', { farewellOnly: true });
  assert.equal(r.voice, 'RAG giúp AI trả lời đúng hơn.');
  assert.equal(r.removed.length, 1);
  assert.ok(!r.gutted);
  const only = stripCtaSentences('Cảm ơn các bạn đã xem. Hẹn gặp lại các bạn!', { farewellOnly: true });
  assert.ok(only.gutted, 'nothing informational left → caller drops the scene');
});

test('P33 json import (zero-LLM): factory-style goodbye blocks come out clean', async () => {
  const scenes = [];
  for (let i = 1; i <= 12; i++) scenes.push({ stt: i, voice: `Cảnh ${i} dạy một ý cụ thể về chủ đề đầu tư dài hạn.`, visual: mkVisual(`focus ${i}`) });
  scenes[5].voice += ' Hẹn gặp lại các bạn trong video tiếp theo!';           // mixed scene → strip
  scenes.splice(8, 0, { stt: 9, voice: 'Cảm ơn các bạn đã theo dõi. Hẹn gặp lại các bạn!', visual: mkVisual('bye') }); // farewell-only → drop
  const logs = [];
  const out = await generateMasterScenes({ input: JSON.stringify({ scenes }), config: {}, onLog: (m) => logs.push(m) });
  assert.equal(out.mode, 'json');
  assert.equal(out.scenes.length, 12, 'farewell-only scene dropped');
  const all = out.scenes.map((s) => s.voice).join(' ');
  assert.ok(!/Hẹn gặp lại/i.test(all), 'no mid-video farewell survives the floor');
  assert.ok(logs.some((m) => m.includes('Kỷ luật CTA')), 'the floor logs what it cut');
  // the canonical export mirrors the floored scenes
  assert.equal(out.raw.scenes.length, 12);
});

test('P33 ctaPlanFor: ~30% soft slot, clamped ends', () => {
  assert.deepEqual(ctaPlanFor(200), { softStt: 60, closingStt: 200 });
  assert.deepEqual(ctaPlanFor(10), { softStt: 3, closingStt: 10 });
  assert.equal(ctaPlanFor(3).softStt, 2, 'never scene 1 / the closing pair');
});

test('P33 batch notes: prohibition / soft-CTA / closing variants, span-relative', () => {
  const ctaPlan = ctaPlanFor(200);
  const middle = batchNoteFor({ label: 'batch 4/8', from: 76, to: 100, targetCount: 200, tail: '  - "…"', closes: false, ctaPlan });
  assert.match(middle, /NO call-to-action and NO farewell/);
  assert.match(middle, /see-you-next-time/);
  assert.match(middle, /CONTINUES after scene 100/);
  const soft = batchNoteFor({ label: 'batch 3/8', from: 51, to: 75, targetCount: 200, tail: 'x', closes: false, ctaPlan });
  assert.match(soft, /scene 60 \(scene 10 of this span\) carries this video's ONE soft CTA/);
  const last = batchNoteFor({ label: 'batch 8/8', from: 176, to: 200, targetCount: 200, tail: 'x', closes: true, ctaPlan });
  assert.match(last, /the video ENDS in this span/);
  assert.match(last, /ONE natural closing line \(subscribe\)/);
  assert.ok(!/NO call-to-action and NO farewell/.test(last));
  // whole-video single call → no note at all (byte-stable head path)
  assert.equal(batchNoteFor({ from: 1, to: 20, targetCount: 20, tail: '', closes: false, ctaPlan: ctaPlanFor(20) }), '');
});

test('P33 pinned outline: chapters normalize to exact coverage; note restates the plan', () => {
  const chs = normalizeChapters([
    { from: 3, to: 30, goal: 'mở vấn đề', keyPoints: ['a', 'b'], bridgeOut: 'sang giải pháp' },
    { from: 28, to: 60, goal: 'giải pháp' },
  ], 75);
  assert.equal(chs[0].from, 1);
  assert.equal(chs[chs.length - 1].to, 75);
  for (let i = 1; i < chs.length; i++) assert.equal(chs[i].from, chs[i - 1].to + 1, 'gapless');
  const outline = { throughline: 'Đầu tư dài hạn thắng nhờ kỷ luật.', spine: ['gap', 'proof', 'payoff'], chapters: chs };
  const note = batchNoteFor({ label: 'batch 2/3', from: 31, to: 60, targetCount: 75, tail: 'x', closes: false, ctaPlan: ctaPlanFor(75), outline });
  assert.match(note, /PINNED VIDEO PLAN/);
  assert.match(note, /Đầu tư dài hạn thắng nhờ kỷ luật\./);
  assert.match(note, /giải pháp/);
});

test('P33 partial head: all three CTA sources are neutralized; single-call head unchanged', () => {
  const plan = planScenes({ videoDuration: 300, sceneDuration: 7, language: 'vi' });
  const [, partial] = buildMasterPrompt({ mode: 'topic', input: 'API là gì', plan, language: 'vi', sttBase: 26, expect: 15, batchNote: '\n\nBATCH CONTEXT: batch 2/2' });
  assert.ok(!partial.content.includes('one natural line to subscribe'), 'spine-clause closing order gone');
  assert.ok(!partial.content.includes('25-40% of the video'), 'CTA-placement order gone');
  assert.ok(!/Content arc[^\n]*\+ CTA/.test(partial.content), 'structure-guide CTA tail stripped');
  assert.match(partial.content, /follow the CTA PLAN in the BATCH CONTEXT below EXACTLY/);
  const [, single] = buildMasterPrompt({ mode: 'topic', input: 'API là gì', plan, language: 'vi' });
  assert.ok(single.content.includes('one natural line to subscribe'));
  assert.ok(single.content.includes('25-40%'));
  assert.match(single.content, /- Content arc: hook/);
  // 'script' polish mode: the blanket ADD-CTA permission only exists on the single call
  const [, ps] = buildMasterPrompt({ mode: 'script', input: 'x '.repeat(100), plan, language: 'vi', batchNote: '\n\nBATCH CONTEXT: b' });
  assert.ok(!ps.content.includes('ADD a soft mid-video CTA'));
  assert.match(ps.content, /NEVER add any CTA or farewell/);
  const [, ss] = buildMasterPrompt({ mode: 'script', input: 'x '.repeat(100), plan, language: 'vi' });
  assert.ok(ss.content.includes('ADD a soft mid-video CTA'));
});

test('P33 scorer: farewell/cta-excess/hook-weak/idea-repeat/anchorless fire correctly', () => {
  const mk = (voices) => voices.map((v, i) => ({ idx: i, voice_text: v }));
  const farewell = scoreScript(mk([
    'Cảnh một dạy về lãi kép với ví dụ ngân hàng Vietcombank trả 5 phần trăm.',
    'Cảm ơn các bạn đã xem, hẹn gặp lại các bạn trong video sau!',
    'Cảnh ba tiếp tục phân tích số liệu 12% tăng trưởng của quỹ chỉ số.',
  ]), { sceneDuration: 7, language: 'vi' });
  assert.ok(farewell.issues.some((x) => x.type === 'farewell' && x.idx === 1));
  const excess = scoreScript(mk([
    'Mở đầu bằng khoảng trống kiến thức cụ thể về thuế thu nhập cá nhân.',
    'Các bạn nhớ đăng ký kênh ngay bây giờ nhé, rất nhiều video hay đang chờ.',
    'Phần hai giải thích biểu thuế luỹ tiến với ví dụ mức lương 20 triệu đồng.',
    'Hãy chia sẻ video này cho bạn bè của các bạn cùng xem nhé.',
    'Phần ba nói về quyết toán thuế qua ứng dụng eTax với 3 bước cụ thể.',
    'Nhớ đăng ký kênh và nhấn chuông để nhận video mới nhé.',
    'Kết video: quay lại khoảng trống mở đầu và chốt hành động. Đăng ký kênh nhé.',
  ]), { sceneDuration: 7, language: 'vi' });
  assert.ok(excess.issues.some((x) => x.type === 'cta-excess'), 'surplus mid CTA flagged');
  assert.ok(excess.issues.some((x) => x.type === 'cta-cluster'), 'clustered mid CTAs flagged');
  const hook = scoreScript(mk(['Xin chào các bạn, chào mừng quay lại với kênh của mình!', 'Nội dung chính bắt đầu với số liệu 45% cụ thể.']), { sceneDuration: 7, language: 'vi' });
  assert.ok(hook.issues.some((x) => x.type === 'hook-weak' && x.idx === 0));
  const rep = scoreScript(mk([
    'Lãi kép nghĩa là tiền lãi sinh thêm lãi theo thời gian dài hạn.',
    'Ví dụ gửi 100 triệu lãi suất 6 phần trăm sau 12 năm thành 201 triệu.',
    'Tiền lãi sinh thêm lãi theo thời gian dài hạn chính là lãi kép.',
  ]), { sceneDuration: 7, language: 'vi' });
  assert.ok(rep.issues.some((x) => x.type === 'idea-repeat' && x.idx === 2), 'paraphrased re-teach flagged');
  const anchor = scoreScript(mk(['Đầu tư là việc rất quan trọng.', 'Ví dụ quỹ VFMVN30 tăng 18% trong 2024, mình phân tích cụ thể ngay đây cho các bạn theo dõi.']), { sceneDuration: 7, language: 'vi' });
  assert.ok(anchor.issues.some((x) => x.type === 'anchorless' && x.idx === 0));
});

test('P33 editorial: instruction table covers every new defect type + chunked drain + strip floor', () => {
  const src = sourceOf('src/pipeline/stages/editorial.js');
  for (const t of ['farewell', 'cta-excess', 'cta-cluster', 'idea-repeat', 'hook-weak', 'anchorless', 'seam', 'arc-unresolved']) {
    assert.ok(src.includes(`- ${t}:`), `FIX_RULES entry for ${t}`);
  }
  assert.match(src, /MAX_CHUNKS = 3/);
  assert.match(src, /ctaStripFloor/);
  assert.match(src, /coherenceReadThrough/);
  assert.match(src, /scenes\.length > 30/, 'read-through only for batched-length videos');
});

test('P33 source pin: the shared head no longer force-feeds closing CTAs to batches', () => {
  const src = sourceOf('src/content/master-script.js');
  assert.match(src, /partial = !!batchNote/, 'partial-span switch exists');
  assert.match(src, /enforceCtaFloor/, 'deterministic floor wired into the pipeline shape');
  assert.match(src, /generateOutline/, 'pinned outline for batched videos');
  assert.match(src, /outline: null/, "script mode keeps the user's arc (no outline)");
});
