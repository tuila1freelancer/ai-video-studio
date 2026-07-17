// P27 — Brand Asset generation: the two reference-app prompts are carried VERBATIM (byte
// equality pinned here) with exactly one mandated edit (transparent background), the image
// model runs primary-only ×10 then fails loudly (no fallback), every accepted PNG passes a
// real alpha transparency gate, and provider mutations round-trip through settings safely.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as DB from '../src/db/index.js';
import { DIRS } from '../src/config/paths.js';
import { ffmpeg, verifyTransparentBg } from '../src/media/ffmpeg.js';
import { editImage } from '../src/providers/imagegen.js';
import {
  buildEmotionsPrompt, buildCharacterPrompt, brandEditConfig, assetFilename,
  generateEmotions, generateBrandAsset, copyToBrand, createBrand,
  addEditProvider, removeEditProvider, TRANSPARENT_RETRY_LINE, BRAND_EDIT_ATTEMPTS,
} from '../src/api/services/brand-gen.js';

// ---- prompt fidelity (byte-for-byte against the reference app's strings) ----

const REF_EMOTIONS_NO_CONTEXT = `You are a character emotion/action designer for brand assets.

Given a character named "ema", generate exactly 20 unique emotions and actions.

The character's theme/domain: general content

Rules:
- Each item is a short English phrase (3-8 words) describing an emotion or physical action
- ALL items must be relevant to the domain: "general content" — do NOT default to crypto/finance/trading
- Mix between pure emotions (crying, showing anger, laughing) and contextual actions specific to "general content"
- Include common reactions: happy, sad, angry, surprised, thinking, explaining
- Include domain-specific actions that match "general content"
- Format: lowercase, descriptive
- Must be diverse — no duplicates or near-duplicates
- Do NOT include the character name in the items

Return JSON: { "emotions": ["emotion or action 1", "emotion or action 2", ...] }`;

const REF_EMOTIONS_WITH_CONTEXT = `You are a character emotion/action designer for brand assets.

Given a character named "luna", generate exactly 5 unique emotions and actions.

IMPORTANT — The character's domain/context is: "crypto memes"
ALL emotions and actions MUST be relevant to this specific context. Do NOT generate finance/crypto/trading related content unless the context explicitly mentions it.

The character's theme/domain: crypto memes

Rules:
- Each item is a short English phrase (3-8 words) describing an emotion or physical action
- ALL items must be relevant to the domain: "crypto memes" — do NOT default to crypto/finance/trading
- Mix between pure emotions (crying, showing anger, laughing) and contextual actions specific to "crypto memes"
- Include common reactions: happy, sad, angry, surprised, thinking, explaining
- Include domain-specific actions that match "crypto memes"
- Format: lowercase, descriptive
- Must be diverse — no duplicates or near-duplicates
- Do NOT include the character name in the items

Return JSON: { "emotions": ["emotion or action 1", "emotion or action 2", ...] }`;

test('P27 emotions prompt: verbatim reference text, with and without context', () => {
  assert.equal(buildEmotionsPrompt({ characterName: 'ema' }).prompt, REF_EMOTIONS_NO_CONTEXT);
  assert.equal(buildEmotionsPrompt({ characterName: 'luna', count: 5, context: 'crypto memes' }).prompt, REF_EMOTIONS_WITH_CONTEXT);
});

test('P27 emotions prompt: count clamps to 1..50, default 20', () => {
  assert.equal(buildEmotionsPrompt({ characterName: 'x' }).count, 20);
  assert.equal(buildEmotionsPrompt({ characterName: 'x', count: 0 }).count, 20);
  assert.equal(buildEmotionsPrompt({ characterName: 'x', count: -3 }).count, 1);
  assert.equal(buildEmotionsPrompt({ characterName: 'x', count: 999 }).count, 50);
});

