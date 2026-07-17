// Master Script Engine — the ONE-master-prompt → canonical scenes JSON pipeline head.
// The fixture is the owner's REAL factory output (55 scenes): it must trip the validator
// exactly where the real file is broken (CTA notes / hashtag line / thumbnail prompt read
// aloud as scene voices, one visual stamped across all 55 scenes) — proving the gates work
// on production data, not synthetic strawmen.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  planScenes, parseScenesInput, validateScenesJson, repairScenesSpec, isMetaLeakVoice,
  buildMasterPrompt, scenesJsonFromRows, generateMasterScenes, VISUAL_BRACKETS,
} from '../src/content/master-script.js';

const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/rag-scenes.json', import.meta.url), 'utf8'));

// A well-formed 8-bracket visual with a per-scene distinct [MAIN FOCUS].
const mkVisual = (focus) => `[ENVIRONMENT] far=grid, mid=panels, near=particles. [MAIN FOCUS] ${focus}, center, dominant. [CAMERA] slow zoom in 4%. [MOTION FLOW] Entry: fade-in. Idle: float. Exit: glow-wipe. [LIGHTING & FX] cyan glow. [TEXT STYLE] bold. [ON-SCREEN TEXT] nhãn ngắn. [MOOD] clean.`;
const FOCI = ['glass document card stack', 'search beam scanning a shelf', 'node chain lighting up', 'giant stat with rising bar', 'two compare panels A/B',
  'timeline stepper with lit node', 'radial hub with satellites', 'terminal window typing', 'sticky notes clustering', 'warning marker over messy files'];
const mkScene = (i, voice) => ({ stt: i + 1, voice, visual: mkVisual(FOCI[i % FOCI.length] + ' #' + i), assets: [] });

// ---------------------------------------------------------------- planner
test('planScenes: vi arithmetic matches the shared word-budget math', () => {
  const p = planScenes({ videoDuration: 60, sceneDuration: 7, language: 'vi' });
  assert.equal(p.sceneCount, 9);          // round(60/7)
  assert.equal(p.wordsPerScene, 27);      // wordsForSlot(7, 'vi')
  assert.equal(p.minWords, 24);
  assert.equal(p.maxWords, 31);
  assert.equal(p.totalWords, 9 * 27);
  assert.ok(p.structureGuide.includes('hook'));
});

// ---------------------------------------------------------------- real-fixture gates
test('fixture: META_LEAK caught exactly on the 4 broken scenes (1,2,3,6) + MONOTONY', () => {
  const v = validateScenesJson(FIXTURE, { mode: 'json', language: 'vi' });
  assert.equal(v.spec.scenes.length, 55);
  const leaks = v.defects.filter((d) => d.code === 'META_LEAK').map((d) => d.stt).sort((a, b) => a - b);
  assert.deepEqual(leaks, [1, 2, 3, 6]);
  const mono = v.defects.find((d) => d.code === 'MONOTONY');
  assert.ok(mono, 'the stamped visual must be flagged as MONOTONY');
  assert.ok(Array.isArray(mono.stt) && mono.stt.length >= 50, `expected ≥50 duplicate visuals, got ${mono.stt?.length}`);
});

test('fixture: repair drops the meta scenes, strips duplicate visuals, renumbers stt', () => {
  const v = validateScenesJson(FIXTURE, { mode: 'json', language: 'vi' });
  const rep = repairScenesSpec(v.spec, v.defects);
  assert.equal(rep.scenes.length, 51);
  assert.equal(rep.scenes.filter((s) => isMetaLeakVoice(s.voice)).length, 0, 'P18: no META_LEAK voice survives repair');
  rep.scenes.forEach((s, i) => assert.equal(s.stt, i + 1));
  assert.ok(rep.scenes[0].voice.startsWith('RAG nghe có vẻ kỹ thuật'), 'first surviving scene is real narration');
  assert.ok(rep.scenes.every((s) => Array.isArray(s.assets)));
});

