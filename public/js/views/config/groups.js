// Config groups: summary cards, the shared edit modal that borrows a group's live body, and the chip summaries.
import { $, $$, fmtDur } from '../../ui/dom.js';
import { state, activeChannelBrand } from '../../state.js';
import { m, tp } from '../../i18n.js';
import { loadPickerFonts } from './fonts.js';
import { RES_LABEL } from './subtitle-studio.js';
import { syncFramePreviewAvailability } from './frame-preview.js';
import { hfCurrentStyle } from './hf-style.js';
import { subPresetName } from './presets.js';
import { rafThrottle } from '../../ui/timing.js';

// ================= config groups: summary cards + edit modal =================
// Each .cfg-group is a read-only summary card; clicking it MOVES the group's live
// .cfg-body node into #cfgModal (ids + listeners travel with the node — never clone),
// and moves it back after the close animation.
// Resolved per call, never at import: the catalogue is fetched after this module is evaluated.
const grpTitle = (id) => ({
  grpFormat: m('Định dạng & chất lượng'), grpBrand: m('Thương hiệu kênh'), grpSubtitle: m('Phụ đề'),
  grpAudio: m('Giọng đọc & nhạc'), grpAdvanced: m('Nâng cao'),
}[id] || m('Cấu hình'));
function restoreParkedBody() {
  const slot = $('#cfgModalBody');
  const body = slot?.querySelector('.cfg-body');
  if (slot?.dataset.owner && body) document.getElementById(slot.dataset.owner)?.appendChild(body);
  if (slot) slot.dataset.owner = '';
}
function openCfgGroupModal(group) {
  restoreParkedBody(); // a previous group may still be parked (fast re-open)
  const slot = $('#cfgModalBody');
  const body = group.querySelector('.cfg-body');
  if (!slot || !body) return;
  slot.dataset.owner = group.id;
  slot.appendChild(body);
  $('#cfgModalTitle').textContent = grpTitle(group.id);
  // All five groups share this one shell, so the extra width has to be put on and taken off with
  // the body rather than living on .cfgm — the other four are single columns and would look lost.
  $('#cfgModal').querySelector('.modal')?.classList.toggle('sub-wide', group.id === 'grpSubtitle');
  if (group.id === 'grpSubtitle') loadPickerFonts();
  $('#cfgModal').classList.add('open');
  // the real-frame preview only means anything once there IS a frame
  if (group.id === 'grpSubtitle') syncFramePreviewAvailability();
}
export function wireConfigGroups() {
  try { localStorage.removeItem('cfgGroups'); } catch { /* accordion-era key */ }
  $$('.cfg-group .cfg-head').forEach((head) => {
    head.addEventListener('click', () => openCfgGroupModal(head.parentElement));
  });
  // restore the body AFTER the 170ms close animation (modal must not empty mid-animation)
  $('#cfgModal').addEventListener('click', (e) => {
    if (e.target.closest('[data-close]') || e.target.id === 'cfgModal') {
      setTimeout(() => { restoreParkedBody(); updateCfgChips(); }, 190);
    }
  });
  // any edit inside the modal refreshes the summary cards live
  $('#cfgModal').addEventListener('change', updateCfgChips);
  // ~25 reads and 5 writes behind the modal's backdrop blur — once per frame during a drag, not per tick
  $('#cfgModal').addEventListener('input', rafThrottle(updateCfgChips));
  const vb = $('#btnCfgVoice');
  if (vb) vb.addEventListener('click', () => import('../../features/voicepicker.js').then((m) => m.openVoicePicker()));
  updateCfgChips();
}
// Current-value summary rendered on each card (data-chip hooks are load-bearing:
// called from palette / brandkit / preset-select / modal edits).
export function updateCfgChips() {
  const set = (k, v) => { const n = document.querySelector(`.cfg-chip[data-chip="${k}"]`); if (n) n.textContent = v; };
  const selText = (id) => { const s = $(id); return s?.selectedOptions?.[0]?.textContent.trim() || ''; };
  const mode = 'HyperFrame ✨';
  const theme = ` · ${hfCurrentStyle().name || 'Chrome Kinetic'}`;
  const res = RES_LABEL[$('#cfgRes').value] || '1080p';
  const durTxt = $('#cfgDurMode')?.value === 'auto' ? m('🪄 tự động') : fmtDur(+$('#cfgVd').value);
  set('format', tp`${mode}${theme} — ${$('#cfgAr').value} · ${$('#cfgFps').value}fps · ${res} · ${durTxt} · cảnh ${$('#cfgSd').value}s`);
  const bk = activeChannelBrand();
  set('brand', bk
    ? `${bk.channelName || m('Brand kit (chỉ logo)')}${bk.finalOverlay?.enabled && bk.logo ? m(' · đóng dấu logo') : ''}${bk.watermark?.enabled ? m(' · watermark trôi') : ''}${bk.nameBadge?.enabled !== false && bk.channelName ? m(' · tên kênh') : ''}`
    : ($('#cfgWatermark').value.trim() ? tp`Watermark: ${$('#cfgWatermark').value.trim()}` : m('Chưa cấu hình — bấm để thiết lập')));
  const sp = state.subPresets.find((p) => p.id === state.subPreset);
  const pos = { bot: m('dưới'), mid: m('giữa'), top: m('trên') }[$('#cfgSubPos').value] || m('dưới');
  const subMode = $('#cfgSubMode')?.value === 'plain' ? m('thường') : 'karaoke';
  const subChunk = $('#cfgSubChunk')?.value === 'sentence' ? m(' · theo câu')
    : $('#cfgSubChunk')?.value === 'words' ? tp` · ${$('#cfgSubWords')?.value || 4} từ/dòng` : '';
  // lifted out of the tagged template: a regex literal inside tp`…` derails msgid extraction
  const subFont = $('#cfgSubFont').value.split(',')[0].replace(/['"]/g, '');
  set('subtitle', $('#cfgSub').checked
    ? tp`${sp ? subPresetName(sp) : m('Tuỳ chỉnh')} · ${subMode}${subChunk} · ${subFont} · cỡ ${$('#cfgSubSize').value} · vị trí ${pos}`
    : m('Tắt phụ đề'));
  const lv = state.settings?.tts?.langVoices?.vi;
  const voice = lv ? `${lv.voice} (${lv.provider})` : (state.settings?.tts?.provider ? `provider ${state.settings.tts.provider}` : m('tự chọn'));
  const bgm = $('#cfgBgm').value ? tp`BGM: ${selText('#cfgBgm')}` : ($('#cfgBgmAuto').checked ? m('BGM tự động') : m('không BGM'));
  set('audio', tp`Giọng: ${voice} · ${bgm}`);
  const flags = [
    $('#cfgSceneGate')?.checked && m('Duyệt cảnh trước 🎬'), $('#cfgReview')?.checked && m('Duyệt trước ghép'),
    $('#cfgTrans').checked && 'Xfade',
    $('#cfgMeta').checked && 'Metadata', $('#cfgPTts').checked && `TTS ×${$('#cfgTtsC').value}`, $('#cfgPRender').checked && `Render ×${$('#cfgRenderC').value}`,
  ].filter(Boolean).join(' · ');
  set('advanced', flags || m('Mặc định'));
}
