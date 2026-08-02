import { $, $$, el, esc, badgeText, statusIcon } from '../ui/dom.js';
import { toast } from '../ui/toast.js';
import { api, fileUrl, withLock, WS } from '../api.js';
import { state } from '../state.js';
import { PIPE, PHASE_W, PHASE_ORDER, prog, resetProgress, setProgress, recomputeProgress, setStep, showOp, hideOp } from './progress.js';
import { loadJournal, clearJournal, onJournalEvent } from '../features/journal.js';
import { refreshTasks } from '../features/tasks.js';
import { renderScenes, refreshScenes, onSceneUpdate, flushSceneUpdates, selectedIds, updateSelCount, regenScene, renderScenes2 } from './scenes.js';
import { icon } from '../ui/icons.js';
import { renderGallery } from './home.js';
import { switchPage } from './nav.js';
import { gatherConfig, applyConfig } from './config.js';
import { openSrt } from '../features/srt.js';
import { confirmDialog, menuDialog } from '../ui/dialog.js';

let ws = null;
export function initWs() { ws = new WS(onWsMessage); }

export function initStudio() {
  // SVG icon labels (markup keeps plain text for graceful no-JS degradation)
  $('#btnFetch').innerHTML = `${icon('link', 13)} Lấy thông tin`;
  $('#btnImgSearch').innerHTML = `${icon('image', 13)} Tìm ảnh AI`;
  $('#btnStart').innerHTML = `${icon('play', 15)} Bắt đầu`;
  $('#btnRender').innerHTML = `${icon('refresh', 14)} Render lại`;
  $('#btnStop').innerHTML = `${icon('stop', 14)} Dừng`;
  $('#btnResume').innerHTML = `${icon('play', 14)} Tiếp tục`;
  $('#btnSrt').innerHTML = `${icon('subtitles', 14)} SRT`;
  $('#btnMeta').innerHTML = `${icon('gauge', 14)} Metadata`;
  $('#btnRegenVoiceSel').innerHTML = `${icon('mic', 13)} Voice đã chọn`;
  $('#btnRegenHtmlSel').innerHTML = `${icon('refresh', 13)} HTML đã chọn`;
  $('#btnRenderSel').innerHTML = `${icon('film', 13)} Render đã chọn`;
  $('#btnRenderAll').innerHTML = `${icon('check', 13)} Render + Ghép`;
  $('#btnDownload').innerHTML = `${icon('download', 14)} Tải video`;
  $('#btnDownloadSrt').innerHTML = `${icon('subtitles', 14)} Tải .SRT`;
  $('#btnOpenFolder').innerHTML = `${icon('folder', 14)} Mở thư mục`;
  // fullscreen for the finished video (native controls also offer it; this is the explicit button)
  $('#btnFinalFs')?.addEventListener('click', () => {
    const v = $('#finalVideo'); if (!v) return;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else if (v.requestFullscreen) v.requestFullscreen();
    else if (v.webkitEnterFullscreen) v.webkitEnterFullscreen(); // Safari <video> fallback
  });
  const lt = $('#logToggle');
  if (lt?.firstElementChild) lt.firstElementChild.innerHTML = `${icon('book', 13)} Nhật ký xử lý`;
  $('#topic').addEventListener('input', detectType);
  $('#btnStart').addEventListener('click', () => withLock($('#btnStart'), createAndStart));
  $('#btnDelAll').addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Xoá tất cả dự án?', body: 'Toàn bộ dự án của kênh hiện tại sẽ bị xoá khỏi danh sách.', okText: 'Xoá tất cả', danger: true });
    if (ok) { await api.del('/projects'); startNewProject(); loadProjects(); }
  });
  $('#btnStop').addEventListener('click', () => api.post(`/projects/${state.current.id}/stop`, {}));
  $('#btnResume').addEventListener('click', () => api.post(`/projects/${state.current.id}/resume`, {}));
  $('#btnApproveScenes')?.addEventListener('click', () => withLock($('#btnApproveScenes'), async () => {
    try {
      const r = await api.post(`/projects/${state.current.id}/approve-scenes`, {});
      if (r?.error) { toast(r.error, 'error'); return; }
      $('#sceneGateBar').classList.add('hidden');
      toast('🎙 Đã duyệt cảnh — bắt đầu lồng tiếng + render', 'success');
    } catch (e) { toast('Không duyệt được: ' + (e?.message || e), 'error'); }
  }));
  $('#btnRender').addEventListener('click', () => withLock($('#btnRender'), () => renderScenes2('all')));
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
      toast(`Đã copy scenes JSON (${r.scenes?.length || 0} cảnh) ✓`, 'success');
    } catch (e) { toast('Không copy được: ' + (e?.message || e), 'error'); }
  });
  $('#checkAll').addEventListener('change', (e) => { $$('#sceneGrid .scene').forEach((c) => { c.classList.toggle('sel', e.target.checked); c.querySelector('.chk').checked = e.target.checked; }); updateSelCount(); });
  $('#btnSrt').addEventListener('click', openSrt);
  $('#btnRepurpose').addEventListener('click', () => withLock($('#btnRepurpose'), repurposeCurrent));
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
}