// ---------------------------------------------------------------- META_LEAK unit rows
test('isMetaLeakVoice: catches production notes, spares real narration', () => {
  for (const bad of [
    '- CTA mềm 25–40%: Sau phần phân biệt, kêu gọi lưu video.',
    '- CTA cuối video: Like, đăng ký, bình luận từ khóa "RAG".',
    'Hashtag comma-separated: #RAG, #AI, #ChatGPT, #HocAI',
    '16:9 HyperFrame thumbnail, dark navy background, big text "AI TRA CỨU"',
    'Thumbnail text chính: AI TRA CỨU TÀI LIỆU',
  ]) assert.ok(isMetaLeakVoice(bad), `should flag: ${bad}`);
  for (const good of [
    'Đến đây, nếu các bạn thấy phần phân biệt này hữu ích, hãy lưu video lại.',
    'Mô tả công việc rõ ràng giúp AI trả lời có căn cứ hơn rất nhiều.',
    'Nếu muốn nhận video tiếp theo, hãy bình luận từ khóa RAG nhé.',
    'Tỉ lệ 16:9 là lựa chọn phổ biến khi dựng video dài trên YouTube.',
  ]) assert.ok(!isMetaLeakVoice(good), `should NOT flag: ${good}`);
});

// ---------------------------------------------------------------- normalizer
test('validateScenesJson: tolerant shapes, stt renumber, field stripping, asset coercion', () => {
  const raw = {
    script: [
      { stt: 7, voice: 'Câu một đủ dài để nói.', visual: mkVisual('doc card'), assets: ['Logo', 3, null], duration: 9 },
      { text: 'Câu hai tiếp nối mạch nói.', visualPrompt: mkVisual('search beam') },
      { voice: '   ' }, // dropped
    ],
  };
  const v = validateScenesJson(raw, { mode: 'json' });
  assert.equal(v.spec.scenes.length, 2);
  assert.deepEqual(v.spec.scenes.map((s) => s.stt), [1, 2]);
  assert.deepEqual(Object.keys(v.spec.scenes[0]), ['stt', 'voice', 'visual', 'assets']);
  assert.deepEqual(v.spec.scenes[0].assets, ['Logo', '3']);
  assert.ok(v.defects.some((d) => d.code === 'EMPTY'));
  // bare array works too
  const v2 = validateScenesJson([{ voice: 'Một câu nói bình thường.' }], { mode: 'json' });
  assert.equal(v2.spec.scenes.length, 1);
});

test('validateScenesJson: thumbnail synthesized when missing, kept when present', () => {
  const withT = validateScenesJson({ scenes: [{ voice: 'A' }], thumbnail: { title: 'T', prompt: 'P' } }, {});
  assert.deepEqual(withT.spec.thumbnail, { title: 'T', prompt: 'P' });
  const noT = validateScenesJson({ scenes: [{ voice: 'Chủ đề mở đầu của video.' }] }, {});
  assert.ok(noT.spec.thumbnail.title.length > 0);
  assert.ok(noT.spec.thumbnail.prompt.length > 20);
});

test('validateScenesJson: BRACKETS gate — [MAIN FOCUS] + ≥5/8 sections, empty visual allowed', () => {
  const bad = validateScenesJson({ scenes: [{ voice: 'Nói gì đó.', visual: '[MAIN FOCUS] card. [MOOD] clean.' }] }, {});
  assert.ok(bad.defects.some((d) => d.code === 'BRACKETS'));
  const good = validateScenesJson({ scenes: [{ voice: 'Nói gì đó.', visual: mkVisual('card') }] }, {});
  assert.ok(!good.defects.some((d) => d.code === 'BRACKETS'));
  const empty = validateScenesJson({ scenes: [{ voice: 'Nói gì đó.', visual: '' }] }, {});
  assert.ok(!empty.defects.some((d) => d.code === 'BRACKETS'), 'empty visual → direction pass owns it');
});

