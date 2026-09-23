// One NAMED regression test per protected behavior (P1–P19 + P36, README.md Architecture §7).
// A refactor may RELOCATE a behavior — update the anchor here — but a silently deleted
// guard/constant turns exactly one of these red. Functional where cheap, source-anchored
// where a functional test would need live providers.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceOf } from './_source.mjs';
import { LANG_WPS } from '../src/providers/llm.js';
import { padMsFor } from '../src/util/lang.js';


test('P1: chatOnce floors max_tokens at 16000 (reasoning models burn tokens on hidden thinking)', () => {
  const s = sourceOf('src/providers/llm/transport.js');
  assert.match(s, /maxTokensFloor\).*:\s*16000/, 'the 16000 floor must survive');
  assert.match(s, /Math\.max\(maxTokens,\s*floor\)/, 'max_tokens must be floored, not capped');
});

test('P2: chatJson enables response_format json_object only on the first attempt', () => {
  assert.match(sourceOf('src/providers/llm/json.js'), /json:\s*preferJson\s*&&\s*i\s*===\s*0/);
});

test('P3: 429 handled BEFORE dead-key, with backoff [8s,20s,45s]', () => {
  const s = sourceOf('src/providers/llm/transport.js');
  assert.match(s, /RL_DELAYS\s*=\s*\[8000,\s*20000,\s*45000\]/);
  const rl = s.indexOf('RATE_LIMIT.test(msg)');
  const dk = s.indexOf('DEAD_KEY.test(msg)');
  assert.ok(rl > 0 && dk > 0 && rl < dk, 'rate-limit check must run before the dead-key check');
});

test('P4: script validate enforces >=70% of target scenes (60% per chapter)', () => {
  const s = sourceOf('src/providers/llm/generate.js');
  assert.match(s, /Math\.ceil\(sceneCount\s*\*\s*0\.7\)/);
  assert.match(s, /Math\.ceil\(perCh\s*\*\s*0\.6\)/);
});

test('P5: LANG_WPS keeps the measured Vietnamese reading speed (vi 4.4)', () => {
  // The table owns the number now; assert the VALUE, which a move cannot silently break.
  assert.equal(LANG_WPS.vi, 4.4);
  assert.match(sourceOf('src/i18n/languages.js'), /code: 'vi'[\s\S]{0,400}?wps: 4\.4/);
});

test('P38 QC integrity: probeStreams trailing-comma strip; no per-frame pixel/silence scan', () => {
  const s = sourceOf('src/pipeline/qc.js');
  assert.match(s, /replace\(\/,\+\$\/,\s*''\)/, 'ffprobe csv trailing comma must be stripped');
  assert.ok(!/blackdetect|silencedetect|negate/.test(s), 'P38: the per-frame pixel/silence scans are removed');
  assert.ok(!/summarizeVisualTiers|qtier/.test(s), 'P38: visual quality tiers are removed');
});

test('P7: TTS voice lock — explicit override beats langVoices, 3 tries on the primary voice', () => {
  const s = sourceOf('src/providers/tts.js');
  // relocated into resolveVoiceTarget: an explicit override still wins on the provider,
  // and a provider-only override inherits the pinned per-language voice for that provider
  assert.match(s, /resolveVoiceTarget\(s,\s*lang,\s*opts\.ttsOverride\)/, 'explicit per-project provider must win');
  assert.match(s, /override\?\.provider/, 'override provider beats langVoices inside resolveVoiceTarget');
  assert.match(s, /pinnedVoice\(s,\s*override\.provider,\s*lang\)/, 'provider-only override keeps the pinned voice');
  assert.match(s, /ci\s*===\s*0\s*\?\s*3\s*:\s*1/, 'primary voice gets 3 tries before the chain switches');
});

