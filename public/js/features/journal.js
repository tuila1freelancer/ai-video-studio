// P32 — the persistent per-run journal panel ("Nhật ký xử lý").
// History loads over REST (it survives page reloads AND server restarts — a video finished
// last week still tells its full story); live rows arrive as WS type 'journal' and are
// deduped by row id, so hub replay buffers can never double-print a line.
import { $, $$, el, esc } from '../ui/dom.js';
import { api } from '../api.js';
import { state } from '../state.js';
import { toast } from '../ui/toast.js';
import { m, tp } from '../i18n.js';

// Both built on call, not at import: the catalogue is fetched after this module is evaluated.
const stageMeta = () => ({
  b2: ['📝', m('Kịch bản')], b5: ['🎨', m('Dựng cảnh')], b34: ['🎙', m('Lồng tiếng + Phụ đề')],
  b6: ['🎬', m('Render')], b7: ['🎞', m('Ghép & Mix')], sys: ['⚙️', m('Hệ thống')],
});
const runStatus = () => ({ queued: m('⏳ chờ'), running: m('▶ đang chạy'), done: m('✅ xong'), error: m('⛔ lỗi'), cancelled: m('🚫 huỷ') });

const J = {
  projectId: null, runs: [], events: [], run: 'latest', level: '', q: '',
  lastId: 0, timer: null, userToggled: new Map(), // group index -> user-chosen open state
};

export function fmtMs(ms) {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}p${String(s % 60).padStart(2, '0')}s` : `${s}s`;
}

export function initJournal() {
  $('#logToggle')?.addEventListener('click', () => {
    const p = $('#journalPanel');
    const closing = !p.classList.contains('closed');
    p.classList.toggle('closed', closing);
    $('#logCaret').textContent = closing ? '▸' : '▾';
  });
  $('#jrRun')?.addEventListener('change', () => { J.run = $('#jrRun').value; J.userToggled.clear(); reload(); });
  $$('#jrBar .jr-chipf').forEach((c) => c.addEventListener('click', () => {
    $$('#jrBar .jr-chipf').forEach((x) => x.classList.toggle('on', x === c));
    J.level = c.dataset.lv || '';
    render();
  }));
  $('#jrSearch')?.addEventListener('input', () => { J.q = $('#jrSearch').value.trim().toLowerCase(); render(); });
  $('#jrCopy')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(exportText()); toast('Đã sao chép nhật ký ✓', 'success'); }
    catch { toast('Không sao chép được', 'error'); }
  });
  $('#jrDownload')?.addEventListener('click', () => {
    const blob = new Blob([exportText()], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `nhat-ky-${J.projectId || 'du-an'}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });
  $('#jrExpand')?.addEventListener('click', () => $('#journalPanel').classList.toggle('expanded'));
  $('#jrNewer')?.addEventListener('click', () => {
    const b = $('#logBody'); b.scrollTop = b.scrollHeight;
    $('#jrNewer').classList.add('hidden');
  });
  $('#logBody')?.addEventListener('scroll', () => { if (nearBottom()) $('#jrNewer').classList.add('hidden'); });
}

/**
 * Open the journal and put it in view.
 *
 * Called whenever the app starts long work from somewhere that is not the pipeline screen — a
 * logo edit, a subtitle edit — because a re-render that reports nothing is indistinguishable
 * from one that never started.
 */
export function showJournal() {
  const p = $('#journalPanel');
  if (!p) return;
  p.classList.remove('closed');
  const c = $('#logCaret'); if (c) c.textContent = '▾';
  p.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
}

/** Project switch: the panel must never bleed lines from the previous project. */
export function clearJournal() {
  Object.assign(J, { projectId: null, runs: [], events: [], run: 'latest', lastId: 0 });
  J.userToggled.clear();
  const b = $('#logBody'); if (b) b.innerHTML = '';
  const s = $('#jrRun'); if (s) s.innerHTML = '';
  $('#jrNewer')?.classList.add('hidden');
}

export async function loadJournal(projectId) {
  J.projectId = projectId; J.run = 'latest'; J.events = []; J.lastId = 0;
  await reload();
}

async function reload() {
  if (!J.projectId) return;
  try {
    const jobParam = J.run === 'all' || J.run === 'latest' ? null : J.run;
    const qs = jobParam ? `?job=${encodeURIComponent(jobParam)}` : '';
    const r = await api.get(`/projects/${J.projectId}/journal${qs}`);
    J.runs = r.runs || [];
    let evs = r.events || [];
    if (J.run === 'latest' && J.runs[0]?.id) {
      // newest run only — but legacy rows without a job id (pre-P32 flows) stay visible
      const latest = J.runs[0].id;
      const scoped = evs.filter((e) => e.job_id === latest);
      if (scoped.length) evs = scoped;
    }
    J.events = evs;
    J.lastId = evs.reduce((m, e) => Math.max(m, e.id || 0), 0);
    renderRunPicker();
    render(true);
  } catch { /* the panel is best-effort — never toast a failure loop */ }
}