test('validateScenesJson: MONOTONY needs a real spread of distinct [MAIN FOCUS]', () => {
  const dup = validateScenesJson({ scenes: [1, 2, 3, 4, 5].map((i) => ({ voice: `Câu ${i}.`, visual: mkVisual(`Scene ${i}: visual hóa ý chính bằng document cards`) })) }, {});
  assert.ok(dup.defects.some((d) => d.code === 'MONOTONY'));
  const ok = validateScenesJson({ scenes: FOCI.slice(0, 5).map((f, i) => ({ voice: `Câu ${i}.`, visual: mkVisual(f) })) }, {});
  assert.ok(!ok.defects.some((d) => d.code === 'MONOTONY'));
});

test('validateScenesJson: COUNT band around the target', () => {
  const scenes = (n) => ({ scenes: Array.from({ length: n }, (_, i) => mkScene(i, `Câu số ${i} nói tiếp mạch trước.`)) });
  assert.ok(validateScenesJson(scenes(5), { expect: 10 }).defects.some((d) => d.code === 'COUNT'));
  assert.ok(!validateScenesJson(scenes(9), { expect: 10 }).defects.some((d) => d.code === 'COUNT'));
});

test('validateScenesJson: POLISH_FLOOR — light edit passes, rewrite/omission fail', () => {
  const source = 'RAG là cách cho AI tra cứu tài liệu của các bạn trước khi trả lời. '
    + 'Hệ thống tìm những đoạn liên quan nhất rồi đưa cho AI đọc. '
    + 'Nếu tài liệu không được tổ chức rõ ràng, AI có thể lấy nhầm phiên bản cũ. '
    + 'Vì vậy các bạn cần dọn dẹp tài liệu trước khi đưa vào hệ thống.';
  const light = {
    scenes: [
      { voice: 'RAG là cách cho AI tra cứu tài liệu của các bạn trước khi trả lời.', visual: mkVisual(FOCI[0]) },
      { voice: 'Hệ thống tìm những đoạn liên quan nhất rồi đưa cho AI đọc kỹ.', visual: mkVisual(FOCI[1]) },
      { voice: 'Nếu tài liệu không được tổ chức rõ ràng, AI có thể lấy nhầm phiên bản cũ.', visual: mkVisual(FOCI[2]) },
      { voice: 'Vì vậy các bạn cần dọn dẹp tài liệu trước khi đưa vào hệ thống.', visual: mkVisual(FOCI[3]) },
      { voice: 'Nếu thấy video hữu ích, các bạn nhớ đăng ký kênh để xem phần tiếp theo nhé.', visual: mkVisual(FOCI[4]) }, // added CTA — allowed
    ],
  };
  assert.ok(!validateScenesJson(light, { mode: 'script', source }).defects.some((d) => d.code === 'POLISH_FLOOR'));
  const rewrite = {
    scenes: [
      { voice: 'Trí tuệ nhân tạo ngày nay phát triển thần tốc chưa từng thấy.', visual: mkVisual(FOCI[0]) },
      { voice: 'Mọi doanh nghiệp hiện đại đều muốn chuyển đổi số toàn diện.', visual: mkVisual(FOCI[1]) },
      { voice: 'Công nghệ mới mở ra vô vàn cơ hội kinh doanh hấp dẫn.', visual: mkVisual(FOCI[2]) },
    ],
  };
  const rd = validateScenesJson(rewrite, { mode: 'script', source }).defects.filter((d) => d.code === 'POLISH_FLOOR');
  assert.ok(rd.length >= 1, 'a full rewrite must trip the floor');
  const dropped = { scenes: [{ voice: 'RAG là cách cho AI tra cứu tài liệu của các bạn trước khi trả lời.', visual: mkVisual(FOCI[0]) }] };
  assert.ok(validateScenesJson(dropped, { mode: 'script', source }).defects.some((d) => d.code === 'POLISH_FLOOR'), 'dropping half the source must trip coverage');
});

