// Brand Kit constants, the summary chip in the config panel, and the draft the editor works on.
import { $, esc } from '../../ui/dom.js';
import { toast } from '../../ui/toast.js';
import { api, thumbUrl } from '../../api.js';
import { state, activeChannelBrand } from '../../state.js';
import { updateCfgChips } from '../../views/config.js';
import { m, tp } from '../../i18n.js';
import { arValue, frameWH, applyControlState, syncBrandStage, startWmPreview } from './stage.js';

// Output resolution per aspect — mirrors src/util/util.js ratioToSize (P26 readout numbers).
export const RATIO_SIZE = { '9:16': [1080, 1920], '16:9': [1920, 1080], '1:1': [1080, 1080], '4:5': [1080, 1350] };
export const SNAPS = [0.03, 1 / 3, 0.5, 2 / 3, 0.97]; // margins, thirds, center
export const CORNER_GAP = 0.025;    // stamp corner presets: gap = 2.5% of min(W,H) — "sát mép một xíu"
export const WM_MARGIN = 0.02;      // watermark path margin — mirrors media/watermark.js marginPct
export const WM_PERIODS = { slower: 120, slow: 75, medium: 45 };
export const WM_PREVIEW_SPEED = 5;  // preview runs ×5 so the drift is visible while editing

export function refreshBrandSummary() {
  const bk = activeChannelBrand();
  const th = $('#bsThumb'), nm = $('#bsName'), mt = $('#bsMeta');
  if (!th) return;
  if (bk) {
    th.innerHTML = bk.logo?.assetPath ? `<img src="${thumbUrl(bk.logo.assetPath, 160)}" loading="lazy" alt="">` : '🏷';
    nm.textContent = bk.channelName || m('Brand kit (chỉ logo)');
    const bits = [];
    if (bk.finalOverlay?.enabled && bk.logo?.assetPath) bits.push(m('đóng dấu logo'));
    if (bk.watermark?.enabled) bits.push(m('watermark trôi'));
    if (bk.nameBadge?.enabled !== false && bk.channelName) bits.push(m('tên kênh'));
    mt.textContent = bits.length ? tp`Cố định: ${bits.join(' · ')}` : m('Chưa bật thành phần nào');
  } else {
    th.textContent = '🏷'; nm.textContent = m('Chưa cấu hình brand');
    mt.textContent = m('Logo đóng dấu + watermark + tên kênh (đều cố định, WYSIWYG)');
  }
  const lw = $('#legacyWatermark'); if (lw) lw.style.display = bk ? 'none' : 'block';
  updateCfgChips();
}