function renderRunPicker() {
  const s = $('#jrRun'); if (!s) return;
  s.innerHTML = '';
  s.appendChild(el('option', null, m('Tất cả các lần chạy'))).value = 'all';
  const status = runStatus();
  J.runs.forEach((r, i) => {
    const n = J.runs.length - i;
    const t = new Date(r.created_at).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
    const dur = r.durMs ? ` · ${fmtMs(r.durMs)}` : '';
    const o = el('option', null, tp`Lần chạy #${n} · ${t} · ${status[r.status] || r.status}${dur}`);
    o.value = r.id;
    s.appendChild(o);
  });
  s.value = J.run === 'latest' ? (J.runs[0]?.id || 'all') : J.run;
  if (!s.value) s.value = 'all';
}

function passes(e) {
  if (J.level === 'warn' && !['warn', 'error'].includes(e.level)) return false;
  if (J.level === 'error' && e.level !== 'error') return false;
  if (J.q && !(e.msg || '').toLowerCase().includes(J.q)) return false;
  return true;
}

function render(fresh = false, liveAppend = false) {
  const body = $('#logBody'); if (!body) return;
  const pin = fresh || nearBottom();
  body.innerHTML = '';
  const evs = J.events.filter(passes);
  if (!evs.length) {
    body.appendChild(el('div', 'jr-empty', J.events.length ? m('Không có dòng nào khớp bộ lọc.') : m('Chưa có nhật ký cho dự án/lần chạy này.')));
    return;
  }
  const groups = [];
  let gb = null, gh = null;
  const openGroup = (icn, name) => {
    const g = el('div', 'jr-g');
    gh = el('div', 'jr-gh', `<span class="jr-car">▾</span> ${icn} ${esc(name)} <span class="jr-gd"></span>`);
    gb = el('div', 'jr-gb');
    const idx = groups.length;
    gh.addEventListener('click', () => {
      g.classList.toggle('closed');
      J.userToggled.set(idx, !g.classList.contains('closed'));
    });
    g.appendChild(gh); g.appendChild(gb);
    body.appendChild(g); groups.push(g);
  };
  const stages = stageMeta();
  for (const e of evs) {
    if (e.kind === 'step' && e.data?.state === 'running') {
      const [icn, name] = stages[e.stage] || ['⚙️', e.stage || m('Khác')];
      openGroup(icn, name);
      continue; // the group header IS the running line
    }
    if (!gb) openGroup('🗒', m('Chung'));
    if (e.kind === 'step' && e.data?.state === 'done') {
      const d = gh?.querySelector('.jr-gd');
      if (d) d.textContent = `✓${e.data?.durMs ? ' ' + fmtMs(e.data.durMs) : ''}`;
      gh?.classList.add('done');
      continue;
    }
    gb.appendChild(line(e));
  }
  // long histories: fold everything but the last group, honoring the user's own toggles
  groups.forEach((g, i) => {
    const user = J.userToggled.get(i);
    const open = user != null ? user : i === groups.length - 1;
    g.classList.toggle('closed', !open);
  });
  if (pin) body.scrollTop = body.scrollHeight;
  else if (liveAppend) $('#jrNewer')?.classList.remove('hidden');
}

function line(e) {
  const t = new Date(e.ts).toLocaleTimeString('vi-VN');
  const d = el('div', 'jr-l lg-' + (e.level || 'info'));
  d.appendChild(el('span', 'jr-t', `[${t}]`));
  if (e.scene_idx != null) {
    const chip = el('button', 'jr-chip', tp`Cảnh ${e.scene_idx + 1}`);
    chip.addEventListener('click', () => jumpToScene(e.scene_idx));
    d.appendChild(chip);
  }
  d.appendChild(el('span', 'jr-m', esc(e.msg)));
  return d;
}

function jumpToScene(idx) {
  const sc = (state.scenes || []).find((s) => s.idx === idx);
  const card = sc && document.querySelector(`#sceneGrid .scene[data-id="${sc.id}"]`);
  if (!card) { toast(tp`Cảnh ${idx + 1} chưa hiển thị trong danh sách`, 'error'); return; }
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  card.classList.add('jr-flash');
  setTimeout(() => card.classList.remove('jr-flash'), 1600);
}

/** Live WS row (also fired for replayed buffers — the id dedupe makes that harmless). */
export function onJournalEvent(e) {
  if (!J.projectId || e.projectId !== J.projectId) return;
  if ((e.id || 0) <= J.lastId) return;
  J.lastId = e.id || J.lastId;
  // pinned to "latest" and a NEW run just started → re-sync the run list and follow it
  if (J.run === 'latest' && e.job_id && J.runs[0] && e.job_id !== J.runs[0].id) { reload(); return; }
  if (J.run !== 'latest' && J.run !== 'all' && e.job_id !== J.run) return;
  J.events.push(e);
  if (J.timer) return;
  J.timer = setTimeout(() => { J.timer = null; render(false, true); }, 150);
}

function nearBottom() {
  const b = $('#logBody');
  return !b || b.scrollHeight - b.scrollTop - b.clientHeight < 48;
}

function exportText() {
  return J.events.filter(passes).map((e) => {
    const t = new Date(e.ts).toLocaleString('vi-VN');
    const sc = e.scene_idx != null ? ` [${tp`Cảnh ${e.scene_idx + 1}`}]` : '';
    return `[${t}] [${(e.level || 'info').toUpperCase()}]${sc} ${e.msg}`;
  }).join('\n');
}
