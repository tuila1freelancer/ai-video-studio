// The left rail became a topbar, and a project can finally be named.
//
// Both are UI changes, so most of this reads source text — but the one thing that is NOT cosmetic
// gets a real assertion: a project the owner has named must never be renamed underneath them.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceOf, indexHtml } from './_source.mjs';

/** The interface catalogue — where a Vietnamese label lives now that the markup carries keys. */
const catalogue = () => JSON.parse(sourceOf('public/locales/vi.json'));


test('the shell is a column with one topbar, and the panes stop padding around the titlebar', () => {
  const css = sourceOf('public/css/app.css');
  assert.match(css, /\.app\{display:flex;flex-direction:column/);
  assert.match(css, /\.nav\{display:flex;align-items:center/);
  assert.doesNotMatch(css, /\.nav\{width:216px/, 'the 216px rail is gone');
  // The title-bar inset belongs to the topbar alone now. Four panes each adding it is what made
  // the app look like it had two headers stacked.
  assert.match(css, /\.nav\{[^}]*padding-top:calc\(8px \+ var\(--pad-titlebar\)\)/);
  for (const pane of ['.s-main', '.s-config', '.lib', '.gallery']) {
    assert.doesNotMatch(css, new RegExp(`html\\.is-shell \\${pane}\\{padding-top:calc`), `${pane} still pads for the titlebar`);
  }
  // The topbar is still the drag region, but NOT via `-webkit-app-region` — see shell-chrome.test.js.
  assert.doesNotMatch(css, /-webkit-app-region\s*:/, 'WKWebView ignores it; the strip in main.swift drags');
});

test('the collapse toggle went with the rail, everywhere', () => {
  // A topbar has no width to give back, so ⌘B and its command-palette entry would do nothing.
  for (const f of ['public/index.html', 'public/js/views/nav.js', 'public/js/ui/palette.js', 'public/css/app.css']) {
    assert.doesNotMatch(sourceOf(f), /btnNavToggle|nav-collapsed|toggleNav/, `${f} still references the collapse toggle`);
  }
});

test('a project can be named, from the row that lists it', () => {
  // The name was briefly a chip in the topbar too. It came out: the row is the scarcest space in
  // the app, and the project list is where you are already looking when you want to tell two
  // projects apart. Renaming lives there and nowhere else.
  assert.doesNotMatch(indexHtml(), /id="projName"/);
  assert.doesNotMatch(sourceOf('public/js/views/nav.js'), /setProjectName|projName/);
  const studio = sourceOf('public/js/views/studio.js');
  assert.match(studio, /async function renameProject\(p\)/);
  assert.match(studio, /api\.put\(`\/projects\/\$\{p\.id\}`, \{ title, metadata: md \}\)/);
  // metadata, never config: config keys feed renderFingerprint, and a rename must not make a
  // single clip stale.
  assert.match(studio, /titleLocked: true/);
  assert.doesNotMatch(studio, /config: \{[^}]*titleLocked/);
});

test('the topbar sheds in a fixed order and never loses a control', () => {
  const css = sourceOf('public/css/app.css');
  // least useful first: the wordmark, then the page labels, then the settings label
  assert.match(css, /@media \(max-width:1220px\)\{\.nav-brand \.nav-label\{display:none\}\}/);
  assert.match(css, /@media \(max-width:1060px\)\{[\s\S]{0,120}\.nav-item \.nav-label\{display:none\}/);
  assert.match(css, /@media \(max-width:880px\)\{[\s\S]{0,200}#navSettings \.nav-label\{display:none\}/);
  // an icon-only item must still say what it is, and only where the label is actually gone
  assert.match(css, /\.nav-item::after\{content:attr\(data-tip\)/);
  assert.match(sourceOf('public/js/views/nav.js'), /b\.dataset\.tip = name;/);
  // nothing is removed outright — every control the row starts with is still in it
  const html = indexHtml();
  for (const id of ['channelSelect', 'navSettings', 'licenseBadge']) {
    assert.match(html, new RegExp(`id="${id}"`), `${id} left the topbar`);
  }
});

test('tool status is silent until a tool is actually missing', () => {
  // Four permanent green dots told the owner what they already knew, in the scarcest space in the
  // app. Deleting them outright would have been worse: a missing Chrome breaks every thumbnail
  // and every caption measurement, and the failure would have been the only clue.
  const html = indexHtml();
  assert.match(html, /class="dep-warn hidden" id="depWarn"/, 'hidden by default');
  // the detail moved into AI Setting rather than being thrown away
  // The label is a translation key now, so the guarantee is the ORDER — the section heading
  // immediately followed by an empty dep row — not the Vietnamese words that happen to fill it.
  assert.match(html, /<div class="sec-label"[^>]*>[^<]*<\/div>\s*\n\s*<div class="dep-row" id="depFoot"><\/div>/);
  assert.match(catalogue()['ui.settingsModal.cong-cu-he-thong'] || '', /Công cụ hệ thống/);
  const nav = sourceOf('public/js/views/nav.js');
  assert.match(nav, /warn\.classList\.toggle\('hidden', !missing\.length\)/);
  assert.match(nav, /\$\('#depWarn'\)\?\.addEventListener\('click', openSettings\)/, 'the warning opens where the detail is');
});

test('a named project survives a regenerated script', () => {
  // B2 overwrites project.title from the script it just generated. Without this guard, naming a
  // project and then regenerating its script silently threw the name away — the single way this
  // feature could have been worse than not having it.
  const script = sourceOf('src/pipeline/stages/script.js');
  assert.match(script, /const named = project\.metadata\?\.titleLocked === true;/);
  assert.match(script, /project\.title = named\s*\n\s*\? project\.title/);
  // and `title` is a field updateProject actually accepts, which is why no migration was needed
  assert.match(sourceOf('src/db/repositories/projects.js'), /const allowed = \['title',/);
});
