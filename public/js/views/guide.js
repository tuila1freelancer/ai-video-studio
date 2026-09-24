// The manual, inside the app.
//
// Content is data, not markup: one array of sections, each a list of typed blocks. That is what
// makes the search box possible — it filters the same structure the page renders from, so a
// section can never be findable and unreadable, or readable and unfindable.
//
// Every "Mở …" button navigates to the real screen instead of describing where it is. A manual
// that can open the thing it is explaining stops being a document and starts being part of the UI.
import { $, $$, esc } from '../ui/dom.js';
import { toast } from '../ui/toast.js';
import { registerPageHook, switchPage } from './nav.js';
import { uiLang, t, m } from '../i18n.js';

/* ---------------------------------------------------------------------------
   CONTENT — public/guide/sections.json
   Block types:
     h      sub-heading
     p      paragraph                     (**bold**, `code`)
     steps  numbered walkthrough          [{ n, t }]
     list   bullets                       [str]
     defs   control reference             [[name, meaning]]
     note   callout                       { kind: tip|warn|cost|key, text }
     where  breadcrumb to the screen
     go     buttons that open that screen [{ label, act, arg }]
     grid   feature cards                 [{ i, t, d }]
     keys   shortcut table                [[combo, meaning]]
--------------------------------------------------------------------------- */

// The content lives in public/guide/sections.json (this file used to carry 40 KB of it as a JS
// literal); it is fetched the first time the page is shown, in every language.
let SECTIONS = [];


/* ---------------------------------------------------------------------------
   RENDER
--------------------------------------------------------------------------- */

// Inline formatting: escape first, then re-introduce the two marks we allow. The order matters —
// doing it the other way round would let content inject tags.
function fmt(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\*([^*]+)\*/g, '<i>$1</i>');
}

// The four callout labels. They live OUTSIDE SECTIONS, which is why the manual's own catalogue
// never saw them and they stayed Vietnamese in a translated manual.
const NOTE_META = {
  tip: ['💡', 'ui.guide.note.tip'], warn: ['⚠️', 'ui.guide.note.warn'],
  cost: ['💰', 'ui.guide.note.cost'], key: ['⌨️', 'ui.guide.note.key'],
};

const BLOCK = {
  h: (b) => `<h4 class="gd-h4">${fmt(b.text)}</h4>`,
  p: (b) => `<p class="gd-p">${fmt(b.text)}</p>`,
  where: (b) => `<div class="gd-where">📍 ${fmt(b.text)}</div>`,
  list: (b) => `<ul class="gd-ul">${b.items.map((x) => `<li>${fmt(x)}</li>`).join('')}</ul>`,
  steps: (b) => `<ol class="gd-steps">${b.items.map((x) => `<li><div class="gd-st-n">${fmt(x.n)}</div><div class="gd-st-t">${fmt(x.t)}</div></li>`).join('')}</ol>`,
  defs: (b) => `<dl class="gd-defs">${b.items.map(([k, v]) => `<div class="gd-def"><dt>${fmt(k)}</dt><dd>${fmt(v)}</dd></div>`).join('')}</dl>`,
  keys: (b) => `<dl class="gd-defs gd-keys">${b.items.map(([k, v]) => `<div class="gd-def"><dt><kbd>${esc(k)}</kbd></dt><dd>${fmt(v)}</dd></div>`).join('')}</dl>`,
  grid: (b) => `<div class="gd-cards">${b.items.map((x) => `<div class="gd-card"><span class="gd-card-i">${x.i}</span><div class="gd-card-t">${fmt(x.t)}</div><div class="gd-card-d">${fmt(x.d)}</div></div>`).join('')}</div>`,
  note: (b) => {
    const [ic, labelKey] = NOTE_META[b.kind] || NOTE_META.tip;
    const label = t(labelKey, null, { 'ui.guide.note.tip': 'Mẹo', 'ui.guide.note.warn': 'Lưu ý', 'ui.guide.note.cost': 'Chi phí', 'ui.guide.note.key': 'Phím tắt' }[labelKey]);
    return `<div class="gd-note ${b.kind}"><span class="gd-note-i">${ic}</span><div><b class="gd-note-l">${label}</b> ${fmt(b.text)}</div></div>`;
  },
  // A command is not prose: it is shown verbatim, never translated, and made easy to take away.
  code: (b) => `<div class="gd-code"><pre><code>${esc(b.text)}</code></pre>`
    + `<button class="gd-copy" data-copy="${esc(b.text)}" title="${esc(m('Sao chép'))}">⧉</button></div>`,
  go: (b) => `<div class="gd-go">${b.items.map((x) => `<button class="btn sm" data-act="${esc(x.act)}"${x.arg ? ` data-arg="${esc(x.arg)}"` : ''}>${esc(x.label)}</button>`).join('')}</div>`,
};

