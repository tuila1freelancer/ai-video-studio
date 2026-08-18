// "What language is this video" — the question the app could not answer.
//
// config.language was read in 21 places and written by nothing in the create-video UI, so every
// layer invented its own fallback and they disagreed. On a real 95-scene ENGLISH video that cost
// 3 scenes of Vietnamese narration (the editorial rewrite hardcoded 'vi' and carried the Vietnamese
// forms of address into the prompt) and 22 scenes of Vietnamese on-screen text (the art-direction
// brief claimed the narration was Vietnamese, and the one worked example the codegen model studies
// was written in Vietnamese). These pin the single resolver and every site that now uses it.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { detectLang, declaredLang, majorityLang, resolveLang, langName, DEFAULT_LANG } from '../src/util/lang.js';

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const EN = 'Most advice tells you to skip the coffee and wait.';
const VI = 'Phần lớn lời khuyên bảo các bạn nhịn cà phê rồi chờ.';

test('lang: a declared language beats whatever the scenes happen to contain', () => {
  assert.equal(resolveLang({ language: 'en' }, [VI, VI, VI]), 'en');
  assert.equal(resolveLang({ language: 'vi' }, [EN, EN, EN]), 'vi');
  assert.equal(declaredLang({ language: 'EN' }), 'en', 'case is normalised');
});

test("lang: 'auto' and empty mean NOT declared — 'auto' is a value that really reaches the DB", () => {
  // createEditVideoProject writes language:'auto' verbatim, so treating it as a language code
  // would be a live bug, not a hypothetical one.
  assert.equal(declaredLang({ language: 'auto' }), null);
  assert.equal(declaredLang({ language: '' }), null);
  assert.equal(declaredLang({}), null);
  assert.equal(declaredLang(null), null);
  assert.equal(resolveLang({ language: 'auto' }, [EN, EN, EN]), 'en', 'auto falls through to the content');
});

test('lang: the content vote is a MAJORITY, not the first scene', () => {
  assert.equal(resolveLang({}, [EN, VI, VI, VI]), 'vi', 'one English opener cannot flip a Vietnamese video');
  assert.equal(resolveLang({}, [VI, EN, EN, EN]), 'en', 'nor one Vietnamese line an English one');
  assert.equal(majorityLang([EN, EN, VI]), 'en');
});

test('lang: short stubs do not get a vote', () => {
  // detectLang returns 'en' for anything without diacritics, so an unwritten or title-card scene
  // would otherwise drag a Vietnamese video to English.
  assert.equal(majorityLang(['OK', 'Xong', '', '   ']), null, 'nothing substantial → no answer');
  assert.equal(resolveLang({}, [VI, VI, 'Hi', 'Go', 'Next', 'Stop']), 'vi', 'four stubs cannot outvote two real lines');
});

test('lang: with nothing to go on at all, the answer is the named house default', () => {
  assert.equal(DEFAULT_LANG, 'vi', 'the owner\'s main channel is Vietnamese');
  assert.equal(resolveLang({}, []), DEFAULT_LANG);
  assert.equal(resolveLang(null), DEFAULT_LANG);
});

test('lang: scene rows work as well as bare strings, and names are human', () => {
  assert.equal(resolveLang({}, [{ voice_text: EN }, { voice_text: EN }, { voice_text: VI }]), 'en');
  assert.equal(langName('en'), 'English (US)');
  assert.equal(langName('vi'), 'Vietnamese');
  assert.equal(detectLang(VI), 'vi');
  assert.equal(detectLang(EN), 'en');
});

