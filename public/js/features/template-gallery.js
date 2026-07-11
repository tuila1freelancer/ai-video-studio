// Template gallery — every scene template as a LIVE self-playing demo (the exact harness
// page the renderer draws, auto-looping). Iframes mount lazily as cards scroll into view,
// so opening the gallery costs one page, not twenty. One click applies the template to the
// scene being edited and refreshes its poster.
import { $, esc } from '../ui/dom.js';
import { api } from '../api.js';
import { toast } from '../ui/toast.js';
import { state } from '../state.js';

let onPicked = null; // set per-open; called with the template id after a successful apply
let observer = null;

export function initTemplateGallery() {
  $('#tgGrid')?.addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-tpl]');
    if (!b) return;
    b.disabled = true; b.textContent = '⏳ Đang áp…';
    try { await onPicked?.(b.dataset.tpl); }
    finally { b.disabled = false; b.textContent = '✓ Dùng template này'; }
  });
  document.addEventListener('click', (e) => {
    if (e.target.closest('#tplGalleryModal [data-close]') || e.target.id === 'tplGalleryModal') {
      $('#tgGrid').innerHTML = ''; // release every live iframe
      observer?.disconnect(); observer = null;
      onPicked = null;
    }
  });
}

/** Open the gallery for one scene. apply(tplId) does the actual PUT + poster refresh. */
export async function openTemplateGallery({ current = null, apply }) {
  onPicked = apply;
  const ar = state.current?.aspect_ratio || '9:16';
  const grid = $('#tgGrid');
  grid.innerHTML = '<div class="hint">⏳ Đang tải danh sách template…</div>';
  $('#tplGalleryModal').classList.add('open');
  let templates = state.templates;
  if (!templates?.length) {
    try { templates = (await api.get('/animation/templates')).templates || []; state.templates = templates; }
    catch (e) { grid.innerHTML = `<div class="hint">✗ ${esc(e.message)}</div>`; return; }
  }
  const [aw, ah] = { '9:16': [9, 16], '16:9': [16, 9], '1:1': [1, 1], '4:5': [4, 5] }[ar] || [9, 16];
  grid.innerHTML = templates.map((t) => `
    <div class="tg-card${t.id === current ? ' sel' : ''}" data-id="${esc(t.id)}">
      <div class="tg-frame" style="aspect-ratio:${aw}/${ah}" data-src="/api/templates/${encodeURIComponent(t.id)}/preview-html?ar=${encodeURIComponent(ar)}"></div>
      <div class="tg-name">${esc(t.name)}${t.id === current ? ' · <b>đang dùng</b>' : ''}</div>
      <div class="hint">${esc(t.desc || '')}</div>
      <button class="btn sm primary" data-tpl="${esc(t.id)}">✓ Dùng template này</button>
    </div>`).join('');
  // live preview: the first rows mount immediately (never trust the viewport math of an
  // embedded/headless context), IntersectionObserver streams in the rest on scroll and
  // frees pages that drift far off-screen
  const mount = (holder) => {
    if (holder.querySelector('iframe')) return;
    const f = document.createElement('iframe');
    f.src = holder.dataset.src;
    f.loading = 'lazy';
    f.style.cssText = 'width:100%;height:100%;border:0;pointer-events:none;display:block';
    holder.appendChild(f);
  };
  const frames = [...grid.querySelectorAll('.tg-frame')];
  frames.slice(0, 6).forEach(mount);
  observer?.disconnect();
  observer = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (en.isIntersecting) mount(en.target);
      else if (Math.abs(en.boundingClientRect.top) > Math.max(innerHeight, 800) * 2) {
        en.target.querySelector('iframe')?.remove(); // far off-screen → free the page
      }
    }
  }, { root: grid, rootMargin: '250px' });
  frames.forEach((n) => observer.observe(n));
}
