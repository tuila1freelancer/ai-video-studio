// initBrandKit(): the modal's controls, wired once.
import { $, $$ } from '../../ui/dom.js';
import { closeModal } from '../../ui/modals.js';
import { toast } from '../../ui/toast.js';
import { api } from '../../api.js';
import { state } from '../../state.js';
import { offerRerender } from '../changeplan.js';
import { m, tp } from '../../i18n.js';
import { refreshBrandSummary, openBrandEditor } from './draft.js';
import { applyControlState, syncBrandStage, cornerCenter, wireBrandDrag, setStampSize } from './stage.js';

export function initBrandKit() {
  const be = $('#btnBrandEditor');
  if (!be) return;
  be.addEventListener('click', openBrandEditor);
  wireStage();
  wireControls();
}

/** The stage: dragging, resizing and nudging the ghosts. */
function wireStage() {
  wireBrandDrag($('#bstLogo'), () => state.brandDraft?.stamp?.position, { snap: true });
  wireBrandDrag($('#bstBadge'), () => state.brandDraft?.badge?.position);
  // free resize: wheel over the ghost (±0.5%, shift ±2%) + corner handle drag
  $('#bstLogo').addEventListener('wheel', (e) => {
    e.preventDefault();
    const d = state.brandDraft; if (!d) return;
    setStampSize(d.stamp.wPct * 100 + (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 2 : 0.5));
    applyControlState();
  }, { passive: false });
  $('#bstRsz').addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    const h = $('#bstRsz');
    h.setPointerCapture(e.pointerId);
    const stage = $('#brandStage').getBoundingClientRect();
    const startX = e.clientX;
    const start = state.brandDraft.stamp.wPct * 100;
    const move = (ev) => { setStampSize(start + ((ev.clientX - startX) / stage.width) * 100); applyControlState(); };
    const up = () => { h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); };
    h.addEventListener('pointermove', move);
    h.addEventListener('pointerup', up);
  });
  // keyboard nudge on the focused ghost: arrows ±0.5%, shift+arrows ±2%
  $('#bstLogo').addEventListener('keydown', (e) => {
    const d = state.brandDraft; if (!d?.logo) return;
    const pos = d.stamp.position;
    const step = (e.shiftKey ? 2 : 0.5) / 100;
    let handled = true;
    if (e.key === 'ArrowLeft') pos.xPct = Math.max(0.02, pos.xPct - step);
    else if (e.key === 'ArrowRight') pos.xPct = Math.min(0.98, pos.xPct + step);
    else if (e.key === 'ArrowUp') pos.yPct = Math.max(0.02, pos.yPct - step);
    else if (e.key === 'ArrowDown') pos.yPct = Math.min(0.98, pos.yPct + step);
    else handled = false;
    if (handled) { e.preventDefault(); syncBrandStage(); }
  });
  $('#bstLogoImg').addEventListener('load', syncBrandStage);
  // corner presets — "sát mép, cách một khoảng rất nhỏ"; 🎯 = focus the ghost for dragging
  $$('#stampCorners button').forEach((b) => b.addEventListener('click', () => {
    const d = state.brandDraft; if (!d) return;
    if (!d.logo?.assetPath) return toast('Tải logo lên trước đã.', 'error');
    if (b.dataset.corner === 'free') { $('#bstLogo').focus(); return; }
    d.stamp.position = cornerCenter(b.dataset.corner);
    syncBrandStage();
  }));
  $('#brandName').addEventListener('input', () => { state.brandDraft.channelName = $('#brandName').value; syncBrandStage(); });
  $('#brandBadgeOn').addEventListener('change', () => { state.brandDraft.badge.enabled = $('#brandBadgeOn').checked; syncBrandStage(); });
  $('#brandBadgeStyle').addEventListener('change', () => { state.brandDraft.badge.style = $('#brandBadgeStyle').value; });
  $('#stampOn').addEventListener('change', () => {
    state.brandDraft.stamp.enabled = $('#stampOn').checked;
    applyControlState(); syncBrandStage();
  });
  $('#brandLogoSize').addEventListener('input', () => setStampSize(+$('#brandLogoSize').value));
  $('#brandLogoOpacity').addEventListener('input', () => {
    state.brandDraft.stamp.opacity = +$('#brandLogoOpacity').value / 100;
    syncBrandStage();
  });
}