test('P27 image prompt: reference text with ONLY the transparency sentence swapped', () => {
  const p = buildCharacterPrompt({ characterName: 'ema', emotion: 'smiling brightly', style: '2D Anime style' });
  assert.equal(p,
    'Generate a character illustration in 2D Anime style: "ema" smiling brightly. '
    + 'Same character design as the reference image. Art style: 2D Anime style. '
    + 'Background MUST be fully transparent (true alpha PNG) — the image contains ONLY the character; no backdrop, no floor, no frame, no solid color behind the character. '
    + 'Full body or upper body visible. Expressive pose matching the emotion/action. PNG style, suitable for video overlay.');
  assert.ok(!p.includes('or clean solid background'), 'the permissive reference sentence is gone');
  assert.equal(buildCharacterPrompt({ characterName: 'x', emotion: 'y' }).includes('2D Anime style'), true, 'reference default style');
});

test('P27 filename: reference scheme `character <name> <emotion>.png`, traversal stripped', () => {
  assert.equal(assetFilename('ema', 'smiling brightly'), 'character ema smiling brightly.png');
  assert.equal(assetFilename('e/m:a', 'a?b*c'), 'character ema abc.png');
  assert.throws(() => assetFilename('', 'x'));
});

// ---- LLM emotions round-trip (fake chat) ----

test('P27 generateEmotions: passes the verbatim prompt, slices to count', async () => {
  let seen = null;
  const out = await generateEmotions({ characterName: 'ema', count: 3 }, {
    llm: { enabled: true }, _chatJson: async (messages) => {
      seen = messages[0].content;
      return { emotions: ['a', 'b', 'c', 'd', 'e'] };
    },
  });
  assert.match(seen, /generate exactly 3 unique emotions/);
  assert.deepEqual(out.emotions, ['a', 'b', 'c']);
});

// ---- transparency gate on real PNGs ----

test('P27 verifyTransparentBg: alpha PNG with clear corners passes, opaque fails', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'p27a-'));
  const tp = join(dir, 't.png'), op = join(dir, 'o.png'), mid = join(dir, 'm.png');
  await ffmpeg(['-f', 'lavfi', '-i', 'color=c=red@0.0:s=64x64:d=1,format=rgba', '-frames:v', '1', tp]);
  await ffmpeg(['-f', 'lavfi', '-i', 'color=c=red:s=64x64:d=1', '-frames:v', '1', op]);
  // opaque character centered on a transparent canvas — the realistic pass case
  await ffmpeg(['-f', 'lavfi', '-i', 'color=c=red@0.0:s=64x64:d=1,format=rgba', '-vf',
    'drawbox=x=16:y=16:w=32:h=32:color=red@1:t=fill', '-frames:v', '1', mid]);
  assert.equal((await verifyTransparentBg(tp)).ok, true);
  assert.equal((await verifyTransparentBg(mid)).ok, true);
  const bad = await verifyTransparentBg(op);
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /alpha/);
});

// ---- editImage API shape (fake fetch) ----

const PNG_B64 = Buffer.alloc(4000, 7).toString('base64');
function fakeRes(status, body, json) {
  return { ok: status < 400, status, text: async () => body || '', json: async () => json };
}

test('P27 editImage: background field probe retries once without it (same attempt)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'p27e-'));
  const ref = join(dir, 'ref.png');
  writeFileSync(ref, Buffer.alloc(2000, 1));
  const calls = [];
  const buf = await editImage({
    imagePath: ref, prompt: 'p', baseUrl: 'https://api.example/v1', apiKey: 'k', model: 'gpt-image-2', size: '1024x1536',
    fetchImpl: async (url, opts) => {
      calls.push({ url, body: opts?.body });
      if (calls.length === 1) return fakeRes(400, '{"error":{"message":"Unknown parameter: background"}}');
      return fakeRes(200, '', { data: [{ b64_json: PNG_B64 }] });
    },
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://api.example/v1/images/edits');
  assert.equal(calls[0].body.get('background'), 'transparent');
  assert.equal(calls[1].body.get('background'), null, 'probe re-send drops the field');
  assert.equal(calls[1].body.get('model'), 'gpt-image-2');
  assert.equal(calls[1].body.get('size'), '1024x1536');
  assert.equal(buf.length, 4000);
});

// ---- the no-fallback ×10 loop + gate consumption ----

const SETTINGS = {
  imageGen: {
    editProviders: [{ id: 'p1', label: 'TestProv', baseUrl: 'https://api.example/v1', apiKey: 'k' }],
    brandEdit: { providerId: 'p1', model: 'model-x', size: '1024x1024' },
  },
};

test('P27 no-fallback: exactly 10 attempts on the primary model, then a loud named failure', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'p27n-'));
  const ref = join(dir, 'ref.png');
  writeFileSync(ref, Buffer.alloc(2000, 1));
  let attempts = 0;
  await assert.rejects(
    generateBrandAsset({ imagePath: ref, characterName: 'ema', emotion: 'crying', brand: 'TestNF' }, {
      settings: SETTINGS, _sleep: async () => {},
      _editImage: async () => { attempts++; throw new Error('HTTP 500: boom'); },
    }),
    (e) => e.message.includes(`sau ${BRAND_EDIT_ATTEMPTS} lần`) && e.message.includes('TestProv') && e.message.includes('model-x'));
  assert.equal(attempts, BRAND_EDIT_ATTEMPTS);
});

