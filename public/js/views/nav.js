import { $, $$ } from '../ui/dom.js';
import { icon, logoSvg } from '../ui/icons.js';
import { openSettings } from '../features/settings.js';
import { m, tp } from '../i18n.js';

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
    // `data-tip` feeds the CSS tooltip that replaces the label on a narrow window; `title` stays
    // as the accessible fallback (and is what a screen reader reads).
    // Both copies carry the label's own key: initNav() runs before initI18n(), and applyDom()
    // repaints only the .nav-label text node — the tooltips would keep their Vietnamese.
    const name = b.textContent.trim();
    b.title = name;
    b.dataset.tip = name;
    const key = b.querySelector('.nav-label')?.dataset.i18n;
    if (key) { b.dataset.i18nTitle = key; b.dataset.i18nDataTip = key; }
    b.addEventListener('click', () => switchPage(b.dataset.page));
  });
  const logo = document.querySelector('.nav-brand .logo');
  if (logo) logo.innerHTML = logoSvg(32);
  const wl = document.querySelector('#welcomeLogo');
  if (wl) wl.innerHTML = logoSvg(84);
  const cl = document.querySelector('#creditLogo');
  if (cl) cl.innerHTML = logoSvg(38);
  // Same load-order trap: m() here resolves against an empty dictionary, applyDom() fills it.
  const setKey = 'ui.msg.AI Setting';
  $('#navSettings').innerHTML = `${icon('settings', 15)}<span class="nav-label" data-i18n="${setKey}">${m('AI Setting')}</span>`;
  $('#navSettings').title = m('AI Setting');
  $('#navSettings').dataset.i18nTitle = setKey;
  $('#navSettings').addEventListener('click', openSettings);
  $('#depWarn')?.addEventListener('click', openSettings);
  const mc = $('#btnManageChannels');
  if (mc) mc.innerHTML = icon('tv', 15);
  // The collapse toggle and its ⌘B went with the rail: a topbar has no width to give back, and
  // the row already sheds its labels by media query when the window gets narrow.
  try { delete localStorage.navCollapsed; } catch { /* ignore */ }
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
  // A second switch while one animates aborts the first; the DOM is already right, so the
  // rejected transition promises are noise, not a failure.
  if (okVt) {
    const t = document.startViewTransition(apply);
    for (const p of [t.ready, t.updateCallbackDone, t.finished]) p?.catch(() => {});
  } else apply();
}

/**
 * Tool status: the detail in AI Setting, and nothing in the topbar unless something is wrong.
 *
 * Four permanent green dots told the owner what they already knew every second of every day, and
 * the row is the scarcest space in the app. Deleting them outright would have been worse though —
 * a missing Chrome makes every thumbnail and every caption measurement fail, and the only clue
 * would have been the failure itself. So silence is the normal state and a real gap still shouts.
 */
export function renderDeps(d) {
  const map = { ffmpeg: 'ffmpeg', whisper: 'whisper', say: 'TTS', chrome: 'Chrome' };
  const rows = Object.entries(map);
  const foot = $('#depFoot');
  if (foot) {
    foot.innerHTML = rows
      .map(([k, label]) => `<span class="dep ${d[k] ? 'ok' : 'no'}">${d[k] ? '●' : '○'} ${label}</span>`).join('');
  }
  const missing = rows.filter(([k]) => !d[k]).map(([, label]) => label);
  const warn = $('#depWarn');
  if (!warn) return;
  warn.classList.toggle('hidden', !missing.length);
  warn.textContent = missing.length ? tp`⚠ Thiếu ${missing.join(', ')}` : '';
  warn.title = missing.length ? tp`Thiếu công cụ: ${missing.join(', ')} — bấm để mở AI Setting` : '';
}
