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
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { buildAss, cueText, readableOn, toAssColor } from '../src/subtitles/ass.js';
import { boxDrawing, captionAnchor, roundedRectPath } from '../src/subtitles/box.js';
import { burnStyleFrom } from '../src/subtitles/presets.js';
import { SUBTITLE_KEYS, pickSubtitleConfig } from '../src/api/services/subtitle-defaults.js';

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

// ------------------------------------------------------------------ the no-drift fence

/**
 * A config that asks for none of the new controls must produce the SAME .ass it did before they
 * existed. Every new field is `undefined` when unset and every consumer falls back to what it
 * computed before — this is the test that says so, for the four shapes real projects are in.
 *
 * If you are here because this failed: a default changed, and 46 finished projects would come back
 * from a re-render looking different. Restore the fallback rather than the number.
 */
const FROZEN_ASS = {
  empty: 'ab894a559118f123',
  'classic-karaoke': '58b4dfe6b97845ec',
  'boxed-news': 'dd5fb77a26477a1e',
  plain: '8a8c91fb67bc1f4e',
};

test('an untouched config still burns byte-identical subtitles', () => {
  const digest = (cfg) => createHash('sha256').update(assFor(cfg)).digest('hex').slice(0, 16);
  assert.equal(digest({}), FROZEN_ASS.empty);
  assert.equal(digest({ subtitlePreset: 'classic-karaoke' }), FROZEN_ASS['classic-karaoke']);
  assert.equal(digest({ subtitlePreset: 'boxed-news' }), FROZEN_ASS['boxed-news']);
  assert.equal(digest({ subtitleMode: 'plain' }), FROZEN_ASS.plain);
  // and an explicit "off" for every switch is the same as not mentioning it
  assert.equal(digest({ subtitleItalic: false, subtitleUnderline: false, subtitleStrike: false, subtitleBox: false, subtitleReveal: false }), FROZEN_ASS.empty);
});

// ------------------------------------------------------------------ typography

test('typography controls land in their own style fields', () => {
  const s = styleOf(assFor({
    subtitleItalic: true, subtitleUnderline: true, subtitleStrike: true,
    subtitleScaleX: 130, subtitleScaleY: 80, subtitleAngle: 12, subtitleLetterSpacing: 8,
  }));
  assert.equal(s.Italic, '1');
  assert.equal(s.Underline, '1');
  assert.equal(s.StrikeOut, '1');
  assert.equal(s.ScaleX, '130');
  assert.equal(s.ScaleY, '80');
  assert.equal(s.Angle, '12');
  assert.equal(s.Spacing, '8');
  // Bold stays 0 — the weight picks the font FILE, and synthetic bold on a black face smears it
  assert.equal(s.Bold, '0');
});

test('a length typed against 1080p scales onto the real frame', () => {
  // the same rule fontSizePx already follows, so a style built at 1080 does not thin out at 4K
  const at4k = styleOf(buildAss([CUE], burnStyleFrom({ subtitleLetterSpacing: 8 }, theme, { w: 3840, h: 2160 }), { w: 3840, h: 2160 }));
  assert.equal(at4k.Spacing, '16');
});

test('the weight the owner picks reaches the font resolver', () => {
  // burnStyleFrom.weight is what prepareBurnFontDir uses to choose the .ttf that gets staged
  assert.equal(burnStyleFrom({ subtitleWeight: 400 }, theme, SIZE).weight, 400);
  assert.equal(burnStyleFrom({}, theme, SIZE).weight, 800, 'unchanged when unset');
});

// ------------------------------------------------------------------ colour, border, glow

test('outline and shadow are the owner\'s, colour and width both', () => {
  const s = styleOf(assFor({
    subtitleOutlineColor: '#FF0000', subtitleOutlineWidth: 7,
    subtitleShadowColor: '#0000FF', subtitleShadowDepth: 9,
  }));
  assert.equal(s.OutlineColour, toAssColor('#FF0000'));
  assert.equal(s.BackColour, toAssColor('#0000FF'), 'BackColour is the shadow colour');
  assert.equal(s.Outline, '7');
  assert.equal(s.Shadow, '9');
});