test('P27 transparency gate: an opaque result consumes an attempt and hardens the re-ask', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'p27g-'));
  const ref = join(dir, 'ref.png');
  writeFileSync(ref, Buffer.alloc(2000, 1));
  const prompts = [];
  let verdicts = [{ ok: false, reason: 'corner alpha 255' }, { ok: true }];
  const out = await generateBrandAsset({ imagePath: ref, characterName: 'ema', emotion: 'smiling brightly', brand: 'TestGate' }, {
    settings: SETTINGS, _sleep: async () => {},
    _editImage: async ({ prompt }) => { prompts.push(prompt); return Buffer.alloc(4000, 2); },
    _verify: async () => verdicts.shift(),
  });
  assert.equal(prompts.length, 2, 'opaque result burned one attempt');
  assert.ok(!prompts[0].includes(TRANSPARENT_RETRY_LINE));
  assert.ok(prompts[1].endsWith(TRANSPARENT_RETRY_LINE), 're-ask carries the hardening line');
  assert.equal(out.ok, true);
  assert.equal(out.filename, 'character ema smiling brightly.png');
  assert.ok(existsSync(out.path), 'PNG saved into the brand folder');
  const rows = DB.listLibrary('brand', 'TestGate');
  assert.ok(rows.some((r) => r.filename === out.filename), 'library row registered');
});

// ---- settings-backed provider management + config resolution ----

test('P27 brandEditConfig: throws without a provider; resolves reference defaults with one', () => {
  assert.throws(() => brandEditConfig({ imageGen: {} }), /provider/i);
  const cfg = brandEditConfig({ imageGen: { editProviders: [{ id: 'a', label: 'A', baseUrl: 'https://x/v1', apiKey: 'k' }] } });
  assert.equal(cfg.model, 'gpt-image-2');
  assert.equal(cfg.size, '1024x1536');
});

test('P27 provider mutations: add selects it, remove clears the selection', () => {
  const r = addEditProvider({ label: 'Infinity', baseUrl: 'https://infinityapis.com/v1/', apiKey: 'sk-test' });
  let ig = DB.aiSettings().imageGen;
  assert.equal(ig.editProviders.length, 1);
  assert.equal(ig.editProviders[0].baseUrl, 'https://infinityapis.com/v1', 'trailing slash trimmed');
  assert.equal(ig.brandEdit.providerId, r.id);
  removeEditProvider(r.id);
  ig = DB.aiSettings().imageGen;
  assert.equal(ig.editProviders.length, 0);
  assert.equal(ig.brandEdit.providerId, '');
  assert.throws(() => addEditProvider({ label: 'x', baseUrl: 'ftp://nope', apiKey: 'k' }), /Base URL/);
});

test('P27 copyToBrand: copies named files, refuses traversal, registers rows', () => {
  createBrand('SrcBrand');
  const src = join(DIRS.brand, 'SrcBrand');
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, 'character ema crying.png'), Buffer.alloc(1000, 3));
  const r = copyToBrand({ sourceBrand: 'SrcBrand', targetBrand: 'DstBrand', filenames: ['character ema crying.png', '../evil.png'] });
  assert.equal(r.copied, 1);
  assert.equal(r.skipped, 1);
  assert.ok(existsSync(join(DIRS.brand, 'DstBrand', 'character ema crying.png')));
});
