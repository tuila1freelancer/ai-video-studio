#!/usr/bin/env node
// Assemble the shipped public/ — the module tree becomes a hashed, code-split bundle.
//
//   node scripts/build-frontend.mjs --out <dir>
//
// This is the weakest link in the whole exercise and it is worth saying so: WKWebView has to be
// handed JavaScript it can run, so the frontend can always be read by someone who wants to. What
// bundling and minifying buys is that it is no longer a browsable, commented source tree — and the
// UI is not where the value is. The engine is, and that ships as encrypted bytecode.
//
// Every file the document references carries a content hash in its name, so the server can mark
// it immutable and a new build can never be served from an old cache; the document itself is the
// only thing revalidated.
import { build, transform } from 'esbuild';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
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

const hashOf = (text) => createHash('sha256').update(text).digest('hex').slice(0, 8).toUpperCase();
const kb = (path) => `${(statSync(path).size / 1024).toFixed(0)} KB`;

const out = resolve(ROOT, arg('out', join('dist', 'public')));
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// Everything but the module tree and stylesheets, verbatim: fonts, images, locales, guide data.
// index.html ships assembled from its partials, which stay behind.
const SKIP = [join(PUBLIC, 'js'), join(PUBLIC, 'css'), join(PUBLIC, 'partials')];
cpSync(PUBLIC, out, { recursive: true, filter: (src) => !SKIP.some((d) => src.startsWith(d)) && !src.endsWith('.DS_Store') });
let html = assembleIndex(PUBLIC);

// ---- stylesheets: the per-area sheets become one hashed file, joined in link order (the cascade);
// fonts.css stays apart because it is large and rarely changes.
mkdirSync(join(out, 'css'));
const links = [...html.matchAll(/^[ \t]*<link rel="stylesheet" href="\/css\/([^"]+)">\n/gm)];
const areaSheets = links.filter((m) => m[1] !== 'fonts.css');
async function emitCss(name, sources) {
  const joined = sources.map((f) => readFileSync(join(PUBLIC, 'css', f), 'utf8')).join('\n');
  const { code } = await transform(joined, { loader: 'css', minify: true });
  const file = `${name}-${hashOf(code)}.css`;
  writeFileSync(join(out, 'css', file), code);
  return `/css/${file}`;
}
const appCss = await emitCss('app', areaSheets.map((m) => m[1]));
const fontsCss = await emitCss('fonts', ['fonts.css']);
html = html.replace(links.find((m) => m[1] === 'fonts.css')[0], `<link rel="stylesheet" href="${fontsCss}">\n`);
html = html.replace(areaSheets[0][0], `<link rel="stylesheet" href="${appCss}">\n`);
for (const m of areaSheets.slice(1)) html = html.replace(m[0], '');

// ---- scripts: one entry, lazy modules split into chunks the entry pulls on demand.
const { metafile } = await build({
  entryPoints: [join(PUBLIC, 'js', 'main.js')],
  outdir: join(out, 'js'),
  entryNames: '[name]-[hash]',
  chunkNames: 'chunks/[name]-[hash]',
  bundle: true,
  splitting: true,
  format: 'esm',
  target: 'safari15', // WKWebView on the oldest macOS the Info.plist admits
  minify: true,
  legalComments: 'none',
  metafile: true,
  logLevel: 'warning',
});
// A lazily imported module is the entry point of its own chunk in the metafile; the document's
// entry is the one that came from main.js.
const [entryPath] = Object.entries(metafile.outputs)
  .find(([, o]) => o.entryPoint && resolve(ROOT, o.entryPoint) === join(PUBLIC, 'js', 'main.js'));
const urlOf = (p) => `/${relative(out, resolve(ROOT, p)).split('\\').join('/')}`;
// Everything the entry reaches through static imports is needed before first paint; hinting the
// whole graph lets the browser fetch it in parallel instead of one level per round trip. The lazy
// chunks are left for the browser to fetch when a click asks for them.
const preload = [];
for (const queue = [entryPath]; queue.length;) {
  const p = queue.shift();
  if (preload.includes(p)) continue;
  preload.push(p);
  for (const i of metafile.outputs[p].imports) if (i.kind === 'import-statement') queue.push(i.path);
}

html = html.replace(/^[ \t]*<link rel="modulepreload" href="[^"]*">\n/gm, '');
html = html.replace('<script type="module" src="/js/main.js"></script>',
  `${preload.map((p) => `<link rel="modulepreload" href="${urlOf(p)}">`).join('\n')}\n<script type="module" src="${urlOf(entryPath)}"></script>`);

// ---- the document: comments and indentation are for the editor, not the browser.
if (!/<pre[\s>]/.test(html)) {
  html = html.replace(/<!--[\s\S]*?-->\n?/g, '').replace(/^[ \t]+/gm, '').replace(/\n{2,}/g, '\n');
}
writeFileSync(join(out, 'index.html'), html);

const chunks = readdirSync(join(out, 'js', 'chunks'));
console.log(`entry:     ${urlOf(entryPath)} (${kb(resolve(ROOT, entryPath))}), ${preload.length - 1} chunk(s) preloaded, ${chunks.length} chunks total`);
console.log(`css:       ${appCss} (${kb(join(out, appCss))}), ${fontsCss} (${kb(join(out, fontsCss))})`);
console.log(`document:  index.html (${kb(join(out, 'index.html'))})`);