test('the unspoken and spoken dim levels are settable', () => {
  const ass = assFor({ subtitleDimUnread: 0.15, subtitleDimRead: 0.5 });
  assert.match(ass, /\\alpha&HD9&/); // 1 - 0.15 → 0xD9
  assert.match(ass, /\\alpha&H80&/); // 1 - 0.5  → 0x80
});

test('progressive reveal hides the words that have not been spoken', () => {
  const ass = assFor({ subtitleReveal: true });
  assert.match(ass, /\\alpha&HFF&/, 'unspoken words are fully transparent, not merely dim');
});

test('glow is a real blurred halo on the layer below, not a wider outline', () => {
  const ass = assFor({ subtitleGlow: 14, subtitleGlowColor: '#00E5FF' });
  const halo = ass.split('\n').find((l) => l.startsWith('Dialogue: 0,'));
  const text = ass.split('\n').find((l) => l.startsWith('Dialogue: 1,'));
  assert.match(halo, /\\blur14/);
  assert.match(halo, new RegExp(`\\\\3c${toAssColor('#00E5FF').replace(/[&\\]/g, '\\$&')}`));
  assert.match(halo, /\\1a&HFF&/, 'the halo contributes no fill, only the blurred rim');
  assert.ok(text, 'the crisp text rides above the halo');
  // …and no halo at all when it was not asked for
  assert.doesNotMatch(assFor({}), /\\blur/);
});

test('the halo fades with each word instead of giving the line away', () => {
  // A halo built from the plain text glows at full strength around words the karaoke has dimmed —
  // and under progressive reveal it would outline words that have not appeared yet.
  const halo = assFor({ subtitleGlow: 12, subtitleReveal: true })
    .split('\n').find((l) => l.startsWith('Dialogue: 0,'));
  assert.match(halo, /\\3a&HFF&/, 'an unrevealed word has no rim either');
  assert.match(halo, /\\3a&H00&/, 'the spoken word does');
});

// ------------------------------------------------------------------ karaoke highlight styles

test('the per-word highlight box paints only the word being spoken', () => {
  const ass = assFor({ subtitleKaraokeStyle: 'box', subtitleColor: '#F7B500' });
  const s = styleOf(ass);
  assert.equal(s.BorderStyle, '3', 'a per-run background is what BorderStyle 3 is');
  assert.equal(s.OutlineColour, toAssColor('#000000', 0), 'the line itself carries no box');
  assert.match(ass, /\\3a&H00&/, 'the spoken word turns its box back on');
  assert.match(ass, new RegExp(`\\\\3c${toAssColor('#F7B500').replace(/[&\\]/g, '\\$&')}`));
  // text inside a bright yellow box has to go dark on its own — one fewer setting to keep in sync
  assert.equal(readableOn('#F7B500'), '#000000');
  assert.equal(readableOn('#1A1A2E'), '#FFFFFF');
});

