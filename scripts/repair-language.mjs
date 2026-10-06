// Repair a finished project whose scenes came out in the wrong language.
//
// Written for the "Why $5,000 Is the Number That Changes Everything" video, which shipped with
// 3 scenes of Vietnamese narration and 22 scenes of Vietnamese on-screen text under English
// voice-over. The engine bugs behind that are fixed; this repairs the video that already exists.
//
//   node scripts/repair-language.mjs <projectId> <lang> [--dry]
//
// Drives the RUNNING server (data/server.url) over HTTP, strictly SERIALLY:
//  - regen and edit-html take no governor permit and each one drives headless Chrome, so firing
//    them in parallel thrashes the browser;
//  - the app owns the SQLite WAL and the render pool per-process, so booting a second server to
//    do this would fight the first.
//
// It never calls /resume. ttsFingerprint hashes `lang: config.language || 'auto'`, so setting the
// language and then resuming would re-synthesize EVERY scene at full TTS cost. The explicit
// render + concat path consults no fingerprints at all.
//
// Every scene it touches is snapshotted as a take by the server first, so any single scene can be
// rolled back from Scene Studio without undoing the rest.
//
// TWO THINGS THIS LEARNED THE HARD WAY — read before trusting a run:
//
// 1. NEVER START THIS WHILE A RENDER IS IN FLIGHT. render-only.js reads every scene row into
//    memory ONCE and renders from that snapshot. A render queued before an edit finishes from the
//    STALE row and writes video_path back over the null the edit just set — so the clip looks
//    fresh by mtime AND the DB row reads correct, while the picture is the old one. Check the
//    project is not 'running' first, and VERIFY BY EXTRACTING A FRAME, never by DB state.
//
// 2. THE DIACRITIC TEST HAS A BLIND SPOT. Vietnamese conventions that carry no diacritics slip
//    through: "84.000.000 đ", "+12 TR" (triệu), and "$5.000" with a dot as the thousands
//    separator. Worse, telling the model to preserve numbers and currency symbols verbatim — right
//    for a label — is exactly wrong when the CURRENCY ITSELF is the foreign thing. Those need a
//    human: the narration usually pins the values ("already at seventy percent"), and a model
//    asked to convert will invent numbers that contradict the voice-over. Run the reporter below
//    after every repair and fix what it lists by hand.
import { readFileSync } from 'node:fs';
import { chat, llmEnabled } from '../src/providers/llm.js';
import { aiSettings } from '../src/db/index.js';

const [projectId, lang] = process.argv.slice(2);
const DRY = process.argv.includes('--dry');
if (!projectId || !lang) {
  console.error('usage: node scripts/repair-language.mjs <projectId> <lang> [--dry]');
  process.exit(2);
}

const BASE = (() => {
  try { return readFileSync('data/server.url', 'utf8').trim(); } catch { return 'http://127.0.0.1:8123'; }
})();
const log = (...a) => console.log('[repair]', ...a);
const VN = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;
const langLabel = { en: 'English', vi: 'Vietnamese', ja: 'Japanese', ko: 'Korean', zh: 'Chinese' }[lang] || lang;
// The DB is opened READ-ONLY here, only to read the LLM settings — every write in this script
// goes through the running server's HTTP API, so the two processes never fight over the WAL.
const llm = aiSettings().llm;
if (!llmEnabled(llm)) { console.error('no LLM configured — check AI Setting'); process.exit(1); }

async function api(path, opts = {}) {
  const r = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
  });
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }
  if (!r.ok) throw Object.assign(new Error(json?.error || text.slice(0, 200)), { status: r.status, body: json });
  return json;
}

// ---------------------------------------------------------------- survey
const { project, scenes } = await api(`/api/projects/${projectId}`);
if (!project) { console.error('project not found'); process.exit(1); }
scenes.sort((a, b) => a.idx - b.idx);
log(`project: ${project.title}`);
log(`${scenes.length} scenes · target language: ${lang}`);