export function openBrandEditor() {
  const ch = (state.channels || []).find((c) => c.id === state.activeChannel);
  if (!ch) return toast('Chưa có kênh đang chọn.', 'error');
  const bk = ch.config?.brandKit || {};
  const fo = bk.finalOverlay || null;
  const [W, H] = frameWH();
  // Legacy migration (pre-stamp configs): placement smart/always carried a per-scene logo —
  // map its geometry onto the stamp so the owner's logo survives the smart-lane removal.
  const legacyStamp = !fo && bk.logo?.assetPath && bk.placement && bk.placement !== 'off';
  state.brandDraft = {
    channelName: bk.channelName || ch.name || '',
    logo: bk.logo?.assetPath ? { assetPath: bk.logo.assetPath } : null,
    badge: {
      enabled: bk.placement === 'off' ? false : (bk.nameBadge ? bk.nameBadge.enabled !== false : true),
      style: bk.nameBadge?.style || 'plain',
      position: { ...(bk.nameBadge?.position || { xPct: 0.5, yPct: 0.045 }) },
    },
    stamp: {
      enabled: fo ? fo.enabled === true : legacyStamp,
      position: fo
        ? { xPct: num(fo.cxPct, 0.92), yPct: num(fo.cyPct, 0.08) }
        : { xPct: num(bk.logo?.position?.xPct, 0.92), yPct: num(bk.logo?.position?.yPct, 0.08) },
      wPct: fo ? num(fo.wPct, 0.085)
        : Math.min(0.4, Math.max(0.02, ((bk.logo?.sizePct || 8.5) / 100) * (Math.min(W, H) / W))),
      opacity: num(fo ? fo.opacity : bk.logo?.opacity, 0.9),
    },
    watermark: {
      enabled: bk.watermark?.enabled === true,
      source: bk.watermark?.source === 'name' ? 'name' : 'logo',
      speed: WM_PERIODS[bk.watermark?.speed] ? bk.watermark.speed : 'slow',
      opacity: num(bk.watermark?.opacity, 0.35),
      logoSizePct: Math.min(20, Math.max(3, num(bk.watermark?.wPct, 0.06) * 100)),
      textSizePct: Math.min(6, Math.max(1.8, num(bk.watermark?.hPct, 0.028) * 100)),
    },
    stickers: bk.stickers || [],
  };
  const d = state.brandDraft;
  $('#brandChName').textContent = ch.name;
  $('#brandName').value = d.channelName;
  $('#brandBadgeOn').checked = d.badge.enabled;
  $('#brandBadgeStyle').value = d.badge.style;
  $('#stampOn').checked = d.stamp.enabled;
  $('#wmOn').checked = d.watermark.enabled;
  $('#wmSource').value = d.watermark.source;
  $('#wmSpeed').value = d.watermark.speed;
  $('#wmOpacity').value = Math.round(d.watermark.opacity * 100);
  // per-channel AI overrides (compact)
  const ai = ch.config?.ai || {};
  $('#brandAiTts').innerHTML = `<option value="">${esc(m('— Dùng cấu hình chung —'))}</option>`
    + (state.providers || []).map((p) => `<option value="${p.id}"${ai.tts?.provider === p.id ? ' selected' : ''}>${esc(p.name)}</option>`).join('');
  $('#brandAiLlmModel').value = ai.llm?.model || '';
  $('#brandAiSub').value = ai.subtitle?.engine || '';
  api.get('/fonts/families', { ttl: 5000 }).then(({ families }) => {
    const sel = $('#brandFont');
    if (!sel) return;
    sel.innerHTML = `<option value="">${esc(m('— Theo style guide —'))}</option>`
      + (families || []).map((f) => `<option value="${esc(f.family)}">${f.source === 'uploaded' ? '📤 ' : ''}${esc(f.family)}</option>`).join('');
    sel.value = ch.config?.fonts?.display || '';
  }).catch(() => { /* picker just stays on the default option */ });
  // stage: true render aspect, latest real frame as backdrop, checkerboard when none
  const stage = $('#brandStage');
  const ar = arValue();
  stage.classList.toggle('landscape', ar === '16:9');
  stage.style.aspectRatio = ar.replace(':', '/');
  stage.style.maxHeight = ({ '16:9': '42vh', '1:1': '52vh', '4:5': '58vh' })[ar] || '66vh';
  const proj = state.projects.find((p) => p.thumb_path) || null;
  const scenePrev = state.scenes.find((s) => s.image_path)?.image_path;
  // The stage is at most ~66vh tall; a 640-px copy of the frame is plenty and a tenth of the file.
  const bg = scenePrev ? `url('${thumbUrl(scenePrev, 640)}')` : (proj ? `url('${thumbUrl(proj.thumb_path, 640)}')` : '');
  stage.style.backgroundImage = bg;
  stage.classList.toggle('checker', !bg);
  $('#bstStageMeta').textContent = tp`Khung xem trước đúng tỉ lệ render: ${W}×${H} (${ar})`;
  applyControlState();
  syncBrandStage();
  startWmPreview();
  $('#brandModal').classList.add('open');
}

const num = (v, dflt) => (Number.isFinite(+v) ? +v : dflt);

// show/hide option groups + slider values that follow the draft
