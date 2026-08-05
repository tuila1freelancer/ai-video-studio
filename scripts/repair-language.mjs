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

const onScreenText = (sc) => {
  const p = sc.props || {};
  return [p.html, p.css, p.script].filter(Boolean).join('\n');
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
const EDIT = `Translate EVERY word of visible on-screen text into ${lang === 'en' ? 'English' : lang}. `
  + 'Keep the design absolutely identical: same elements, same ids, same classes, same CSS, same '
  + 'positions, same sizes, same colours, same GSAP timings — change ONLY the human-readable text '
  + 'inside the elements. Numbers, units, %, currency symbols and {{icon:...}} placeholders stay '
  + 'exactly as they are. Keep each translation about the same character length as the original so '
  + 'nothing overflows its box or re-wraps.';
// Re-survey FIRST. A scene whose narration was just rewritten (say #16: Vietnamese voice with
// matching Vietnamese labels) was CORRECT a moment ago and is wrong now — it would be missed by
// the survey taken at the top of this script, which ran before the narration pass.
const nowHtml = (await api(`/api/projects/${projectId}`)).scenes
  .filter((s) => !VN.test(s.voice_text || '') && VN.test(onScreenText(s)))
  .sort((a, b) => a.idx - b.idx);
if (nowHtml.length !== badHtml.length) {
  log(`re-survey after the narration pass: ${nowHtml.length} scenes need translating (was ${badHtml.length})`);
}
const rejected = [];
for (const sc of nowHtml) {
  process.stdout.write(`[repair] scene ${sc.idx}: translating on-screen text… `);
  try {
    await api(`/api/scenes/${sc.id}/edit-html`, { method: 'POST', body: { prompt: EDIT } });
    console.log('✓');
    touched.add(sc.id);
  } catch (e) {
    console.log('✗');
    // 422 = the app's own lint/render gate refused the edit. The scene keeps its previous spec.
    rejected.push({ idx: sc.idx, why: (e.body?.defects || [e.message]).join('; ').slice(0, 160) });
    log(`  ! scene ${sc.idx} rejected: ${rejected[rejected.length - 1].why}`);
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
const stillVoice = final.filter((s) => VN.test(s.voice_text || ''));
const stillHtml = final.filter((s) => !VN.test(s.voice_text || '') && VN.test(onScreenText(s)));
log('---- result ----');
log(`narration still wrong: ${stillVoice.length} ${stillVoice.map((s) => s.idx).join(', ')}`);
log(`on-screen still wrong: ${stillHtml.length} ${stillHtml.map((s) => s.idx).join(', ')}`);
if (rejected.length) {
  log(`${rejected.length} scenes were REFUSED by the render gate and keep their old text:`);
  for (const r of rejected) log(`  scene ${r.idx}: ${r.why}`);
}
process.exit(stillVoice.length || stillHtml.length ? 1 : 0);