// ---------------------------------------------------------------- master prompt pins
test('buildMasterPrompt (topic): plan-then-write + duration specs + persona + CTA + visual doctrine', () => {
  const plan = planScenes({ videoDuration: 60, sceneDuration: 7, language: 'vi' });
  const [sys, usr] = buildMasterPrompt({ mode: 'topic', input: 'RAG là gì', plan, language: 'vi' });
  assert.ok(/pure JSON/i.test(sys.content));
  for (const pin of ['PLAN THEN WRITE', '"throughline"', 'DURATION SPECS', 'VALUE ARCHITECTURE', 'mình', 'các bạn',
    '25-40%', 'DIVERSITY IS MANDATORY', 'Apple-keynote', '2-3 main moving elements', 'hero-center',
    '"stt" continuous integers starting at 1', 'NEVER put production notes']) {
    assert.ok(usr.content.includes(pin), `topic prompt must contain: ${pin}`);
  }
  for (const b of VISUAL_BRACKETS) assert.ok(usr.content.includes(`[${b}]`), `doctrine lists [${b}]`);
});

test('buildMasterPrompt (script): light-edit contract embeds the owner script, no plan-then-write', () => {
  const plan = planScenes({ videoDuration: 60, sceneDuration: 7, language: 'vi' });
  const src = 'Đây là kịch bản chi tiết của chủ kênh, từng câu đã được viết sẵn để đọc.';
  const [, usr] = buildMasterPrompt({ mode: 'script', input: src, plan, language: 'vi' });
  for (const pin of ['LIGHT EDIT ONLY', '≥90%', 'NEVER invent new content', src]) {
    assert.ok(usr.content.includes(pin), `script prompt must contain: ${pin}`);
  }
  assert.ok(!usr.content.includes('PLAN THEN WRITE'));
});

test('buildMasterPrompt: sttBase + batch note + assets block ride along', () => {
  const plan = planScenes({ videoDuration: 300, sceneDuration: 7, language: 'vi' });
  const [, usr] = buildMasterPrompt({
    mode: 'topic', input: 'API là gì', plan, language: 'vi', sttBase: 26, expect: 15,
    batchNote: '\nBATCH CONTEXT: batch 2/2', assets: [{ name: 'Logo Bitcoin vàng', type: 'image' }],
  });
  assert.ok(usr.content.includes('starting at 26'));
  assert.ok(usr.content.includes('BATCH CONTEXT: batch 2/2'));
  assert.ok(usr.content.includes('PROJECT ASSETS'));
  assert.ok(usr.content.includes('Logo Bitcoin vàng'));
});

// ---------------------------------------------------------------- canonical export
test('scenesJsonFromRows: exact factory schema from DB rows + stored thumbnail', () => {
  const project = { title: 'Video T', metadata: JSON.stringify({ thumbnail: { title: 'TH', prompt: 'PR' } }) };
  const rows = [
    { voice_text: 'Câu một.', visual_prompt: mkVisual('card') },
    { voice_text: 'Câu hai.', visual_prompt: '' },
  ];
  const out = scenesJsonFromRows(project, rows);
  assert.deepEqual(Object.keys(out), ['thumbnail', 'scenes']);
  assert.deepEqual(out.thumbnail, { title: 'TH', prompt: 'PR' });
  out.scenes.forEach((s, i) => {
    assert.deepEqual(Object.keys(s), ['stt', 'voice', 'visual', 'assets']);
    assert.equal(s.stt, i + 1);
    assert.deepEqual(s.assets, []);
  });
});

// ---------------------------------------------------------------- parse input
test('parseScenesInput: factory format / {script:[…]} / bare array yes — prose and non-scene JSON no', () => {
  assert.ok(parseScenesInput(JSON.stringify(FIXTURE)));
  assert.ok(parseScenesInput('{"script":[{"voice":"a"}]}'));
  assert.ok(parseScenesInput('[{"voice":"a"}]'));
  assert.equal(parseScenesInput('RAG là gì mà ai cũng nhắc?'), null);
  assert.equal(parseScenesInput('{"foo": 1}'), null);
  assert.equal(parseScenesInput('{"scenes": []}'), null);
});

