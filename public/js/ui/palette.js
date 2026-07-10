// ⌘K command palette: navigate, create, open modals, jump to recent projects, apply presets.
import { $, el, esc } from './dom.js';
import { icon } from './icons.js';
import { state } from '../state.js';
import { switchPage, toggleNav } from '../views/nav.js';
import { openProject } from '../views/studio.js';
import { applyConfig, updateCfgChips } from '../views/config.js';
import { openSettings } from '../features/settings.js';
import { openVoicePicker } from '../features/voicepicker.js';
import { openBrandEditor } from '../features/brandkit.js';
import { renderChannelList } from '../features/channels.js';
import { toast } from './toast.js';

let bg = null, listEl = null, inputEl = null, items = [], sel = 0;

export function initPalette() {
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); togglePalette(); }
    else if (e.key === 'Escape' && bg) closePalette();
  });
}

function commands() {
  const cmds = [
    { icn: 'wand', label: 'Tạo video mới', hint: 'nhập chủ đề ở Trang chủ', run: () => { switchPage('home'); $('#heroTopic').focus(); } },
    { icn: 'home', label: 'Trang chủ', run: () => switchPage('home') },
    { icn: 'clapperboard', label: 'Tạo Video (Studio)', run: () => switchPage('studio') },
    { icn: 'library', label: 'Thư viện', run: () => switchPage('library') },
    { icn: 'palette', label: 'Brand Asset', run: () => switchPage('brandgen') },
    { icn: 'scissors', label: 'Edit Video', run: () => switchPage('editvideo') },
    { icn: 'book', label: 'Hướng dẫn', run: () => switchPage('tutorials') },
    { icn: 'panelLeft', label: 'Thu gọn / mở rộng sidebar', hint: '⌘B', run: toggleNav },
    { icn: 'settings', label: 'AI Setting', run: openSettings },
    { icn: 'mic', label: 'Chọn giọng đọc', run: openVoicePicker },
    { icn: 'tv', label: 'Quản lý kênh', run: () => { renderChannelList(); $('#channelModal').classList.add('open'); } },
    { icn: 'star', label: 'Brand Kit của kênh', run: openBrandEditor },
  ];
  (state.presets || []).forEach((p) => cmds.push({
    icn: 'save', label: `Áp preset: ${p.name}`, hint: 'config panel',
    run: () => { applyConfig(p.config || {}); updateCfgChips(); switchPage('studio'); toast(`Đã áp preset "${p.name}"`, 'success'); },
  }));
  (state.projects || []).slice(0, 8).forEach((p) => cmds.push({
    icn: 'film', label: p.title, hint: 'dự án gần đây',
    run: () => openProject(p.id),
  }));
  return cmds;
}

function togglePalette() { bg ? closePalette() : openPalette(); }

function openPalette() {
  bg = el('div', 'palette-bg');
  bg.innerHTML = `<div class="palette">
    <div class="pal-input">${icon('search', 16)}<input type="text" placeholder="Gõ lệnh, tên trang, dự án…" spellcheck="false"><kbd>esc</kbd></div>
    <div class="pal-list"></div>
  </div>`;
  document.body.appendChild(bg);
  listEl = bg.querySelector('.pal-list');
  inputEl = bg.querySelector('input');
  bg.addEventListener('click', (e) => { if (e.target === bg) closePalette(); });
  inputEl.addEventListener('input', () => renderList(inputEl.value));
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); runSel(); }
  });
  listEl.addEventListener('click', (e) => {
    const it = e.target.closest('.pal-item'); if (!it) return;
    sel = +it.dataset.i; runSel();
  });
  renderList('');
  inputEl.focus();
}

export function closePalette() {
  if (!bg) return;
  bg.classList.add('closing');
  const b = bg; bg = null;
  setTimeout(() => b.remove(), 150);
}

function fuzzy(q, s) {
  // subsequence match, diacritic-insensitive
  const norm = (x) => x.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  q = norm(q); s = norm(s);
  let i = 0;
  for (const ch of s) { if (ch === q[i]) i++; if (i === q.length) return true; }
  return q.length === 0;
}

function renderList(q) {
  items = commands().filter((c) => fuzzy(q, c.label));
  sel = 0;
  listEl.innerHTML = items.length
    ? items.map((c, i) => `<button class="pal-item${i === sel ? ' sel' : ''}" data-i="${i}">${icon(c.icn, 15)}<span>${esc(c.label)}</span>${c.hint ? `<small>${esc(c.hint)}</small>` : ''}</button>`).join('')
    : '<div class="pal-empty">Không tìm thấy lệnh nào.</div>';
}

function move(d) {
  if (!items.length) return;
  sel = (sel + d + items.length) % items.length;
  listEl.querySelectorAll('.pal-item').forEach((n, i) => n.classList.toggle('sel', i === sel));
  listEl.querySelector('.pal-item.sel')?.scrollIntoView({ block: 'nearest' });
}

function runSel() {
  const c = items[sel]; if (!c) return;
  closePalette();
  c.run();
}
