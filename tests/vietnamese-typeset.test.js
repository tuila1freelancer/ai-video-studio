// Vietnamese capitals do not fit a line box built for Latin ones.
//
// Measured in the render Chrome at the real .hf-kw size (119px on a 1920x1080 frame): a capital
// carrying a stacked mark reaches 120–123px above the baseline where a Latin capital reaches
// 83–103px. At the line-height the harness used, that ink sat OUTSIDE the box by 8–23px, and
// three separate mechanisms turned that into a visible defect:
//
//   · background-clip:text paints only inside the box, so the mark was never painted — this is
//     the "ĐÀ NẴNG" frame the owner reported: the tilde on Ẵ simply absent, the grave on À cut flat
//   · two lines collided by 18–23px — "chữ đè lên nhau"
//   · an overflow:hidden wrapper cut the mark off
//
// Verified end to end through previewSceneFrame on the real scene: before, the tilde is missing;
// after, it is whole, and the composition did not move.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSceneHtml } from '../src/animation/index.js';
import { scriptTextRule } from '../src/hyperframe/prompt.js';

const harness = readFileSync(new URL('../src/animation/harness.js', import.meta.url), 'utf8');

test('the repair measures the real font instead of hardcoding a number', () => {
  // The safe line-height runs 1.18 (Anton) to 1.41 (Nunito) — one constant would be wrong for
  // every face but one, and wrong in the direction that either clips or wastes vertical space.
  assert.match(harness, /const vnMetrics = \(el, text\) => \{/);
  assert.match(harness, /cv\.font = cs\.fontStyle \+ ' ' \+ cs\.fontWeight/);
  assert.match(harness, /actualBoundingBoxAscent - \(m\.fontBoundingBoxAscent \+ leading \/ 2\)/);
  assert.match(harness, /safeLh: \(m\.actualBoundingBoxAscent \+ m\.actualBoundingBoxDescent\) \/ fs/);
  // measureText ignores text-transform, and CAPITALS are the tall case — the whole problem
  assert.match(harness, /tf === 'uppercase' \? text\.toUpperCase\(\)/);
});

test('it only looks at text that actually carries a mark', () => {
  // An English scene must render byte-identically to before, so the pass selects by CONTENT:
  // a text node carrying a combining mark after NFD, and nothing else. The class used to be
  // seven Vietnamese marks, which is why a Devanagari matra and a Thai tone stack — measured
  // exactly the same way by exactly the same code — were walked straight past.
  assert.match(harness, /MARKED = \/\\\\p\{M\}\/u/);
  assert.match(harness, /t\.normalize\('NFD'\)/);
  // doubled in the source so the template literal EMITS an escape: a literal combining mark
  // inside a character class is invisible in an editor and one stray keystroke from breaking.
  assert.match(harness, /NodeFilter\.SHOW_TEXT/);
});

test('paint room is bought with padding and paid for with margin', () => {
  // Growing the box would move a centred headline by half the growth. Padding out, margin back:
  // measured on the real scene, the glyphs move 0.10px vertically and 0.00px horizontally.
  assert.match(harness, /el\.style\.paddingTop = \(padT \+ over\) \+ 'px';/);
  assert.match(harness, /el\.style\.marginTop = \(\(parseFloat\(d\.vnMarT\) \|\| 0\) - over\) \+ 'px';/);
  assert.match(harness, /el\.style\.paddingBottom = \(padB \+ under\) \+ 'px';/);
  assert.match(harness, /el\.style\.marginBottom = \(\(parseFloat\(d\.vnMarB\) \|\| 0\) - under\) \+ 'px';/);
  assert.match(harness, /clip\.indexOf\('text'\) >= 0/, 'only background-clip:text needs the paint room');
});

test('line-height is only raised where two lines could actually touch', () => {
  // A single tight line is a design choice and is left alone — steps 2 and 3 fix its clipping
  // without moving anything. Raising every line-height would restyle scenes that had no defect.
  assert.match(harness, /const lines = Math\.max\(1, Math\.round\(\(el\.clientHeight - padT - padB\) \/ m\.lhPx\)\);/);
  assert.match(harness, /if \(lines > 1 && m\.safeLh > m\.lhPx \/ m\.fs \+ 0\.001\) el\.style\.lineHeight/);
});

test('only a text-tight wrapper gets its overflow opened', () => {
  // 34% of Vietnamese scenes carry overflow:hidden somewhere, and most of those are PANELS that
  // hide something on purpose — a bar fill, an ::after streak. Opening one of those would leak
  // the thing it hides. The rule is measured: the box must be no taller than 1.6 line boxes AND
  // must genuinely cut into the ink.
  assert.match(harness, /const tight = a\.clientHeight <= after\.lhPx \* 1\.6;/);
  assert.match(harness, /const cuts = \(r\.top - over\) < ar\.top - 1 \|\| \(r\.bottom \+ under\) > ar\.bottom \+ 1;/);
  assert.match(harness, /if \(tight && cuts\)/);
  assert.match(harness, /hop < 3 && a && a !== document\.body/, 'never the frame itself');
});

test('it runs on both sides of __fitText, and cannot double-apply', () => {
  // __fitText changes font-size, which changes the overhang — so the pass has to run again after
  // it. That is only safe because the originals are stashed on the node and every value is
  // recomputed from them.
  const order = /__fitMarks\(\); \} catch\(e\)\{\}\s*\n\s*try \{ window\.__fitText\(\); \} catch\(e\)\{\}\s*\n\s*try \{ window\.__fitMarks\(\)/;
  assert.match(harness, order);
  assert.match(harness, /if \(d\.vnPadT === undefined\) \{/, 'originals are stashed once');
  assert.match(harness, /const padT = parseFloat\(d\.vnPadT\) \|\| 0, padB = parseFloat\(d\.vnPadB\) \|\| 0;/);
});

test('the pass ships inside the scene page', () => {
  const html = buildSceneHtml(
    { id: 's', idx: 0, voice_text: 'Đà Nẵng', template: 'kinetic-statement', props: { heading: 'ĐÀ NẴNG' }, duration: 5 },
    { id: 'p', aspect_ratio: '16:9' }, { enableSubtitles: false }, { total: 1 },
  );
  assert.match(html, /window\.__fitMarks = /);
  // the class must survive the template literal as an ESCAPE, not as a literal property name
  assert.match(html, /\\p\{M\}/);
});

test('the codegen prompt finally names Vietnamese as a tall-mark script', () => {
  // The function had branches for Devanagari, Thai and CJK from the start. Vietnamese fell
  // through every one of them because it is written in Latin letters — so the model was never
  // told, and wrote line-height:0.8 on uppercase headlines.
  const vi = scriptTextRule('Điều gì xảy ra khi rơi vào hố đen vũ trụ?');
  assert.match(vi, /SCRIPT RULE \(Vietnamese\)/);
  assert.match(vi, /line-height ≥1\.35/);
  assert.match(vi, /NEVER overflow:hidden/);
  assert.match(vi, /background-clip:text/, 'the mechanism that actually broke the reported frame');
  assert.match(vi, /padding:0\.22em/);
  // …and an English scene still gets nothing, so its prompt — and its output — are unchanged
  assert.equal(scriptTextRule('What happens when you fall into a black hole?'), '');
  assert.equal(scriptTextRule(''), '');
});

test('the rule fires on the marks, not on a word list', () => {
  // Detection is by combining mark after NFD, so it covers a Vietnamese proper noun inside an
  // otherwise English narration, and cannot be fooled by a topic that happens to avoid diacritics.
  assert.match(scriptTextRule('We flew to Đà Nẵng last week'), /SCRIPT RULE \(Vietnamese\)/);
  assert.equal(scriptTextRule('We flew to Da Nang last week'), '', 'no marks, no rule');
});

test('the zone budget names the failure it actually gets', () => {
  // The rule already forbade two anchors sharing a left% or a top%, which a model satisfies with
  // 48% and 62% — different numbers, same zone. Measured over 1,082 shipped scenes: 31% put two
  // slots in one zone while 43% left a corner empty, so in most of them the SAME slots would have
  // passed if one of the pair had moved to the starved corner.
  const prompt = readFileSync(new URL('../src/hyperframe/prompt.js', import.meta.url), 'utf8');
  assert.match(prompt, /TWO SLOTS MAY NEVER BIN INTO THE SAME ZONE/);
  assert.match(prompt, /48% and 62% are different numbers and the SAME zone/);
  assert.match(prompt, /move the slot, do not add one/, 'the rule must never ask for more elements');
  // and the law it enforces is still the one that was already there
  assert.match(prompt, /at least 7 of the 9 zones hold an anchor/);
});
