// normalizeSpec: deterministic pre-lint hygiene. Focus here: the WATERMARK strip removes the
// faint English/code telemetry decor a weak model sprinkles behind scenes (limit_1024,
// ai_state="LOST_FOCUS", OVERLOAD, foo.bar(), NAME.EXE) without touching real Vietnamese copy —
// a node is blanked ONLY when it has a code/telemetry token AND no Vietnamese diacritic — and
// de-snake_cases surviving labels (DỮ_LIỆU_DƯ_THỪA → DỮ LIỆU DƯ THỪA).
import './_env.mjs';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { normalizeSpec } from '../src/hyperframe/codegen.js';

const guide = { fonts: { body: 'Be Vietnam Pro' } };
const norm = (html) => { const s = { html, css: '' }; normalizeSpec(s, { guide, duration: 6 }); return s.html; };

test('normalizeSpec: blanks pure code/English telemetry watermark nodes', () => {
  for (const w of ['limit_1024', 'ai_state = "LOST_FOCUS"', 'PROMPT_OVERFLOW', 'ERROR_502', 'PROMPT_ENGINE.EXE',
    'prompt.strip_polite_phrases()', '[SYSTEM_INIT] role_model = true', 'config.json', 'AI ACTIVE', 'OVERLOAD']) {
    const out = norm(`<i>${w}</i>`);
    assert.equal(out, '<i></i>', `should blank watermark: ${w} → ${out}`);
  }
});

test('normalizeSpec: keeps real Vietnamese copy, labels, numbers, kickers, icons', () => {
  for (const keep of ['VAI TRÒ', 'KẾT QUẢ = 100%', '// KIỂM CHỨNG', '85%', 'ĐỘ CHÍNH XÁC', '{{icon:cpu}}', 'GPT-4', 'AI RỐI TRÍ']) {
    const out = norm(`<span>${keep}</span>`);
    assert.ok(out.includes(keep), `should keep: ${keep} → ${out}`);
  }
});

test('normalizeSpec: de-snake_cases a surviving Vietnamese label', () => {
  assert.equal(norm('<div>DỮ_LIỆU_DƯ_THỪA</div>'), '<div>DỮ LIỆU DƯ THỪA</div>');
  assert.equal(norm('<div>MẤT_TRỌNG_TÂM</div>'), '<div>MẤT TRỌNG TÂM</div>');
});

test('normalizeSpec: conservative — a node mixing real Vietnamese copy with a token is left intact', () => {
  const out = norm('<div>Lỗi hệ thống ERROR_502</div>');
  assert.ok(out.includes('Lỗi hệ thống'), out);
});

test('normalizeSpec: still fixes the pre-existing mechanical mistakes (<br>, infinite)', () => {
  const s = { html: 'A<br>B', css: '.x{animation:spin 2s infinite}' };
  normalizeSpec(s, { guide, duration: 6 });
  assert.ok(!/<br/i.test(s.html), 'br removed');
  assert.ok(!/\binfinite\b/.test(s.css), 'infinite replaced with a finite count');
});

test('a bare English word the narration never says is decor, and is stripped', async () => {
  // The oversized faint ghost glyph came back in English on four videos running — END, NULL,
  // VELOCITY, SECURE, SYS.DAT, ID: NV-042 — and each one had to be fixed by hand before render.
  // The test that settles it deterministically: does this scene's own narration ever say the word?
  const { normalizeSpec } = await import('../src/hyperframe/codegen.js');
  const guide = { fonts: { body: 'Be Vietnam Pro' }, palette: { bg: '#0B0F19', bg2: '#111', ink: '#fff', accents: ['#00F0FF'] } };
  const run = (html, narration) => {
    const spec = { html, css: '', script: '' };
    normalizeSpec(spec, { guide, duration: 6, language: 'vi', narration });
    return (spec.html.match(/>([^<>]*)</) || [])[1];
  };

  for (const w of ['END', 'NULL', 'VELOCITY', 'SECURE', 'HABIT']) {
    assert.equal(run(`<div class="hf-ghost">${w}</div>`, 'Một câu tiếng Việt bình thường.'), '', w);
  }
  assert.equal(run('<div class="hf-ghost">SYS.DAT</div>', 'Nó không biết hoàn cảnh riêng.'), '', 'dotted telemetry');
  assert.equal(run('<div class="emp-id">ID: NV-042</div>', 'Một bài đánh giá cuối năm.'), '', 'fake record code');

  // …and everything that is real copy survives
  assert.equal(run('<div class="hf-ghost">TỐC ĐỘ</div>', 'Tốc độ quyết định.'), 'TỐC ĐỘ', 'Vietnamese');
  assert.equal(run('<div class="chip">ChatGPT</div>', 'Mở trợ lý lên.'), 'ChatGPT', 'product name');
  assert.equal(run('<div class="chip">AI</div>', 'AI rất giỏi biến đổi.'), 'AI', 'said in the narration');
  assert.equal(run('<div class="stat">99.8%</div>', 'Tỉ lệ rất cao.'), '99.8%', 'numbers belong to no language');

  // an English video must keep its own words — the guard is language-gated
  const en = { html: '<div class="hf-ghost">MOMENTUM</div>', css: '', script: '' };
  normalizeSpec(en, { guide, duration: 6, language: 'en', narration: 'A normal English sentence.' });
  assert.match(en.html, /MOMENTUM/);
});

test('source code is never on-screen copy, and a half-stripped code panel is the worse outcome', () => {
  // A mock code panel kept `return true;` and a bare `}` after its first line was stripped, which
  // reads as broken rather than as decoration. Keywords and lone braces go with the rest.
  const src = readFileSync(new URL('../src/hyperframe/codegen.js', import.meta.url), 'utf8');
  assert.match(src, /const CODEISH = /);
  assert.match(src, /if \(CODEISH\.test\(t\)\) return true;/);
  for (const kw of ['return', 'const', 'function', 'import', 'undefined']) {
    assert.ok(src.includes(kw), `keyword ${kw} listed`);
  }
});
