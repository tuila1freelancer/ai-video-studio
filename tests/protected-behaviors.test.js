// One NAMED regression test per protected behavior (P1–P16, docs/architecture.md §7).
// A refactor may RELOCATE a behavior — update the anchor here — but a silently deleted
// guard/constant turns exactly one of these red. Functional where cheap, source-anchored
// where a functional test would need live providers.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (p) => readFileSync(join(ROOT, p), 'utf8');

test('P1: chatOnce floors max_tokens at 16000 (reasoning models burn tokens on hidden thinking)', () => {
  const s = src('src/providers/llm.js');
  assert.match(s, /maxTokensFloor\).*:\s*16000/, 'the 16000 floor must survive');
  assert.match(s, /Math\.max\(maxTokens,\s*floor\)/, 'max_tokens must be floored, not capped');
});

test('P2: chatJson enables response_format json_object only on the first attempt', () => {
  assert.match(src('src/providers/llm.js'), /json:\s*preferJson\s*&&\s*i\s*===\s*0/);
});

test('P3: 429 handled BEFORE dead-key, with backoff [8s,20s,45s]', () => {
  const s = src('src/providers/llm.js');
  assert.match(s, /RL_DELAYS\s*=\s*\[8000,\s*20000,\s*45000\]/);
  const rl = s.indexOf('RATE_LIMIT.test(msg)');
  const dk = s.indexOf('DEAD_KEY.test(msg)');
  assert.ok(rl > 0 && dk > 0 && rl < dk, 'rate-limit check must run before the dead-key check');
});

test('P4: script validate enforces >=70% of target scenes (60% per chapter)', () => {
  const s = src('src/providers/llm.js');
  assert.match(s, /Math\.ceil\(sceneCount\s*\*\s*0\.7\)/);
  assert.match(s, /Math\.ceil\(perCh\s*\*\s*0\.6\)/);
});

