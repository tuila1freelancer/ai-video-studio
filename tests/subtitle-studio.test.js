// Every subtitle control has to reach the burned video. This file tests that claim where it is
// actually settled — the generated .ass document — and not on the resolver objects in between,
// because both bugs it opens with lived exactly in that gap: a value resolved correctly, then
// dropped one hop before the file was written.
//
// The panel's own preview is not evidence. It reads the DOM controls directly, so it renders the
// owner's pick faithfully whether or not the renderer ever sees it — which is why "Kiểu chữ" looked
// right in the panel and came out wrong in the video for as long as it did.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAss, toAssColor } from '../src/subtitles/ass.js';
import { burnStyleFrom } from '../src/subtitles/presets.js';

const theme = { ink: '#F2F5FF', accents: ['#7C8CFF', '#22D3EE', '#F59E0B'] };
const SIZE = { w: 1920, h: 1080 };

const CUE = {
  start: 0, end: 2, text: 'một câu thử',
  words: [
    { word: 'một', start: 0, end: 0.6 },
    { word: 'câu', start: 0.6, end: 1.2 },
    { word: 'thử', start: 1.2, end: 2 },
  ],
};

/** The .ass produced by the real path: config → burnStyleFrom → buildAss. */
function assFor(config, cues = [CUE]) {
  return buildAss(cues, burnStyleFrom(config, theme, SIZE), SIZE);
}

/**
 * The V4+ Style line, by name. A positional format string with 23 comma-separated fields is
 * unreadable to assert against directly, and miscounting it is how a colour ends up in the
 * shadow slot without anything failing.
 */
const STYLE_FIELDS = ['Name', 'Fontname', 'Fontsize', 'PrimaryColour', 'SecondaryColour',
  'OutlineColour', 'BackColour', 'Bold', 'Italic', 'Underline', 'StrikeOut', 'ScaleX', 'ScaleY',
  'Spacing', 'Angle', 'BorderStyle', 'Outline', 'Shadow', 'Alignment', 'MarginL', 'MarginR',
  'MarginV', 'Encoding'];

export function styleOf(ass) {
  const line = ass.split('\n').find((l) => l.startsWith('Style: '));
  assert.ok(line, 'the document has no [V4+ Styles] line');
  const parts = line.slice('Style: '.length).split(',');
  assert.equal(parts.length, STYLE_FIELDS.length, `expected ${STYLE_FIELDS.length} style fields`);
  return Object.fromEntries(STYLE_FIELDS.map((k, i) => [k, parts[i]]));
}

// ------------------------------------------------------------------ bug 1: dropped text case

test('KIỂU CHỮ reaches the burn with no preset selected', () => {
  // '' is what the panel sends for "Tuỳ biến tay" — a real choice, not an absent one. This is the
  // exact configuration the owner reported: the preview showed HOA, the video did not.
  const cfg = { subtitlePreset: '', subtitleTextCase: 'uppercase' };
  assert.equal(burnStyleFrom(cfg, theme, SIZE).textCase, 'uppercase');
  const ass = assFor(cfg);
  assert.match(ass, /MỘT/);
  assert.doesNotMatch(ass, /một/);
});

test('an explicit text case still wins over a preset that declares one', () => {
  // 'mono-terminal' declares lowercase; asking for uppercase has to beat it, in both directions.
  const upper = assFor({ subtitlePreset: 'mono-terminal', subtitleTextCase: 'uppercase' });
  assert.match(upper, /MỘT/);
  const preset = assFor({ subtitlePreset: 'mono-terminal' });
  assert.match(preset, /một/);
  assert.doesNotMatch(preset, /MỘT/);
});

test('no text case anywhere leaves the narration untouched', () => {
  const ass = assFor({ subtitlePreset: '' });
  assert.match(ass, /một câu thử|một/);
  assert.doesNotMatch(ass, /MỘT/);
});

// ------------------------------------------------------------------ bug 2: box colour slot

test('an opaque box is painted from OutlineColour, which is where libass reads it', () => {
  // Measured against a real libass render, not the ASS spec: with BorderStyle 3 the box takes the
  // OUTLINE colour. Writing the box colour to BackColour — as this did — tinted the drop shadow
  // and left every box black, so "Bản Tin" and "Terminal" never showed their own colour.
  const s = styleOf(assFor({ subtitlePreset: 'boxed-news' }));
  assert.equal(s.BorderStyle, '3');
  assert.equal(s.OutlineColour, toAssColor('rgba(17,17,17,0.85)'));
});

test('a non-box effect keeps its black outline and does not borrow the box colour', () => {
  const s = styleOf(assFor({ subtitlePreset: 'bold-impact' })); // effect: outline
  assert.equal(s.BorderStyle, '1');
  assert.equal(s.OutlineColour, toAssColor('#000000', 0.92));
});

test('dimming an unspoken word does not dim the box behind it', () => {
  // `\alpha` sets all four alpha channels, and under BorderStyle 3 the outline channel IS the box.
  // Using it per word gave a boxed caption a patchwork of opacities that moved with the karaoke —
  // invisible until the box stopped being hardcoded black. The fill alone follows the word.
  const boxed = assFor({ subtitlePreset: 'boxed-news' });
  assert.match(boxed, /\\1a&H/);
  assert.doesNotMatch(boxed, /\\alpha&H/);
  // …while an outline effect still dims its outline with the text, or a faint word would keep a
  // full-strength black rim around it.
  assert.match(assFor({ subtitlePreset: 'bold-impact' }), /\\alpha&H/);
});
