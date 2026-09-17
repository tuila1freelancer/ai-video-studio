// Code-health ratchets. Each baseline below is the state of the tree when the ratchet was added;
// the numbers may only go DOWN, and a file that improves past its entry must be struck from the
// list in the same commit — so an improvement is recorded, and a regression is a red test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('../', import.meta.url).pathname;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}
const rel = (p) => relative(ROOT, p);
const lines = (p) => { const s = readFileSync(p, 'utf8'); return s.split('\n').length - (s.endsWith('\n') ? 1 : 0); };

// (a) No file over 400 lines. Every entry is a file that was already over when the rule arrived;
// each shrinks (never grows) until it is under the bar and leaves the list.
const MAX_LINES = 400;
const OVERSIZE = {
  'public/js/views/config.js': 1127,
  'public/js/views/studio.js': 982,
  'public/js/views/guide.js': 678,
  'public/js/features/brandkit.js': 451,
  'public/js/features/settings.js': 439,
  'src/hyperframe/prompt.js': 418,
};

test('code health: no source file over 400 lines (ratchet)', () => {
  const files = [...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'public', 'js'))];
  const seen = new Set();
  for (const f of files) {
    const r = rel(f);
    const n = lines(f);
    seen.add(r);
    if (r in OVERSIZE) {
      assert.ok(n <= OVERSIZE[r], `${r} grew: ${n} lines, ratchet is ${OVERSIZE[r]}`);
      assert.ok(n > MAX_LINES, `${r} is ${n} lines now — under the bar, remove it from OVERSIZE`);
    } else {
      assert.ok(n <= MAX_LINES, `${r} is ${n} lines; split it (max ${MAX_LINES})`);
    }
  }
  for (const r of Object.keys(OVERSIZE)) assert.ok(seen.has(r), `${r} is gone — remove it from OVERSIZE`);
});

// (b) The server speaks through util/log.js. The two console lines in server.js are the sentinels
// the native launchers grep for (AVS_READY, AVS_PORT_IN_USE) and stay.
test('code health: no console.* in src/ outside the logger and the launcher sentinels', () => {
  for (const f of walk(join(ROOT, 'src'))) {
    const r = rel(f);
    if (r === 'src/util/log.js') continue;
    const hits = readFileSync(f, 'utf8').split('\n')
      .map((l, i) => [i + 1, l])
      .filter(([, l]) => /\bconsole\.(log|warn|error|info|debug)\(/.test(l))
      .filter(([, l]) => !(r === 'src/server.js' && /AVS_READY|AVS_PORT_IN_USE/.test(l)));
    assert.deepEqual(hits.map(([i]) => `${r}:${i}`), [], `${r} logs through console`);
  }
});

// (c) One definition per helper. The counts are today's copies; each drops to 1 as the copies are
// replaced by an import from util/util.js (server) or ui/format.js (browser).
const HELPER_COPIES = { sleep: 4, clamp: 5, fold: 5, escapeHtml: 2, safeJson: 2, fmtT: 2 };

test('code health: duplicated helpers only ever decrease (ratchet)', () => {
  const files = [...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'public', 'js'))];
  for (const [name, max] of Object.entries(HELPER_COPIES)) {
    const re = new RegExp(`^(?:export )?(?:function ${name}\\b|const ${name} = )`, 'm');
    const where = files.filter((f) => re.test(readFileSync(f, 'utf8'))).map(rel);
    assert.ok(where.length <= max, `${name} is defined ${where.length}× (ratchet ${max}): ${where.join(', ')}`);
    assert.ok(where.length === max, `${name} is down to ${where.length} copies — lower HELPER_COPIES.${name} to ${where.length}`);
  }
});

// (d) A test that touches src/ runs against a private data dir (_env.mjs) unless it imports only
// pure modules — the ones listed here open no database and spawn nothing.
const PURE_TESTS = new Set(['cross-platform-paths.test.js', 'pricing.test.js', 'hf-lint.test.js']);

test('code health: every test touching src/ loads _env.mjs first', () => {
  const dir = join(ROOT, 'tests');
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.test.js'))) {
    const s = readFileSync(join(dir, name), 'utf8');
    if (!/from '\.\.\/src\/|import\('\.\.\/src\//.test(s) || PURE_TESTS.has(name)) continue;
    assert.match(s, /^import '\.\/_env\.mjs';/m, `${name} imports src/ without ./_env.mjs`);
  }
});
