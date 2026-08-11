// P40 — the remaining gaps a multi-agent audit of the reference app CONFIRMED against this repo:
// SEO written from the title alone, no key pool for paid voices, and no scheduled publishing.
// Pure/fast: no network, no LLM.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { keyPool } from '../src/providers/tts.js';

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('P40: SEO metadata is written from the NARRATION, not from the title alone', () => {
  const llm = src('../src/providers/llm.js');
  assert.match(llm, /generateMetadata\(project, stylePrompt, \{ ai, script = '' \} = \{\}\)/, 'the script is an input');
  assert.match(llm, /WHAT THE VIDEO ACTUALLY SAYS/, 'and it reaches the prompt');
  assert.match(llm, /never promise something the script does not deliver/, 'with the honesty rule attached');
  // both callers feed it: the pipeline stage and the manual regenerate button
  const stage = src('../src/pipeline/stages/metadata.js');
  assert.match(stage, /scs\.map\(\(s\) => \(s\.voice_text \|\| ''\)\.trim\(\)\)/, 'stage collects the narration');
  assert.match(stage, /\{ ai, script \}/);
  const routes = src('../src/api/routes.js');
  assert.match(routes, /generateMetadata\(p, req\.body\.stylePrompt, \{ script \}\)/, 'manual regenerate too');
  assert.match(routes, /metadata: \{ \.\.\.\(p\.metadata \|\| \{\}\), \.\.\.md \}/, 'and it no longer wipes the thumbnail record');
});

test('P40: a paid voice can hold a pool of keys and rotate off an exhausted one', () => {
  assert.equal(keyPool({ apiKey: 'one-key' }), null, 'a single key is not a pool');
  assert.equal(keyPool({}), null);
  assert.deepEqual(keyPool({ apiKey: 'k1\nk2, k3' }), { field: 'apiKey', keys: ['k1', 'k2', 'k3'] });
  assert.deepEqual(keyPool({ token: 'a;b' }), { field: 'token', keys: ['a', 'b'] }, 'Vbee-style token field too');
  const tts = src('../src/providers/tts.js');
  // rotation must only trigger on a credit/auth refusal — a bad voice id or a network blip is
  // not a reason to burn through every key the owner has.
  assert.match(tts, /function keyExhausted\(e\)/);
  assert.match(tts, /if \(!keyExhausted\(e\) \|\| i === pool\.keys\.length - 1\) throw e;/);
});

test('P40: both publishers can schedule, in the same unit', () => {
  const yt = src('../src/publish/youtube.js');
  assert.match(yt, /scheduledAt = null/, 'youtube accepts a schedule');
  assert.match(yt, /publishAt: new Date\(scheduledAt \* 1000\)\.toISOString\(\)/, 'unix seconds → ISO, as the API wants');
  assert.match(yt, /privacyStatus: scheduledAt \? 'private'/, 'YouTube only honours publishAt on a private video');
  const fb = src('../src/publish/facebook.js');
  assert.match(fb, /scheduled_publish_time/, 'facebook accepts one too');
  assert.match(fb, /video_state: scheduledAt \? 'SCHEDULED' : 'PUBLISHED'/);
  assert.match(src('../src/api/routes.js'), /scheduledAt: Number\.isFinite\(\+req\.body\?\.scheduledAt\)/, 'and the route passes it through');
});

test('P40: the free voice finally has prosody controls, and none of them changes the old call', async () => {
  const { edgeProsody, default: edge } = await import('../src/providers/voice/edge.js');
  assert.equal(edgeProsody({}), null, 'no knobs set → the historic call, byte for byte');
  assert.equal(edgeProsody({ rate: '0', pitch: '0' }), null, 'zero is "unchanged", not "+0%"');
  assert.deepEqual(edgeProsody({ rate: '-10' }), { rate: '-10%' });
  assert.deepEqual(edgeProsody({ rate: '15', pitch: '20', volume: '-5' }), { rate: '+15%', volume: '-5%', pitch: '+20Hz' });
  assert.deepEqual(edgeProsody({ rate: '999', pitch: '-99' }), { rate: '+100%', pitch: '-24Hz' }, 'clamped to what Edge accepts');
  assert.deepEqual(edge.configSchema.map((f) => f.key), ['rate', 'pitch', 'volume']);
  assert.match(src('../src/providers/voice/edge.js'), /prosody \? await tts\.toStream\(text, prosody\) : await tts\.toStream\(text\)/);
});

