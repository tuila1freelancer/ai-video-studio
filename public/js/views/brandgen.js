import { $, el, esc } from '../ui/dom.js';
import { toast } from '../ui/toast.js';
import { api, fileUrl } from '../api.js';

export function initBrandGen() {
  $('#bgRef').addEventListener('change', (e) => $('#bgRefName').textContent = e.target.files[0]?.name || 'Chưa chọn');
  $('#bgGo').addEventListener('click', async () => {
    const name = $('#bgName').value.trim(); if (!name) return toast('Nhập tên nhân vật.', 'error');
    toast('Đang tạo brand asset…');
    const fd = new FormData();
    fd.append('charName', name); fd.append('style', $('#bgStyle').value); fd.append('brand', name);
    if ($('#bgRef').files[0]) fd.append('image', $('#bgRef').files[0]);
    const r = await api.upload('/brandgen', fd);
    const grid = $('#bgResults'); grid.innerHTML = '';
    (r.items || []).forEach((it) => { const d = el('div', 'libitem', `<div class="lp"><img src="${fileUrl(it.path)}"></div><div class="ln">${esc(it.name)}</div>`); grid.appendChild(d); });
    toast(r.note || 'Hoàn thành', 'success');
  });
}
