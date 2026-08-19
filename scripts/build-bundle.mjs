#!/usr/bin/env node
// Collapse the server into one file, so a release carries no readable module tree.
//
//   node scripts/build-bundle.mjs [--out dist/bundle]
//
// Only OUR code is bundled. Every dependency stays external (`packages: 'external'`): express and
// friends are public open source, so hiding them buys nothing, while bundling them means inheriting
// every dynamic `require` they do — and `better-sqlite3` is a native addon that cannot be bundled
// at all. The payload therefore keeps node_modules exactly as before and loses only src/.
//
// The sourcemap is written OUTSIDE the output directory on purpose. Without one, a customer's crash
// report is a stack trace into a single minified line; with one inside the bundle, the whole point
// of this step is undone.
import { build } from 'esbuild';
import { mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The one set of bundling rules. Exported so a test can bundle a probe through EXACTLY these
 * settings — a test that reimplements the options proves only that the reimplementation works.
 */
export const bundleOptions = (entryPoints, outfile) => ({
  entryPoints: [entryPoints],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  minify: true,
  legalComments: 'none',
  packages: 'external',
  // CJS has no `import.meta`, and paths.js uses it to find ROOT — which is what locates
  // vendor/ffmpeg. Left undefined it would resolve silently to the wrong directory and downgrade
  // every customer to whatever ffmpeg their machine happens to have.
  banner: { js: "const __AVS_IMPORT_META_URL__ = require('node:url').pathToFileURL(__filename).href;" },
  define: { 'import.meta.url': '__AVS_IMPORT_META_URL__' },
  sourcemap: 'external',
  sourceRoot: ROOT,
  metafile: true,
  logLevel: 'warning',
});

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : fallback;
}

const outDir = resolve(ROOT, arg('out', join('dist', 'bundle')));
const mapDir = resolve(ROOT, arg('map-out', join('dist', 'private')));
const outfile = join(outDir, 'server.cjs');

mkdirSync(outDir, { recursive: true });
mkdirSync(mapDir, { recursive: true });

const result = await build(bundleOptions(join(ROOT, 'src', 'server.js'), outfile));

// esbuild writes `<outfile>.map` next to the bundle; move it out of the shipping directory.
const mapTo = join(mapDir, 'server.cjs.map');
renameSync(`${outfile}.map`, mapTo);

const inputs = Object.keys(result.metafile.inputs).filter((f) => f.startsWith('src/'));
console.log(`bundle:    ${relative(ROOT, outfile)}  (${(statSync(outfile).size / 1024).toFixed(0)} KB)`);
console.log(`sourcemap: ${relative(ROOT, mapTo)}  — KEEP PRIVATE, never ships, never committed`);
console.log(`modules:   ${inputs.length} src files collapsed into one`);
