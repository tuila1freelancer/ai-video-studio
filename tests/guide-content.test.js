// The manual has to render every block it declares.
//
// The renderer dispatches on `block.t`, and the first draft of the content also used `t` for the
// TEXT of a callout: `{ t: 'note', kind: 'tip', t: '…' }`. A duplicate key in an object literal is
// legal JavaScript — the second one wins — so `b.t` became the sentence, `BLOCK[b.t]` was
// undefined, and all twenty callouts rendered as empty strings on a page that otherwise looked
// perfect. esbuild warned; nothing failed.
//
// This evaluates the real SECTIONS array (a pure literal, so it needs no DOM) and checks every
// block against the renderer's own dispatch table. A block type the renderer cannot draw is a
// test failure, not a silent blank.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = readFileSync(join(REPO, 'public', 'js', 'views', 'guide.js'), 'utf8');

// Required fields per block type, mirroring what each renderer in BLOCK reads.
const NEEDS = {
  h: ['text'], p: ['text'], where: ['text'],
  list: ['items'], steps: ['items'], defs: ['items'], keys: ['items'], grid: ['items'], go: ['items'],
  note: ['kind', 'text'],
};

function sections() {
  const from = SRC.indexOf('const SECTIONS = [');
  const to = SRC.indexOf('\n];', from);
  assert.ok(from > 0 && to > from, 'SECTIONS array not found in guide.js');
  return vm.runInNewContext(`${SRC.slice(from, to + 3)}\nSECTIONS`);
}

test('every guide block is one the renderer can draw', () => {
  const known = new Set(Object.keys(NEEDS));
  for (const s of sections()) {
    for (const b of s.blocks) {
      assert.ok(known.has(b.t), `section "${s.id}": unknown block type ${JSON.stringify(b.t)}`);
      for (const field of NEEDS[b.t]) {
        assert.ok(b[field] != null, `section "${s.id}": ${b.t} block missing "${field}"`);
      }
    }
  }
});

test('callouts keep their kind — a shadowed key would silently blank them', () => {
  const kinds = new Set(['tip', 'warn', 'cost', 'key']);
  let seen = 0;
  for (const s of sections()) {
    for (const b of s.blocks.filter((x) => x.t === 'note')) {
      seen += 1;
      assert.ok(kinds.has(b.kind), `section "${s.id}": note kind "${b.kind}" has no style`);
      assert.equal(typeof b.text, 'string');
      assert.ok(b.text.length > 10, `section "${s.id}": note text is suspiciously short`);
    }
  }
  assert.ok(seen >= 10, `expected the manual to carry callouts, found ${seen}`);
});

test('sections have unique ids and a sidebar group', () => {
  const ids = new Set();
  const groups = new Set();
  for (const s of sections()) {
    assert.ok(s.id && s.title && s.ic && s.grp, `section ${s.id || '?'} is missing id/title/ic/grp`);
    assert.ok(!ids.has(s.id), `duplicate section id "${s.id}" — the nav anchor would be ambiguous`);
    ids.add(s.id);
    groups.add(s.grp);
    assert.ok(s.blocks.length, `section "${s.id}" has no content`);
  }
  assert.ok(ids.size >= 15, `expected a full manual, found ${ids.size} sections`);
  assert.ok(groups.size >= 3, 'the sidebar needs more than a couple of groups to be worth having');
});

test('every "open that screen" button names an action the guide implements', () => {
  const map = SRC.slice(SRC.indexOf('const ACTIONS = {'), SRC.indexOf('let built = false;'));
  const implemented = new Set([...map.matchAll(/^\s{2}([a-z]+):/gm)].map((m) => m[1]));
  assert.ok(implemented.size >= 5, `ACTIONS table not parsed, found ${implemented.size}`);
  for (const s of sections()) {
    for (const b of s.blocks.filter((x) => x.t === 'go')) {
      for (const item of b.items) {
        assert.ok(implemented.has(item.act), `section "${s.id}": button "${item.label}" calls unknown action "${item.act}"`);
        assert.ok(item.label, `section "${s.id}": a go button has no label`);
      }
    }
  }
});

test('the guide page markup carries the hooks the renderer writes into', () => {
  const html = readFileSync(join(REPO, 'public', 'index.html'), 'utf8');
  for (const id of ['gdNav', 'gdBody', 'gdSearch', 'gdCount', 'gdMore', 'gdEmpty']) {
    assert.ok(html.includes(`id="${id}"`), `index.html is missing #${id}`);
  }
});
