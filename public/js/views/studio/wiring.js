// initStudio(): every button and label of the studio page, wired once.
import { $, $$ } from '../../ui/dom.js';
import { toast } from '../../ui/toast.js';
import { api, withLock } from '../../api.js';
import { state } from '../../state.js';
import { selectedIds, updateSelCount, regenScene, renderScenes2 } from '../scenes.js';
import { icon } from '../../ui/icons.js';
import { openChangePlan } from '../../features/changeplan.js';
import { initPendingChanges } from '../../features/pending-changes.js';
import { confirmDialog } from '../../ui/dialog.js';
import { t, m, tp, setLabel } from '../../i18n.js';
import { loadProjects, mb } from './projects.js';
import { repurposeCurrent, dubCurrent, exportCurrent, publishCurrent, restartCurrent, copyAssetsFrom, genMeta } from './actions.js';
import { startNewProject, createAndStart, repairTypeset } from './project-view.js';
import { detectType, setSourceDoc, fetchLink, imageSearch, initImageViewer, uploadAssets } from './source.js';

export function initStudio() {
  // SVG icon labels (markup keeps plain text for graceful no-JS degradation)
  setLabel('#btnFetch', icon('link', 13));
  setLabel('#btnImgSearch', icon('image', 13));
  setLabel('#btnStart', icon('play', 15));
  setLabel('#btnRender', icon('refresh', 14));
  setLabel('#btnStop', icon('stop', 14));
  setLabel('#btnResume', icon('play', 14));
  setLabel('#btnSrt', icon('subtitles', 14));
  setLabel('#btnMeta', icon('gauge', 14));
  setLabel('#btnRegenVoiceSel', icon('mic', 13));
  setLabel('#btnRegenHtmlSel', icon('refresh', 13));
  setLabel('#btnRenderSel', icon('film', 13));
  setLabel('#btnRenderAll', icon('check', 13));
  setLabel('#btnDownload', icon('download', 14));
  setLabel('#btnDownloadSrt', icon('subtitles', 14));
  setLabel('#btnOpenFolder', icon('folder', 14));
  // fullscreen for the finished video (native controls also offer it; this is the explicit button)
  $('#btnFinalFs')?.addEventListener('click', () => {
    const v = $('#finalVideo'); if (!v) return;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else if (v.requestFullscreen) v.requestFullscreen();
    else if (v.webkitEnterFullscreen) v.webkitEnterFullscreen(); // Safari <video> fallback
  });
  const lt = $('#logToggle');
  if (lt?.firstElementChild) setLabel(lt.firstElementChild, icon('book', 13), 'Nhật ký xử lý');
  $('#topic').addEventListener('input', detectType);
  $('#btnStart').addEventListener('click', () => withLock($('#btnStart'), createAndStart));
  $('#btnDelAll').addEventListener('click', async () => {
    // Same rule as the single delete: the files go too, so say so before anything is pressed.
    const ok = await confirmDialog({
      title: 'Xoá tất cả dự án?',
      body: tp`Toàn bộ ${state.projects.length} dự án của kênh này sẽ bị xoá — kèm TOÀN BỘ file trên ổ đĩa (kịch bản, giọng đọc, clip từng cảnh, video hoàn chỉnh, ảnh bìa).`
        + '\n\n' + m('Không khôi phục được.'),
      okText: 'Xoá tất cả vĩnh viễn', cancelText: 'Giữ lại', danger: true,
    });
    if (ok) {
      const r = await api.del('/projects');
      toast(tp`🗑 Đã xoá ${r.files || 0} file (${mb(r.bytes || 0)})`, 'success');
      startNewProject(); loadProjects();
    }
  });
  $('#btnStop').addEventListener('click', () => api.post(`/projects/${state.current.id}/stop`, {}));
  // On a finished video the button means "apply my edits", which is a different question: show
  // what the change costs BEFORE spending it. Anywhere else it is the plain resume it always was.
  $('#btnResume').addEventListener('click', () => (state.current?.status === 'done'
    ? openChangePlan()
    : api.post(`/projects/${state.current.id}/resume`, {})));
  $('#btnApproveScenes')?.addEventListener('click', () => withLock($('#btnApproveScenes'), async () => {
    try {
      const r = await api.post(`/projects/${state.current.id}/approve-scenes`, {});
      if (r?.error) { toast(r.error, 'error'); return; }
      $('#sceneGateBar').classList.add('hidden');
      toast('🎙 Đã duyệt cảnh — bắt đầu lồng tiếng + render', 'success');
    } catch (e) { toast(tp`Không duyệt được: ${e?.message || e}`, 'error'); }
  }));
  $('#btnRender').addEventListener('click', () => withLock($('#btnRender'), () => renderScenes2('all')));
  $('#btnTypeset').addEventListener('click', () => withLock($('#btnTypeset'), repairTypeset));
  $('#btnRenderAll').addEventListener('click', () => withLock($('#btnRenderAll'), () => renderScenes2('all')));
  $('#btnRenderSel').addEventListener('click', () => withLock($('#btnRenderSel'), () => renderScenes2('scenes', selectedIds())));
  $('#btnRegenVoiceSel').addEventListener('click', () => selectedIds().forEach((id) => regenScene(id, 'voice')));
  $('#btnRegenHtmlSel').addEventListener('click', () => selectedIds().forEach((id) => regenScene(id, 'html')));
  // canonical scenes JSON (factory format) — download / clipboard, rebuilt from the DB rows
  $('#btnScenesJson')?.addEventListener('click', () => {
    if (!state.current) return;
    window.open(`/api/projects/${state.current.id}/scenes-json?download=1`, '_blank');
  });
  $('#btnScenesJsonCopy')?.addEventListener('click', async () => {
    if (!state.current) return;
    try {
      const r = await api.get(`/projects/${state.current.id}/scenes-json`);
      if (r?.error) return toast(r.error, 'error');
      await navigator.clipboard.writeText(JSON.stringify(r, null, 2));
      toast(tp`Đã copy scenes JSON (${r.scenes?.length || 0} cảnh) ✓`, 'success');
    } catch (e) { toast(tp`Không copy được: ${e?.message || e}`, 'error'); }
  });
  $('#checkAll').addEventListener('change', (e) => { $$('#sceneGrid .scene').forEach((c) => { c.classList.toggle('sel', e.target.checked); c.querySelector('.chk').checked = e.target.checked; }); updateSelCount(); });
  $('#btnSrt').addEventListener('click', () => import('../../features/srt.js').then((m) => m.openSrt()));
  $('#btnRepurpose').addEventListener('click', () => withLock($('#btnRepurpose'), repurposeCurrent));
  $('#btnDub')?.addEventListener('click', () => withLock($('#btnDub'), dubCurrent));
  $('#btnExport')?.addEventListener('click', () => withLock($('#btnExport'), exportCurrent));
  $('#btnPublish')?.addEventListener('click', () => withLock($('#btnPublish'), publishCurrent));
  // P40: the toolbar button existed but had no handler — reveal the finished file in Finder.
  $('#btnOpenFolder')?.addEventListener('click', async () => {
    if (!state.current) return toast('Chưa mở dự án nào.', 'error');
    const r = await api.post(`/projects/${state.current.id}/open`, {});
    if (r?.error) toast(r.error, 'error');
  });
  // P42: restart the whole video, and borrow another project's assets
  $('#btnRestart')?.addEventListener('click', () => withLock($('#btnRestart'), restartCurrent));
  $('#btnCopyAssets')?.addEventListener('click', () => withLock($('#btnCopyAssets'), copyAssetsFrom));
  $('#btnMeta').addEventListener('click', genMeta);
  $('#btnFetch').addEventListener('click', fetchLink);
  $('#btnImgSearch').addEventListener('click', imageSearch);
  $('#assetInput').addEventListener('change', uploadAssets);
  initPendingChanges();
  // the fetched article: show it, edit it, drop it
  $('#srcToggle')?.addEventListener('click', () => {
    const box = $('#srcText');
    box.classList.toggle('hidden');
    // 'Xem' carries no diacritic, so no m() msgid for it can ever reach the catalogue — the
    // button's own data-i18n key can.
    $('#srcToggle').textContent = box.classList.contains('hidden') ? t('ui.srcDoc.xem', null, 'Xem') : m('Ẩn');
  });
  $('#srcClear')?.addEventListener('click', () => setSourceDoc(null));
  // An edit is the owner's decision about what the video is written from, so it has to be what
  // the pipeline receives — not a display copy of something the server will re-fetch anyway.
  $('#srcText')?.addEventListener('input', () => {
    if (state.sourceDoc) state.sourceDoc.text = $('#srcText').value;
  });
  initImageViewer();
}