test('pop scales the spoken word and resets every other one', () => {
  const ass = assFor({ subtitleKaraokeStyle: 'pop', subtitlePopScale: 120 });
  assert.match(ass, /\\fscx120\\fscy120/);
  assert.match(ass, /\{\\r\\c/, 'without \\r the scale would leak onto the following words');
});

test('fades are emitted per cue in milliseconds', () => {
  assert.match(assFor({ subtitleFadeIn: 120, subtitleFadeOut: 200 }), /\\fad\(120,200\)/);
  assert.doesNotMatch(assFor({}), /\\fad/);
});

// ------------------------------------------------------------------ position and wrapping

test('horizontal alignment moves without disturbing the vertical placement', () => {
  // The vertical axis stays a distance from the BOTTOM with a bottom-row Alignment, because that
  // is what every finished project already renders — moving to Alignment 5/8 would shift them all.
  assert.equal(styleOf(assFor({ subtitleAlignH: 'left' })).Alignment, '1');
  assert.equal(styleOf(assFor({ subtitleAlignH: 'right' })).Alignment, '3');
  assert.equal(styleOf(assFor({})).Alignment, '2');
});

test('margins are free percentages of the frame', () => {
  const s = styleOf(assFor({ subtitleMarginV: 25, subtitleMarginH: 15 }));
  assert.equal(s.MarginV, String(Math.round(1080 * 0.25)));
  assert.equal(s.MarginL, String(Math.round(1920 * 0.15)));
  assert.equal(s.MarginR, s.MarginL);
});

test('the wrap mode is selectable and defaults to balanced', () => {
  assert.match(assFor({ subtitleWrap: 2 }), /^WrapStyle: 2$/m);
  assert.match(assFor({}), /^WrapStyle: 0$/m);
});

// ------------------------------------------------------------------ the persistence door

/**
 * A subtitle setting the resolver reads but the channel writer does not accept works for exactly
 * one video and is gone from the next — the setting appears to save and then quietly does not.
 * Rather than trusting two hand-maintained lists to stay in step, this reads the resolver's source
 * and demands that every `config.subtitle*` it consumes has a validator.
 */
test('every subtitle setting the resolver reads can be saved to a channel', () => {
  const src = readFileSync(new URL('../src/subtitles/presets.js', import.meta.url), 'utf8');
  const read = new Set([...src.matchAll(/\bc\.(subtitle[A-Z]\w*)/g)].map((m) => m[1]));
  assert.ok(read.size > 25, `expected the resolver to read many settings, found ${read.size}`);
  // Two are deliberately not channel settings: the lane is stated by the panel rather than chosen
  // (it is the only lane), and the language comes from the project's own config.
  const notPersisted = new Set(['subtitleLane', 'subtitleLang']);
  const missing = [...read].filter((k) => !notPersisted.has(k) && !(k in SUBTITLE_KEYS));
  assert.deepEqual(missing, [], 'add these to SUBTITLE_KEYS in api/services/subtitle-defaults.js');
});

test('the channel writer refuses values that would ruin a render', () => {
  const bad = {
    subtitleWeight: 0, subtitleScaleX: 5000, subtitleAngle: 900, subtitleDimRead: 4,
    subtitleBoxOpacity: -1, subtitleGlow: 999, subtitleAlignH: 'middle', subtitleWrap: 7,
    subtitleKaraokeStyle: 'sparkle', subtitleBoxColor: 'red', subtitleBoxPadding: [1, 2],
  };
  assert.deepEqual(pickSubtitleConfig(bad), {});
  // …and keeps the same values once they are inside the walls
  const good = { subtitleWeight: 700, subtitleAlignH: 'left', subtitleWrap: 2, subtitleBoxPadding: { top: 10, left: 24 } };
  assert.deepEqual(pickSubtitleConfig(good), good);
});

// ------------------------------------------------------------------ the drawn caption box

test('a rounded rectangle closes, and a radius cannot exceed the shape', () => {
  assert.equal(roundedRectPath(100, 40, 0), 'm 0 0 l 100 0 l 100 40 l 0 40', 'no radius, no curves');
  const r = roundedRectPath(200, 80, 20);
  assert.equal((r.match(/ b /g) || []).length, 4, 'one bezier per corner');
  assert.match(r, /^m 20 0 /);
  // a "pill" is asked for by naming a huge radius; it must clamp to half the short side rather
  // than fold the path inside out
  assert.match(roundedRectPath(300, 80, 9999), /b 300 80 300 80 260 80/);
});

test('the box hangs off the same anchor as the text it wraps', () => {
  // If the box were placed by libass's margins and the text by \pos (or the reverse) they would
  // drift apart on any alignment but centre. Both read captionAnchor.
  const style = burnStyleFrom({ subtitleBox: true, subtitleAlignH: 'left', subtitleMarginH: 10, subtitleMarginV: 20 }, theme, SIZE);
  const a = captionAnchor(style, SIZE);
  assert.equal(a.x, 192, 'left-aligned text starts at the margin');
  assert.equal(a.y, 864, '20% up from the bottom');
  assert.equal(a.an, 1);
});

test('the drawn box is one shape per cue, under the text', () => {
  const style = burnStyleFrom({
    subtitleBox: true, subtitleBoxRadius: 24, subtitleBoxColor: '#101828', subtitleBoxOpacity: 0.9,
    subtitleBoxPadding: { top: 12, right: 30, bottom: 16, left: 30 },
  }, theme, SIZE);
  const metrics = new Map([[cueText(CUE, style), { width: 400, height: 60, breakAfter: [] }]]);
  const doc = buildAss([CUE], style, SIZE, metrics);
  const drawn = doc.split('\n').filter((l) => l.includes('\\p1'));
  assert.equal(drawn.length, 1, 'one background for the whole cue — not one per karaoke word');
  assert.match(drawn[0], /^Dialogue: 0,/, 'layer 0, beneath the text');
  assert.match(drawn[0], /\\an7\\pos\(/, 'a shape has no baseline, so it is placed by its corner');
  // 400 + 30 + 30 wide, 60 + 12 + 16 tall — the straight edges stop a radius short of each corner
  assert.match(drawn[0], /m 24 0 l 436 0/);
  assert.match(drawn[0], /l 460 64 b 460 88 460 88 436 88/);
  // and the text is positioned explicitly too, so libass's margins cannot move it out of the box.
  // 1004 is the landscape default caption line (7% up from the bottom), and the box top is that
  // minus the measured height and the top padding — 1004 − 60 − 12 = 932.
  assert.match(doc, /\\an2\\pos\(960,1004\)/);
  assert.match(drawn[0], /\\pos\(730,932\)/);
  // BorderStyle reverts to an outline: a second, square, unpadded box on top would be nonsense
  assert.equal(styleOf(doc).BorderStyle, '1');
  assert.match(doc, /^WrapStyle: 2$/m, 'libass must not reflow text the box was measured against');
});

test('a box with no measurement draws nothing rather than a wrong shape', () => {
  const style = burnStyleFrom({ subtitleBox: true }, theme, SIZE);
  assert.doesNotMatch(buildAss([CUE], style, SIZE, new Map()), /\\p1/);
  assert.equal(boxDrawing(style, null, SIZE), null);
});

test('measured line breaks are burned as breaks, not handed back to libass', () => {
  const style = burnStyleFrom({ subtitleBox: true }, theme, SIZE);
  const metrics = new Map([[cueText(CUE, style), { width: 200, height: 120, breakAfter: [0] }]]);
  const doc = buildAss([CUE], style, SIZE, metrics);
  assert.match(doc, /một\\N/, 'the break the measurement chose');
  assert.doesNotMatch(doc, /một \{/, 'and not a space in its place');
  // without a box there is nothing measured to honour, and the join stays exactly as it was
  assert.doesNotMatch(buildAss([CUE], burnStyleFrom({}, theme, SIZE), SIZE), /\\N/);
});

// ------------------------------------------------------------------ saved presets

test('a saved preset carries settings, not an id the resolver would have to know', () => {
  const routes = readFileSync(new URL('../src/api/routes.js', import.meta.url), 'utf8');
  // stored through the same validator channel defaults use, so a preset cannot smuggle in a
  // setting the renderer would refuse — it would look saved and then not apply
  assert.match(routes, /pickSubtitleConfig\(req\.body\?\.config \|\| \{\}\)/);
  assert.match(routes, /DB\.createStyle\(\{ name, kind: 'subtitle'/);
  assert.match(routes, /DB\.listStyles\('subtitle'\)/);
  // a corrupt row must not empty the whole gallery
  assert.match(routes, /catch \{ \/\* a corrupt row must not empty the gallery \*\/ \}/);

  const cfg = readFileSync(new URL('../public/js/views/config.js', import.meta.url), 'utf8');
  // clicking a saved preset POURS it back into the panel; a built-in only sets the id
  assert.match(cfg, /SUB_FIELDS\.forEach\(\(f\) => writeSubField\(f, mine\.config\)\)/);
  // …with `applying` held, or every field written would fire its own save back at the channel
  assert.match(cfg, /applying = true;[\s\S]{0,900}?SUB_FIELDS\.forEach\(\(f\) => writeSubField\(f, mine\.config\)\)/);
});

test('a slider whose resting value is a legal choice only counts once touched', () => {
  // The burn's default vertical margin is 7% on a landscape frame, so a panel that shipped its
  // parked 12 would move every caption the first time subtitles were saved.
  const cfg = readFileSync(new URL('../public/js/views/config.js', import.meta.url), 'utf8');
  assert.match(cfg, /if \(f\.t === 'color' \|\| f\.off === null\) \{\s*\n\s*if \(el\.dataset\.set !== '1'\) return undefined;/);
  assert.match(cfg, /if \(f\.off === null\) el\.dataset\.set = has \? '1' : '';/, 'a stored value is a decision');
  assert.match(cfg, /\{ k: 'subtitleMarginV', el: '#cfgSubMarginV', t: 'num', off: null/);
});
