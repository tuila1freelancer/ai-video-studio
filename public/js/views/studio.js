import { $, $$, el, esc, badgeText, statusIcon } from '../ui/dom.js';
import { toast } from '../ui/toast.js';
import { api, fileUrl, withLock, WS } from '../api.js';
import { state, channelDefaults } from '../state.js';
import { PIPE, PHASE_W, PHASE_ORDER, prog, resetProgress, setProgress, recomputeProgress, setStep, showOp, hideOp } from './progress.js';
import { loadJournal, clearJournal, onJournalEvent } from '../features/journal.js';
import { refreshTasks } from '../features/tasks.js';
import { renderScenes, refreshScenes, onSceneUpdate, flushSceneUpdates, selectedIds, updateSelCount, regenScene, renderScenes2 } from './scenes.js';
import { icon } from '../ui/icons.js';
import { renderGallery } from './home.js';
import { switchPage } from './nav.js';
import { gatherConfig, applyConfig } from './config.js';
import { openChangePlan } from '../features/changeplan.js';
import { initPendingChanges, schedulePendingCheck, resetPendingCheck } from '../features/pending-changes.js';
import { openSrt } from '../features/srt.js';
import { confirmDialog, menuDialog, publishDialog, promptDialog } from '../ui/dialog.js';

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
  initPendingChanges();
  // the fetched article: show it, edit it, drop it
  $('#srcToggle')?.addEventListener('click', () => {
    const t = $('#srcText');
    t.classList.toggle('hidden');
    $('#srcToggle').textContent = t.classList.contains('hidden') ? 'Xem' : 'Ẩn';
  });
  $('#srcClear')?.addEventListener('click', () => setSourceDoc(null));
  // An edit is the owner's decision about what the video is written from, so it has to be what
  // the pipeline receives — not a display copy of something the server will re-fetch anyway.
  $('#srcText')?.addEventListener('input', () => {
    if (state.sourceDoc) state.sourceDoc.text = $('#srcText').value;
  });
  initImageViewer();
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
      <div class="meta"><div class="t">${esc(p.title)}</div><div class="s">${badgeText(p.status)} · ${p.aspect_ratio}</div></div>
      <button class="pitem-ren" title="Đổi tên">✏️</button>`;
    it.querySelector('.pitem-ren').addEventListener('click', (e) => { e.stopPropagation(); renameProject(p); });
    it.addEventListener('click', () => openProject(p.id));
    box.appendChild(it);
  });
}

/** Rename from the list too — the topbar only ever shows the project that is open. */
async function renameProject(p) {
  const name = await promptDialog({ title: 'Đổi tên dự án', label: 'Tên dự án', value: p.title || '' });
  if (name == null) return;
  const title = String(name).trim();
  if (!title || title === p.title) return;
  try {
    // metadata, not config: a rename must not touch anything a render fingerprint reads
    const md = { ...(p.metadata || {}), titleLocked: true };
    await api.put(`/projects/${p.id}`, { title, metadata: md });
    p.title = title; p.metadata = md;
    if (state.current?.id === p.id) state.current.title = title;
    renderProjectList();
    toast(`✏️ Đã đổi tên: ${title}`, 'success');
  } catch (e) { toast(`✖ Không đổi được tên: ${e.message}`, 'error'); }
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
  // P43: show the owner the EXACT post text and let them edit it, and let them pick when it goes
  // live — a privacy menu cannot fix a typo in a caption nobody ever saw.
  const md = state.current?.metadata || {};
  let caption = md.captions?.facebook || md.description || '';
  const wantAi = !caption && await confirmDialog({
    title: 'Chưa có caption — để AI viết?',
    body: 'AI viết caption ngắn từ đúng lời thoại trong video. Bỏ qua thì bạn tự soạn.',
    okText: 'AI viết giúp',
  });
  if (wantAi) {
    try {
      const c = await api.post('/publish/generate-caption', { projectId: state.current.id, platform: 'facebook' });
      if (c?.caption) caption = c.caption;
    } catch (e) { toast('Không viết được caption: ' + e.message, 'error'); }
  }
  const form = await publishDialog({
    title: '📘 Đăng lên Facebook Page', platform: 'facebook',
    caption, postTitle: md.title || state.current?.title || '',
  });
  if (!form) return;
  if (!form.when) {
    const ok = await confirmDialog({
      title: 'Đăng CÔNG KHAI ngay?',
      body: 'Video sẽ hiển thị công khai trên Trang ngay lập tức.',
      okText: 'Đăng công khai', danger: true,
    });
    if (!ok) return;
  }
  toast(form.when ? '🕒 Đang lên lịch…' : '📤 Đang tải lên Facebook…', 'success');
  try {
    const r = await api.post(`/projects/${state.current.id}/publish`, {
      platform: 'facebook',
      privacy: form.when ? 'private' : 'public',
      scheduledAt: form.when || undefined,
      caption: form.caption, title: form.title,
    });
    if (r.error) throw new Error(r.error);
    toast(r.scheduled ? `🕒 Đã lên lịch: ${r.url}` : `✅ Đã đăng: ${r.url}`, 'success');
    renderPublishHistory();
  } catch (e) { toast('Lỗi đăng: ' + e.message, 'error'); }
}

export function startNewProject() {
  state.current = null; state.scenes = []; state.assets = [];
  $('#welcome').classList.remove('hidden');
  $('#projView').classList.add('hidden');
  $('#topic').value = ''; $('#assetList').innerHTML = ''; $('#imgResults').innerHTML = '';
  setSourceDoc(null);
  // Back to the CHANNEL's defaults, not to whatever the last project happened to use. Opening a
  // project calls applyConfig with that project's config; without this, "video mới" inherited it
  // silently — so a one-off experiment on one video became the starting point for the next.
  applyConfig(channelDefaults());
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
    // Carry the article the owner actually looked at (and may have edited). Without it the stage
    // re-fetches the URL and writes from whatever the site serves at that second instead.
    if (state.sourceDoc?.text?.trim()) {
      const d = state.sourceDoc;
      config.sourceDoc = { url: d.url || topic, title: d.title || '', text: d.text.trim() };
    }
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
  // …including the article this video was written from, so reopening it shows the material rather
  // than leaving the owner to guess which link it came from.
  setSourceDoc(project.config?.sourceDoc || null);
  // A different project has a different idea of what is pending — the previous answer describes
  // somebody else's video and must not survive the switch.
  resetPendingCheck();
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
  // 'done' included: a finished video is a VERSION, not a terminal state. The fingerprint-aware
  // resume is the fastest correct path for a mixed edit and it was simply unreachable here.
  $('#btnResume').classList.toggle('hidden', !['paused', 'error', 'review', 'done'].includes(p.status));
  $('#btnResume').innerHTML = p.status === 'done'
    ? `${icon('refresh', 14)} Áp dụng thay đổi`
    : `${icon('play', 14)} Tiếp tục`;
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

/**
 * Metadata, per platform, where it can be read and copied.
 *
 * It used to render one card — a title, a description and a row of hashtags — even though the
 * generator already produced YouTube/Shorts/TikTok separately, and the per-platform text was only
 * visible from inside a publish dialog. Now every platform is a card, every field carries the
 * platform's REAL character limit as a live count, and every field copies with one click.
 */
export function renderMeta() {
  const box = $('#metaCard');
  const m = state.current && state.current.metadata;
  if (!m) { box.innerHTML = ''; return; }
  const pf = m.platforms || {};
  const specs = state.platformSpecs || [];
  if (!specs.length) { loadPlatformSpecs(); }
  const cards = specs.filter((spec) => pf[spec.id]).map((spec) => {
    const row = pf[spec.id];
    const fields = spec.fields.filter((f) => row[f.key] != null && String(row[f.key]).length).map((f) => {
      const val = f.list ? (row[f.key] || []).join(f.key === 'tags' ? ', ' : ' ') : String(row[f.key]);
      const len = val.length;
      // over the SWEET spot is a nudge, over the hard cap is a problem — two different colours
      const cls = len > f.limit ? 'over' : (len > f.sweet ? 'tight' : 'ok');
      return `<div class="mf">
        <div class="mf-h"><span>${esc(f.label)}</span>
          <span class="mf-n ${cls}">${len}/${f.limit}</span>
          <button class="mf-c" data-copy="${esc(val)}" title="Sao chép">⧉</button></div>
        <div class="mf-v${f.list ? ' chips' : ''}">${f.list
          ? (row[f.key] || []).map((x) => `<span class="tag-chip">${esc(x)}</span>`).join('')
          : esc(val)}</div>
      </div>`;
    }).join('');
    return `<div class="meta-card"><div class="mt">${spec.icon} ${esc(spec.label)}</div>${fields}</div>`;
  }).join('');
  const covers = (m.covers || []).map((c) => `<a class="cover-chip" href="${fileUrl(c.path)}" target="_blank" rel="noreferrer">
      <img src="${fileUrl(c.path)}" loading="lazy" decoding="async"><span>${esc(c.label)}<small>${c.w}×${c.h}</small></span></a>`).join('');
  box.innerHTML = (covers ? `<div class="sec-label">🖼 Ảnh bìa theo nền tảng</div><div class="cover-row">${covers}</div>` : '')
    + (cards || `<div class="meta-card"><div class="mt">${esc(m.title || '')}</div>
        <div style="color:var(--muted);white-space:pre-wrap">${esc(m.description || '')}</div>
        <div class="tags">${(m.hashtags || []).map((h) => `<span class="tag-chip">${esc(h)}</span>`).join('')}</div></div>`);
  box.querySelectorAll('.mf-c').forEach((b) => b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy); toast('⧉ Đã sao chép', 'success'); }
    catch { toast('Không sao chép được', 'error'); }
  }));
}

/** The platform table, fetched once — the panel and the writer must agree on the limits. */
async function loadPlatformSpecs() {
  if (state.platformSpecs) return;
  try {
    state.platformSpecs = (await api.get('/platforms')).platforms || [];
    renderMeta();
  } catch { state.platformSpecs = []; }
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
  // The bar is a claim about a FINISHED file. A run starting invalidates it, and a run finishing
  // is the moment it should have emptied — without this it kept advertising work already done.
  schedulePendingCheck({ now: true });
  $('#pvStatus').textContent = badgeText(status); $('#pvStatus').className = 'badge ' + status;
  $('#btnStop').classList.toggle('hidden', status !== 'running');
  // 'review' included: a live WS hold must reveal the continue button without a reload
  $('#btnResume').classList.toggle('hidden', !['paused', 'error', 'review', 'done'].includes(status));
  $('#btnResume').innerHTML = status === 'done'
    ? `${icon('refresh', 14)} Áp dụng thay đổi`
    : `${icon('play', 14)} Tiếp tục`;
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
// ---------------- fetched source article ----------------
// The article NEVER goes back into #topic.
//
// It used to: the button replaced the URL with `title + text`, which flipped detectInputType from
// 'url' to 'text'. The master engine picks its mode from that (master-script.js) — a fetched
// article is mode 'source', "write a NEW script from this research", while >=80 words of plain
// text is mode 'script', "this is the owner's own script, keep >=90% of its wording". So pressing
// the button silently changed the product: instead of writing a video from the article, the app
// narrated the article's own sentences, sliced up. Its own comment says so — "a long article is
// research material for a NEW script, never a detailed owner script to polish" — the UI was the
// only thing breaking that rule. The URL stays in #topic; the article gets its own panel.
export function setSourceDoc(doc) {
  state.sourceDoc = doc && doc.text ? doc : null;
  const box = $('#srcDoc');
  if (!box) return;
  box.classList.toggle('hidden', !state.sourceDoc);
  if (!state.sourceDoc) { $('#srcText').value = ''; return; }
  const d = state.sourceDoc;
  $('#srcTitle').textContent = d.title || d.url || 'Nội dung đã lấy';
  $('#srcTitle').title = d.url || '';
  $('#srcText').value = d.text;
  const words = d.text.trim().split(/\s+/).filter(Boolean).length;
  const bits = [`${words.toLocaleString('vi')} từ`, `${d.chars ?? d.text.length} ký tự`];
  // Show the filtering as a RATIO, not a total: "62/373 đoạn" is the only way to see that the page
  // furniture actually got thrown away.
  if (d.blocks) bits.push(d.found && d.found !== d.blocks ? `${d.blocks}/${d.found} đoạn` : `${d.blocks} đoạn`);
  if (d.siteName) bits.push(esc(d.siteName));
  const how = d.ai ? '🤖 AI đã lọc bỏ phần thừa' : '⚙️ lọc theo cấu trúc trang';
  // Say it out loud when the page was longer than the engine can read — the old extractor cut at
  // 8000 characters mid-sentence and nothing anywhere said a word about it.
  $('#srcMeta').innerHTML = `${bits.join(' · ')} · ${how} → AI sẽ viết kịch bản MỚI từ tư liệu này`
    + (d.note ? `<br><b class="warn">⚠ ${esc(d.note)}</b>` : '')
    + (d.truncated ? `<br><b class="warn">⚠ Bài quá dài — đã lấy tối đa engine đọc được${d.dropped ? `, bỏ ${d.dropped} đoạn cuối` : ''}.</b>` : '');
}

async function fetchLink() {
  const url = $('#topic').value.trim().split(/\s+/)[0];
  if (!/^https?:/.test(url)) { toast('Dán 1 link http(s) trước.', 'error'); return; }
  const btn = $('#btnFetch');
  btn.disabled = true;
  toast('Đang lấy nội dung…');
  try {
    const r = await api.post('/fetch-link', { url });
    if (r.error) throw new Error(r.error);
    if (!r.text?.trim()) throw new Error('trang này không có nội dung bài viết đọc được');
    setSourceDoc(r);
    if (r.images?.length) {
      showImages(r.images.map((u) => ({ url: u })),
        r.foundImages && r.foundImages !== r.images.length ? `ảnh trong bài (bỏ ${r.foundImages - r.images.length} ảnh ngoài bài)` : 'ảnh trong bài');
    } else $('#imgResults').innerHTML = '';
    toast(`Đã lấy ${r.chars} ký tự ✓${r.ai ? ' (AI đã lọc)' : ''}`, 'success');
  } catch (e) { toast('Không lấy được nội dung: ' + e.message, 'error'); }
  finally { btn.disabled = false; }
}

async function imageSearch() {
  // Search the ARTICLE when there is one — the topic box holds a bare URL in that case, and
  // "https://vnexpress.net/…" is not a search query.
  const q = (state.sourceDoc?.title || state.sourceDoc?.text || $('#topic').value).trim().slice(0, 120) || 'video';
  const btn = $('#btnImgSearch');
  btn.disabled = true;
  toast('Đang tìm ảnh…');
  try {
    const r = await api.post('/image-search', { query: q, count: 12 });
    if (r.error) throw new Error(r.error);
    const items = r.items?.length ? r.items : (r.images || []).map((u) => ({ url: u }));
    if (!items.length) throw new Error('không tìm thấy ảnh nào');
    showImages(items, r.note ? `${r.source} — ${r.note}` : `${r.source}${r.keywords?.[0] ? ` · “${r.keywords[0]}”` : ''}`);
    // Gradient placeholders are a legitimate answer, but handing them over without saying why
    // reads as "there are no pictures of this" instead of "the catalogue is throttling us".
    if (r.note) toast(`⚠ ${r.note} — đang dùng ảnh nền tạm`, 'error');
    else toast(`Tìm thấy ${items.length} ảnh (${r.source})`, 'success');
  } catch (e) { toast('Tìm ảnh lỗi: ' + e.message, 'error'); }
  finally { btn.disabled = false; }
}

/**
 * Results the owner can actually LOOK at.
 *
 * They were 46×46 squares whose only interaction was "click to download into assets" — no way to
 * see what a picture was before committing it to a video. Tiles are real thumbnails now, clicking
 * one opens it full size, and adding is its own explicit button.
 */
function showImages(items, sourceLabel = '') {
  const box = $('#imgResults');
  box.innerHTML = '';
  if (!items.length) return;
  if (sourceLabel) box.appendChild(el('div', 'imgres-src', esc(`${items.length} ảnh · ${sourceLabel}`)));
  const grid = el('div', 'imgres-grid');
  items.forEach((it) => {
    const url = it.url;
    const src = it.thumb || url;
    const cell = el('div', 'imgres-cell');
    const img = el('img');
    img.src = src.startsWith('/api') || /^https?:/.test(src) ? src : fileUrl(src);
    img.alt = it.title || '';
    img.loading = 'lazy';
    // A hit that will not even load is not a candidate — say so instead of showing a broken box.
    img.addEventListener('error', () => cell.classList.add('dead'));
    img.addEventListener('click', () => openImageViewer(items, items.indexOf(it)));
    const add = el('button', 'imgres-add', '+');
    add.title = 'Thêm vào assets của video';
    add.addEventListener('click', (e) => { e.stopPropagation(); addImageAsset(url, cell); });
    cell.append(img, add);
    grid.appendChild(cell);
  });
  box.appendChild(grid);
}

/**
 * A search hit lives on someone else's server; a scene must be self-contained and offline, so a
 * remote URL is downloaded ONCE and the project keeps the local path (P40).
 */
async function addImageAsset(url, cell) {
  if (!/^https?:/i.test(url)) { state.assets.push(url); return toast('Đã thêm ảnh'); }
  cell?.classList.add('busy');
  try {
    const r = await api.post('/media/download', { url });
    if (r?.error) throw new Error(r.error);
    state.assets.push(r.path);
    $('#assetList')?.appendChild(el('span', 'badge', esc(String(r.name).slice(0, 14))));
    cell?.classList.add('added');
    toast('Đã tải ảnh về máy ✓', 'success');
  } catch (e) { toast('Không tải được ảnh: ' + e.message, 'error'); }
  finally { cell?.classList.remove('busy'); }
}

/** Full-size viewer: the point of "xem trực tiếp ảnh trong app". Arrows walk the result set. */
function openImageViewer(items, startAt) {
  let i = Math.max(0, startAt);
  const modal = $('#imgViewer');
  const show = () => {
    const it = items[i];
    $('#ivImg').src = it.thumb && !it.url ? it.thumb : it.url;
    $('#ivCap').textContent = it.title || it.url;
    $('#ivPos').textContent = `${i + 1}/${items.length}`;
    $('#ivOpen').href = it.url;
  };
  const step = (d) => { i = (i + d + items.length) % items.length; show(); };
  modal._step = step;
  modal._add = () => addImageAsset(items[i].url);
  show();
  modal.classList.add('open');
}

export function initImageViewer() {
  const modal = $('#imgViewer');
  if (!modal) return;
  $('#ivPrev').addEventListener('click', () => modal._step?.(-1));
  $('#ivNext').addEventListener('click', () => modal._step?.(1));
  $('#ivAdd').addEventListener('click', () => modal._add?.());
  document.addEventListener('keydown', (e) => {
    if (!modal.classList.contains('open')) return;
    if (e.key === 'ArrowLeft') modal._step?.(-1);
    else if (e.key === 'ArrowRight') modal._step?.(1);
  });
}
async function uploadAssets(e) {
  const fd = new FormData();
  [...e.target.files].forEach((f) => fd.append('files', f));
  const r = await api.upload('/upload', fd);
  (r.files || []).forEach((f) => { state.assets.push(f.path); const tag = el('span', 'badge', esc(f.name.slice(0, 14))); $('#assetList').appendChild(tag); });
  toast(`Đã thêm ${(r.files || []).length} file`, 'success');
}