// ---------------------------------------------------------------- orchestrator: json + offline (no LLM)
test('generateMasterScenes: pasted factory JSON imports with zero LLM calls, leaks dropped', async () => {
  let fetches = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => { fetches++; throw new Error('no network allowed'); };
  try {
    const logs = [];
    const out = await generateMasterScenes({ input: JSON.stringify(FIXTURE), config: {}, onLog: (m) => logs.push(m) });
    assert.equal(out.mode, 'json');
    assert.equal(out.scenes.length, 51);
    assert.equal(out.scenes.filter((s) => isMetaLeakVoice(s.voice)).length, 0);
    assert.equal(out.raw.scenes.length, 51);
    assert.deepEqual(Object.keys(out.raw.scenes[0]), ['stt', 'voice', 'visual', 'assets']);
    assert.ok(out.scenes[0].keywords.length >= 1, 'keywords derived for beat-sync');
    assert.ok(logs.some((l) => l.includes('META_LEAK')));
    assert.equal(fetches, 0);
  } finally { globalThis.fetch = realFetch; }
});

test('generateMasterScenes: offline topic + offline detailed script (verbatim segmentation)', async () => {
  const topic = await generateMasterScenes({ input: 'RAG là gì cho người mới', config: { videoDuration: 30, sceneDuration: 6 } });
  assert.equal(topic.mode, 'topic-offline');
  assert.ok(topic.scenes.length >= 1);
  const srcWords = Array.from({ length: 30 }, (_, i) => `câu${i}`);
  const src = `Đây là kịch bản chi tiết. ${srcWords.join(' ')}. Nội dung phải được giữ nguyên từng chữ một. `
    + 'Người xem cần nghe đúng những gì chủ kênh viết ra. Không ai được phép thay đổi lời thoại này. '
    + 'Mỗi câu ở đây đều có chủ đích riêng của nó. Video sẽ dựng theo đúng thứ tự các câu này. '
    + 'Phần kết thúc nhắc người xem đăng ký kênh để theo dõi tiếp.';
  const script = await generateMasterScenes({ input: src, config: { videoDuration: 60, sceneDuration: 7 } });
  assert.equal(script.mode, 'script-offline');
  const joined = script.scenes.map((s) => s.voice).join(' ');
  assert.ok(joined.includes('giữ nguyên từng chữ'), 'offline script mode keeps the owner words');
});

// ---------------------------------------------------------------- orchestrator: fake LLM
const FAKE_LLM = { enabled: true, apiKey: 'k', baseUrl: 'http://fake.local', model: 'fake-m' };
const okResponse = (payload) => ({
  ok: true,
  text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }),
});

test('generateMasterScenes (topic, fake LLM): clean reply → canonical shape, direction-ready visuals', async () => {
  const realFetch = globalThis.fetch;
  const prompts = [];
  const payload = {
    title: 'RAG là gì?', throughline: 'x', spine: ['a', 'b'],
    scenes: [0, 1, 2, 3, 4].map((i) => mkScene(i, `Câu ${i} nói tiếp mạch trước đó thật tự nhiên.`)),
    thumbnail: { title: 'RAG LÀ GÌ?', prompt: 'Static cinematic thumbnail…' },
  };
  globalThis.fetch = async (url, init) => { prompts.push(JSON.parse(init.body)); return okResponse(payload); };
  try {
    const out = await generateMasterScenes({ input: 'RAG là gì', config: { videoDuration: 35, sceneDuration: 7 }, ai: { llm: FAKE_LLM } });
    assert.equal(out.mode, 'topic');
    assert.equal(out.scenes.length, 5);
    assert.ok(out.scenes.every((s) => /\[MAIN FOCUS\]/i.test(s.visualPrompt)), 'master visuals carry [MAIN FOCUS] → direction pass skips');
    assert.equal(out.title, 'RAG là gì?');
    assert.deepEqual(out.thumbnail, payload.thumbnail);
    assert.equal(prompts.length, 1, 'clean reply → exactly one LLM call');
    assert.ok(prompts[0].messages[1].content.includes('PLAN THEN WRITE'));
  } finally { globalThis.fetch = realFetch; }
});