function renderSection(s, i) {
  const body = s.blocks.map((b) => (BLOCK[b.t] ? BLOCK[b.t](b) : '')).join('');
  return `<section class="gd-sec" id="gd-${s.id}">
    <header class="gd-sec-h">
      <span class="gd-sec-ic">${s.ic}</span>
      <div>
        <div class="gd-sec-num">${String(i + 1).padStart(2, '0')} · ${esc(s.grp)}</div>
        <h3 class="gd-sec-t">${esc(s.title)}</h3>
      </div>
    </header>
    ${s.lede ? `<p class="gd-lede">${fmt(s.lede)}</p>` : ''}
    ${body}
  </section>`;
}

/* ---------------------------------------------------------------------------
   SEARCH
   Vietnamese without diacritics has to match Vietnamese with them: nobody types "phụ đề"
   into a filter box, they type "phu de".
--------------------------------------------------------------------------- */
// NFD strips the marks, so "phu de" matches "phụ đề", "resume" matches "résumé" and "sluzba"
// matches "служба" is NOT what happens — Cyrillic, Thai and CJK have no marks to strip and simply
// pass through unchanged, which is the right answer for all three. đ has no decomposition of its
// own, so it needs its own line.
const flat = (s) => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\u0111/g, 'd');

function haystack(s) {
  const parts = [s.title, s.grp, s.lede || ''];
  for (const b of s.blocks) {
    if (b.text) parts.push(b.text);
    if (b.t) parts.push(b.t);
    for (const x of b.items || []) {
      if (Array.isArray(x)) parts.push(...x);
      else if (typeof x === 'string') parts.push(x);
      else parts.push(x.n || '', x.t || '', x.d || '', x.label || '');
    }
  }
  return flat(parts.join(' '));
}

// The chapters actually being shown: the Vietnamese source, or a translated copy laid over the
// SAME shape (see scripts/i18n-extract-guide.mjs), so a translated manual can never have a
// different set of chapters, blocks or jump buttons from the Vietnamese one.
let CHAPTERS = SECTIONS;
let HAY = new Map();

function rehydrate(flatText) {
  const clone = JSON.parse(JSON.stringify(SECTIONS));
  for (const [path, value] of Object.entries(flatText || {})) {
    if (typeof value !== 'string') continue;
    const parts = path.split('.');
    let node = clone;
    for (let i = 0; i < parts.length - 1 && node; i++) node = node[parts[i]];
    if (node) node[parts[parts.length - 1]] = value;
  }
  return clone;
}

async function loadChapters() {
  try {
    SECTIONS = await (await fetch('/guide/sections.json')).json();
  } catch { SECTIONS = []; }
  CHAPTERS = SECTIONS;
  if (uiLang() !== 'vi') {
    try {
      const res = await fetch(`/locales/guide.${uiLang()}.json`, { cache: 'no-cache' });
      if (res.ok) CHAPTERS = rehydrate(await res.json()); // else: no translated manual yet — Vietnamese still reads
    } catch { /* offline: the authored manual is already here */ }
  }
  HAY = new Map(CHAPTERS.map((s) => [s.id, haystack(s)]));
}

/* ---------------------------------------------------------------------------
   BOOT
--------------------------------------------------------------------------- */