// ---------------- projects ----------------
export async function loadProjects() {
  const { projects } = await api.get('/projects');
  state.projects = projects;
  state.projectsLoaded = true;
  renderProjectList();
  renderGallery();
}
export function renderProjectList() {
  const box = $('#projList');
  if (!state.projects.length) { box.innerHTML = '<div class="empty">Chưa có dự án</div>'; return; }
  box.innerHTML = '';
  state.projects.forEach((p) => {
    const it = el('div', 'pitem' + (state.current && state.current.id === p.id ? ' active' : ''));
    it.innerHTML = `${p.thumb_path ? `<img class="thumb" src="${fileUrl(p.thumb_path)}" loading="lazy" decoding="async">` : '<div class="thumb"></div>'}
      <div class="meta"><div class="t">${esc(p.title)}</div><div class="s">${badgeText(p.status)} · ${p.aspect_ratio}</div></div>`;
    it.addEventListener('click', () => openProject(p.id));
    box.appendChild(it);
  });
}

// Clone the current project into another aspect ratio: voice + captions are reused
// verbatim, layouts reflow, every scene re-renders. Opens the derived project.
async function repurposeCurrent() {
  if (!state.current) { toast('Mở một dự án trước đã.', 'error'); return; }
  const cur = state.current.aspect_ratio;
  const names = { '9:16': '📱 Dọc 9:16 (Shorts/TikTok)', '16:9': '🖥 Ngang 16:9 (YouTube)', '1:1': '⬛ Vuông 1:1', '4:5': '📐 4:5 (Feed)' };
  const items = ['9:16', '16:9', '1:1', '4:5'].filter((r) => r !== cur).map((r) => ({ id: r, label: names[r] }));
  const pick = await menuDialog({ title: 'Đổi sang tỉ lệ khung nào?', items });
  if (!pick) return;
  try {
    const r = await api.post(`/projects/${state.current.id}/repurpose`, { aspectRatio: pick });
    toast(`Đã tạo bản ${pick} — giữ giọng đọc, đang dàn lại bố cục 🎬`, 'success');
    await loadProjects();
    await openProject(r.project.id);
  } catch (e) { toast('Lỗi đổi tỉ lệ: ' + e.message, 'error'); }
}