test('lang: no stage invents its own Vietnamese default any more', () => {
  // Every one of these used to answer "Vietnamese" whenever config.language was unset — which was
  // always, because nothing wrote it. They must now go through the resolver.
  for (const f of ['../src/pipeline/stages/editorial.js', '../src/pipeline/stages/budget.js',
    '../src/pipeline/stages/finalize.js', '../src/pipeline/direction.js', '../src/audio/sound-design.js',
    '../src/api/services/topic-autopilot.js', '../src/pipeline/estimate.js']) {
    const code = src(f).split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    assert.ok(!/\|\| *'vi'/.test(code), `${f} still falls back to 'vi'`);
    assert.ok(!/\|\| *'Vietnamese'/.test(code), `${f} still falls back to 'Vietnamese'`);
    assert.ok(!/!== *'auto'\)? *\? *[\w.?]+\.language *: *'vi'/.test(code), `${f} still has the ternary default`);
  }
  // and the art-direction brief — which travels into the codegen prompt and so decides the
  // ON-SCREEN language scene after scene — names a real language
  assert.match(src('../src/pipeline/direction.js'), /narration in \$\{langName\(/);
  // the two pass-through sites: fixing direction.js alone would do nothing without these.
  // Both resolve ONCE per run and hand the same answer to the brief and to codegen — see the
  // "reaches codegen from BOTH lanes" test for the codegen half.
  assert.match(src('../src/pipeline/stages/visuals.js'), /ai: hfAi, language: videoLang,/);
  assert.match(src('../src/pipeline/regen.js'), /guide, ai: hfAi, language: sceneLang \}\)/);
});

