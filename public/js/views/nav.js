import { $, $$ } from '../ui/dom.js';
import { icon, logoSvg } from '../ui/icons.js';
import { openSettings } from '../features/settings.js';

// Views register what should refresh when their page is shown (keeps nav free of view imports).
const pageHooks = {};
export function registerPageHook(page, fn) { pageHooks[page] = fn; }

// Per-item icon + tint — the colorful chip look (Arc/Craft style).
const NAV_STYLE = {
  home: { icn: 'home', tint: '#8b7cff' },
  studio: { icn: 'clapperboard', tint: '#f472b6' },
  library: { icn: 'library', tint: '#fbbf24' },
  brandgen: { icn: 'palette', tint: '#34d399' },
  editvideo: { icn: 'scissors', tint: '#22d3ee' },
  tutorials: { icn: 'book', tint: '#60a5fa' },
};

export function initNav() {
  $$('.nav-item').forEach((b) => {
    const st = NAV_STYLE[b.dataset.page] || { icn: 'film', tint: '#8b7cff' };
    const ic = b.querySelector('.ic');
    if (ic) { ic.innerHTML = icon(st.icn, 15); ic.style.setProperty('--tint', st.tint); }
      b.title = b.textContent.trim(); // still the tooltip once labels drop on a narrow window
    b.addEventListener('click', () => switchPage(b.dataset.page));
  });
  const logo = document.querySelector('.nav-brand .logo');
  if (logo) logo.innerHTML = logoSvg(32);
  const wl = document.querySelector('#welcomeLogo');
  if (wl) wl.innerHTML = logoSvg(84);
  const cl = document.querySelector('#creditLogo');
  if (cl) cl.innerHTML = logoSvg(38);
  $('#navSettings').innerHTML = `${icon('settings', 15)}<span class="nav-label">AI Setting</span>`;
  $('#navSettings').title = 'AI Setting';
  $('#navSettings').addEventListener('click', openSettings);
  const mc = $('#btnManageChannels');
  if (mc) mc.innerHTML = icon('tv', 15);
  wireProjectName();
  // The collapse toggle and its ⌘B went with the rail: a topbar has no width to give back, and
  // the row already sheds its labels by media query when the window gets narrow.
  try { delete localStorage.navCollapsed; } catch { /* ignore */ }
}

/**
 * The open project's name, shown and edited where it is read.
 *
 * The server has always accepted a title change (`updateProject`'s allowed list) — there was
 * simply nowhere in the app to make one, so every project kept whatever it was created with and
 * the library filled up with rows nobody could tell apart.
 */
function wireProjectName() {
  const btn = $('#projName');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const { promptDialog } = await import('../ui/dialog.js');
    const { state } = await import('../state.js');
    const { api } = await import('../api.js');
    const cur = state.current;
    if (!cur) return;
    const name = await promptDialog({ title: 'Đổi tên dự án', label: 'Tên dự án', value: cur.title || '' });
    if (name == null) return;
    const title = String(name).trim();
    if (!title || title === cur.title) return;
    try {
      // `metadata.titleLocked` and not a config key: config feeds the render fingerprints, and a
      // rename must never make a single clip stale. metadata is the blob for exactly this.
      const md = { ...(cur.metadata || {}), titleLocked: true };
      await api.put(`/projects/${cur.id}`, { title, metadata: md });
      cur.title = title; cur.metadata = md;
      setProjectName(title);
      const { toast } = await import('../ui/toast.js');
      toast(`✏️ Đã đổi tên: ${title}`, 'success');
      const st = await import('./studio.js');
      const row = (state.projects || []).find((x) => x.id === cur.id);
      if (row) row.title = title;
      st.renderProjectList();
    } catch (e) {
      const { toast } = await import('../ui/toast.js');
      toast(`✖ Không đổi được tên: ${e.message}`, 'error');
    }
  });
}

/** Show (or hide) the open project's name in the topbar. */
export function setProjectName(title) {
  const btn = $('#projName');
  if (!btn) return;
  const t = String(title || '').trim();
  btn.classList.toggle('hidden', !t);
  const span = $('#projNameText');
  if (span) span.textContent = t;
  btn.title = t ? `${t} — bấm để đổi tên` : '';
}

export function switchPage(p) {
  const apply = () => {
    $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.page === p));
    $$('.page').forEach((s) => s.classList.toggle('active', s.id === 'page-' + p));
    if (pageHooks[p]) pageHooks[p]();
  };
  // View Transitions: skip on reduced motion and on huge scene grids (capture cost)
  const okVt = typeof document.startViewTransition === 'function'
    && !matchMedia('(prefers-reduced-motion: reduce)').matches
    && document.querySelectorAll('#sceneGrid .scene').length < 60;
  if (okVt) document.startViewTransition(apply); else apply();
}

export function renderDeps(d) {
  const map = { ffmpeg: 'ffmpeg', whisper: 'whisper', say: 'TTS', chrome: 'Chrome' };
  $('#depFoot').innerHTML = Object.entries(map)
    .map(([k, label]) => `<span class="dep ${d[k] ? 'ok' : 'no'}">${d[k] ? '●' : '○'} ${label}</span>`).join('');
}