test('P8: fresh hyperframe visuals null video_path (resume re-renders); chapter-break with props is skipped', () => {
  const s = sourceOf('src/pipeline/stages/visuals.js');
  assert.match(s, /template: 'hyperframe', props: \{ \.\.\.props[^;]*status: 'html', video_path: null/, 'fresh hyperframe still nulls video_path (P38: props may also carry the per-scene backdrop)');
  assert.match(s, /chapter-break'\s*&&\s*sc\.props\)\s*return/);
});

test('P9: -16 LUFS semantics + language breath pad (vi 650ms / other 400ms)', () => {
  assert.match(sourceOf('src/media/ffmpeg.js'), /loudnorm=I=-16:TP=-1\.5:LRA=11/, 'the -16 LUFS target must survive (relocatable, not deletable)');
  // The pad moved into the language table (it was five copies written five different ways,
  // one of which sniffed diacritics instead of asking for the language). Assert the VALUES —
  // a relocation cannot break them silently, a deletion still turns this red.
  assert.equal(padMsFor('vi'), 650);
  assert.equal(padMsFor('en'), 400);
  assert.match(sourceOf('src/pipeline/stages/tts.js'), /padMs = padMsFor\(videoLang\)/,
    'B3+4 pads by the VIDEO language, never by a per-scene re-detection');
});

test('P10: macro self-heal — exactly one auto-resume (_auto<1) and the kinetic-statement swap', () => {
  const s = sourceOf('src/pipeline/runner.js');
  assert.match(s, /_auto\s*<\s*1/);
  assert.match(s, /_auto:\s*_auto\s*\+\s*1/);
  assert.match(sourceOf('src/pipeline/stages/render.js'), /kinetic-statement/);
});

test('P11: beat timing constants MIN_GAP=1.2 HOLD_MAX=2.6 LEAD=0.12', () => {
  const s = sourceOf('src/hyperframe/beats.js');
  assert.match(s, /MIN_GAP\s*=\s*1\.2/);
  assert.match(s, /HOLD_MAX\s*=\s*2\.6/);
  assert.match(s, /LEAD\s*=\s*0\.12/);
});

test('P12: determinism thresholds — PSNR_OK=70 in both QA scripts', () => {
  assert.match(sourceOf('scripts/determinism.mjs'), /PSNR_OK\s*=\s*70/);
  assert.match(sourceOf('scripts/hf-qa.mjs'), /PSNR_OK\s*=\s*70/);
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
  const s = sourceOf('src/api/services/file-access.js');
  assert.match(s, /allowlist|allowed/i);
  assert.match(sourceOf('src/api/routers/files-media.js'), /file-access\.js|isPathAllowed|fileAllowed/, 'the file routes serve through the allowlist');
});

test('P16: assistant proposals never auto-start a paid pipeline', () => {
  // suggestTopics computes + persists DATA only — no job/pipeline machinery in the module
  const autopilot = sourceOf('src/api/services/topic-autopilot.js');
  assert.ok(!/enqueueJob|startBatch|startProject|pipeline\//.test(autopilot),
    'topic-autopilot must stay data-only');
  // planWeek and buildSeries create slots/suggestions; only acceptSuggestion (an explicit
  // owner click) may reach startBatch
  const assistant = sourceOf('src/api/services/assistant.js');
  const afterPlan = assistant.slice(assistant.indexOf('export function planWeek'));
  assert.ok(!/enqueueJob|startBatch|startProject/.test(afterPlan),
    'planWeek/buildSeries must never enqueue or start anything');
  // the suggest route itself must not create projects either
  const routes = sourceOf('src/api/routers/assistant-calendar.js');
  const suggestHandler = routes.slice(routes.indexOf("r.post('/topics/suggest'"), routes.indexOf("r.get('/topics/history'"));
  assert.ok(suggestHandler.length > 0 && !/startBatch|enqueueJob|createProject/.test(suggestHandler),
    'POST /topics/suggest returns proposals, never projects');
});

test('P17: scene gate holds cleanly and only the explicit owner route approves it', () => {
  const runner = sourceOf('src/pipeline/runner.js');
  // hold pattern mirrors the review gate: distinct status + clean return (P13/P10 stay inert)
  assert.match(runner, /config\.sceneGate === true && !DB\.getProject\(projectId\)\.scenes_approved_at/, 'gate checks the durable approval stamp');
  assert.match(runner, /status:\s*'scenes'/, "hold uses the distinct 'scenes' status, never 'paused'");
  const gateBlock = runner.slice(runner.indexOf("config.sceneGate === true"), runner.indexOf('await runTts'));
  assert.match(gateBlock, /return;/, 'gate exits via a clean return, not the error path');
  // the approval stamp has exactly one writer: the explicit owner route
  const routes = sourceOf('src/api/routers/pipeline.js');
  assert.match(routes, /approve-scenes/, 'explicit approve route exists');
  const writers = [runner, sourceOf('src/pipeline/scheduler.js'), sourceOf('src/pipeline/estimate.js'),
    sourceOf('src/api/services/topic-autopilot.js'), sourceOf('src/api/services/assistant.js')];
  for (const w of writers) assert.ok(!/scenes_approved_at:\s*Date\.now/.test(w), 'only the route stamps approval');
  // TTS resume-skip requires REAL audio — estimated timing can never suppress synthesis
  assert.match(sourceOf('src/pipeline/stages/tts.js'), /sc\.audio_path && existsSync\(sc\.audio_path\) && sc\.srt_json/);
  assert.match(sourceOf('src/pipeline/estimate.js'), /if \(sc\.audio_path\) continue/, 'estimate seeds unvoiced scenes only');
  // a scenes hold settles the durable job as done (not error)
  assert.match(sourceOf('src/pipeline/scheduler.js'), /status === 'scenes'\) return \{ status: 'done' \}/);
});

test('P18: master scenes JSON contract — no META_LEAK persisted, canonical export shape', () => {
  const eng = sourceOf('src/content/master-script.js');
  // every path out of the engine runs the deterministic repair when defects remain…
  assert.match(eng, /repairScenesSpec\(best\.spec, best\.ok \? \[\] : best\.defects,/, 'LLM chunks repair before returning — always, so the opening is fixed even on a clean parse');
  assert.match(eng, /v\.ok \? v\.spec : repairScenesSpec\(v\.spec, v\.defects\)/, 'pasted-JSON imports repair before returning');
  // …and the repair DROPS unspeakable voices (CTA notes / hashtag lines / thumbnail prompts)
  const rep = eng.slice(eng.indexOf('export function repairScenesSpec'), eng.indexOf('// ----', eng.indexOf('export function repairScenesSpec')));
  assert.match(rep, /'META_LEAK' \|\| d\.code === 'NOT_SPEAKABLE' \|\| d\.code === 'EMPTY'/, 'repair drops meta/unspeakable/empty scenes');
  assert.match(rep, /filter\(\(sc\) => !dropStt\.has\(sc\.stt\)\)/, 'dropped scenes never survive');
  // the canonical export carries ONLY the factory fields (stt/voice/visual/assets + thumbnail)
  const exp = eng.slice(eng.indexOf('export function scenesJsonFromRows'), eng.indexOf('// ----', eng.indexOf('export function scenesJsonFromRows')));
  for (const field of ['stt: i + 1', 'voice: String(r.voice_text', 'visual: String(r.visual_prompt', 'assets: Array.isArray(r.assets) ? r.assets : []']) {
    assert.ok(exp.includes(field), `canonical export pins field: ${field}`);
  }
  assert.ok(!/duration/.test(exp), 'no duration field in the canonical export');
  // B2 routes through the engine and writes the canonical artifact from DB rows
  const b2 = sourceOf('src/pipeline/stages/script.js');
  assert.match(b2, /generateMasterScenes/, 'B2 uses the master engine by default');
  assert.match(b2, /config\.scriptEngine !== 'legacy'/, 'legacy escape hatch stays');
  assert.match(b2, /scenesJsonFromRows\(DB\.getProject\(projectId\), scenes\)/, 'artifact is rebuilt from persisted rows');
  // the export route serves the same canonical builder
  assert.match(sourceOf('src/api/routers/project-exports.js'), /scenes-json/, 'export route exists');
  // owner's detailed script: duration follows content — the fitter must skip it
  assert.match(sourceOf('src/pipeline/stages/budget.js'), /SCRIPT_MODE_MIN_WORDS\) return;/, 'budget fit never trims a pasted detailed script');
});

test('P19: codegen prompt embeds the scene narration + visual brief VERBATIM (functional + no-slice pin)', async () => {
  const { buildCodegenPrompt } = await import('../src/hyperframe/prompt.js');
  const { extractBeats, cinematicDirection } = await import('../src/hyperframe/beats.js');
  const { HF_DEFAULT_GUIDE } = await import('../src/styleguide/index.js');
  // long, quote-riddled narration — the HTML can only follow the voice if ALL of it arrives
  const voice = 'Mình sẽ nói một câu rất dài, có "trích dẫn kép", có \'nháy đơn\', có số 42% và một dấu — gạch — lạ, '
    + 'để chắc chắn toàn bộ lời thoại của cảnh xuất hiện nguyên văn trong prompt tạo HTML, không bị cắt ở bất kỳ ký tự nào, '
    + 'kể cả khi câu dài hơn mọi giới hạn hiển thị quen thuộc của các đoạn tóm tắt. Đoạn kết này phải có mặt: HOA_TIEU_CUOI_CAU.';
  const visual = '[ENVIRONMENT] far=grid, mid=panels, near=dust. [MAIN FOCUS] a glass ledger with 42 glowing rows, dominant. '
    + '[CAMERA] slow zoom in 4%. [MOTION FLOW] Entry: rise. Idle: float. Exit: settle. [LIGHTING & FX] cyan glow. '
    + '[TEXT STYLE] bold. [ON-SCREEN TEXT] sổ cái. [MOOD] clean. DUOI_VISUAL_NGUYEN_VAN';
  const scene = { voice_text: voice, visual_prompt: visual, srt_json: null, keywords: ['ledger'], duration: 6 };
  const beats = extractBeats(scene.srt_json, scene.keywords, 6);
  const direction = cinematicDirection(scene, 3, 10);
  const msgs = buildCodegenPrompt({
    scene, beats, direction, guide: HF_DEFAULT_GUIDE, w: 960, h: 540,
    duration: 6, idx: 3, total: 10, density: 'rich', captionsOn: true,
  });
  const user = msgs[1].content;
  assert.ok(user.includes(voice), 'the FULL narration must ride in the codegen prompt verbatim');
  assert.ok(user.includes(visual), 'the FULL visual brief must ride in the codegen prompt verbatim');
  // and the builder itself must never slice either field (the chain B2→DB→B5/regen passes
  // whole rows; prompt.js is the last hop, so a slice here is the only place voice could shrink)
  const s = sourceOf('src/hyperframe/prompt.js');
  assert.match(s, /\(scene\.voice_text \|\| ''\)\.trim\(\)/, 'narration embed anchor survives');
  assert.match(s, /\(scene\.visual_prompt \|\| ''\)\.trim\(\)/, 'visual embed anchor survives');
  assert.ok(!/voice_text[^\n]*\.slice\(/.test(s), 'voice_text must never be sliced in the codegen prompt');
  assert.ok(!/visual_prompt[^\n]*\.slice\(/.test(s), 'visual_prompt must never be sliced in the codegen prompt');
});

test('P36: single visual mode — kinetic-statement fallback survives, animation templates gone, legacy mode coerced', () => {
  // buildTemplate MUST keep the universal kinetic-statement fallback so a legacy scene whose
  // stored template id no longer exists still renders instead of crashing.
  const reg = sourceOf('src/animation/templates/index.js');
  assert.match(reg, /TEMPLATES\[templateId\]\s*\|\|\s*TEMPLATES\['kinetic-statement'\]/, 'kinetic-statement fallback must survive');
  assert.match(reg, /import kineticStatement from '\.\/kinetic-statement\.js'/, 'kinetic-statement kept');
  assert.match(reg, /import chapterBreak from '\.\/chapter-break\.js'/, 'chapter-break kept');
  // the 20-template animation library is gone (registry no longer imports any of them)
  for (const gone of ['hero-title', 'bar-race', 'spotlight-quote', 'orbit-3d', 'counter-stat']) {
    assert.ok(!reg.includes(`./${gone}.js`), `deleted animation template must not be imported: ${gone}`);
  }
  // headline() (the P10 swap + fallback-plan text source) survives the planner trim
  assert.match(sourceOf('src/animation/planner.js'), /export function headline/, 'headline survives the planner trim');
  // migration id 5 coerces any stored 'animation'/'image' visualMode to 'hyperframe'
  const mig = sourceOf('src/db/migrate.js');
  assert.match(mig, /id:\s*5/, 'migration id 5 exists');
  assert.match(mig, /cfg\.visualMode === 'animation' \|\| cfg\.visualMode === 'image'/, 'legacy modes are coerced');
  assert.match(mig, /cfg\.visualMode = 'hyperframe'/, 'coerced to hyperframe');
  // no dispatch site keeps an image-mode branch
  assert.ok(!/=== 'image'/.test(sourceOf('src/pipeline/stages/finalize.js')), 'no image-mode guard left in finalize');
});

test('P40: the new lanes are additive — a project without them renders exactly as before', () => {
  // Creative libraries are opt-in per scene: a spec that references none must inject none, so
  // the page bytes of every pre-P40 scene are unchanged.
  const harness = sourceOf('src/animation/harness.js');
  assert.match(harness, /const libSrc = libIds\.length \? libsBundle\(libIds\) : '';/, 'no reference → no bundle');
  assert.match(harness, /const libScript = libSrc \? `<script>\$\{libSrc\}<\\\/script>\\n` : '';/, 'no bundle → no tag at all');
  // Brand casting only ever touches scenes the script left empty, and is opt-out.
  const vis = sourceOf('src/pipeline/stages/visuals.js');
  assert.match(vis, /scenes\.filter\(\(sc\) => !\(Array\.isArray\(sc\.assets\) && sc\.assets\.length\)\)/,
    'an explicitly assigned asset outranks the cast');
  assert.match(vis, /config\.hyperframe\?\.imageFull === false \? null : brandFolderFor\(config\)/, 'imageFull:false disables casting too');
  // The AI thumbnail can never fail a render — the deterministic builder is always the backup.
  assert.match(sourceOf('src/pipeline/stages/finalize.js'), /const p = ai\?\.path \|\| await buildThumbnail\(/, 'thumbnail fallback');
  // Overlay mode keeps its historic wrapping slice + narration audio unless mode==='edit'.
  assert.match(sourceOf('src/animation/index.js'), /exact: edit, audioFrom: edit \? 'footage' : 'scene'/, 'plain overlay unchanged');
  // Edit-video is routed by config only: a normal project never enters that branch.
  assert.match(sourceOf('src/pipeline/edit-video.js'), /return !!\(config && config\.editVideo && config\.editVideo\.source\)/);
});

test('P40 determinism: window.__onSeek is the ONLY harness door, and rAF stays banned', () => {
  const lint = sourceOf('src/hyperframe/lint.js');
  assert.match(lint, /window\\s\*\\\.\\s\*__\(\?!onSeek\\b\)/, 'every other __ internal stays banned');
  assert.match(lint, /requestAnimationFrame/, 'self-scheduling stays a hard error — the renderer scrubs frames');
  const harness = sourceOf('src/animation/harness.js');
  assert.match(harness, /window\.__runSeekHooks\(t, st\)/, 'hooks run inside __seek, after the timeline settled');
  // a hook that throws must never take the whole seek (and thus the render) down
  assert.match(harness, /try \{ fn\(t, st\); \} catch\(e\) \{ window\.__hookErr/, 'a broken hook is contained');
});

test('P45: the agent lane is opt-in, scoped, channel-explicit and coded', () => {
  // (1) desktop is the default and asks for nothing.
  const mode = sourceOf('src/core/runtime-mode.js');
  assert.match(mode, /env\.AVS_MODE === 'server' \? 'server' : 'desktop'/, 'server mode is opt-in, never inferred');
  assert.match(mode, /!isLoopback\(host\(env\)\) && !isServerMode\(env\)/, 'a public host without server mode refuses to boot');
  const auth = sourceOf('src/api/middleware/auth.js');
  // Two doors, both opt-in: started as a server, or agent access turned on in the app. A desktop
  // app that was asked for neither still passes straight through.
  assert.match(auth, /return isServerMode\(\) \|\| agentEnabled\(\);/, 'the second door is the setting, nothing inferred');
  assert.match(auth, /if \(!authRequired\(\)\) \{[\s\S]{0,120}return next\(\);/, 'desktop keeps passing straight through');
  assert.match(sourceOf('src/ops/agent-mode.js'), /s\.enabled === true/, 'and it is off unless the owner said otherwise');

  // (2) the secret is never stored, and the comparison is constant-time.
  const tokens = sourceOf('src/db/repositories/api-tokens.js');
  assert.match(tokens, /createHash\('sha256'\)/);
  assert.match(tokens, /timingSafeEqual/);
  assert.ok(!/INSERT INTO api_tokens[^)]*secret/i.test(tokens), 'no column ever holds the secret');
  // ... and minting one is the machine's to do: the window asks, a caller of the API never can.
  const minting = sourceOf('src/api/routers/tokens.js');
  assert.match(minting, /if \(isServerMode\(\)\) \{/, 'a server deployment mints with the CLI, not over HTTP');
  assert.match(minting, /if \(!isLocalRequest\(req\)\)/, 'and never from off this machine');
  assert.match(minting, /authRequired\(\) && !String\(req\.token\?\.id \|\| ''\)\.startsWith\('sys'\)/,
    'an agent holding admin is still not the window');

  // (3) the channel is what the caller named, and a bound token cannot leave it.
  const scope = sourceOf('src/api/channel-scope.js');
  assert.match(scope, /body\?\.channelId \?\? req\?\.query\?\.channel \?\? req\?\.headers\?\.\['x-avs-channel'\]/);
  assert.match(scope, /tokenHasChannel\(req\?\.token, found\.id\)/, 'a named channel is still checked against the token');

  // (4) every refusal carries a machine word, derived from the untranslated message.
  const codes = sourceOf('src/core/api-codes.js');
  assert.match(codes, /BY_MESSAGE\.get\(String\(message/);
  assert.match(sourceOf('src/api/routes.js'), /body\.code = codeFor\(body\.error, res\.statusCode\)/);

  // (5) P16/P17 still hold: the gate stamp has exactly one writer, and it is a route a caller hits.
  const pipeline = sourceOf('src/api/routers/pipeline.js');
  assert.match(pipeline, /approve-scenes/);
  assert.match(pipeline, /scenes_approved_at: Date\.now\(\)/);
});