// One-click platform export: fast remux when the master already fits; confirmed fade-trim
// over the platform cap; aspect mismatch hands off to the repurpose flow (no silent crops).
async function exportCurrent() {
  if (!state.current) { toast('Mở một dự án trước đã.', 'error'); return; }
  let presets = [];
  try { presets = (await api.get('/export/presets')).presets || []; } catch (e) { toast('✗ ' + e.message, 'error'); return; }
  const pick = await menuDialog({ title: '📤 Xuất cho nền tảng nào?', items: presets.map((p) => ({ id: p.id, label: p.label })) });
  if (!pick) return;
  try {
    let r = await api.post(`/projects/${state.current.id}/export`, { preset: pick });
    if (r.needsRepurpose) {
      const ok = await confirmDialog({
        title: `Video đang ${state.current.aspect_ratio} — nền tảng này cần ${r.targetAr}`,
        body: 'Chạy Đổi tỉ lệ (dàn lại bố cục + render, không crop) rồi export từ bản mới nhé?',
        okText: '📱 Đổi tỉ lệ ngay',
      });
      if (ok) {
        const rp = await api.post(`/projects/${state.current.id}/repurpose`, { aspectRatio: r.targetAr });
        toast(`Đã tạo bản ${r.targetAr} — export lại sau khi render xong 🎬`, 'success');
        await loadProjects(); await openProject(rp.project.id);
      }
      return;
    }
    if (r.needsTrim) {
      const ok = await confirmDialog({
        title: `Video dài ${r.duration}s — nền tảng giới hạn ${r.maxDur}s`,
        body: `Cắt còn ${r.maxDur}s với fade-out 0.6s cuối? (bản gốc giữ nguyên)`,
        okText: `✂️ Cắt còn ${r.maxDur}s`,
      });
      if (!ok) return;
      r = await api.post(`/projects/${state.current.id}/export`, { preset: pick, allowTrim: true });
    }
    toast(`📤 Đã xuất ${r.preset}${r.trimmed ? ' (đã cắt fade)' : ''} — ${r.path.split('/').pop()}`, 'success');
  } catch (e) { toast('Lỗi export: ' + e.message, 'error'); }
}

// Manual publish — always an explicit choice; 'Riêng tư' (staging) is the safe default.
async function publishCurrent() {
  if (!state.current) return;
  // P40: more than one destination exists now, so ask WHERE before asking how visible.
  let platforms = [];
  try { platforms = (await api.get('/publish/status')).platforms || []; } catch { platforms = []; }
  const ready = platforms.filter((p) => p.connected);
  if (!ready.length) return toast('Chưa kết nối nền tảng nào — vào Cài đặt → Đăng video.', 'error');
  const platform = ready.length === 1 ? ready[0].id : await menuDialog({
    title: '📤 Đăng lên đâu?',
    items: ready.map((p) => ({ id: p.id, label: p.id === 'facebook' ? '📘 Facebook Page' : '▶️ YouTube' })),
  });
  if (!platform) return;
  if (platform === 'facebook') return publishToFacebook();
  const pick = await menuDialog({
    title: '📤 Đăng YouTube — chế độ hiển thị?',
    items: [
      { id: 'private', label: '🔒 Riêng tư (kiểm tra trước — khuyên dùng)' },
      { id: 'unlisted', label: '🔗 Không công khai (ai có link mới xem)' },
      { id: 'public', label: '🌐 Công khai ngay', danger: true },
    ],
  });
  if (!pick) return;
  if (pick === 'public') {
    const ok = await confirmDialog({ title: 'Đăng CÔNG KHAI ngay?', body: 'Video sẽ hiển thị với mọi người trên kênh. Bạn chắc chứ?', okText: 'Đăng công khai', danger: true });
    if (!ok) return;
  }
  toast('📤 Đang tải lên YouTube…', 'success');
  try {
    const r = await api.post(`/projects/${state.current.id}/publish`, { platform: 'youtube', privacy: pick });
    toast(`✅ Đã đăng (${pick}): ${r.url}`, 'success');
    renderPublishHistory();
  } catch (e) { toast('Lỗi đăng: ' + e.message, 'error'); }
}

