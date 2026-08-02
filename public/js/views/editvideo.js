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
  // P40 — AI motion graphics onto the owner's own footage. The lane creates a normal project,
  // so once it starts the usual Studio view owns the progress, scenes and final video.
  $('#evEnhance')?.addEventListener('click', async () => {
    if (!state.evPath) return toast('Chọn video trước.', 'error');
    const btn = $('#evEnhance');
    btn.disabled = true;
    $('#evEnhanceOut').innerHTML = '<span class="hint">⏳ Đang bóc lời thoại và dựng cảnh… (mở tab Studio để theo dõi)</span>';
    try {
      const r = await api.post('/edit-video/start', {
        path: state.evPath,
        language: $('#evLang')?.value || 'auto',
        config: {
          sceneDuration: +($('#evSceneDur')?.value || 7),
          enableSubtitles: !!$('#evSubs')?.checked,
          reframePosition: $('#evReframe')?.value || 'center',
          removeSilence: !!$('#evCutSilence')?.checked,
          autoZoom: !!$('#evZoom')?.checked,
        },
      });
      if (r.error) throw new Error(r.error);
      $('#evEnhanceOut').innerHTML = `<span class="hint">✅ Đã tạo dự án <code>${r.projectId}</code> (${r.aspectRatio}) — theo dõi tiến trình ở tab Studio.</span>`;
      toast('Đã bắt đầu dựng đồ hoạ ✓', 'success');
    } catch (e) {
      $('#evEnhanceOut').innerHTML = `<span class="hint" style="color:var(--bad,#f87171)">✖ ${e.message}</span>`;
      toast(e.message, 'error');
    } finally { btn.disabled = false; }
  });
}