test('generateMasterScenes: defective reply → defect re-ask → clean; repeated defect → repaired (P18)', async () => {
  const realFetch = globalThis.fetch;
  const dirty = {
    scenes: [
      { stt: 1, voice: '- CTA mềm 25–40%: kêu gọi lưu video.', visual: mkVisual(FOCI[0]) },
      ...[1, 2, 3, 4].map((i) => mkScene(i, `Câu ${i} tiếp nối mạch nói phía trước.`)),
    ],
    thumbnail: { title: 'T', prompt: 'P' },
  };
  const clean = { scenes: [0, 1, 2, 3, 4].map((i) => mkScene(i, `Câu ${i} tiếp nối mạch nói phía trước.`)), thumbnail: { title: 'T', prompt: 'P' } };
  // round 1 dirty → re-ask carries the defect note → round 2 clean
  let call = 0; const bodies = [];
  globalThis.fetch = async (url, init) => { bodies.push(JSON.parse(init.body)); call++; return okResponse(call === 1 ? dirty : clean); };
  try {
    const out = await generateMasterScenes({ input: 'RAG là gì', config: { videoDuration: 35, sceneDuration: 7 }, ai: { llm: FAKE_LLM } });
    assert.equal(out.scenes.length, 5);
    assert.equal(out.scenes.filter((s) => isMetaLeakVoice(s.voice)).length, 0);
    assert.equal(call, 2);
    assert.ok(bodies[1].messages[1].content.includes('META_LEAK'), 're-ask names the defect');
  } finally { globalThis.fetch = realFetch; }

  // model repeats the defect both rounds → deterministic repair drops the scene (P18 floor)
  globalThis.fetch = async () => okResponse(dirty);
  try {
    const out = await generateMasterScenes({ input: 'RAG là gì', config: { videoDuration: 35, sceneDuration: 7 }, ai: { llm: FAKE_LLM } });
    assert.equal(out.scenes.filter((s) => isMetaLeakVoice(s.voice)).length, 0, 'META_LEAK never persists');
    assert.equal(out.scenes.length, 4);
    assert.ok(out.warnings.some((d) => d.code === 'META_LEAK'));
  } finally { globalThis.fetch = realFetch; }
});

test('generateMasterScenes (long video): batches of 25 with rolling context, stt continuous', async () => {
  const realFetch = globalThis.fetch;
  const bodies = [];
  // per-scene LETTER tags (digits are stripped by the monotony tokenizer on purpose) so the
  // mock's [MAIN FOCUS] texts are genuinely distinct, like a real model's would be
  const W = ['an', 'binh', 'chi', 'dung', 'giang', 'hoa', 'khang', 'lan', 'minh', 'nga', 'oanh', 'phuc', 'quan', 'son', 'tam', 'uyen', 'vy', 'xuan', 'yen', 'zung'];
  const tag = (n) => `${W[n % 20]} ${W[(n * 7 + 3) % 20]} ${W[(n * 13 + 5) % 20]}`;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body); bodies.push(body);
    const m = body.messages[1].content.match(/Produce scenes (\d+) to (\d+)/);
    const [from, to] = [Number(m[1]), Number(m[2])];
    const scenes = [];
    for (let s = from; s <= to; s++) scenes.push({ stt: s, voice: `Cảnh ${s} tiếp tục mạch nội dung video dài.`, visual: mkVisual(`${FOCI[s % FOCI.length]} ${tag(s)}`), assets: [] });
    return okResponse({ title: 'Video dài', scenes, thumbnail: { title: 'TH', prompt: 'PR' } });
  };
  try {
    const out = await generateMasterScenes({ input: 'API là gì', config: { videoDuration: 280, sceneDuration: 7 }, ai: { llm: FAKE_LLM } });
    assert.equal(bodies.length, 2, '40 scenes → 2 batches');
    assert.equal(out.scenes.length, 40);
    assert.deepEqual(out.raw.scenes.map((s) => s.stt), Array.from({ length: 40 }, (_, i) => i + 1));
    assert.ok(bodies[1].messages[1].content.includes('batch 2/2'));
    assert.ok(bodies[1].messages[1].content.includes('Cảnh 25'), 'rolling context carries the previous tail');
    assert.deepEqual(out.thumbnail, { title: 'TH', prompt: 'PR' });
  } finally { globalThis.fetch = realFetch; }
});
