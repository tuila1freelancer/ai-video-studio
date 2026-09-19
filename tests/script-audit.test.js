// Value/policy gate for narration scripts: measurable clauses of PROMPT MASTER v2.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { auditScript, CLOSING_LINE } from '../src/content/script-audit.js';

const filler = (n) => Array.from({ length: n }, (_, i) => `Sentence number ${i} says that the index went from 259 to 334 according to the Bureau of Labor Statistics.`).join(' ');
const good = `Prices are up 29 percent since 2020. So the answer is a mechanism I call the invisible pay cut. ${filler(70)} Divide 65 by two percent and you get 3,250. Nothing here is advice. Check your savings rate and subtract 2.7 percent. Compare your rent to the 33 percent shelter index. Look up the CPI and divide your raise by it. If this made the numbers a little clearer, subscribe. Thanks for watching.`;

test('a dense, sourced, answer-first script with three checks passes', () => {
  const r = auditScript(good, { title: 'Why Your Paycheck Feels Smaller Every Year' });
  assert.ok(r.ok, r.fails.join('; '));
  assert.ok(r.per100 >= 1.8 && r.sourcesSpoken >= 3 && r.checks >= 3 && r.workedExample >= 1);
  assert.ok(r.answerAt !== null && r.answerAt <= 0.35);
  assert.ok(r.closingOk && r.mechanismNamed);
});

test('persona, advice and fear phrases are named defects', () => {
  const r = auditScript(good.replace('Nothing here is advice.', "As a financial advisor I recommend you should buy stocks before it's too late."), { title: 'x' });
  assert.ok(r.persona.length >= 1 && r.advice.length >= 2 && r.fear.length >= 1);
  assert.ok(r.fails.some((f) => f.startsWith('persona')) && r.fails.some((f) => f.startsWith('advice')) && r.fails.some((f) => f.startsWith('fear')));
});

test('sentences shared verbatim with another script are a template fingerprint; the closing line is exempt', () => {
  const other = `Here is an unrelated video. Sentence number 3 says that the index went from 259 to 334 according to the Bureau of Labor Statistics. ${CLOSING_LINE}`;
  const r = auditScript(good, { title: 'x', corpus: [other] });
  assert.equal(r.crossRepeats.length, 1);
  assert.ok(!r.crossRepeats.includes(CLOSING_LINE));
});

test('a connective used twice, or reused from the previous video, is flagged', () => {
  const twice = good.replace('Prices are up', "Here's the thing. Prices are up").replace('Divide 65', "Here's the thing. Divide 65");
  const r = auditScript(twice, { title: 'x', corpus: ["Here's the thing. Previous video."] });
  assert.deepEqual(r.connectiveReuse, ["here's the thing."]);
  assert.deepEqual(r.connectiveFromPrevious, ["here's the thing."]);
});

test('a late or missing answer and a thin script fail', () => {
  const thin = `Money is complicated. ${CLOSING_LINE}`;
  const r = auditScript(thin, { title: 'x' });
  assert.ok(!r.ok && r.fails.some((f) => f.startsWith('words')) && r.fails.some((f) => f.includes('answer')));
});
