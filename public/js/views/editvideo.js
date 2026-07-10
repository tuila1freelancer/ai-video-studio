import { $ } from '../ui/dom.js';
import { toast } from '../ui/toast.js';
import { api, fileUrl } from '../api.js';
import { state } from '../state.js';

export function initEditVideo() {
  $('#evFile').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    $('#evName').textContent = f.name;
    const fd = new FormData(); fd.append('files', f);
    const r = await api.upload('/upload', fd);
    state.evPath = r.files[0].path;
    const v = $('#evPreview'); v.src = fileUrl(state.evPath); v.classList.remove('hidden');
  });
  $('#evCut').addEventListener('click', async () => {
    if (!state.evPath) return toast('Chọn video trước.', 'error');
    toast('Đang cắt…');
    const r = await api.post('/edit-cut', { path: state.evPath, start: +$('#evStart').value, end: +$('#evEnd').value });
    if (r.error) return toast(r.error, 'error');
    $('#evOut').innerHTML = `<video controls src="${fileUrl(r.path)}" style="max-width:340px;border-radius:8px;background:#000"></video><br><a class="btn success" download href="${fileUrl(r.path)}" style="margin-top:8px">⬇ Tải</a>`;
    toast('Đã cắt ✓', 'success');
  });
}
