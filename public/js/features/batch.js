import { $ } from '../ui/dom.js';
import { closeModal } from '../ui/modals.js';
import { toast } from '../ui/toast.js';
import { api } from '../api.js';
import { gatherConfig } from '../views/config.js';
import { loadProjects } from '../views/studio.js';

export function initBatch() {
  $('#heroBatch').addEventListener('click', () => $('#batchModal').classList.add('open'));
  $('#batchGo').addEventListener('click', runBatch);
}

async function runBatch() {
  const topics = $('#batchTopics').value.split('\n').map((t) => t.trim()).filter((t) => t.length > 3);
  if (!topics.length) { toast('Nhập ít nhất 1 chủ đề.', 'error'); return; }
  const r = await api.post('/batch', { topics, config: gatherConfig() });
  if (r.error) return toast(r.error, 'error');
  closeModal('#batchModal');
  toast(`🚀 Đã xếp hàng ${r.count} video — app tự chạy lần lượt.`, 'success');
  loadProjects();
}