// Facebook Page (P40). A 9:16/4:5 video goes up as a Reel, anything else as a feed video —
// the server picks that from the project's own aspect ratio. Anything other than "công khai
// ngay" is SCHEDULED a few minutes out rather than going live, mirroring the YouTube staging
// default: a publish is never accidentally public.
async function publishToFacebook() {
  const pick = await menuDialog({
    title: '📘 Đăng lên Facebook Page',
    items: [
      { id: 'private', label: '🕒 Hẹn giờ 15 phút nữa (kiểm tra trước — khuyên dùng)' },
      { id: 'public', label: '🌐 Đăng công khai ngay', danger: true },
    ],
  });
  if (!pick) return;
  if (pick === 'public') {
    const ok = await confirmDialog({ title: 'Đăng CÔNG KHAI ngay?', body: 'Video sẽ hiển thị công khai trên Trang. Bạn chắc chứ?', okText: 'Đăng công khai', danger: true });
    if (!ok) return;
  }
  // A YouTube description is the wrong shape for a Facebook post, so offer to write the
  // platform-shaped caption first (P42). Saved server-side under metadata.captions.facebook,
  // which the publish route prefers; declining just leaves the existing description in place.
  const wantCaption = await confirmDialog({
    title: 'Để AI viết caption cho Facebook?',
    body: 'Caption ngắn, mở đầu bằng hook, viết từ đúng lời thoại trong video. Bỏ qua thì dùng mô tả sẵn có.',
    okText: 'Viết caption',
  });
  if (wantCaption) {
    try {
      const c = await api.post('/publish/generate-caption', { projectId: state.current.id, platform: 'facebook' });
      if (c?.error) toast(c.error, 'error');
      else if (c?.caption) toast(`✍️ ${c.caption.split('\n')[0].slice(0, 60)}…`, 'success');
    } catch (e) { toast('Không viết được caption: ' + e.message, 'error'); }
  }
  toast('📤 Đang tải lên Facebook…', 'success');
  try {
    const r = await api.post(`/projects/${state.current.id}/publish`, { platform: 'facebook', privacy: pick });
    if (r.error) throw new Error(r.error);
    toast(r.scheduled ? `🕒 Đã lên lịch đăng: ${r.url}` : `✅ Đã đăng: ${r.url}`, 'success');
    renderPublishHistory();
  } catch (e) { toast('Lỗi đăng: ' + e.message, 'error'); }
}

export function startNewProject() {
  state.current = null; state.scenes = []; state.assets = [];
  $('#welcome').classList.remove('hidden');
  $('#projView').classList.add('hidden');
  $('#topic').value = ''; $('#assetList').innerHTML = ''; $('#imgResults').innerHTML = '';
  renderProjectList();
}

// Module-level in-flight guard: createAndStart is reachable from two buttons (#btnStart and
// the home hero) — whichever fires second must be a no-op, never a duplicate project.
let creating = false;
export async function createAndStart() {
  if (creating) return;
  const topic = $('#topic').value.trim();
  if (!topic) { toast('Nhập chủ đề trước đã.', 'error'); return; }
  creating = true;
  try {
    resetProgress();
    const config = gatherConfig();
    const { project } = await api.post('/projects', { topic, config });
    await loadProjects();
    await openProject(project.id);
    await api.post(`/projects/${project.id}/start`, { config });
    toast('Đã bắt đầu pipeline 🚀', 'success');
  } catch (e) {
    toast(`Không tạo được video: ${e.message}`, 'error');
  } finally {
    creating = false;
  }
}

export async function openProject(id) {
  switchPage('studio');
  const { project, scenes } = await api.get('/projects/' + id);
  state.current = project; state.scenes = scenes || [];
  try { localStorage.lastProjectId = id; } catch { /* private mode */ }
  ws.subscribe(id);
  clearJournal();          // never bleed the previous project's lines
  loadJournal(id);         // full persisted history (REST) — fire-and-forget
  applyConfig(project.config || {});
  $('#welcome').classList.add('hidden');
  $('#projView').classList.remove('hidden');
  renderProjectView();
  renderProjectList();
}

