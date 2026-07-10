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
    b.title = b.textContent.trim(); // tooltip for collapsed rail
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
  // collapse toggle: button + ⌘B, persisted
  const tg = $('#btnNavToggle');
  if (tg) { tg.innerHTML = icon('panelLeft', 15); tg.addEventListener('click', toggleNav); }
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); toggleNav(); }
  });
  try { if (localStorage.navCollapsed === '1') document.querySelector('.app').classList.add('nav-collapsed'); } catch { /* ignore */ }
}

export function toggleNav() {
  const app = document.querySelector('.app');
  const collapsed = app.classList.toggle('nav-collapsed');
  try { localStorage.navCollapsed = collapsed ? '1' : '0'; } catch { /* ignore */ }
  const tg = $('#btnNavToggle');
  if (tg) tg.title = collapsed ? 'Mở rộng sidebar (⌘B)' : 'Thu gọn sidebar (⌘B)';
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
