// Promise-based dialogs replacing native confirm()/prompt(): glass surface, Esc/backdrop
// close, focus management, spring in/out (uses .modal-bg/.modal/.dlg styles in app.css).
import { el, esc } from './dom.js';

export function openDialog(innerHtml, { onReady } = {}) {
  return new Promise((resolve) => {
    const bg = el('div', 'modal-bg open');
    bg.innerHTML = `<div class="modal dlg" role="dialog" aria-modal="true">${innerHtml}</div>`;
    document.body.appendChild(bg);
    const dlg = bg.firstElementChild;
    const prevFocus = document.activeElement;

    let done = false;
    const close = (value) => {
      if (done) return; done = true;
      bg.classList.add('closing');
      setTimeout(() => { bg.remove(); prevFocus?.focus?.(); }, 170);
      document.removeEventListener('keydown', onKey, true);
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(null); }
      else if (e.key === 'Tab') {
        // minimal focus trap
        const f = [...dlg.querySelectorAll('button,input,textarea,select,[tabindex]')].filter((n) => !n.disabled);
        if (!f.length) return;
        const i = f.indexOf(document.activeElement);
        if (e.shiftKey && (i <= 0)) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
      }
    };
    document.addEventListener('keydown', onKey, true);
    bg.addEventListener('click', (e) => { if (e.target === bg) close(null); });
    onReady?.(dlg, close);
  });
}

export function confirmDialog({ title, body = '', okText = 'Xác nhận', cancelText = 'Huỷ', danger = false }) {
  return openDialog(`
    <div class="dlg-title">${esc(title)}</div>
    ${body ? `<div class="dlg-body">${esc(body)}</div>` : ''}
    <div class="dlg-actions">
      <button class="btn" data-a="cancel">${esc(cancelText)}</button>
      <button class="btn ${danger ? 'danger' : 'primary'}" data-a="ok">${esc(okText)}</button>
    </div>`, {
    onReady(dlg, close) {
      dlg.querySelector('[data-a=cancel]').addEventListener('click', () => close(false));
      dlg.querySelector('[data-a=ok]').addEventListener('click', () => close(true));
      dlg.querySelector('[data-a=ok]').focus();
    },
  }).then((v) => !!v);
}

export function promptDialog({ title, label = '', value = '', placeholder = '', okText = 'Lưu', cancelText = 'Huỷ' }) {
  return openDialog(`
    <div class="dlg-title">${esc(title)}</div>
    <div class="field" style="margin-bottom:16px">
      ${label ? `<label class="label">${esc(label)}</label>` : ''}
      <input class="input" data-a="val" value="${esc(value)}" placeholder="${esc(placeholder)}">
    </div>
    <div class="dlg-actions">
      <button class="btn" data-a="cancel">${esc(cancelText)}</button>
      <button class="btn primary" data-a="ok">${esc(okText)}</button>
    </div>`, {
    onReady(dlg, close) {
      const input = dlg.querySelector('[data-a=val]');
      const ok = () => close(input.value.trim() || null);
      dlg.querySelector('[data-a=cancel]').addEventListener('click', () => close(null));
      dlg.querySelector('[data-a=ok]').addEventListener('click', ok);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
      input.focus(); input.select();
    },
  });
}

// items: [{ id, label, icon?, danger? }] → resolves the chosen id (null on dismiss)
export function menuDialog({ title, items }) {
  return openDialog(`
    <div class="dlg-title">${esc(title)}</div>
    <div class="dlg-menu">
      ${items.map((it) => `<button data-mi="${esc(it.id)}" class="${it.danger ? 'danger' : ''}">${it.icon || ''}<span>${esc(it.label)}</span></button>`).join('')}
    </div>
    <div class="dlg-actions"><button class="btn" data-a="cancel">Đóng</button></div>`, {
    onReady(dlg, close) {
      dlg.querySelectorAll('[data-mi]').forEach((b) => b.addEventListener('click', () => close(b.dataset.mi)));
      dlg.querySelector('[data-a=cancel]').addEventListener('click', () => close(null));
      dlg.querySelector('[data-mi]')?.focus();
    },
  });
}