export function renderProjectView() {
  const p = state.current; if (!p) return;
  $('#pvTitle').textContent = p.title;
  $('#pvStatus').textContent = badgeText(p.status);
  $('#pvStatus').className = 'badge ' + p.status;
  $('#pvAr').textContent = p.aspect_ratio;
  $('#pvDate').textContent = new Date(p.updated_at).toLocaleString('vi-VN');
  $('#btnStop').classList.toggle('hidden', p.status !== 'running');
  $('#btnResume').classList.toggle('hidden', !['paused', 'error', 'review'].includes(p.status));
  renderSceneGate(p);
  // reset pipeline visuals from scene statuses
  resetPipeFromState();
  renderScenes();
  renderFinal();
  renderMeta();
  renderPublishHistory();
}

function resetPipeFromState() {
  PIPE.forEach((s) => setStep(s.k, 'idle'));
  const p = state.current;
  if (!p) return;
  if (state.scenes.length) { setStep('b2', 'done'); }
  // scenes-first order: template/props (visuals) can exist before any audio does.
  // every(): B2 two-stage pre-assigns plans to SOME scenes (chapter breaks) — b5 is only
  // done once the whole storyboard carries one.
  if (state.scenes.length && state.scenes.every((s) => s.image_path || (s.template && s.props))) setStep('b5', 'done');
  if (state.scenes.some((s) => s.audio_path)) setStep('b34', 'done');
  if (state.scenes.some((s) => s.video_path)) setStep('b6', 'done');
  if (p.video_path) setStep('b7', 'done');
}

// Scene-gate banner: visible only while the run holds at status 'scenes'. State-derived
// (not event-derived) so WS replays and reloads render it idempotently.
async function renderSceneGate(p) {
  const bar = $('#sceneGateBar');
  if (!bar) return;
  const show = p && p.status === 'scenes';
  bar.classList.toggle('hidden', !show);
  if (!show) return;
  const sheetBtn = $('#btnContactSheet');
  if (sheetBtn) {
    sheetBtn.onclick = () => window.open(`/api/projects/${p.id}/contact-sheet`, '_blank');
  }
  try {
    const est = await api.get(`/projects/${p.id}/voice-estimate`);
    const cost = est.credits != null ? `≈ ${est.credits.toLocaleString('vi-VN')} credits LarVoice`
      : est.usd ? `≈ $${est.usd.toFixed(3)} (${est.provider})` : `${est.provider} (miễn phí)`;
    $('#sceneGateCost').textContent = `Lồng tiếng ${est.scenes} cảnh · ${est.chars.toLocaleString('vi-VN')} ký tự · ${cost}`;
  } catch { $('#sceneGateCost').textContent = ''; }
}

// ---------------- final + meta ----------------
function renderFinal() {
  const p = state.current;
  const show = p && p.video_path && p.status === 'done';
  $('#finalView').classList.toggle('hidden', !show);
  if (show) {
    $('#finalVideo').src = fileUrl(p.video_path);
    $('#btnDownload').href = fileUrl(p.video_path);
    $('#btnDownloadSrt').href = '/api/projects/' + p.id + '/srt';
    const sheet = $('#btnFinalContactSheet');
    if (sheet) sheet.href = '/api/projects/' + p.id + '/contact-sheet';
  }
}
// Publish ledger (P40): every attempt was recorded but never shown, so nothing told the owner
// whether a video had already gone out — or where. Rendered under the final-video toolbar.
export async function renderPublishHistory() {
  const box = $('#pubHistory');
  if (!box) return;
  if (!state.current?.id) { box.innerHTML = ''; return; }
  let rows = [];
  try { rows = (await api.get(`/projects/${state.current.id}/publishes`)).publishes || []; } catch { return; }
  if (!rows.length) { box.innerHTML = '<span style="opacity:.6">Chưa đăng ở đâu.</span>'; return; }
  const ICON = { youtube: '▶️', facebook: '📘' };
  box.innerHTML = rows.slice(0, 6).map((r) => {
    const when = r.created_at ? new Date(r.created_at).toLocaleString('vi-VN') : '';
    const mark = r.status === 'done' ? '✅' : (r.status === 'error' ? '❌' : '⏳');
    const link = r.url ? ` <a href="${esc(r.url)}" target="_blank" rel="noopener">mở</a>` : '';
    return `<div>${mark} ${ICON[r.platform] || '📤'} ${esc(r.platform)}${r.privacy ? ` · ${esc(r.privacy)}` : ''} · ${esc(when)}${link}${r.error ? ` <span style="color:var(--bad,#f87171)">${esc(r.error)}</span>` : ''}</div>`;
  }).join('');
}