/** The form: watermark, badge and save. */
function wireControls() {
  // watermark controls
  $('#wmOn').addEventListener('change', () => {
    state.brandDraft.watermark.enabled = $('#wmOn').checked;
    applyControlState(); syncBrandStage();
  });
  $('#wmSource').addEventListener('change', () => {
    state.brandDraft.watermark.source = $('#wmSource').value;
    applyControlState(); syncBrandStage();
  });
  $('#wmSpeed').addEventListener('change', () => { state.brandDraft.watermark.speed = $('#wmSpeed').value; });
  $('#wmSize').addEventListener('input', () => {
    const d = state.brandDraft, v = +$('#wmSize').value;
    if (d.watermark.source === 'logo') d.watermark.logoSizePct = v; else d.watermark.textSizePct = v;
    syncBrandStage();
  });
  $('#wmOpacity').addEventListener('input', () => {
    state.brandDraft.watermark.opacity = +$('#wmOpacity').value / 100;
    syncBrandStage();
  });
  $('#brandLogoClear').addEventListener('click', () => { state.brandDraft.logo = null; syncBrandStage(); });
  $('#brandLogoFile').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    // api.upload THROWS on any non-2xx — the old `if (r.error)` branch was unreachable, so a
    // rejected upload produced an unhandled rejection and the UI did NOTHING AT ALL: no toast,
    // no message, the logo simply never appeared. Every failure has to be visible.
    try {
      if (!state.brandDraft) throw new Error(m('Mở Brand Kit của kênh trước khi tải logo'));
      const fd = new FormData(); fd.append('file', f);
      const r = await api.upload(`/channels/${state.activeChannel}/brand-logo`, fd);
      state.brandDraft.logo = { assetPath: r.path };
      if (!$('#stampOn').checked) { $('#stampOn').checked = true; state.brandDraft.stamp.enabled = true; applyControlState(); }
      syncBrandStage();
      toast(r.converted ? tp`🖼 Logo đã tải lên (đổi từ ${r.converted} sang PNG)` : m('🖼 Logo đã tải lên'), 'success');
    } catch (err) {
      toast(tp`✖ Không tải được logo: ${err.message}`, 'error');
    } finally {
      // let the SAME file be picked again after a failure — a file input does not re-fire
      // 'change' for an unchanged value, so without this a retry needs a different file
      e.target.value = '';
    }
  });
  $('#brandSave').addEventListener('click', async () => {
    const ch = (state.channels || []).find((c) => c.id === state.activeChannel);
    if (!ch || !state.brandDraft) return;
    const d = state.brandDraft;
    const brandKit = {
      channelName: d.channelName.trim(),
      placement: null, // PUT deep-merges — null explicitly deletes the legacy smart/always key
      logo: d.logo,
      nameBadge: { enabled: d.badge.enabled, style: d.badge.style, position: d.badge.position },
      stickers: d.stickers,
      finalOverlay: {
        enabled: d.stamp.enabled && !!d.logo,
        cxPct: d.stamp.position.xPct, cyPct: d.stamp.position.yPct,
        wPct: d.stamp.wPct, opacity: d.stamp.opacity,
      },
      watermark: {
        enabled: d.watermark.enabled,
        source: d.watermark.source, speed: d.watermark.speed, opacity: d.watermark.opacity,
        wPct: d.watermark.logoSizePct / 100, hPct: d.watermark.textSizePct / 100,
      },
    };
    const ai = {};
    if ($('#brandAiTts').value) ai.tts = { ...(ch.config?.ai?.tts || {}), provider: $('#brandAiTts').value };
    if ($('#brandAiLlmModel').value.trim()) ai.llm = { ...(ch.config?.ai?.llm || {}), model: $('#brandAiLlmModel').value.trim() };
    if ($('#brandAiSub').value) ai.subtitle = { engine: $('#brandAiSub').value };
    const cfg = { ...(ch.config || {}), brandKit };
    cfg.ai = Object.keys(ai).length ? ai : null; // null = xoá override AI của kênh (deep-merge delete)
    cfg.fonts = $('#brandFont')?.value ? { display: $('#brandFont').value } : null;
    const r = await api.put(`/channels/${ch.id}`, { config: cfg });
    if (r.error) return toast(r.error, 'error');
    ch.config = r.channel.config;
    closeModal('#brandModal');
    refreshBrandSummary();
    // The brand kit lives on the CHANNEL, so nothing in the config panel moved and the delegated
    // listener never fires — but the finished video is now out of date all the same.
    (await import('../pending-changes.js')).schedulePendingCheck({ now: true });
    toast('🏷 Brand Kit đã lưu — mọi video mới của kênh sẽ tự gắn brand', 'success');
    // …and the video already on screen? finalize reads the brand kit LIVE from the channel, so
    // one join is all it takes — but nothing said so, and the only route to it was knowing that
    // the resume button on a finished project had become an apply-changes button.
    await offerRerender(m('Đã đổi nhận diện thương hiệu của kênh'));
  });
}
