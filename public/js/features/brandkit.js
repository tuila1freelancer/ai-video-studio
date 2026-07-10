import { $, esc } from '../ui/dom.js';
import { closeModal } from '../ui/modals.js';
import { toast } from '../ui/toast.js';
import { api, fileUrl } from '../api.js';
import { state, activeChannelBrand } from '../state.js';
import { updateCfgChips } from '../views/config.js';

export function refreshBrandSummary() {
  const bk = activeChannelBrand();
  const th = $('#bsThumb'), nm = $('#bsName'), mt = $('#bsMeta');
  if (!th) return;
  if (bk) {
    th.innerHTML = bk.logo?.assetPath ? `<img src="${fileUrl(bk.logo.assetPath)}">` : '🏷';
    nm.textContent = bk.channelName || 'Brand kit (chỉ logo)';
    mt.textContent = `Chèn: ${bk.placement === 'always' ? 'cố định' : bk.placement === 'off' ? 'tắt' : 'thông minh'}${bk.logo ? ' · có logo' : ''}`;
  } else {
    th.textContent = '🏷'; nm.textContent = 'Chưa cấu hình brand';
    mt.textContent = 'Logo + tên kênh sẽ tự chèn vào từng cảnh';
  }
  const lw = $('#legacyWatermark'); if (lw) lw.style.display = bk ? 'none' : 'block';
  updateCfgChips();
}

export function openBrandEditor() {
  const ch = (state.channels || []).find((c) => c.id === state.activeChannel);
  if (!ch) return toast('Chưa có kênh đang chọn.', 'error');
  const bk = ch.config?.brandKit || {};
  state.brandDraft = {
    channelName: bk.channelName || ch.name || '',
    placement: bk.placement || 'smart',
    logo: bk.logo ? { ...bk.logo, position: { ...(bk.logo.position || { xPct: 0.92, yPct: 0.06 }) } } : null,
    nameBadge: {
      enabled: bk.nameBadge ? bk.nameBadge.enabled !== false : true,
      style: bk.nameBadge?.style || 'plain',
      position: { ...(bk.nameBadge?.position || { xPct: 0.5, yPct: 0.045 }) },
    },
    stickers: bk.stickers || [],
  };
  $('#brandChName').textContent = ch.name;
  $('#brandName').value = state.brandDraft.channelName;
  $('#brandPlacement').value = state.brandDraft.placement;
  $('#brandBadgeOn').checked = state.brandDraft.nameBadge.enabled;
  $('#brandBadgeStyle').value = state.brandDraft.nameBadge.style;
  $('#brandLogoSize').value = state.brandDraft.logo?.sizePct ?? 8.5;
  $('#brandLogoOpacity').value = Math.round((state.brandDraft.logo?.opacity ?? 0.9) * 100);
  $('#brandLogoStyle').value = state.brandDraft.logo?.style || 'plain';
  // per-channel AI overrides (compact)
  const ai = ch.config?.ai || {};
  $('#brandAiTts').innerHTML = '<option value="">— Dùng cấu hình chung —</option>'
    + (state.providers || []).map((p) => `<option value="${p.id}"${ai.tts?.provider === p.id ? ' selected' : ''}>${esc(p.name)}</option>`).join('');
  $('#brandAiLlmModel').value = ai.llm?.model || '';
  $('#brandAiSub').value = ai.subtitle?.engine || '';
  // stage backdrop: latest scene preview of this channel's projects, else theme-dark
  const stage = $('#brandStage');
  const ar = $('#cfgAr').value;
  stage.classList.toggle('landscape', ar === '16:9');
  const proj = state.projects.find((p) => p.thumb_path) || null;
  const scenePrev = state.scenes.find((s) => s.image_path)?.image_path;
  stage.style.backgroundImage = scenePrev ? `url('${fileUrl(scenePrev)}')` : (proj ? `url('${fileUrl(proj.thumb_path)}')` : '');
  syncBrandStage();
  $('#brandModal').classList.add('open');
}

function syncBrandStage() {
  const d = state.brandDraft; if (!d) return;
  const logoEl = $('#bstLogo'), badgeEl = $('#bstBadge');
  if (d.logo?.assetPath) {
    logoEl.classList.remove('hidden');
    $('#bstLogoImg').src = fileUrl(d.logo.assetPath);
    logoEl.style.left = (d.logo.position.xPct * 100) + '%';
    logoEl.style.top = (d.logo.position.yPct * 100) + '%';
    logoEl.style.width = (d.logo.sizePct * 1.6) + '%'; // stage is min-dim scaled; approx for editing
    logoEl.style.opacity = d.logo.opacity;
  } else logoEl.classList.add('hidden');
  if (d.nameBadge.enabled && (d.channelName || '').trim()) {
    badgeEl.classList.remove('hidden');
    badgeEl.textContent = (d.channelName || 'TÊN KÊNH').toUpperCase();
    badgeEl.style.left = (d.nameBadge.position.xPct * 100) + '%';
    badgeEl.style.top = (d.nameBadge.position.yPct * 100) + '%';
  } else badgeEl.classList.add('hidden');
  $('#brandLogoSizeL').textContent = (d.logo?.sizePct ?? 8.5) + '%';
  $('#brandLogoOpacityL').textContent = Math.round((d.logo?.opacity ?? 0.9) * 100) + '%';
}