export function renderMeta() {
  const box = $('#metaCard'); const m = state.current && state.current.metadata;
  if (!m) { box.innerHTML = ''; return; }
  box.innerHTML = `<div class="meta-card"><div class="mt">${esc(m.title || '')}</div><div style="color:var(--muted);white-space:pre-wrap">${esc(m.description || '')}</div>
    <div class="tags">${(m.hashtags || []).map((h) => `<span class="tag-chip">${esc(h)}</span>`).join('')}</div></div>`;
}
// Same topic and config, all generated work discarded — as a NEW project, so the previous
// attempt survives for comparison and one click can never destroy a finished video (P42).
async function restartCurrent() {
  if (!state.current) return toast('Mở một dự án trước đã.', 'error');
  const ok = await confirmDialog({
    title: 'Làm lại từ đầu?',
    body: 'Tạo một dự án MỚI với cùng chủ đề và cấu hình, rồi chạy lại toàn bộ. Dự án hiện tại vẫn được giữ nguyên.',
    okText: 'Làm lại',
  });
  if (!ok) return;
  const r = await api.post(`/projects/${state.current.id}/restart`, {});
  if (r?.error) return toast(r.error, 'error');
  toast('♻️ Đã tạo dự án mới và bắt đầu chạy', 'success');
  await loadProjects();
  openProject(r.projectId);
}

async function copyAssetsFrom() {
  if (!state.current) return toast('Mở một dự án trước đã.', 'error');
  const others = (state.projects || []).filter((p) => p.id !== state.current.id).slice(0, 12);
  if (!others.length) return toast('Chưa có dự án nào khác.', 'error');
  const pick = await menuDialog({
    title: '🧲 Lấy asset từ dự án nào?',
    items: others.map((p) => ({ id: p.id, label: p.title || p.topic || p.id })),
  });
  if (!pick) return;
  const r = await api.post(`/projects/${state.current.id}/copy-assets-from/${pick}`, {});
  if (r?.error) return toast(r.error, 'error');
  toast(`Đã thêm ${r.added} asset (tổng ${r.total})`, 'success');
}

async function genMeta() {
  toast('Đang tạo metadata…');
  const r = await api.post('/metadata', { projectId: state.current.id, stylePrompt: '' });
  if (r.metadata) { state.current.metadata = r.metadata; renderMeta(); toast('Đã tạo metadata ✓', 'success'); }
}

