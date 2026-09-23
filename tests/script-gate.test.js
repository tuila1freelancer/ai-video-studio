import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as DB from '../src/db/index.js';
import { auditProjectScript, runScriptGate, scriptAuditSettings, narrationOf } from '../src/pipeline/stages/script-gate.js';
import { classifyError } from '../src/core/errors.js';

const GOOD = [
  'Airlines lose money selling seats and make it selling miles. Here is the mechanism, and the answer is the balance sheet.',
  'According to the Bureau of Labor Statistics, the average household spent 4,300 dollars on air travel last year.',
  'Take a 400 dollar ticket. Divide it by the 8 cents an airline pays per mile and you get the real margin: 5,000 miles.',
  'The Federal Reserve reported that co-brand card spending grew 11 percent, and its own filings say the same.',
  'Check your statement. Compare the annual fee with the miles you actually redeemed. Count the months you carried a balance.',
  'Look up the redemption rate in the program terms, and measure it against the 1.4 cents per mile the airline books.',
  'That is the whole machine: the seat is the marketing cost, the mile is the product.',
  'Thanks for watching.',
].join(' ');

const makeProject = (voice, config) => {
  const p = DB.createProject({ title: 'Why airlines sell miles', topic: 't', inputType: 'text', aspectRatio: '16:9', config });
  DB.replaceScenes(p.id, [{ voice, visualPrompt: '' }]);
  return p;
};

test('the gate is off unless a channel turns it on', () => {
  assert.equal(scriptAuditSettings({}).mode, 'off');
  assert.equal(scriptAuditSettings({ scriptAudit: 'warn' }).mode, 'warn');
  assert.equal(scriptAuditSettings({ scriptAudit: { mode: 'block', wpm: 171 } }).mode, 'block');
  assert.equal(scriptAuditSettings({ scriptAudit: { mode: 'block', wpm: 171 } }).wpm, 171);
  assert.equal(scriptAuditSettings({ scriptAudit: 'nonsense' }).mode, 'off', 'an unknown mode is off, not on');
  const p = makeProject('bất cứ điều gì', {});
  assert.equal(auditProjectScript(p.id, {}), null, 'off means no report at all');
});

test('it measures the narration the scenes actually carry', () => {
  assert.equal(narrationOf([{ voice_text: 'a' }, { voice_text: '' }, { voice_text: 'b' }]), 'a\n\nb');
  const p = makeProject(GOOD, { scriptAudit: 'warn' });
  const report = auditProjectScript(p.id, { scriptAudit: 'warn', minWords: 10 });
  assert.equal(report.mode, 'warn');
  assert.ok(report.words > 100);
  assert.ok(report.sourcesSpoken >= 2, 'it saw the sources spoken aloud');
  assert.ok(report.workedExample >= 1, 'and the calculation done out loud');
  assert.ok(Array.isArray(report.fails));
});

test('warn records and carries on; block stops the run before the voice is paid for', () => {
  const bad = 'As a financial advisor with twenty years of experience, I recommend you buy this now before it is too late.';
  const warned = makeProject(bad, { scriptAudit: 'warn' });
  const report = runScriptGate({ projectId: warned.id, config: { scriptAudit: 'warn' } });
  assert.ok(report.fails.length > 0, 'the persona and advice clauses fired');
  assert.equal(DB.getProject(warned.id).status, 'draft', 'warn does not touch the run');

  const blocked = makeProject(bad, { scriptAudit: { mode: 'block' } });
  let err;
  try { runScriptGate({ projectId: blocked.id, config: { scriptAudit: { mode: 'block' } } }); }
  catch (e) { err = e; }
  assert.ok(err, 'block throws rather than letting the run spend on it');
  assert.equal(err.appCode, 'script.audit-failed');
  const kind = classifyError(err);
  assert.equal(kind.cls, 'config');
  assert.equal(kind.retryable, false, 'an auto-resume cannot fix a script that says the wrong things');
});