// pointer-drag ghosts → xPct/yPct (center-based, clamped)
function wireBrandDrag(el, getPos) {
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    el.classList.add('drag');
    const stage = $('#brandStage').getBoundingClientRect();
    const move = (ev) => {
      const pos = getPos(); if (!pos) return;
      pos.xPct = Math.min(0.98, Math.max(0.02, (ev.clientX - stage.left) / stage.width));
      pos.yPct = Math.min(0.98, Math.max(0.02, (ev.clientY - stage.top) / stage.height));
      syncBrandStage();
    };
    const up = () => {
      el.classList.remove('drag');
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  });
}

export function initBrandKit() {
  const be = $('#btnBrandEditor');
  if (!be) return;
  be.addEventListener('click', openBrandEditor);
  wireBrandDrag($('#bstLogo'), () => state.brandDraft?.logo?.position);
  wireBrandDrag($('#bstBadge'), () => state.brandDraft?.nameBadge?.position);
  $('#brandName').addEventListener('input', () => { state.brandDraft.channelName = $('#brandName').value; syncBrandStage(); });
  $('#brandBadgeOn').addEventListener('change', () => { state.brandDraft.nameBadge.enabled = $('#brandBadgeOn').checked; syncBrandStage(); });
  $('#brandBadgeStyle').addEventListener('change', () => { state.brandDraft.nameBadge.style = $('#brandBadgeStyle').value; });
  $('#brandPlacement').addEventListener('change', () => { state.brandDraft.placement = $('#brandPlacement').value; });
  $('#brandLogoSize').addEventListener('input', () => { if (state.brandDraft.logo) { state.brandDraft.logo.sizePct = +$('#brandLogoSize').value; syncBrandStage(); } });
  $('#brandLogoOpacity').addEventListener('input', () => { if (state.brandDraft.logo) { state.brandDraft.logo.opacity = +$('#brandLogoOpacity').value / 100; syncBrandStage(); } });
  $('#brandLogoStyle').addEventListener('change', () => { if (state.brandDraft.logo) state.brandDraft.logo.style = $('#brandLogoStyle').value; });
  $('#brandLogoClear').addEventListener('click', () => { state.brandDraft.logo = null; syncBrandStage(); });
  $('#brandLogoFile').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const fd = new FormData(); fd.append('file', f);
    const r = await api.upload(`/channels/${state.activeChannel}/brand-logo`, fd);
    if (r.error) return toast(r.error, 'error');
    state.brandDraft.logo = {
      assetPath: r.path, position: state.brandDraft.logo?.position || { xPct: 0.92, yPct: 0.06 },
      sizePct: +$('#brandLogoSize').value, opacity: +$('#brandLogoOpacity').value / 100, style: $('#brandLogoStyle').value,
    };
    syncBrandStage();
    toast('🖼 Logo đã tải lên', 'success');
  });
  $('#brandSave').addEventListener('click', async () => {
    const ch = (state.channels || []).find((c) => c.id === state.activeChannel);
    if (!ch || !state.brandDraft) return;
    const d = state.brandDraft;
    const brandKit = {
      channelName: d.channelName.trim(),
      placement: d.placement,
      logo: d.logo, nameBadge: { ...d.nameBadge, text: undefined }, stickers: d.stickers,
    };
    const ai = {};
    if ($('#brandAiTts').value) ai.tts = { ...(ch.config?.ai?.tts || {}), provider: $('#brandAiTts').value };
    if ($('#brandAiLlmModel').value.trim()) ai.llm = { ...(ch.config?.ai?.llm || {}), model: $('#brandAiLlmModel').value.trim() };
    if ($('#brandAiSub').value) ai.subtitle = { engine: $('#brandAiSub').value };
    const cfg = { ...(ch.config || {}), brandKit };
    cfg.ai = Object.keys(ai).length ? ai : null; // null = xoá override AI của kênh (deep-merge delete)
    const r = await api.put(`/channels/${ch.id}`, { config: cfg });
    if (r.error) return toast(r.error, 'error');
    ch.config = r.channel.config;
    closeModal('#brandModal');
    refreshBrandSummary();
    toast('🏷 Brand Kit đã lưu — mọi video mới của kênh sẽ tự gắn brand', 'success');
  });
}
