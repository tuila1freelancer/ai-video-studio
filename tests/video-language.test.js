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