test('lang: the editorial rewrite can no longer translate an English video into Vietnamese', () => {
  const ed = src('../src/pipeline/stages/editorial.js');
  // the scenes are the authority on their own language
  assert.match(ed, /const lang = resolveLang\(config, scenes\);/);
  // FIX_RULES names the language instead of hardcoding the word "Vietnamese"
  assert.match(ed, /rewrite ENTIRELY in \$\{langName\(lang\)\}/);
  // and the Vietnamese forms of address stay gated on the video ACTUALLY being Vietnamese
  assert.match(ed, /lang === 'vi' \? '\\nUse the fixed Vietnamese forms of address/);
});

test('lang: the telemetry stripper no longer deletes legitimate English labels', async () => {
  // MEASURED BUG, invisible in the logs: normalizeSpec blanks any text node matching a telemetry
  // pattern that carries no Vietnamese diacritic. On a Vietnamese video the diacritic guard
  // protects real copy, so the ALLCAPS wordlist only ever caught decor. On an ENGLISH video there
  // is no guard — ACTIVE, SUCCESS, ERROR RATE and RUNNING TOTAL all became EMPTY text nodes
  // before validation could see them. Second, independent cause of broken English scenes.
  const { normalizeSpec } = await import('../src/hyperframe/codegen.js');
  const { normalizeGuide } = await import('../src/styleguide/index.js');
  const guide = normalizeGuide({});
  const strip = (txt, language) => {
    const spec = { css: '', html: `<div class="hf-label">${txt}</div>`, script: '' };
    normalizeSpec(spec, { guide, duration: 6, language });
    return (/>([^<]*)</.exec(spec.html) || [])[1];
  };
  for (const word of ['ACTIVE', 'SUCCESS', 'ERROR RATE', 'RUNNING TOTAL', 'PENDING']) {
    assert.equal(strip(word, 'en'), word, `"${word}" is real copy in an English video`);
    assert.equal(strip(word, 'vi'), '', `"${word}" is still decor in a Vietnamese video`);
  }
  // STRUCTURAL telemetry is not a language question — no language writes copy this way
  for (const junk of ['limit_1024', 'ai_state="LOST"', 'foo.bar()', '[TARGET]', 'run.exe']) {
    assert.equal(strip(junk, 'en'), '', `"${junk}" is junk in any language`);
    assert.equal(strip(junk, 'vi'), '');
  }
  // and real copy survives everywhere, in both languages
  assert.equal(strip('TRẠNG THÁI', 'vi'), 'TRẠNG THÁI');
  assert.equal(strip('CASH FLOW', 'en'), 'CASH FLOW');
});

test('lang: the codegen prompt states the language instead of assuming Vietnamese', async () => {
  const { codegenSystem, buildCodegenPrompt } = await import('../src/hyperframe/prompt.js');
  const vi = codegenSystem('vi');
  const en = codegenSystem('en');
  assert.match(vi, /ON-SCREEN LANGUAGE: Vietnamese\./);
  assert.match(en, /ON-SCREEN LANGUAGE: English\./);
  // the system message was the strongest instruction in the prompt AND it was Vietnamese-only:
  // "a Vietnamese video shows complete Vietnamese words", "never put English or code on screen
  // in a Vietnamese video". On an English video that says the opposite of what is wanted.
  assert.ok(!/Vietnamese/.test(en), 'an English video is never told about Vietnamese');
  assert.ok(!/English/.test(vi), 'and a Vietnamese video is never told about English');
  // LANG_NAME's disambiguating parenthetical must not leak into prose ("a English (US) word")
  const { langAdjective } = await import('../src/util/lang.js');
  assert.equal(langAdjective('en'), 'English');
  assert.equal(langAdjective('es'), 'Spanish');
  assert.equal(langAdjective('vi'), 'Vietnamese');

  // and the rule is repeated in the USER message, next to the narration it applies to
  const guide = (await import('../src/styleguide/index.js')).HF_DEFAULT_GUIDE;
  const msgs = buildCodegenPrompt({
    scene: { voice_text: EN, visual_prompt: '' }, beats: [], direction: {}, guide,
    w: 1920, h: 1080, duration: 6, idx: 0, total: 4, language: 'en',
  });
  assert.match(msgs[1].content, /ON-SCREEN LANGUAGE: English —/);
});

test('lang: the one worked example carries no words in any language', async () => {
  // SAMPLE_SPEC is the only FINISHED scene the model ever sees, which makes it the strongest
  // language signal in a very long prompt. It used to be written in Vietnamese
  // ("// KIỂM CHỨNG", "TỰ TIN ≠ ĐÚNG", "Đối chiếu sự thật") — that is how ~23% of the scenes in
  // an English video came out Vietnamese. Translating it to English would only flip the bias,
  // so it carries numbers and symbols only.
  const { SAMPLE_SPEC } = await import('../src/styleguide/index.js');
  const texts = [...String(SAMPLE_SPEC.html).matchAll(/>([^<>]{1,60})</g)]
    .map((m) => m[1].trim()).filter(Boolean).filter((t) => !t.startsWith('{{'));
  const words = texts.filter((t) => /\p{L}{2,}/u.test(t));
  assert.deepEqual(words, [], `the example must carry no natural-language copy, found ${JSON.stringify(words)}`);
  assert.ok(texts.length >= 8, 'but it still has real content in its slots');
  // the LESSON is geometry — the slot anchors and ids are pinned by p41-even-layout/hf-lint
  for (const id of ['lb1', 'ic1', 'kw1', 'vc1', 'vr1', 'vr2', 'tk1', 'st1', 'sc1']) {
    assert.ok(SAMPLE_SPEC.html.includes(`id="${id}"`), `${id} is still there`);
  }
  for (const at of ['left:20%;top:12%', 'left:82%;top:14%', 'left:50%;top:30%', 'left:30%;top:66%',
    'left:80%;top:62%', 'left:52%;top:87%']) {
    assert.ok(SAMPLE_SPEC.html.includes(at), `slot ${at} is unmoved`);
  }
});

test('lang: the resolved language reaches codegen from BOTH lanes', () => {
  // fixing normalizeSpec is worthless if the batch and regen lanes do not tell it the language
  assert.match(src('../src/pipeline/stages/visuals.js'), /const videoLang = resolveLang\(config, scenes\)/);
  assert.match(src('../src/pipeline/stages/visuals.js'), /language: videoLang,/);
  assert.match(src('../src/pipeline/regen.js'), /const sceneLang = resolveLang\(config, allScenes\)/);
  assert.match(src('../src/pipeline/regen.js'), /ai: hfAi, language: sceneLang,/);
  // the manual scene-edit lane too
  assert.match(src('../src/api/services/edit-scene.js'), /normalizeSpec\(spec, \{ guide, duration, language \}\)/);
  // and a caller that forgets falls back to the scene's own text, never to a blanket assumption
  assert.match(src('../src/hyperframe/codegen.js'), /const lang = language \|\| detectLang\(scene\.voice_text \|\| ''\)/);
});

test('lang: the leak detector is MIRRORED, not symmetric — one word means different things', async () => {
  const { textLanguageLeak } = await import('../src/hyperframe/validate.js');
  const { fold } = await import('../src/hyperframe/beats.js');
  const words = (s) => new Set((fold(s).match(/[\p{L}\p{N}]+/gu) || []).filter((w) => w.length >= 2));

  const enNarr = words('Keep that five grand liquid in a high yield savings account');
  // THE TRAP: the naive fix is to delete the `narrLang !== 'en'` guard so the check is symmetric.
  // That condemns every valid one-word English label, because the prompt explicitly ASKS for
  // semantic, non-verbatim keywords — "MOMENTUM" is good design, not a leak.
  assert.equal(textLanguageLeak('MOMENTUM', enNarr, 'en'), false, 'a semantic English label is fine');
  assert.equal(textLanguageLeak('LIQUIDITY', enNarr, 'en'), false);
  // but a foreign SCRIPT in an English video is readable as a leak from a single word
  assert.equal(textLanguageLeak('TỰ TIN', enNarr, 'en'), true);
  assert.equal(textLanguageLeak('QUỸ', enNarr, 'en'), true);

  const viNarr = words('Giữ năm nghìn đô ở dạng tiền mặt trong tài khoản lãi cao');
  // unchanged for Vietnamese: ASCII dev decor is still the leak, real Vietnamese is still fine
  assert.equal(textLanguageLeak('SCANNING', viNarr, 'vi'), true);
  assert.equal(textLanguageLeak('TƯỞNG', viNarr, 'vi'), false, 'folds to ASCII but is NOT English decor');
  assert.equal(textLanguageLeak('tiền mặt', viNarr, 'vi'), false, 'drawn from the narration');
  // numbers and symbols belong to no language, in either direction
  for (const l of ['en', 'vi']) {
    assert.equal(textLanguageLeak('37%', enNarr, l), false);
    assert.equal(textLanguageLeak('0 → 100', enNarr, l), false);
  }
});

test('lang: the validator judges against the DECLARED language, not the narration it is given', () => {
  const v = src('../src/hyperframe/validate.js');
  // detecting from the narration was circular: a scene whose narration had itself been rewritten
  // into the wrong language would then validate its on-screen text against the corruption.
  assert.match(v, /const narrLang = language \|\| detectLang\(narration \|\| ''\)/);
  assert.match(v, /language = '' \}\) \{/, 'renderValidate accepts it');
  assert.match(src('../src/hyperframe/codegen.js'), /captionsOn, overlay, language: lang \}\)/, 'and codegen passes it');
  // the finding is persistence-tiered like every other one — a label flashing through a 0.3s
  // entrance must not burn an attempt
  assert.match(v, /textLanguageLeak\(e\.txt, narrWords, narrLang\)\) bump\(bad, e\.txt/);
  assert.match(v, /const badH = held\(bad\);/);
  // and the messages name the language rather than printing the code ("the narration is en")
  assert.ok(!/narrLang === 'vi' \? 'Vietnamese' : narrLang/.test(v), 'no raw language codes in prose');
});

