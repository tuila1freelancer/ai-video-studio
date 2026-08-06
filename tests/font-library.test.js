// One list of typefaces, and a scene page that carries only the ones it uses.
//
// Three answers to "which fonts exist?" used to be in circulation: ten hard-coded <option>s in
// index.html (two of which existed nowhere else), eight families inlined into every scene page
// whether referenced or not, and exactly two loaded by the app's own UI. The owner could pick
// Anton, watch the preview fall back to system sans-serif, and have no way to tell whether the
// video would differ.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CATALOGUE, fontLibrary, familiesForLanguage, familyReady, scriptForLanguage, catalogueEntry } from '../src/fonts/registry.js';
import { fontsCss, familiesIn, vendoredFamilies, buildScenePage } from '../src/animation/harness.js';
import { buildSceneHtml } from '../src/animation/index.js';
import { normFamily } from '../src/fonts/files.js';

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

// ---------------------------------------------------------------- the registry

test('the catalogue covers every script the app claims to support', () => {
  const covered = new Set(CATALOGUE.flatMap((e) => e.scripts));
  for (const s of ['latin', 'vietnamese', 'cyrillic', 'greek', 'cjk-sc', 'japanese', 'korean', 'arabic', 'thai', 'devanagari', 'hebrew']) {
    assert.ok(covered.has(s), `no family covers ${s}`);
  }
  assert.ok(CATALOGUE.length >= 30, `expected a real library, got ${CATALOGUE.length}`);
});

test('every entry is reachable one of exactly three ways', () => {
  for (const e of CATALOGUE) {
    assert.ok(e.google || e.system, `${e.family} is neither downloadable nor a system face`);
    assert.ok(e.weights.length && e.scripts.length, `${e.family} is under-described`);
  }
});

test('CJK deliberately rides on system fonts', () => {
  // a single Noto Sans SC face is 5–20 MB; vendoring the set would dwarf the repository
  for (const script of ['cjk-sc', 'japanese', 'korean']) {
    const fams = CATALOGUE.filter((e) => e.scripts.includes(script));
    assert.ok(fams.length, `${script} has no family at all`);
    assert.ok(fams.some((e) => e.system), `${script} has no system option`);
  }
});

test('the library reports an honest status per family', () => {
  const lib = fontLibrary();
  const byName = new Map(lib.map((f) => [f.family, f]));
  // the eight built into vendor/fonts are ready without anything being fetched
  for (const f of ['Be Vietnam Pro', 'Anton', 'Montserrat', 'Lexend']) {
    assert.equal(byName.get(f)?.source, 'vendored', `${f} should be vendored`);
    assert.equal(byName.get(f)?.ready, true);
  }
  assert.equal(byName.get('PingFang SC')?.source, 'system');
  assert.equal(byName.get('PingFang SC')?.ready, true);
  // …and one that has to be fetched must SAY so rather than sit in the list looking available
  assert.equal(byName.get('Bebas Neue')?.source, 'downloadable');
  assert.equal(byName.get('Bebas Neue')?.ready, false);
});

test('language decides which faces the owner is shown first', () => {
  assert.equal(scriptForLanguage('vi'), 'vietnamese');
  assert.equal(scriptForLanguage('ja'), 'japanese');
  assert.equal(scriptForLanguage('ar'), 'arabic');
  assert.equal(scriptForLanguage('en'), 'latin');
  assert.equal(scriptForLanguage(undefined), 'latin');

  const ja = familiesForLanguage('ja');
  assert.ok(ja[0].scripts.includes('japanese'), `a Japanese video leads with ${ja[0].family}`);
  assert.ok(ja[0].ready, 'and with something usable right now');
  const vi = familiesForLanguage('vi');
  assert.ok(vi[0].scripts.includes('vietnamese'));
});

test('familyReady is what stands between a pick and a silent substitution', () => {
  assert.equal(familyReady('Anton'), true);
  assert.equal(familyReady('PingFang SC'), true);
  assert.equal(familyReady('Bebas Neue'), false, 'not fetched yet — the UI must say so');
  assert.equal(familyReady('Nothing At All'), false);
  assert.equal(familyReady(''), false);
});

test('catalogue lookup ignores how the name is spaced', () => {
  assert.equal(catalogueEntry('BeVietnamPro')?.family, 'Be Vietnam Pro');
  assert.equal(normFamily('Be Vietnam Pro'), normFamily('bevietnampro'));
});

// ---------------------------------------------------------------- per-scene embedding

test('a scene page embeds the faces it names and no others', () => {
  const known = vendoredFamilies();
  assert.ok(known.length >= 8, 'the vendored sheet parsed');
  assert.equal(familiesIn("font-family:'Anton',sans-serif", known).join(), 'Anton');
  assert.deepEqual(familiesIn('nothing here', known), []);
  // the scan has to see `font:` shorthand and inline styles too, not just font-family:
  assert.ok(familiesIn('.wmt{font:700 20px JetBrains Mono}', known).includes('JetBrains Mono'));
});

test('fontsCss returns only the requested families', () => {
  const one = fontsCss(['Anton']);
  assert.match(one, /font-family:\s*'Anton'/);
  assert.ok(!/font-family:\s*'Montserrat'/.test(one), 'nothing else came along');
  assert.equal(fontsCss([]), '', 'a page naming no family carries no font bytes');
  assert.ok(fontsCss().length > one.length, 'the unfiltered sheet is still available');
});

test('the whole point: a scene page is no longer half a megabyte of unused fonts', () => {
  const project = { id: 'fontproj', aspect_ratio: '16:9' };
  const scene = {
    id: 's1', idx: 0, voice_text: 'thử', template: 'kinetic-statement',
    props: { pre: '', heading: 'THỬ', heading2: '', sub: '' }, duration: 5, srt_json: [],
  };
  const html = buildSceneHtml(scene, project, { enableSubtitles: true }, { total: 1 });
  const faces = html.match(/@font-face/g)?.length || 0;
  const allFaces = fontsCss().match(/@font-face/g)?.length || 0;
  assert.ok(faces > 0, 'the page still carries the font it renders with');
  assert.ok(faces < allFaces, `embedded ${faces} of ${allFaces} faces`);
  assert.ok(html.length < 700_000, `page is ${Math.round(html.length / 1024)}KB — it used to be 757KB`);
});

test('an owner font named in the scene still reaches the page', () => {
  // uploads are matched by the family name on the DB row, not the filename on disk
  const page = buildScenePage({
    w: 1920, h: 1080, theme: { bg: '#000', bg2: '#111', ink: '#fff', font: "'Anton',sans-serif", mono: 'monospace', accents: ['#f00', '#0f0', '#00f'], glow: () => 'none', gradBar: '#fff', muted: '#888' },
    duration: 5, template: { css: '', html: '<p>x</p>' }, captions: [],
  });
  assert.match(page, /font-family:\s*'Anton'/, 'the theme font is embedded');
});
