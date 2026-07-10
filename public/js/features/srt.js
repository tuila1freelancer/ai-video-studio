import { $, $$, el, esc } from '../ui/dom.js';
import { closeModal } from '../ui/modals.js';
import { toast } from '../ui/toast.js';
import { api } from '../api.js';
import { state } from '../state.js';
import { renderScenes } from '../views/scenes.js';

export function initSrt() {
  $('#srtSave').addEventListener('click', saveSrt);
}

export function openSrt() {
  if (!state.scenes.length) { toast('Chưa có cảnh nào.', 'error'); return; }
  const box = $('#srtList'); box.innerHTML = '';
  state.scenes.forEach((s) => {
    const d = el('div', 'field');
    d.innerHTML = `<label class="label">Cảnh ${s.idx + 1} · ${(s.duration || 0).toFixed(1)}s</label><textarea class="input" rows="2" data-sid="${s.id}">${esc(s.voice_text || '')}</textarea>`;
    box.appendChild(d);
  });
  $('#srtModal').classList.add('open');
}
async function saveSrt() {
  for (const ta of $$('#srtList textarea')) {
    await api.put('/scenes/' + ta.dataset.sid, { voice_text: ta.value });
  }
  const r = await api.get('/projects/' + state.current.id); state.scenes = r.scenes; renderScenes();
  closeModal('#srtModal');
  toast('Đã lưu. Hãy “Voice đã chọn” + Render để áp dụng.', 'success');
}
