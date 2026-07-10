// Static template smoke test — NO Chrome, safe to run any time.
// For every registered template: build with representative props in 16:9 + 9:16,
// assert css/html non-empty, compile the GSAP script (syntax), and assemble the
// full scene page. Exits non-zero on any failure.
import { TEMPLATES, buildTemplate, makeCtx } from '../src/animation/templates.js';
import { SAMPLE_SPEC } from '../src/styleguide/index.js';
import { buildScenePage } from '../src/animation/harness.js';
import { getTheme } from '../src/animation/themes.js';

const SAMPLE = {
  heading: 'Làm chủ công cụ AI trong 5 phút',
  sub: 'Mẹo thực chiến cho người mới bắt đầu',
  label: 'PHẦN 02', pre: 'BÍ QUYẾT', heading2: 'Ngay hôm nay', a: 'Tốc độ', b: 'Chính xác',
  number: 7, count: 5, chapter: 'PHẦN 03', cta: 'Đăng ký kênh', tag: 'CẢNH BÁO', icon: 'bolt',
  center: 'AI', chips: ['tự động', 'nhanh gọn', 'chính xác'],
  value: 68, unit: '%', keyword: 'BỨT PHÁ', accentWord: 'AI',
  items: [
    { title: 'Xác định mục tiêu', sub: 'Rõ ràng, đo được', icon: 'target', tag: 'MỤC 1', value: 64 },
    { title: 'Chọn công cụ', sub: 'Đúng việc đúng app', icon: 'gear', tag: 'MỤC 2', value: 82 },
    { title: 'Đo kết quả', sub: 'Lặp lại và tối ưu', icon: 'chart', tag: 'MỤC 3', value: 45 },
  ],
  lines: ['> phân tích đầu vào…', '[SYS] ngữ cảnh: OK', '[OK] sẵn sàng'],
  messages: [{ from: 'user', text: 'Tóm tắt bài này giúp tôi?' }, { from: 'ai', text: 'Đã xong. 3 ý chính như sau…' }],
  values: [64, 82, 45], labels: ['A', 'B', 'C'],
};

const theme = getTheme('neon-tech');
const sizes = [{ w: 1920, h: 1080 }, { w: 1080, h: 1920 }];
let fail = 0, withScript = 0;

// hyperframe is hidden from TEMPLATES (planner must not pick it) but must still smoke-pass:
// it builds from its canned SAMPLE_SPEC instead of the generic prop bag.
const CASES = [...Object.keys(TEMPLATES), 'hyperframe'];
const propsFor = (id) => (id === 'hyperframe' ? SAMPLE_SPEC : SAMPLE);

for (const id of CASES) {
  for (const { w, h } of sizes) {
    try {
      const ctx = makeCtx({ w, h, theme, seed: 3, duration: 6, idx: 2 });
      const tpl = buildTemplate(id, propsFor(id), ctx);
      if (!tpl.css || !tpl.html) throw new Error('empty css/html');
      if (tpl.script) {
        new Function('gsap', 'tl', 'S', 'rng', tpl.script); // syntax check only
        if (w === 1920) withScript++;
      }
      const page = buildScenePage({
        w, h, theme, seed: 3, duration: 6, progressStart: 0, progressTotal: 6,
        template: tpl, captions: [], watermark: { text: 'demo' }, captionStyle: {},
      });
      if (!page.includes('__seek')) throw new Error('page missing runtime');
      if (tpl.script && !page.includes('__tplScript')) throw new Error('script not injected');
    } catch (e) {
      fail++;
      console.error(`✗ ${id} @${w}x${h}: ${e.message}`);
    }
  }
  console.log(`✓ ${id}${buildTemplate(id, propsFor(id), makeCtx({ w: 1920, h: 1080, theme, seed: 3 })).script ? ' [gsap]' : ''}`);
}
console.log(`\n${CASES.length} templates, ${withScript} with GSAP script, ${fail} failures`);
process.exit(fail ? 1 : 0);
