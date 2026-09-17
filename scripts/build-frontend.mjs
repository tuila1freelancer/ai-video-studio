#!/usr/bin/env node
// Assemble the shipped public/ — 36 ES modules become one minified file.
//
//   node scripts/build-frontend.mjs --out <dir>
//
// This is the weakest link in the whole exercise and it is worth saying so: WKWebView has to be
// handed JavaScript it can run, so the frontend can always be read by someone who wants to. What
// bundling and minifying buys is that it is no longer a browsable, commented source tree — and the
// UI is not where the value is. The engine is, and that ships as encrypted bytecode.
import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : fallback;
}

const out = resolve(ROOT, arg('out', join('dist', 'public')));
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// Everything but the module tree, verbatim: css, fonts, images, index.html.
cpSync(PUBLIC, out, { recursive: true, filter: (src) => !src.startsWith(join(PUBLIC, 'js')) });
rmSync(join(out, 'js'), { recursive: true, force: true });

await build({
  entryPoints: [join(PUBLIC, 'js', 'main.js')],
  outfile: join(out, 'js', 'main.js'),
  bundle: true,
  format: 'esm',
  target: 'safari15', // WKWebView on the oldest macOS the Info.plist admits
  minify: true,
  legalComments: 'none',
  logLevel: 'warning',
});

// The preload hints name files that no longer exist; left in place every one of them is a 404 on
// first paint. main.js keeps its hint because it is still the entry.
const htmlPath = join(out, 'index.html');
const html = readFileSync(htmlPath, 'utf8');
const stripped = html.replace(/^[ \t]*<link rel="modulepreload" href="\/?js\/(?!main\.js")[^"]*">\n/gm, '');
const removed = (html.match(/rel="modulepreload"/g) || []).length
  - (stripped.match(/rel="modulepreload"/g) || []).length;
writeFileSync(htmlPath, stripped);

console.log(`frontend:  ${relative(ROOT, join(out, 'js', 'main.js'))}  (${(statSync(join(out, 'js', 'main.js')).size / 1024).toFixed(0)} KB, one file)`);
console.log(`preloads:  ${removed} stale modulepreload hints removed from index.html`);
