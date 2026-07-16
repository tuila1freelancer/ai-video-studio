// normalizeSpec: deterministic pre-lint hygiene. Focus here: the WATERMARK strip removes the
// faint English/code telemetry decor a weak model sprinkles behind scenes (limit_1024,
// ai_state="LOST_FOCUS", OVERLOAD, foo.bar(), NAME.EXE) without touching real Vietnamese copy —
// a node is blanked ONLY when it has a code/telemetry token AND no Vietnamese diacritic — and
// de-snake_cases surviving labels (DỮ_LIỆU_DƯ_THỪA → DỮ LIỆU DƯ THỪA).
import './_env.mjs';
import test from 'node:test';
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