test('P40: silent mode renders a music-only cut without spending TTS credit', () => {
  const s = src('../src/pipeline/stages/tts.js');
  assert.match(s, /if \(config\.enableVoice === false\)/, 'the branch exists');
  assert.match(s, /makeSilence/, 'each scene gets a silent track of its own planned length');
  assert.match(s, /estimateWordTiming/, 'captions still land on the script timing');
  assert.ok(!/synthesizeVoice/.test(s.slice(s.indexOf('enableVoice === false'), s.indexOf('const ttsC'))), 'no synthesis in that branch');
  assert.match(src('../public/js/views/config.js'), /enableVoice: \$\('#cfgNoVoice'\)\?\.checked \? false : undefined/, 'exposed in the panel');
});

test('P40: named SEO styles reuse the shared styles table and never leave a run dangling', () => {
  const cfg = src('../public/js/views/config.js');
  assert.match(cfg, /api\.get\('\/styles\?kind=metadata'\)/, 'named styles are listed');
  assert.match(cfg, /api\.post\('\/styles', \{ name, kind: 'metadata', prompt \}\)/, 'and saved');
  assert.match(cfg, /metadataPrompt: \$\('#cfgMetaPrompt'\)\?\.value\.trim\(\)/,
    'the panel sends the RESOLVED prompt, so deleting the row later cannot break a queued run');
});

test('P40: the thumbnail designer may use the owner\'s own pictures, safely', async () => {
  const { applyThumbAssets } = await import('../src/pipeline/thumbnail-codegen.js');
  const out = applyThumbAssets(
    '<img src="{{asset:a.jpg}}"><img src="{{asset:ghost.png}}"><b>{{asset:nope}}</b>',
    [{ name: 'a.jpg', uri: 'data:image/jpeg;base64,AAA' }],
  );
  assert.match(out, /src="data:image\/jpeg;base64,AAA"/, 'a real asset resolves');
  assert.ok(!/ghost\.png|nope|\{\{asset/.test(out), 'an invented name never reaches the render');
  assert.equal(applyThumbAssets(null, []), '');
  // finalize and the regen route both offer the pictures
  assert.match(src('../src/pipeline/stages/finalize.js'), /media: thumbMedia/);
  assert.match(src('../src/api/routes.js'), /media, llm: DB\.aiSettings\(\)\.llm/);
});

test('P40: image search works with NO api key — a real catalog, not gradients', () => {
  const s = src('../src/providers/imagesearch.js');
  assert.match(s, /api\.openverse\.org/, 'a keyless web image search exists');
  assert.match(s, /license_type: 'commercial,modification'/, 'only images that are safe to publish');
  // The phrases must be tried one at a time; concatenating them matches nothing. That was the P40
  // finding and it still holds — but two rungs were not enough, because both of them are usually
  // full phrases and Openverse matches the whole thing (measured 2026-08-11: five words → 0 hits,
  // three words → 240). The ladder now shortens as it descends; see searchTerms.
  assert.match(s, /for \(const term of searchTerms\(query, keywords\)\)/);
  assert.match(s, /export function searchTerms\(query, keywords = \[\]\)/);
  // and the offline gradient generator stays the LAST resort, not a step everyone pays for
  assert.ok(s.indexOf('api.openverse.org') < s.indexOf('await makeGradientImage('), 'placeholders are generated only after the real search failed');
});

test('P40: the media library is browsable per brand, renameable and auditionable', () => {
  const lib = src('../public/js/views/library.js');
  assert.match(lib, /brand=\$\{encodeURIComponent\(state\.libBrand/, 'the grid follows the selected brand folder');
  assert.match(lib, /fd\.append\('brand', state\.libBrand/, 'an upload lands in the folder being browsed');
  assert.match(lib, /<audio controls preload="none"/, 'BGM/SFX can be auditioned before use');
  assert.match(lib, /api\.patch\('\/library\/' \+ it\.id, \{ name \}\)/, 'entries can be renamed');
  assert.match(lib, /it\.onDisk \? ' disabled/, 'a file that only exists on disk is not pretend-editable');
  const routes = src('../src/api/routes.js');
  assert.match(routes, /r\.patch\('\/library\/:id'/, 'the rename route exists');
  assert.match(src('../src/db/repositories/catalogs.js'), /export function renameLibrary/);
});

test('P40: the publish ledger is finally visible', () => {
  const studio = src('../public/js/views/studio.js');
  assert.match(studio, /export async function renderPublishHistory/, 'history renders');
  assert.match(studio, /\/publishes`\)\)\.publishes/, 'from the ledger the app already wrote');
  // and it refreshes on both publish paths, not just one
  assert.equal((studio.match(/renderPublishHistory\(\);/g) || []).length, 3, 'open + youtube + facebook');
});