// What a VIEWER can actually read: HTML text nodes plus strings the script assigns to the DOM.
// Deliberately NOT the whole props blob — a Vietnamese `// Beat 1: …` comment and the style
// guide's own name (props.guide.name = "Tài Chính Thực Tế") never reach the screen, and counting
// them cries wolf on a scene that is already correct.
const onScreenText = (sc) => {
  const p = sc.props || {};
  return [...String(p.html || '').matchAll(/>([^<>]+)</g)].map((m) => m[1])
    .concat([...String(p.script || '').replace(/\/\/[^\n]*/g, '')
      .matchAll(/(['"`])((?:(?!\1)[^\\]|\\.)*)\1/g)].map((m) => m[2]))
    .join('\n');
};
// Which scenes are actually wrong, measured now rather than assumed from an earlier survey.
const badVoice = scenes.filter((s) => VN.test(s.voice_text || ''));
const badHtml = scenes.filter((s) => !VN.test(s.voice_text || '') && VN.test(onScreenText(s)));
log(`narration in the wrong language: ${badVoice.length} → ${badVoice.map((s) => s.idx).join(', ') || '—'}`);
log(`on-screen text in the wrong language: ${badHtml.length} → ${badHtml.map((s) => s.idx).join(', ') || '—'}`);
if (DRY) { log('--dry: nothing changed'); process.exit(0); }
if (!badVoice.length && !badHtml.length) { log('nothing to repair'); process.exit(0); }

// ---------------------------------------------------------------- 1. pin the language
// Also switches the thumbnail off: finalize regenerates it on every concat, and this project's
// thumbnail is already correct — no reason to pay for it twice.
const config = { ...project.config, language: lang, thumbnailAi: false };
await api(`/api/projects/${projectId}`, { method: 'PUT', body: { config } });
log(`config.language = ${lang}, thumbnailAi = false`);

// ---------------------------------------------------------------- 2. narration
const touched = new Set();
for (const sc of badVoice) {
  const prev = scenes[sc.idx - 1]?.voice_text || '';
  const next = scenes[sc.idx + 1]?.voice_text || '';
  log(`scene ${sc.idx}: rewriting narration…`);
  // One LLM call, keeping the meaning, the spoken length and the continuity with the scenes on
  // either side — a bare translation would read as a seam in the middle of a continuous talk.
  const text = await chat([
    { role: 'system', content: `You are a video script editor. Reply with the rewritten narration line ONLY — no quotes, no commentary, no preamble.` },
    { role: 'user', content: `This line of a ${langLabel} video was written in the wrong language. Rewrite it in ${langLabel}, keeping the exact meaning, the speaking style and roughly the same spoken length.

It sits in the MIDDLE of one continuous talk: it must still follow the previous line and lead into the next, never read as a standalone sentence.

PREVIOUS LINE: "${prev.slice(-220)}"
THIS LINE (rewrite this): "${sc.voice_text}"
NEXT LINE: "${next.slice(0, 220)}"` },
  ], { temperature: 0.4, maxTokens: 600, llm })
    .then((s) => String(s || '').trim().replace(/^["']|["']$/g, ''))
    .catch((e) => { log(`  ! LLM failed (${e.message.slice(0, 80)})`); return ''; });
  if (!text || VN.test(text)) { log(`  ! scene ${sc.idx}: no usable rewrite, left as-is`); continue; }
  await api(`/api/scenes/${sc.id}`, { method: 'PUT', body: { voice_text: text } });
  log(`  → "${text.slice(0, 80)}…"`);
  await api(`/api/scenes/${sc.id}/regen-voice`, { method: 'POST', body: {} });
  log(`  ✓ scene ${sc.idx}: voice re-synthesized`);
  touched.add(sc.id);
}

// ---------------------------------------------------------------- 3. on-screen text
//
// TEXT NODES ONLY, substituted deterministically. The obvious approach — POST /edit-html and let
// the model rewrite the spec — was tried and is WRONG for this job on both counts:
//   * it cannot work: the model must return the complete {css,html,script}, and re-linting that
//     output rejected all 22 scenes ("touches the harness internal runtime", "spec too long").
//     One violation the model invents anywhere in 24k characters loses the whole edit.
//   * it should not work: the user asked to keep the layout. Handing a model the layout and
//     trusting it to return an identical one is a promise nobody can keep.
// So the model only ever sees a LIST OF STRINGS and returns a list of strings. Everything else —
// ids, classes, CSS, positions, GSAP timings — is untouched by construction, not by instruction.
const textNodes = (html) => [...String(html).matchAll(/>([^<>]+)</g)]
  .map((m) => m[1]).filter((t) => VN.test(t));
// Vietnamese inside a script string literal: `el.textContent = 'CHƯA'`. Quoted runs only — never
// identifiers, never code.
const scriptStrings = (js) => [...String(js).matchAll(/(['"`])((?:(?!\1)[^\\]|\\.)*)\1/g)]
  .map((m) => m[2]).filter((t) => VN.test(t));

async function translateAll(items) {
  if (!items.length) return [];
  const numbered = items.map((t, i) => `${i + 1}. ${t}`).join('\n');
  const reply = await chat([
    { role: 'system', content: 'You translate short UI labels for motion-graphics videos. Reply with a pure JSON array of strings and nothing else.' },
    { role: 'user', content: `Translate each of these ${items.length} on-screen labels into ${langLabel}.

RULES
- Keep each translation close to the ORIGINAL CHARACTER LENGTH. These sit in fixed-size boxes; a longer string overflows or re-wraps and breaks the layout.
- Keep the register: these are display labels and kickers, not prose. ALL CAPS stays ALL CAPS.
- Keep every number, unit, %, currency symbol and punctuation mark exactly as it appears.
- Leading markers like "//" or "▸" are decoration — keep them in place.
- Translate the MEANING, not word by word.

Return a JSON array of exactly ${items.length} strings, in order.

${numbered}` },
  ], { json: true, temperature: 0.2, maxTokens: Math.min(8000, 500 + items.length * 60), llm });
  let arr = null;
  try {
    const parsed = JSON.parse(String(reply).replace(/^```json?\s*|\s*```$/g, '').trim());
    arr = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.labels) ? parsed.labels : null);
  } catch { /* handled below */ }
  if (!arr || arr.length !== items.length) throw new Error(`expected ${items.length} strings, got ${arr ? arr.length : 'unparseable'}`);
  return arr.map((s, i) => String(s ?? items[i]));
}

// Re-survey FIRST. A scene whose narration was just rewritten (say #16: a Vietnamese voice with
// matching Vietnamese labels) was CORRECT a moment ago and is wrong now — it would be missed by
// the survey taken at the top of this script, which ran before the narration pass.
const nowHtml = (await api(`/api/projects/${projectId}`)).scenes
  .filter((s) => VN.test(onScreenText(s)))
  .sort((a, b) => a.idx - b.idx);
if (nowHtml.length !== badHtml.length) log(`re-survey: ${nowHtml.length} scenes need translating (was ${badHtml.length})`);

const rejected = [];
for (const sc of nowHtml) {
  const props = sc.props || {};
  const htmlItems = textNodes(props.html);
  const jsItems = scriptStrings(props.script);
  process.stdout.write(`[repair] scene ${sc.idx}: ${htmlItems.length} labels + ${jsItems.length} strings… `);
  try {
    const all = await translateAll([...htmlItems, ...jsItems]);
    const htmlOut = all.slice(0, htmlItems.length);
    const jsOut = all.slice(htmlItems.length);
    // Substitute POSITIONALLY, in the same traversal order the extraction used, so the nth
    // Vietnamese node gets the nth translation even when two nodes share the same text.
    let hi = 0;
    const html = String(props.html).replace(/>([^<>]+)</g, (seg, t) => (VN.test(t) ? `>${htmlOut[hi++]}<` : seg));
    let ji = 0;
    const script = String(props.script || '').replace(/(['"`])((?:(?!\1)[^\\]|\\.)*)\1/g,
      (seg, q, t) => (VN.test(t) ? `${q}${String(jsOut[ji++]).replace(/(['"`\\])/g, '\\$1')}${q}` : seg));
    if (hi !== htmlItems.length || ji !== jsItems.length) throw new Error('substitution count drifted');
    await api(`/api/scenes/${sc.id}`, { method: 'PUT', body: { props: { ...props, html, script } } });
    console.log('✓');
    touched.add(sc.id);
  } catch (e) {
    console.log('✗');
    rejected.push({ idx: sc.idx, why: String(e.message).slice(0, 160) });
    log(`  ! scene ${sc.idx}: ${rejected[rejected.length - 1].why}`);
  }
}

// ---------------------------------------------------------------- 4. render + concat
const after = (await api(`/api/projects/${projectId}`)).scenes;
const needRender = after.filter((s) => touched.has(s.id) || !s.video_path);
log(`re-rendering ${needRender.length} scenes (${needRender.map((s) => s.idx).join(', ')})`);
if (needRender.length) {
  await api(`/api/projects/${projectId}/render`, { method: 'POST', body: { mode: 'scenes', sceneIds: needRender.map((s) => s.id) } });
  // /render is fire-and-forget; poll the rows rather than the WS feed.
  for (let i = 0; i < 600; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const rows = (await api(`/api/projects/${projectId}`)).scenes.filter((s) => needRender.some((n) => n.id === s.id));
    const left = rows.filter((s) => !s.video_path).length;
    process.stdout.write(`\r[repair] rendering… ${rows.length - left}/${rows.length}   `);
    if (!left) break;
  }
  console.log();
}
log('concatenating (no re-render — mode:concat)…');
await api(`/api/projects/${projectId}/render`, { method: 'POST', body: { mode: 'concat' } });
for (let i = 0; i < 360; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  const p = (await api(`/api/projects/${projectId}`)).project;
  process.stdout.write(`\r[repair] ${p.status} … `);
  if (p.status !== 'running') { console.log(); log(`final: ${p.video_path}`); break; }
}

// ---------------------------------------------------------------- 5. verify
const final = (await api(`/api/projects/${projectId}`)).scenes;
const visible = (sc) => {
  const p = sc.props || {};
  return [...String(p.html || '').matchAll(/>([^<>]+)</g)].map((m) => m[1])
    // comments are stripped: a Vietnamese `// Beat 1: …` note never reaches the screen, and
    // neither does the guide's own name in props.guide — flagging those is a false alarm.
    .concat([...String(p.script || '').replace(/\/\/[^\n]*/g, '')
      .matchAll(/(['"`])((?:(?!\1)[^\\]|\\.)*)\1/g)].map((m) => m[2]));
};
const stillVoice = final.filter((s) => VN.test(s.voice_text || ''));
const stillHtml = final.filter((s) => visible(s).some((t) => VN.test(t)));
// The blind spot (see the header): Vietnamese conventions with no diacritics. Reported, never
// auto-fixed — the narration pins these values and a model asked to convert will contradict it.
const CONV = /\d\.\d{3}(?!\d)|\bTR\b|\bđ\b|VN[ĐD]\b/;
const conventions = final
  .map((s) => ({ idx: s.idx, hits: [...new Set(visible(s).filter((t) => CONV.test(t)).map((t) => t.trim()))] }))
  .filter((x) => x.hits.length);
log('---- result ----');
log(`narration still wrong: ${stillVoice.length} ${stillVoice.map((s) => s.idx).join(', ')}`);
log(`on-screen still wrong: ${stillHtml.length} ${stillHtml.map((s) => s.idx).join(', ')}`);
if (conventions.length) {
  log(`NEEDS A HUMAN — ${conventions.length} scenes keep Vietnamese number/currency conventions:`);
  for (const c of conventions) log(`  scene ${c.idx}: ${JSON.stringify(c.hits).slice(0, 120)}`);
}
log('Verify by EXTRACTING A FRAME from the finished file — the DB can read correct while the');
log('clip is stale (see note 1 in the header).');
if (rejected.length) {
  log(`${rejected.length} scenes were REFUSED by the render gate and keep their old text:`);
  for (const r of rejected) log(`  scene ${r.idx}: ${r.why}`);
}
process.exit(stillVoice.length || stillHtml.length ? 1 : 0);
