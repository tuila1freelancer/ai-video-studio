// Whole-project actions: repurpose, dub, export, publish (YouTube, Facebook), restart, copy assets, metadata.
import { toast } from '../../ui/toast.js';
import { api } from '../../api.js';
import { state } from '../../state.js';
import { confirmDialog, menuDialog, publishDialog } from '../../ui/dialog.js';
import { t, m, tp } from '../../i18n.js';
import { loadProjects } from './projects.js';
import { openProject } from './project-view.js';
import { SRT_LANGS, renderPublishHistory, renderMeta } from './outputs.js';

// Clone the current project into another aspect ratio: voice + captions are reused
// verbatim, layouts reflow, every scene re-renders. Opens the derived project.
export async function repurposeCurrent() {
  if (!state.current) { toast('Mở một dự án trước đã.', 'error'); return; }
  const cur = state.current.aspect_ratio;
  const names = { '9:16': m('📱 Dọc 9:16 (Shorts/TikTok)'), '16:9': m('🖥 Ngang 16:9 (YouTube)'), '1:1': m('⬛ Vuông 1:1'), '4:5': m('📐 4:5 (Feed)') };
  const items = ['9:16', '16:9', '1:1', '4:5'].filter((r) => r !== cur).map((r) => ({ id: r, label: names[r] }));
  const pick = await menuDialog({ title: 'Đổi sang tỉ lệ khung nào?', items });
  if (!pick) return;
  try {
    const r = await api.post(`/projects/${state.current.id}/repurpose`, { aspectRatio: pick });
    toast(tp`Đã tạo bản ${pick} — giữ giọng đọc, đang dàn lại bố cục 🎬`, 'success');
    await loadProjects();
    await openProject(r.project.id);
  } catch (e) { toast(tp`Lỗi đổi tỉ lệ: ${e.message}`, 'error'); }
}

// Clone the current project into another LANGUAGE: the art direction travels verbatim, the
// narration and the on-screen text are rewritten. Creates the project and opens it — it does not
// start it, because starting one spends money and that stays an explicit click (P16).
export async function dubCurrent() {
  if (!state.current) { toast(t('ui.toast.mo-du-an-truoc', null, 'Mở một dự án trước đã.'), 'error'); return; }
  const own = state.current.config?.language && state.current.config.language !== 'auto'
    ? state.current.config.language : null;
  const items = SRT_LANGS.filter(([c]) => c !== own).map(([c, label]) => ({ id: c, label }));
  const pick = await menuDialog({ title: t('ui.dialog.long-tieng-sang', null, 'Lồng tiếng sang ngôn ngữ nào?'), items });
  if (!pick) return;
  try {
    const r = await api.post(`/projects/${state.current.id}/dub`, { language: pick });
    toast(t('ui.toast.da-tao-ban-long-tieng', { n: r.scenes },
      'Đã tạo bản lồng tiếng — {n} cảnh, giữ nguyên chỉ dẫn mỹ thuật. Bấm Bắt đầu khi sẵn sàng 🌍'), 'success');
    await loadProjects();
    await openProject(r.project.id);
  } catch (e) { toast(t('ui.toast.loi-long-tieng', null, 'Lỗi lồng tiếng: ') + e.message, 'error'); }
}

// One-click platform export: fast remux when the master already fits; confirmed fade-trim
// over the platform cap; aspect mismatch hands off to the repurpose flow (no silent crops).
export async function exportCurrent() {
  if (!state.current) { toast('Mở một dự án trước đã.', 'error'); return; }
  let presets = [];
  try { presets = (await api.get('/export/presets')).presets || []; } catch (e) { toast('✗ ' + e.message, 'error'); return; }
  const pick = await menuDialog({ title: '📤 Xuất cho nền tảng nào?', items: presets.map((p) => ({ id: p.id, label: p.label })) });
  if (!pick) return;
  try {
    let r = await api.post(`/projects/${state.current.id}/export`, { preset: pick });
    if (r.needsRepurpose) {
      const ok = await confirmDialog({
        title: tp`Video đang ${state.current.aspect_ratio} — nền tảng này cần ${r.targetAr}`,
        body: 'Chạy Đổi tỉ lệ (dàn lại bố cục + render, không crop) rồi export từ bản mới nhé?',
        okText: '📱 Đổi tỉ lệ ngay',
      });
      if (ok) {
        const rp = await api.post(`/projects/${state.current.id}/repurpose`, { aspectRatio: r.targetAr });
        toast(tp`Đã tạo bản ${r.targetAr} — export lại sau khi render xong 🎬`, 'success');
        await loadProjects(); await openProject(rp.project.id);
      }
      return;
    }
    if (r.needsTrim) {
      const ok = await confirmDialog({
        title: tp`Video dài ${r.duration}s — nền tảng giới hạn ${r.maxDur}s`,
        body: tp`Cắt còn ${r.maxDur}s với fade-out 0.6s cuối? (bản gốc giữ nguyên)`,
        okText: tp`✂️ Cắt còn ${r.maxDur}s`,
      });
      if (!ok) return;
      r = await api.post(`/projects/${state.current.id}/export`, { preset: pick, allowTrim: true });
    }
    toast(tp`📤 Đã xuất ${r.preset}${r.trimmed ? m(' (đã cắt fade)') : ''} — ${r.path.split('/').pop()}`, 'success');
  } catch (e) { toast(tp`Lỗi export: ${e.message}`, 'error'); }
}

// Manual publish — always an explicit choice; 'Riêng tư' (staging) is the safe default.
export async function publishCurrent() {
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
    toast(tp`✅ Đã đăng (${pick}): ${r.url}`, 'success');
    renderPublishHistory();
  } catch (e) { toast(tp`Lỗi đăng: ${e.message}`, 'error'); }
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
    } catch (e) { toast(tp`Không viết được caption: ${e.message}`, 'error'); }
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
  toast(form.when ? m('🕒 Đang lên lịch…') : m('📤 Đang tải lên Facebook…'), 'success');
  try {
    const r = await api.post(`/projects/${state.current.id}/publish`, {
      platform: 'facebook',
      privacy: form.when ? 'private' : 'public',
      scheduledAt: form.when || undefined,
      caption: form.caption, title: form.title,
    });
    if (r.error) throw new Error(r.error);
    toast(r.scheduled ? tp`🕒 Đã lên lịch: ${r.url}` : tp`✅ Đã đăng: ${r.url}`, 'success');
    renderPublishHistory();
  } catch (e) { toast(tp`Lỗi đăng: ${e.message}`, 'error'); }
}

// Same topic and config, all generated work discarded — as a NEW project, so the previous
// attempt survives for comparison and one click can never destroy a finished video (P42).
export async function restartCurrent() {
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

export async function copyAssetsFrom() {
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
  toast(tp`Đã thêm ${r.added} asset (tổng ${r.total})`, 'success');
}

export async function genMeta() {
  toast('Đang tạo metadata…');
  const r = await api.post('/metadata', { projectId: state.current.id, stylePrompt: '' });
  if (r.metadata) { state.current.metadata = r.metadata; renderMeta(); toast('Đã tạo metadata ✓', 'success'); }
}