// ---------------- WS ----------------
function onWsMessage(m) {
  if (m.type === '_status') { state.wsOpen = m.open; $('#wsDot').textContent = m.open ? '● realtime' : '● offline'; $('#wsDot').classList.toggle('on', m.open); return; }
  // cross-project broadcasts (before the current-project filter)
  if (m.type === 'job') { refreshTasks(); return; }
  if (!state.current || (m.projectId && m.projectId !== state.current.id)) return;
  if (m.type === 'replay') {
    // buffered feed replayed on (re)subscribe: a page reload mid-run catches up instantly.
    // 'op' spam is skipped except the last one (only the current activity line matters).
    const events = m.events || [];
    const lastOp = events.map((e, i) => (e.type === 'op' ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
    events.forEach((e, i) => { if (e.type !== 'op' || i === lastOp) onWsMessage(e); });
    return;
  }
  switch (m.type) {
    case 'step':
      flushSceneUpdates(); // coalesced patches must land before step transitions
      setStep(m.step, m.state, m.detail);
      if (m.state === 'running') { showOp(PIPE.find((x) => x.k === m.step)?.n || ''); prog.step = m.step; recomputeProgress(); }
      else if (m.state === 'done') {
        const i = PHASE_ORDER.indexOf(m.step);
        if (i >= 0) setProgress(PHASE_ORDER.slice(0, i + 1).reduce((s, k) => s + PHASE_W[k], 0));
        if (m.step === 'b2') { prog.total = parseInt(m.detail) || prog.total; refreshScenes(); }
      }
      break;
    case 'op': showOp(m.text); break;
    case 'journal': onJournalEvent(m); break;
    case 'status': flushSceneUpdates(); updateStatusBadge(m.status); break;
    case 'scene': onSceneUpdate(m); break;
    case 'retry': onRetryEvent(m); break;
    case 'done': flushSceneUpdates(); onDone(m); break;
    case 'error':
      flushSceneUpdates();
      toast('Lỗi: ' + m.msg, 'error'); hideOp(); updateStatusBadge('error');
      if (prog.step) setStep(prog.step, 'error', (m.msg || '').slice(0, 60));
      break;
    // content calendar lifecycle (assistant-scheduled videos)
    case 'calendar':
      toast(`🗓 Đến hạn — bắt đầu sản xuất: ${(m.topic || '').slice(0, 60)}`, 'success');
      loadProjects();
      break;
    case 'calendar-done':
      toast(m.status === 'done'
        ? `✅ Video hẹn lịch đã xong: ${(m.topic || '').slice(0, 60)}`
        : `⚠ Video hẹn lịch kết thúc (${m.status}): ${(m.topic || '').slice(0, 60)}`, m.status === 'done' ? 'success' : 'error');
      loadProjects();
      break;
  }
}
// Self-heal visibility: 'đang tự thử lại' — the user sees the app fixing itself, not a stall.
function onRetryEvent(m) {
  const label = m.scope === 'pipeline'
    ? `🩹 Gặp lỗi "${(m.msg || '').slice(0, 70)}" — tự động chạy tiếp sau ${Math.round((m.delayMs || 8000) / 1000)}s…`
    : `🩹 ${m.idx != null ? `Cảnh ${m.idx + 1}: ` : ''}đang tự thử lại${m.attempt ? ` (lần ${m.attempt + 1})` : ''}…`;
  showOp(label, true);
  if (m.step) setStep(m.step, 'running', '🩹 tự thử lại…');
  if (m.idx != null) {
    const sc = state.scenes.find((s) => s.idx === m.idx);
    if (sc) { sc.status = 'retrying'; const cEl = document.querySelector(`#sceneGrid .scene[data-id="${sc.id}"] .n span:last-child`); if (cEl) cEl.textContent = statusIcon('retrying'); }
  }
}
function updateStatusBadge(status) {
  if (state.current) state.current.status = status;
  $('#pvStatus').textContent = badgeText(status); $('#pvStatus').className = 'badge ' + status;
  $('#btnStop').classList.toggle('hidden', status !== 'running');
  // 'review' included: a live WS hold must reveal the continue button without a reload
  $('#btnResume').classList.toggle('hidden', !['paused', 'error', 'review'].includes(status));
  renderSceneGate(state.current);
}
async function onDone(m) {
  hideOp(); setProgress(100); toast('Video hoàn thành ✓', 'success');
  const r = await api.get('/projects/' + state.current.id);
  state.current = r.project; state.scenes = r.scenes;
  renderProjectView();
  setProgress(100);
  loadProjects();
}

// ---------------- input helpers ----------------
// Mirror of the master engine's input modes (SCRIPT_MODE_MIN_WORDS = 80 backend-side):
// topic → AI writes everything · detailed script → light polish + slicing, wording kept ·
// scenes JSON → direct import, no script-writing LLM call.
function detectType() {
  const v = $('#topic').value.trim();
  const words = v.split(/\s+/).filter(Boolean).length;
  let t = 'văn bản', hint = '';
  if (!v) { $('#inputTypeHint').textContent = ''; return; }
  if (/^https?:\/\/\S+$/i.test(v.split(/\s+/)[0]) && v.split(/\s+/).length <= 3) {
    t = 'link 🔗'; hint = ' → lấy nội dung rồi AI viết kịch bản từ đó';
  } else if (v.startsWith('{') || v.startsWith('[')) {
    t = 'scenes JSON 🧩'; hint = ' → nhập trực tiếp từng cảnh (voice + visual), không tốn AI viết kịch bản';
  } else if (words >= 80) {
    t = `kịch bản chi tiết 📜 (${words} từ)`; hint = ' → AI biên tập nhẹ + cắt cảnh, giữ ~90% lời của bạn; thời lượng theo nội dung';
  } else {
    t = 'chủ đề 💡'; hint = ' → AI viết toàn bộ kịch bản + visual từng cảnh theo thời lượng đã chọn';
  }
  $('#inputTypeHint').textContent = 'Nhận diện: ' + t + hint;
}
async function fetchLink() {
  const url = $('#topic').value.trim().split(/\s+/)[0];
  if (!/^https?:/.test(url)) { toast('Dán 1 link http(s) trước.', 'error'); return; }
  toast('Đang lấy nội dung…');
  const r = await api.post('/fetch-link', { url });
  if (r.error) return toast(r.error, 'error');
  $('#topic').value = (r.title ? r.title + '\n' : '') + (r.text || '');
  if (r.images?.length) showImages(r.images);
  toast('Đã lấy nội dung ✓', 'success');
}
async function imageSearch() {
  const q = $('#topic').value.trim().slice(0, 120) || 'video';
  toast('Đang tìm ảnh…');
  const r = await api.post('/image-search', { query: q, count: 6 });
  if (r.images?.length) { showImages(r.images); toast(`Tìm thấy ${r.images.length} ảnh (${r.source})`, 'success'); }
}
function showImages(images) {
  const box = $('#imgResults'); box.innerHTML = '';
  images.slice(0, 8).forEach((u) => {
    const i = el('img'); i.src = u.startsWith('/api') || u.startsWith('http') ? u : fileUrl(u);
    i.style = 'width:46px;height:46px;object-fit:cover;border-radius:6px;cursor:pointer';
    i.title = 'Thêm vào assets';
    // A search hit lives on someone else's server; a scene must be self-contained and offline,
    // so a remote URL is downloaded ONCE and the project keeps the local path (P40).
    i.addEventListener('click', async () => {
      if (!/^https?:/i.test(u)) { state.assets.push(u); return toast('Đã thêm ảnh'); }
      i.style.opacity = '.4';
      try {
        const r = await api.post('/media/download', { url: u });
        if (r?.error) throw new Error(r.error);
        state.assets.push(r.path);
        const tag = el('span', 'badge', esc(String(r.name).slice(0, 14)));
        $('#assetList')?.appendChild(tag);
        toast('Đã tải ảnh về máy ✓', 'success');
      } catch (e) { toast('Không tải được ảnh: ' + e.message, 'error'); }
      finally { i.style.opacity = ''; }
    });
    box.appendChild(i);
  });
}
async function uploadAssets(e) {
  const fd = new FormData();
  [...e.target.files].forEach((f) => fd.append('files', f));
  const r = await api.upload('/upload', fd);
  (r.files || []).forEach((f) => { state.assets.push(f.path); const tag = el('span', 'badge', esc(f.name.slice(0, 14))); $('#assetList').appendChild(tag); });
  toast(`Đã thêm ${(r.files || []).length} file`, 'success');
}
