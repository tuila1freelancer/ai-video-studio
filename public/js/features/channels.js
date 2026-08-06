import { $, $$, esc } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { api } from '../api.js';
import { state, channelDefaults } from '../state.js';
import { startNewProject, loadProjects } from '../views/studio.js';
import { applyConfig, gatherConfig, loadBgmOptions, loadChannelPresets } from '../views/config.js';
import { refreshBrandSummary } from './brandkit.js';
import { confirmDialog } from '../ui/dialog.js';

export function initChannels() {
  $('#channelSelect').addEventListener('change', () => switchChannel($('#channelSelect').value));
  $('#btnManageChannels').addEventListener('click', () => { renderChannelList(); $('#channelModal').classList.add('open'); });
  $('#chCreate').addEventListener('click', createChannelUI);
}

export async function loadChannels() {
  const { channels, active } = await api.get('/channels');
  state.channels = channels || []; state.activeChannel = active;
  $('#channelSelect').innerHTML = state.channels
    .map((c) => `<option value="${c.id}"${c.id === active ? ' selected' : ''}>${esc(c.name)}</option>`).join('');
}
export async function switchChannel(id) {
  await api.post(`/channels/${id}/activate`, {});
  state.activeChannel = id;
  startNewProject();
  await Promise.all([loadProjects(), loadBgmOptions()]);
  // Presets FIRST, then apply — the channel's default preset is part of what a new video starts
  // from, and applying before it loaded showed the channel without it. Unconditional, too: a
  // channel with no config of its own must reset the panel to the defaults, not inherit the
  // previous channel's fonts and colours (which the next edit would then save onto it).
  await loadChannelPresets();
  applyConfig(channelDefaults());
  refreshBrandSummary();
  toast(`Đã chuyển sang kênh ${ch ? ch.name : ''} ✓`, 'success');
}
export function renderChannelList() {
  $('#channelList').innerHTML = state.channels.map((c) => `
    <div class="row" style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;margin-bottom:6px;gap:8px">
      <span style="flex:1;min-width:0">
        <strong>${c.id === state.activeChannel ? '✅ ' : ''}${esc(c.name)}</strong>
        <div class="hint" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.root_dir)}</div>
      </span>
      <button class="btn sm" data-open="${c.id}" title="Mở thư mục trong Finder">${icon('folder', 13)}</button>
      <button class="btn sm" data-usecfg="${c.id}" title="Cập nhật config kênh = panel hiện tại">${icon('save', 13)}</button>
      ${c.slug !== 'default' ? `<button class="btn sm danger" data-del="${c.id}">${icon('trash', 13)}</button>` : ''}
    </div>`).join('');
  $$('#channelList [data-open]').forEach((b) => b.addEventListener('click', () => api.post(`/channels/${b.dataset.open}/open`, {})));
  $$('#channelList [data-usecfg]').forEach((b) => b.addEventListener('click', async () => {
    await api.put(`/channels/${b.dataset.usecfg}`, { config: gatherConfig() });
    await loadChannels(); toast('Đã lưu config panel hiện tại vào kênh ✓', 'success');
  }));
  $$('#channelList [data-del]').forEach((b) => b.addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Xoá kênh này?', body: 'Project sẽ chuyển về kênh Default. File trên đĩa GIỮ NGUYÊN.', okText: 'Xoá kênh', danger: true });
    if (!ok) return;
    const r = await api.del(`/channels/${b.dataset.del}`);
    if (r.error) return toast(r.error, 'error');
    await loadChannels(); renderChannelList(); loadProjects();
  }));
}
async function createChannelUI() {
  const name = $('#chName').value.trim();
  if (!name) return toast('Nhập tên kênh.', 'error');
  const config = $('#chCopyConfig').checked ? gatherConfig() : {};
  if ($('#chWatermark').value.trim()) config.watermarkText = $('#chWatermark').value.trim();
  const r = await api.post('/channels', { name, rootDir: $('#chRoot').value.trim() || undefined, config });
  if (r.error) return toast(r.error, 'error');
  $('#chName').value = ''; $('#chRoot').value = ''; $('#chWatermark').value = '';
  await loadChannels(); renderChannelList();
  await switchChannel(r.channel.id);
  toast(`Kênh "${r.channel.name}" đã tạo — thư mục: ${r.channel.root_dir}`, 'success');
}
