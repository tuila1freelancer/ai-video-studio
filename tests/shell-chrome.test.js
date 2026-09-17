// Two things the window itself owes the user: a page that scrolls, and a window that moves.
//
// Both were broken and both were invisible to every other test, because both live in the one place
// the test suite cannot execute — the native WKWebView shell.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceOf } from './_source.mjs';

const css = sourceOf('public/css/app.css');
const swift = sourceOf('shell/main.swift');

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

test('the window has exactly one drag handle, and it is native', () => {
  // `-webkit-app-region` is a Chromium extension. WKWebView ignores it, so the CSS that claimed to
  // make the topbar draggable did nothing at all — and `fullSizeContentView` makes the titlebar
  // band hit-test straight through to the web view, so the window could not be moved from
  // anywhere. Measured with a hitTest probe over the theme frame: every point from 6pt to 60pt
  // below the top returned the WKWebView, whose mouseDownCanMoveWindow is false.
  assert.doesNotMatch(css, /-webkit-app-region\s*:/, 'dead in WKWebView — it must not look alive');
  assert.match(swift, /final class TitlebarDragView: NSView \{/);
  assert.match(swift, /window\.performDrag\(with: event\)/);
  // AppKit only hit-tests the strip if it sits ABOVE the web view, which means the web view can no
  // longer be the content view itself.
  assert.match(swift, /content\.addSubview\(webView\)[\s\S]{0,300}content\.addSubview\(dragStrip\)/);
  assert.match(swift, /window\.contentView = content/);
  assert.doesNotMatch(swift, /window\.contentView = webView/);
  assert.match(swift, /autoresizingMask = \[\.width, \.minYMargin\]/, 'stays pinned to the top on resize');
});

test('the strip covers the inset the CSS reserves, and no more', () => {
  // One number in two languages. Any control the web UI puts in that band becomes unclickable, and
  // any shortfall leaves a dead strip of topbar that looks draggable and is not.
  const inset = swift.match(/let TITLEBAR_INSET: CGFloat = (\d+)/)?.[1];
  const pad = css.match(/html\.is-shell\{ --pad-titlebar:(\d+)px; \}/)?.[1];
  assert.equal(inset, pad, `strip is ${inset}pt but the CSS reserves ${pad}px`);
  // …and the band really is empty: the topbar's own padding is what fills it.
  assert.match(css, /\.nav\{[^}]*padding-top:calc\(8px \+ var\(--pad-titlebar\)\)/);
});

test('double-clicking the strip does what the system says it should', () => {
  // A drag region that swallows the double-click is a titlebar that stopped zooming the window.
  assert.match(swift, /UserDefaults\.standard\.string\(forKey: "AppleActionOnDoubleClick"\)/);
  assert.match(swift, /case "Minimize": window\.miniaturize\(nil\)/);
  assert.match(swift, /default: window\.zoom\(nil\)/);
});
