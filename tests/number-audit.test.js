// Unspoken-number audit: on-screen figures the narration never says are listed per scene;
// axis scaffold (small/round unit-less integers) and figures spoken elsewhere are set aside.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { numbersIn, visibleText, auditSceneNumbers, auditProjectNumbers } from '../src/content/number-audit.js';

test('numbersIn canonicalises digits, units and spelled-out numbers', () => {
  const s = numbersIn('Prices are up 29 percent: $54,000 buys what $70,000 did. Twenty-nine percent in six years.');
  for (const k of ['29', '54000', '70000', '6']) assert.ok(s.has(k), k);
});

test('visibleText drops scripts, styles, tags and entities', () => {
  assert.equal(visibleText('<style>.a{}</style><div class="hf-kw">$1,600&nbsp;<b>a</b></div><script>x=1</script>'), '$1,600 a');
});

test('a fabricated line-chart point is unspoken; ticks are scaffold; a recap figure is elsewhere', () => {
  const r = auditSceneNumbers({
    html: '<div>259 → 334 <span>293</span> <span>0 100 200 300</span> <b>$16,000</b> <i>2024</i></div>',
    narration: 'January 2020, it sits at 259. August 2026, it is at 334.',
    allNarration: 'sixteen thousand dollars walked out the door. $16,000. 259. 334.',
  });
  assert.deepEqual(r.unspoken, ['293', '2024']);
  assert.deepEqual(r.scaffold, ['0', '100', '200', '300']);
  assert.deepEqual(r.elsewhere, ['$16,000']);
});

test('K/M/B suffixes resolve to the spoken figure', () => {
  const r = auditSceneNumbers({ html: '<b>$54K</b> <b>$70K</b> <b>$1.6T</b> <b>$54</b>', narration: 'about $54,000 today, not $70,000; that is $1.6 trillion.' });
  assert.deepEqual(r.unspoken, ['$54']);
});

test('a unit-bearing round number is never scaffold', () => {
  const r = auditSceneNumbers({ html: '<b>50%</b> <b>$100</b> <b>50</b>', narration: 'no numbers here' });
  assert.deepEqual(r.unspoken, ['50%', '$100']);
  assert.deepEqual(r.scaffold, ['50']);
});

test('auditProjectNumbers reads voice_text/props rows and counts defects', () => {
  const { scenes, defects } = auditProjectNumbers([
    { idx: 0, voice_text: 'Up 29 percent.', props: { html: '<b>29%</b><b>9.1%</b>' } },
    { idx: 1, voice_text: 'Nothing.', props: JSON.stringify({ html: '<b>2020</b>' }) },
    { idx: 2, voice_text: 'In 2020.', props: null },
  ]);
  assert.equal(defects, 1);
  assert.deepEqual(scenes[0].unspoken, ['9.1%']);
  assert.deepEqual(scenes[1].elsewhere, ['2020']);
  assert.deepEqual(scenes[2].unspoken, []);
});
