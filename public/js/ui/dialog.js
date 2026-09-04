// Promise-based dialogs replacing native confirm()/prompt(): glass surface, Esc/backdrop
// close, focus management, spring in/out (uses .modal-bg/.modal/.dlg styles in app.css).
import { el, esc } from './dom.js';
import { t, m } from '../i18n.js';

/** Translate a dialog's own words, keyed by their Vietnamese text — same trick as toast(). */
const tr = (v) => (typeof v === 'string' && v ? t(`ui.msg.${v}`, null, v) : v);

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

export function confirmDialog({ title, body = '', okText = m('Xác nhận'), cancelText = m('Huỷ'), danger = false }) {
  return openDialog(`
    <div class="dlg-title">${esc(tr(title))}</div>
    ${body ? `<div class="dlg-body">${esc(tr(body))}</div>` : ''}
    <div class="dlg-actions">
      <button class="btn" data-a="cancel">${esc(tr(cancelText))}</button>
      <button class="btn ${danger ? 'danger' : 'primary'}" data-a="ok">${esc(tr(okText))}</button>
    </div>`, {
    onReady(dlg, close) {
      dlg.querySelector('[data-a=cancel]').addEventListener('click', () => close(false));
      dlg.querySelector('[data-a=ok]').addEventListener('click', () => close(true));
      dlg.querySelector('[data-a=ok]').focus();
    },
  }).then((v) => !!v);
}

export function promptDialog({ title, label = '', value = '', placeholder = '', okText = m('Lưu'), cancelText = m('Huỷ') }) {
  return openDialog(`
    <div class="dlg-title">${esc(tr(title))}</div>
    <div class="field" style="margin-bottom:16px">
      ${label ? `<label class="label">${esc(tr(label))}</label>` : ''}
      <input class="input" data-a="val" value="${esc(value)}" placeholder="${esc(tr(placeholder))}">
    </div>
    <div class="dlg-actions">
      <button class="btn" data-a="cancel">${esc(tr(cancelText))}</button>
      <button class="btn primary" data-a="ok">${esc(tr(okText))}</button>
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
    <div class="dlg-title">${esc(tr(title))}</div>
    <div class="dlg-menu">
      ${items.map((it) => `<button data-mi="${esc(it.id)}" class="${it.danger ? 'danger' : ''}">${it.icon || ''}<span>${esc(tr(it.label))}</span></button>`).join('')}
    </div>
    <div class="dlg-actions"><button class="btn" data-a="cancel">${esc(m('Đóng'))}</button></div>`, {
    onReady(dlg, close) {
      dlg.querySelectorAll('[data-mi]').forEach((b) => b.addEventListener('click', () => close(b.dataset.mi)));
      dlg.querySelector('[data-a=cancel]').addEventListener('click', () => close(null));
      dlg.querySelector('[data-mi]')?.focus();
    },
  });
}

/**
 * Publish composer (P43): the reference app lets the owner see and EDIT the exact post text and
 * title before anything goes out, and pick when it goes live. A menu of privacy levels does not
 * cover that — you cannot fix a typo in a caption you never saw.
 * @returns {Promise<{caption,title,when}|null>} `when` is unix SECONDS, or null for "now".
 */
export function publishDialog({ title = m('Đăng video'), platform = 'facebook', caption = '', postTitle = '', canSchedule = true }) {
  const QUICK = [
    { id: '', label: m('Đăng ngay') },
    { id: '1h', label: m('+1 giờ') },
    { id: '3h', label: m('+3 giờ') },
    { id: 'tonight', label: m('Tối nay 20h') },
    { id: 'tmr9', label: m('Mai 9h') },
    { id: 'tmr20', label: m('Mai 20h') },
  ];
  return openDialog(`
    <h3>${esc(tr(title))}</h3>
    <label class="label">${esc(m('Nội dung bài đăng (hỗ trợ #hashtag)'))}</label>
    <textarea class="input" id="dlgCaption" rows="6">${esc(caption)}</textarea>
    <label class="label" style="margin-top:8px">${esc(m('Tiêu đề (tuỳ chọn)'))}</label>
    <input class="input" id="dlgTitle" value="${esc(postTitle)}">
    ${canSchedule ? `<label class="label" style="margin-top:10px">${esc(m('Thời điểm đăng'))}</label>
    <div class="row" id="dlgWhen" style="flex-wrap:wrap;gap:6px">${
      QUICK.map((q, i) => `<button class="gtab${i === 0 ? ' active' : ''}" data-w="${q.id}">${esc(q.label)}</button>`).join('')
    }</div>
    <input class="input" id="dlgWhenAt" type="datetime-local" style="margin-top:6px">` : ''}
    <div class="row" style="justify-content:flex-end;gap:8px;margin-top:14px">
      <button class="btn" data-x>${esc(m('Huỷ'))}</button><button class="btn primary" data-ok>${esc(m('Đăng'))}</button>
    </div>`, {
    onReady(dlg, close) {
      let quick = '';
      dlg.querySelectorAll('#dlgWhen .gtab').forEach((b) => b.addEventListener('click', () => {
        dlg.querySelectorAll('#dlgWhen .gtab').forEach((x) => x.classList.remove('active'));
        b.classList.add('active'); quick = b.dataset.w; dlg.querySelector('#dlgWhenAt').value = '';
      }));
      dlg.querySelector('[data-x]').addEventListener('click', () => close(null));
      dlg.querySelector('[data-ok]').addEventListener('click', () => {
        const at = dlg.querySelector('#dlgWhenAt')?.value;
        close({
          caption: dlg.querySelector('#dlgCaption').value.trim(),
          title: dlg.querySelector('#dlgTitle').value.trim(),
          when: at ? Math.floor(new Date(at).getTime() / 1000) : quickToUnix(quick),
        });
      });
      dlg.querySelector('#dlgCaption')?.focus();
    },
  });
}

/** Turn a quick-pick into unix seconds. null = publish now. */
export function quickToUnix(id, now = new Date()) {
  const at = (d, h) => { const x = new Date(now); x.setDate(x.getDate() + d); x.setHours(h, 0, 0, 0); return Math.floor(x.getTime() / 1000); };
  if (id === '1h') return Math.floor(now.getTime() / 1000) + 3600;
  if (id === '3h') return Math.floor(now.getTime() / 1000) + 3 * 3600;
  if (id === 'tonight') { const t = at(0, 20); return t > Math.floor(now.getTime() / 1000) ? t : at(1, 20); }
  if (id === 'tmr9') return at(1, 9);
  if (id === 'tmr20') return at(1, 20);
  return null;
}
