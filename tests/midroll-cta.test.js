// The mid-video CTA shipped torn in half once: one clause spliced into an unrelated sentence
// thirty scenes early, the rest reworded later. These cases are that failure, verbatim.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { midrollBlock, repairScenesSpec } from '../src/content/master-script.js';

const MID = 'Tới đây nếu các bạn thấy có ích, các bạn bấm lưu video này lại giúp mình nhé. '
  + 'Phần sau mình sẽ đưa các bạn mẫu để chép về dùng được luôn.';
const CLOSING = 'Nếu thấy video hữu ích, các bạn hãy ấn thích, lưu lại, chia sẻ video và đăng ký kênh giúp mình nhé.';

const SOURCE = `# Chủ đề: Thử

### Mở đầu

Câu mở đầu của chủ kênh.

### Nội dung

Một đoạn nội dung bình thường không có lời mời.

### Nhắc nhỏ giữa bài

${MID}

### Phần sau

Nội dung phần sau.

### Lời mời

${CLOSING}
`;

const spec = (voices) => ({ scenes: voices.map((voice, i) => ({ stt: i + 1, voice, visual: '', assets: [] })) });
const repair = (voices) => repairScenesSpec(spec(voices), [], { source: SOURCE }).scenes.map((s) => s.voice);

test('midrollBlock picks the mid CTA, never the closing one', () => {
  assert.equal(midrollBlock(SOURCE), MID);
});

test('midrollBlock returns empty when the script has no mid CTA', () => {
  assert.equal(midrollBlock('# T\n\n### A\n\nKhông có lời mời nào.\n\n### B\n\nCũng không.\n'), '');
});

test('a reworded mid CTA is restored verbatim', () => {
  const out = repair([
    'Câu mở đầu của chủ kênh.', 'Nội dung một.', 'Nội dung hai.', 'Nội dung ba.',
    'Phần sau mình sẽ đưa ngay bộ khung để các bạn chép lại.', // reworded half
    'Nội dung bốn.', 'Nội dung năm.', 'Nội dung sáu.', 'Nội dung bảy.', CLOSING,
  ]);
  assert.equal(out[4], MID);
});

test('a CTA clause spliced into an unrelated scene is stripped, content kept', () => {
  const out = repair([
    'Câu mở đầu của chủ kênh.',
    'Vì sao phải là mười việc? Các bạn lưu video lại để làm theo nhé. Bảy việc đầu là việc nổi trên mặt.',
    'Nội dung hai.', 'Nội dung ba.', MID, 'Nội dung bốn.', 'Nội dung năm.', 'Nội dung sáu.',
    'Nội dung bảy.', CLOSING,
  ]);
  assert.ok(!out[1].includes('lưu video lại'), 'clause phải bị bỏ');
  assert.ok(out[1].includes('Bảy việc đầu'), 'nội dung thật phải còn');
  assert.equal(out[4], MID);
});

test('the closing CTA in the closing zone is never stripped', () => {
  const out = repair([
    'Câu mở đầu của chủ kênh.', 'Nội dung một.', 'Nội dung hai.', 'Nội dung ba.', MID,
    'Nội dung bốn.', 'Nội dung năm.', 'Nội dung sáu.', 'Nội dung bảy.', CLOSING,
  ]);
  assert.equal(out[9], CLOSING);
});

test('a script with no mid CTA passes through untouched', () => {
  const src = '# T\n\n### A\n\nMột đoạn.\n\n### B\n\nHai đoạn.\n';
  const voices = ['Một đoạn.', 'Hai đoạn.', 'Ba đoạn.', 'Bốn đoạn.'];
  const out = repairScenesSpec(spec(voices), [], { source: src }).scenes.map((s) => s.voice);
  assert.deepEqual(out, voices);
});
