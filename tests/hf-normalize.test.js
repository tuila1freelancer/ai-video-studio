// normalizeSpec: deterministic pre-lint hygiene. Focus here: the WATERMARK strip removes the
// faint English/code decor a weak model sprinkles behind scenes (PROMPT_OVERFLOW, ERROR_502,
// foo.bar(), NAME.EXE, [SYSTEM_INIT] x=true) without touching real Vietnamese on-screen copy.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSpec } from '../src/hyperframe/codegen.js';

const guide = { fonts: { body: 'Be Vietnam Pro' } };
const norm = (html) => { const s = { html, css: '' }; normalizeSpec(s, { guide, duration: 6 }); return s.html; };

test('normalizeSpec: blanks pure code/English watermark text nodes', () => {
  for (const w of ['PROMPT_OVERFLOW', 'ERROR_502', 'PROMPT_ENGINE.EXE', 'prompt.strip_polite_phrases()', '[SYSTEM_INIT] role_model = true', 'config.json']) {
    const out = norm(`<div class="wm">${w}</div>`);
    assert.ok(!out.includes(w), `should strip watermark: ${w} → ${out}`);
  }
});

test('normalizeSpec: keeps real Vietnamese copy, labels, numbers, kickers, icons', () => {
  for (const keep of ['VAI TRÒ', 'KẾT QUẢ = 100%', '// KIỂM CHỨNG', '85%', 'ĐỘ CHÍNH XÁC', '{{icon:cpu}}', 'GPT-4']) {
    const out = norm(`<div>${keep}</div>`);
    assert.ok(out.includes(keep), `should keep: ${keep} → ${out}`);
  }
});

test('normalizeSpec: conservative — a node mixing real copy with a token is left intact', () => {
  const out = norm('<div>Lỗi hệ thống ERROR_502</div>');
  assert.ok(out.includes('Lỗi hệ thống'), out);
});

test('normalizeSpec: still fixes the pre-existing mechanical mistakes (<br>, infinite)', () => {
  const s = { html: 'A<br>B', css: '.x{animation:spin 2s infinite}' };
  normalizeSpec(s, { guide, duration: 6 });
  assert.ok(!/<br/i.test(s.html), 'br removed');
  assert.ok(!/\binfinite\b/.test(s.css), 'infinite replaced with a finite count');
});
