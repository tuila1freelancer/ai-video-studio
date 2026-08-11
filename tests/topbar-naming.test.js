// The left rail became a topbar, and a project can finally be named.
//
// Both are UI changes, so most of this reads source text — but the one thing that is NOT cosmetic
// gets a real assertion: a project the owner has named must never be renamed underneath them.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('the shell is a column with one topbar, and the panes stop padding around the titlebar', () => {
  const css = src('../public/css/app.css');
  assert.match(css, /\.app\{display:flex;flex-direction:column/);
  assert.match(css, /\.nav\{display:flex;align-items:center/);
  assert.doesNotMatch(css, /\.nav\{width:216px/, 'the 216px rail is gone');
  // The title-bar inset belongs to the topbar alone now. Four panes each adding it is what made
  // the app look like it had two headers stacked.
  assert.match(css, /\.nav\{[^}]*padding-top:calc\(8px \+ var\(--pad-titlebar\)\)/);
  for (const pane of ['.s-main', '.s-config', '.lib', '.gallery']) {
    assert.doesNotMatch(css, new RegExp(`html\\.is-shell \\${pane}\\{padding-top:calc`), `${pane} still pads for the titlebar`);
  }
  // …and the topbar is the drag region, with its own controls opted back out
  assert.match(css, /-webkit-app-region:drag/);
  assert.match(css, /\.nav button,\.nav select,\.nav \.nav-foot\{-webkit-app-region:no-drag\}/);
});

test('the collapse toggle went with the rail, everywhere', () => {
  // A topbar has no width to give back, so ⌘B and its command-palette entry would do nothing.
  for (const f of ['../public/index.html', '../public/js/views/nav.js', '../public/js/ui/palette.js', '../public/css/app.css']) {
    assert.doesNotMatch(src(f), /btnNavToggle|nav-collapsed|toggleNav/, `${f} still references the collapse toggle`);
  }
});

test('a project can be named, and naming it locks the name', () => {
  const html = src('../public/index.html');
  assert.match(html, /id="projName"/);
  const nav = src('../public/js/views/nav.js');
  assert.match(nav, /api\.put\(`\/projects\/\$\{cur\.id\}`, \{ title, metadata: md \}\)/);
  // metadata, never config: config keys feed renderFingerprint, and a rename must not make a
  // single clip stale.
  assert.match(nav, /titleLocked: true/);
  assert.doesNotMatch(nav, /config: \{[^}]*titleLocked/);
  // renameable from the list too — the topbar only ever shows the project that is open
  assert.match(src('../public/js/views/studio.js'), /async function renameProject\(p\)/);
});

test('a named project survives a regenerated script', () => {
  // B2 overwrites project.title from the script it just generated. Without this guard, naming a
  // project and then regenerating its script silently threw the name away — the single way this
  // feature could have been worse than not having it.
  const script = src('../src/pipeline/stages/script.js');
  assert.match(script, /const named = project\.metadata\?\.titleLocked === true;/);
  assert.match(script, /project\.title = named\s*\n\s*\? project\.title/);
  // and `title` is a field updateProject actually accepts, which is why no migration was needed
  assert.match(src('../src/db/repositories/projects.js'), /const allowed = \['title',/);
});
