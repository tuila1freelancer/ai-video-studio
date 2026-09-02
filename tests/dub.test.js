// The same video in another language — the reason most of the language work exists.
//
// What travels is the expensive half: every scene's `visual_prompt` is the 8-bracket cinematic
// brief the direction pass wrote, and the doctrine already keeps it in English precisely so it can
// drive a rendering engine that reads English. So the storyboard, the pacing, the palette and the
// CTA plan survive verbatim and the result is recognisably the same video.
//
// What is redone is the half that IS language: narration, voice, captions, and the words on
// screen. On-screen text is regenerated rather than string-replaced, because it lives inside a
// rendered HTML spec — a headline swapped in place would keep a box measured for Vietnamese
// around a German compound noun.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as DB from '../src/db/index.js';
import { dubProject } from '../src/pipeline/dub.js';
import { LANG_WPS } from '../src/providers/llm.js';
import { countWords } from '../src/i18n/segment.js';

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

function seedProject() {
  const p = DB.createProject({
    title: 'Ba dấu hiệu', topic: 'giá', inputType: 'topic', aspectRatio: '16:9',
    config: { language: 'vi', hyperframe: { styleId: 'tuila1-hud-cyber' } },
  });
  DB.replaceScenes(p.id, [
    { voice: 'Ba dấu hiệu cho thấy bạn có thể tăng giá ngay hôm nay.', visualPrompt: '[ROLE] hook [LAYOUT] centre stack', keywords: ['tăng giá'] },
    { voice: 'Dấu hiệu đầu tiên là khách hỏi về lịch trống của bạn.', visualPrompt: '[ROLE] insight [LAYOUT] split', keywords: ['lịch'] },
  ]);
  // …as though it had been produced: a spec, a voice and a clip on every scene.
  for (const s of DB.getScenes(p.id)) {
    DB.updateScene(s.id, {
      template: 'hyperframe', props: { script: 'tl.to()', html: '<div class="hf-kw">TĂNG GIÁ</div>' },
      audio_path: '/tmp/a.m4a', duration: 6, srt_json: [{ start: 0, end: 6, text: s.voice_text, words: [] }],
      video_path: '/tmp/v.mp4', status: 'rendered',
    });
  }
  return p;
}

test('dub: the art direction travels, the words do not', async () => {
  const source = seedProject();
  const before = DB.getScenes(source.id);
  const out = await dubProject(source.id, {
    language: 'en',
    llm: { enabled: true },
    // The translation itself is the LLM's job; this test is about what the lane keeps and drops.
    onLog: () => {},
  }).catch((e) => e);

  // With no reachable model the lane must fail BEFORE creating anything — a half-made project
  // that looks finished is worse than an error.
  if (out instanceof Error) {
    assert.match(out.message, /LLM|lời thoại|fetch|ECONN|not configured/i);
    assert.equal(DB.listProjects().filter((p) => p.title.includes('English')).length, 0,
      'a failed dub must leave no project behind');
    return;
  }
  const dubbed = DB.getScenes(out.project.id);
  assert.equal(dubbed.length, before.length, 'a dub never changes the scene count');
  for (let i = 0; i < dubbed.length; i++) {
    assert.equal(dubbed[i].visual_prompt, before[i].visual_prompt, 'the cinematic brief is reused verbatim');
    assert.equal(dubbed[i].template, null, 'the spec is rebuilt so its on-screen text is the new language');
    assert.equal(dubbed[i].audio_path, null, 'the voice is re-recorded');
  }
  assert.equal(out.project.config.language, 'en');
  assert.equal(out.project.aspect_ratio, source.aspect_ratio);
  assert.equal(out.project.channel_id, source.channel_id);
});

test('dub: it refuses the cases that would produce a broken project', async () => {
  const source = seedProject();
  const llm = { enabled: true };
  await assert.rejects(() => dubProject(source.id, { language: 'vi', llm }), /KHÁC bản gốc/);
  await assert.rejects(() => dubProject(source.id, { language: 'kl', llm }), /không được hỗ trợ/);
  await assert.rejects(() => dubProject('nope', { language: 'en', llm }), /not found/);
  await assert.rejects(() => dubProject(source.id, { language: 'en', llm: { enabled: false } }), /LLM/);
});

test('dub: the target word count comes from BOTH languages\' speaking rates', () => {
  // Vietnamese speaks 4.4 tokens a second and English 2.6, so a faithful English rendering of a
  // Vietnamese scene runs nearly twice as long as the slot the visual was designed around. The
  // lane asks for a word count, not for a translation.
  const s = src('../src/pipeline/dub.js');
  assert.match(s, /const ratio = \(LANG_WPS\[to\] \|\| 3\) \/ \(LANG_WPS\[from\] \|\| 3\)/);
  assert.match(s, /countWords\(sc\.voice_text \|\| '', from\) \* ratio/,
    'and it counts the source the way the source language is written');
  assert.ok(LANG_WPS.vi / LANG_WPS.en > 1.6, 'the gap this corrects for is real');
  assert.equal(countWords('một hai ba bốn', 'vi'), 4);
});

test('dub: creating one never spends a credit on its own (P16)', () => {
  const routes = src('../src/api/routes.js');
  const route = routes.slice(routes.indexOf("r.post('/projects/:id/dub'"), routes.indexOf("r.post('/projects/:id/dub'") + 700);
  assert.ok(!/runPipeline|enqueue|startProject/.test(route),
    'the dub route must create the project and stop — running it is the owner\'s own click');
});