test('lang: the picker exists, and it cannot clobber a channel that declared its language', () => {
  const html = src('../public/index.html');
  assert.ok(html.includes('id="cfgLang"'), 'the control exists');
  for (const code of ['auto', 'vi', 'en', 'ja', 'es']) {
    assert.ok(html.includes(`<option value="${code}"`), `${code} is offered`);
  }
  const cfg = src('../public/js/views/config.js');
  // 'auto' MUST become undefined. mergeConfigLayers skips only undefined and the merge order is
  // defaults → channel → preset → request, so emitting the string 'auto' would overwrite a
  // channel that declared its language and the channel default could never win. null is worse:
  // also not skipped, and the resolver rejects it.
  assert.match(cfg, /language: \$\('#cfgLang'\)\?\.value === 'auto' \? undefined : \(\$\('#cfgLang'\)\?\.value \|\| undefined\)/);
  assert.ok(!/language: \$\('#cfgLang'\)\?\.value \|\| 'auto'/.test(cfg), 'never emits the literal auto');
  // and the merge really does skip only undefined — the property this depends on
  assert.match(src('../src/core/config.js'), /if \(v === undefined\) continue;/);
  // applyConfig must assign UNCONDITIONALLY: it runs on every channel switch, and a guarded
  // `if (cfg.language)` would leave the previous channel's language in the picker — which
  // gatherConfig would then pin onto a project that should have been auto.
  assert.match(cfg, /if \(\$\('#cfgLang'\)\) \$\('#cfgLang'\)\.value = cfg\.language \|\| 'auto';/);
});

