// What the window itself owes the user — starting with a page that scrolls.
//
// Broken and invisible to every other test, because it lives in the one place the suite cannot
// execute: the native WKWebView shell.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const css = src('../public/css/app.css');

test('a page fills the viewport and scrolls; nothing may take that away', () => {
  // `.page` is `position:absolute;inset:0` so it is exactly as tall as `.content` and scrolls its
  // own overflow. `#page-home{position:relative}` used to beat it on specificity, which let the
  // home page grow to its content (measured 3815px against a 743px viewport) — and since
  // `.content` is `overflow:hidden`, the gallery below the fold was clipped with nothing to scroll.
  assert.match(css, /\.page\{position:absolute;inset:0;overflow:auto;display:none\}/);
  assert.doesNotMatch(css, /#page-\w+\{[^}]*position:(relative|static)/,
    'an id rule beats .page and costs the page its height');
  assert.match(css, /\.content\{flex:1;overflow:hidden/);
});
