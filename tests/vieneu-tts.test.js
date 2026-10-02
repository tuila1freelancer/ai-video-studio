// VieNeu-TTS — the local bilingual voice. Pins registration, the request the repo's OpenAI-style
// server expects, the WAV it writes from headerless PCM, and the dropped-words guard. The server
// is stubbed through fetch: no process, no model.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getProvider, listProviders, providerExt } from '../src/providers/voice/index.js';
import vieneu, { wavFromPcm16, MAX_WPM } from '../src/providers/voice/vieneu.js';
import { vieneuUrl, vieneuPython } from '../src/media/tts-server.js';

const RATE = 48000;
const pcmFor = (seconds) => Buffer.alloc(Math.round(seconds * RATE) * 2);

async function withFetch(handler, fn) {
  const real = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, opts = {}) => {
    seen.push({ url: String(url), body: opts.body ? JSON.parse(opts.body) : null, headers: opts.headers || {} });
    return handler(String(url), opts);
  };
  try { return await fn(seen); } finally { globalThis.fetch = real; }
}

test('vieneu joins the registry as a free, offline provider that writes wav', () => {
  assert.equal(getProvider('vieneu').id, 'vieneu');
  const row = listProviders().find((p) => p.id === 'vieneu');
  assert.equal(row.free, true);
  assert.equal(row.needsNetwork, false);
  assert.equal(providerExt('vieneu'), '.wav');
  assert.equal(vieneu.autoVoiceFor('vi'), 'Hải Đăng');
  assert.equal(vieneu.autoVoiceFor('en'), 'Hải Đăng', 'one bilingual model reads both');
  assert.equal(vieneu.autoVoiceFor('ja'), null, 'no Japanese — let the façade pick another provider');
  assert.equal(vieneuUrl({}), 'http://127.0.0.1:8000');
  assert.equal(vieneuUrl({ serverUrl: 'http://127.0.0.1:8001//' }), 'http://127.0.0.1:8001');
  assert.equal(vieneuPython(''), null);
  assert.equal(vieneuPython(join(tmpdir(), 'no-such-vieneu')), null, 'no venv, no launch');
});

test('wavFromPcm16 wraps headerless PCM in a valid 48 kHz mono RIFF header', () => {
  const wav = wavFromPcm16(pcmFor(0.5));
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wav.readUInt32LE(24), RATE);
  assert.equal(wav.readUInt16LE(22), 1, 'mono');
  assert.equal(wav.readUInt32LE(40), RATE, 'data chunk = 0.5 s of 16-bit samples');
  assert.equal(wav.readUInt32LE(4), wav.length - 8);
});

test('synthesis posts the OpenAI-style request and writes a playable wav', async () => {
  const out = join(tmpdir(), `vieneu_ok_${process.pid}.wav`);
  try {
    await withFetch(async () => ({ ok: true, arrayBuffer: async () => pcmFor(4) }), async (seen) => {
      const r = await vieneu.synthesize('Mình dùng AI mỗi ngày, nhưng không phải ai cũng biết cách hỏi.', 'Thanh Bình', {}, out);
      assert.equal(seen[0].url, 'http://127.0.0.1:8000/v1/audio/speech');
      assert.deepEqual(
        { voice: seen[0].body.voice, fmt: seen[0].body.response_format, rate: seen[0].body.sample_rate },
        { voice: 'Thanh Bình', fmt: 'pcm', rate: RATE },
      );
      assert.ok(Math.abs(r.duration - 4) < 0.05, `duration ${r.duration}`);
      assert.equal(readFileSync(out).toString('ascii', 0, 4), 'RIFF');
    });
    await withFetch(async () => ({ ok: true, arrayBuffer: async () => pcmFor(2) }), async (seen) => {
      await vieneu.synthesize('Xin chào các bạn.', 'auto', { apiKey: 'k' }, out);
      assert.equal(seen[0].body.voice, 'Hải Đăng', "'auto' resolves to a real preset");
      assert.equal(seen[0].headers.Authorization, 'Bearer k');
    });
  } finally { rmSync(out, { force: true }); }
});

test('audio far too short for its words is rejected so the façade re-asks', async () => {
  const out = join(tmpdir(), `vieneu_short_${process.pid}.wav`);
  const text = 'Dòng một. Tài liệu nằm trong Google, việc gắn với Docs, Sheets, Gmail, thì chọn Gemini. Dòng hai.';
  const words = text.split(/\s+/).length;
  // A dropped sentence: the audio is shorter than even MAX_WPM allows.
  const tooShort = (words / (MAX_WPM * 1.4)) * 60;
  await withFetch(async () => ({ ok: true, arrayBuffer: async () => pcmFor(tooShort) }), async () => {
    await assert.rejects(vieneu.synthesize(text, 'Hải Đăng', {}, out), /đọc sót chữ/);
  });
  await withFetch(async () => ({ ok: false, status: 400, text: async () => "unknown voice 'X'" }), async () => {
    await assert.rejects(vieneu.synthesize(text, 'X', {}, out), /VieNeu 400/);
  });
  rmSync(out, { force: true });
});

test('the voice list adds runtime-enrolled voices and survives a stopped server', async () => {
  const live = { data: [{ id: 'Hải Đăng' }, { id: 'Giọng Của Tôi' }] };
  await withFetch(async () => ({ ok: true, json: async () => live }), async () => {
    const voices = await vieneu.listVoices({});
    assert.ok(voices.some((v) => v.id === 'Giọng Của Tôi'), 'enrolled voice listed');
    assert.equal(voices.filter((v) => v.id === 'Hải Đăng').length, 1, 'presets not duplicated');
    assert.ok(voices.every((v) => v.provider === 'vieneu' && v.lang === 'vi'));
  });
  await withFetch(async () => { throw new Error('ECONNREFUSED'); }, async () => {
    const voices = await vieneu.listVoices({});
    assert.equal(voices.length, 25, 'the shipped presets, offline');
  });
});