test('lang: a language with no pinned voice warns instead of silently using another', () => {
  const tts = src('../src/pipeline/stages/tts.js');
  // this is how three English scenes got read by a Vietnamese voice: resolveTarget falls through
  // to the default provider when langVoices has no entry for the video's language
  assert.match(tts, /const lv = ai\.tts\?\.langVoices\?\.\[videoLang\];/);
  assert.match(tts, /Chưa ghim giọng cho \$\{langName\(videoLang\)\}/);
  // warn-only: an offline or keyless install must still be able to make a video
  assert.ok(!/throw new Error\([^)]*langVoices/.test(tts), 'never blocks');
});

test('lang: "ghép lại" concatenates instead of re-rendering the whole video', () => {
  const ro = src('../src/pipeline/render-only.js');
  // the subset filter only ever applied to mode 'scenes', so 'concat' fell through to the full
  // mapPool — on a 95-scene video that is ~95 needless renders to join clips already on disk
  assert.match(ro, /const renderPass = mode !== 'concat';/);
  // The gate is now `renderPass && scenes.length`: 'concat' still skips the pool entirely, and so
  // does a render pass that found every clip already current — see incremental-render.test.js.
  assert.match(ro, /if \(renderPass && scenes\.length\) \{/, 'the render pool is gated');
  assert.match(ro, /không render lại/, 'and the owner is told what it did');
  // the unvoiced early-exit belongs to the RENDER path only — a fully-voiced project with clips
  // is perfectly concat-able
  assert.match(ro, /const unvoiced = renderPass \? scenes\.filter\(\(s\) => !s\.audio_path\) : \[\];/);
  // but the half-silent-video guard stays exactly as it was
  assert.match(ro, /const stillUnvoiced = DB\.getScenes\(projectId\)\.some\(\(s\) => !s\.audio_path\);/);
  // …now spelled through `doJoin`, because a subset render may opt into the join (the Vietnamese
  // repair knows its whole list up front). The guard itself is unchanged: no join while a scene
  // is unvoiced, or finalize's missing-clip pass would ship a half-silent "final".
  assert.match(ro, /const doJoin = mode !== 'scenes' \|\| join;/);
  assert.match(ro, /if \(doJoin && stillUnvoiced\)/);
  // and finalize still repairs any scene missing a clip, so nothing is skipped by rendering less
  assert.match(src('../src/pipeline/stages/finalize.js'), /missing-clip repair|thiếu clip|!existsSync\(s\.video_path/);
});

test('lang: a busy port is fatal and loud, and the listener order that makes it work', () => {
  const s = src('../src/server.js');
  assert.match(s, /server\.on\('error', \(e\) => \{/);
  assert.match(s, /e\?\.code === 'EADDRINUSE'/);
  assert.match(s, /AVS_PORT_IN_USE/);
  assert.match(s, /process\.exit\(1\);/);
  // ORDER IS LOAD-BEARING, and this is not a style preference: `ws` attaches its own 'error'
  // listener to the http server which RE-THROWS. A WebSocketServer created first turns the
  // listen error into an uncaughtException — which the catch-all only LOGS, leaving a live
  // process that never listens while the launcher's health probe gets a 200 from the OLD
  // server. That is exactly the "I rebuilt and it still runs yesterday's code" trap.
  assert.ok(s.indexOf("server.on('error'") < s.indexOf('hub.attach(server)'),
    'the error handler must be registered BEFORE hub.attach');
  assert.ok(s.indexOf('hub.attach(server)') < s.indexOf('server.listen('), 'and both before listen');
});

test('lang: scriptLang still falls back to the SOURCE text, not the narration', () => {
  // At script time no scenes exist yet, so the topic/pasted document is the only signal — a
  // different question from resolveLang's, and it must keep its own semantics.
  const llm = src('../src/providers/llm.js');
  assert.match(llm, /export function scriptLang\(config, sourceText\)/);
  assert.match(llm, /declaredLang\(config\) \|\| detectLang\(String\(sourceText \|\| ''\)\.slice\(0, 400\)\)/);
  // LANG_NAME moved to util/lang.js so validate.js can name a language without importing the
  // LLM module (db + metering + pricing); llm.js re-exports it for the existing call sites.
  assert.match(llm, /export \{ LANG_NAME, langName \}/);
  assert.ok(!/^export const LANG_NAME = \{/m.test(llm), 'no second copy of the table');
});
