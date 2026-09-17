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
import { assembleIndex } from '../src/util/html-include.js';
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

// Everything but the module tree, verbatim: css, fonts, images. index.html ships assembled from
// its partials, which stay behind.
cpSync(PUBLIC, out, { recursive: true, filter: (src) => !src.startsWith(join(PUBLIC, 'js')) && !src.startsWith(join(PUBLIC, 'partials')) && !src.endsWith('.DS_Store') });
rmSync(join(out, 'js'), { recursive: true, force: true });
let indexHtml = assembleIndex(PUBLIC);

// The per-area stylesheets become one file, joined in the order the shell links them (that order
// is the cascade). fonts.css stays apart: it is large, rarely changes, and caches on its own.
const sheets = [...indexHtml.matchAll(/^[ \t]*<link rel="stylesheet" href="\/css\/(?!fonts\.css")([^"]+)">\n/gm)];
const joined = sheets.map((m) => readFileSync(join(PUBLIC, 'css', m[1]), 'utf8')).join('\n');
writeFileSync(join(out, 'css', 'app.css'), joined);
for (const m of sheets) rmSync(join(out, 'css', m[1]));
indexHtml = indexHtml.replace(sheets[0][0], '<link rel="stylesheet" href="/css/app.css">\n');
for (const m of sheets.slice(1)) indexHtml = indexHtml.replace(m[0], '');
writeFileSync(join(out, 'index.html'), indexHtml);

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