test('P5: LANG_WPS keeps the measured Vietnamese reading speed (vi 4.4)', () => {
  assert.match(src('src/providers/llm.js'), /LANG_WPS\s*=\s*\{\s*vi:\s*4\.4/);
});

test('P6: QC constants — blackdetect pix_th=0.04, probeStreams trailing-comma strip, tailAllowance', () => {
  const s = src('src/pipeline/qc.js');
  assert.match(s, /pix_th=0\.04/, 'dark-theme backgrounds must not count as black');
  assert.match(s, /replace\(\/,\+\$\/,\s*''\)/, 'ffprobe csv trailing comma must be stripped');
  assert.match(s, /tailAllowance/, 'outro tail allowance must survive');
});

test('P7: TTS voice lock — explicit override beats langVoices, 3 tries on the primary voice', () => {
  const s = src('src/providers/tts.js');
  // relocated into resolveVoiceTarget: an explicit override still wins on the provider,
  // and a provider-only override inherits the pinned per-language voice for that provider
  assert.match(s, /resolveVoiceTarget\(s,\s*lang,\s*opts\.ttsOverride\)/, 'explicit per-project provider must win');
  assert.match(s, /override\?\.provider/, 'override provider beats langVoices inside resolveVoiceTarget');
  assert.match(s, /pinnedVoice\(s,\s*override\.provider,\s*lang\)/, 'provider-only override keeps the pinned voice');
  assert.match(s, /ci\s*===\s*0\s*\?\s*3\s*:\s*1/, 'primary voice gets 3 tries before the chain switches');
});

test('P8: fresh hyperframe visuals null video_path (resume re-renders); chapter-break with props is skipped', () => {
  const s = src('src/pipeline/stages/visuals.js');
  assert.match(s, /template:\s*'hyperframe',\s*props,\s*status:\s*'html',\s*video_path:\s*null/);
  assert.match(s, /chapter-break'\s*&&\s*sc\.props\)\s*return/);
});

test('P9: -16 LUFS semantics + language breath pad (vi 650ms / other 400ms)', () => {
  assert.match(src('src/media/ffmpeg.js'), /loudnorm=I=-16:TP=-1\.5:LRA=11/, 'the -16 LUFS target must survive (relocatable, not deletable)');
  assert.match(src('src/pipeline/stages/tts.js'), /lang\s*===\s*'vi'\s*\?\s*650\s*:\s*400/);
});

test('P10: macro self-heal — exactly one auto-resume (_auto<1) and the kinetic-statement swap', () => {
  const s = src('src/pipeline/runner.js');
  assert.match(s, /_auto\s*<\s*1/);
  assert.match(s, /_auto:\s*_auto\s*\+\s*1/);
  assert.match(src('src/pipeline/stages/render.js'), /kinetic-statement/);
  assert.match(src('src/pipeline/stages/finalize.js'), /_qcAttempt\s*<\s*1/, 'QC repair cycle stays bounded');
});

test('P11: beat timing constants MIN_GAP=1.2 HOLD_MAX=2.6 LEAD=0.12', () => {
  const s = src('src/hyperframe/beats.js');
  assert.match(s, /MIN_GAP\s*=\s*1\.2/);
  assert.match(s, /HOLD_MAX\s*=\s*2\.6/);
  assert.match(s, /LEAD\s*=\s*0\.12/);
});

test('P12: determinism thresholds — PSNR_OK=70 in both QA scripts', () => {
  assert.match(src('scripts/determinism.mjs'), /PSNR_OK\s*=\s*70/);
  assert.match(src('scripts/hf-qa.mjs'), /PSNR_OK\s*=\s*70/);
});

test('P13: boot recovery flips zombie running projects to paused (functional)', async () => {
  const DB = await import('../src/db/index.js');
  const p = DB.createProject({ title: 't', topic: 't', aspectRatio: '9:16', config: {} });
  DB.updateProject(p.id, { status: 'running' });
  const n = DB.recoverZombieProjects();
  assert.ok(n >= 1, 'the zombie must be recovered');
  assert.equal(DB.getProject(p.id).status, 'paused');
});

test('P14: maskSecrets masks on egress and applyMaskedUpdate round-trips •• (functional)', async () => {
  const { maskSecrets, applyMaskedUpdate } = await import('../src/util/secrets.js');
  const masked = maskSecrets({ llm: { apiKey: 'sk-supersecret', model: 'x' } });
  assert.ok(masked.llm.apiKey.includes('••'));
  assert.equal(masked.llm.model, 'x');
  const merged = applyMaskedUpdate({ llm: { apiKey: 'sk-supersecret' } }, { llm: { apiKey: masked.llm.apiKey, model: 'y' } });
  assert.equal(merged.llm.apiKey, 'sk-supersecret', 'a masked value must keep the saved secret');
  assert.equal(merged.llm.model, 'y');
});

test('P15: /api/file path allowlist module guards internal media serving', () => {
  const s = src('src/api/services/file-access.js');
  assert.match(s, /allowlist|allowed/i);
  assert.match(src('src/api/routes.js'), /file-access\.js|isPathAllowed|fileAllowed/, 'routes must serve files through the allowlist');
});

test('P16: assistant proposals never auto-start a paid pipeline', () => {
  // suggestTopics computes + persists DATA only — no job/pipeline machinery in the module
  const autopilot = src('src/api/services/topic-autopilot.js');
  assert.ok(!/enqueueJob|startBatch|startProject|pipeline\//.test(autopilot),
    'topic-autopilot must stay data-only');
  // planWeek and buildSeries create slots/suggestions; only acceptSuggestion (an explicit
  // owner click) may reach startBatch
  const assistant = src('src/api/services/assistant.js');
  const afterPlan = assistant.slice(assistant.indexOf('export function planWeek'));
  assert.ok(!/enqueueJob|startBatch|startProject/.test(afterPlan),
    'planWeek/buildSeries must never enqueue or start anything');
  // the suggest route itself must not create projects either
  const routes = src('src/api/routes.js');
  const suggestHandler = routes.slice(routes.indexOf("r.post('/topics/suggest'"), routes.indexOf("r.get('/topics/history'"));
  assert.ok(suggestHandler.length > 0 && !/startBatch|enqueueJob|createProject/.test(suggestHandler),
    'POST /topics/suggest returns proposals, never projects');
});