// Screens the guide can open for you. Dynamic import keeps this module out of every other
// module's import graph — the guide knows about the app, the app does not know about the guide.
const ACTIONS = {
  page: (arg) => switchPage(arg),
  settings: async () => (await import('../features/settings.js')).openSettings(),
  agent: async () => (await import('../features/settings.js')).openAgentPanel(),
  voices: async () => (await import('../features/voicepicker.js')).openVoicePicker(),
  brandkit: async () => (await import('../features/brandkit.js')).openBrandEditor(),
  channels: async () => {
    const m = await import('../features/channels.js');
    m.renderChannelList();
    $('#channelModal').classList.add('open');
  },
  assistant: () => $('#heroAutopilot')?.click(),
  tasks: () => $('#heroTasks')?.click(),
};

let built = false;

export function initGuide() {
  registerPageHook('tutorials', build);
}
/** First show of the page: register the real hook and build once. */
export function openGuide() { initGuide(); return build(); }

async function build() {
  if (built) return;
  built = true;
  await loadChapters();

  const groups = [...new Set(CHAPTERS.map((s) => s.grp))];
  $('#gdNav').innerHTML = groups.map((g) => `
    <div class="gd-nav-g">${esc(g)}</div>
    ${CHAPTERS.filter((s) => s.grp === g).map((s) => `
      <a class="gd-nav-i" href="#gd-${s.id}" data-id="${s.id}"><span>${s.ic}</span>${esc(s.title)}</a>`).join('')}
  `).join('');
  $('#gdBody').innerHTML = CHAPTERS.map(renderSection).join('');

  // Nav clicks scroll inside .page (the app's scroll container), not the window.
  $('#gdNav').addEventListener('click', (e) => {
    const a = e.target.closest('.gd-nav-i');
    if (!a) return;
    e.preventDefault();
    document.getElementById('gd-' + a.dataset.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  $('#gdBody').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-act]');
    if (b) return ACTIONS[b.dataset.act]?.(b.dataset.arg);
    const copy = e.target.closest('[data-copy]');
    if (!copy) return;
    try { await navigator.clipboard.writeText(copy.dataset.copy); toast('⧉ Đã sao chép', 'success'); }
    catch { toast('Trình duyệt không cho sao chép.', 'error'); }
  });

  // Two-tier search. "phụ đề" appears in fifteen chapters and is the NAME of one — showing all
  // fifteen answers nothing. So a title match wins outright, and the chapters that merely mention
  // the word are offered on a second line rather than dumped into the results.
  const search = $('#gdSearch');
  let wide = false;
  const runSearch = () => {
    const q = flat(search.value.trim());
    const byTitle = q ? CHAPTERS.filter((s) => flat(s.title + ' ' + s.grp).includes(q)) : [];
    const byBody = q ? CHAPTERS.filter((s) => HAY.get(s.id).includes(q)) : CHAPTERS;
    const show = new Set((!q || wide || !byTitle.length ? byBody : byTitle).map((s) => s.id));
    for (const s of CHAPTERS) {
      const on = show.has(s.id);
      document.getElementById('gd-' + s.id)?.classList.toggle('hidden', !on);
      $(`.gd-nav-i[data-id="${s.id}"]`)?.classList.toggle('hidden', !on);
    }
    const rest = byBody.length - show.size;
    $('#gdMore').classList.toggle('hidden', rest <= 0);
    $('#gdMore').textContent = t('ui.guide.con-n-chuong-khac', { n: rest, q: search.value.trim() },
      'Còn {n} chương khác có nhắc tới “{q}” — bấm để xem');
    $('#gdEmpty').classList.toggle('hidden', !q || show.size > 0);
    $('#gdCount').textContent = q
      ? t('ui.guide.n-chuong-khop', { n: show.size }, '{n} chương khớp')
      : t('ui.guide.n-chuong', { n: CHAPTERS.length }, '{n} chương');
  };
  search.addEventListener('input', () => { wide = false; runSearch(); });
  $('#gdMore').addEventListener('click', () => { wide = true; runSearch(); });
  runSearch();

  // Scrollspy: the sidebar always shows where you are.
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      $$('.gd-nav-i').forEach((a) => a.classList.toggle('on', a.dataset.id === en.target.id.slice(3)));
    }
  }, { root: $('#page-tutorials'), rootMargin: '-10% 0px -80% 0px' });
  $$('.gd-sec').forEach((s) => io.observe(s));
}
