// The subtitle studio: the 30 controls as one field table, their read/write/sync, the colour row, the channel's remembered defaults and the live preview through the real burn style.
import { $, el } from '../../ui/dom.js';
import { toast } from '../../ui/toast.js';
import { api } from '../../api.js';
import { state } from '../../state.js';
import { confirmDialog } from '../../ui/dialog.js';

import { m, tp } from '../../i18n.js';
import { ensureFontLoaded } from './fonts.js';
import { gatherConfig, applying } from './form.js';
import { updateCfgChips } from './groups.js';

// Output resolution: the value stored in config.resolutionScale, and the label on the chip.
// Mirrors resRung() in src/animation/index.js — 1.3333 lands on exactly 2560×1440.
export const RES_LABEL = { 1: '1080p', 1.3333: '2K', 2: '4K' };
export const resRung = (v) => [1, 1.3333, 2]
  .reduce((b, r) => (Math.abs(r - (+v || 1)) < Math.abs(b - (+v || 1)) ? r : b), 1);

const SUB_COLORS = ['#F7B500', '#FFFFFF', '#00E5FF', '#FF5252', '#69F0AE', '#FF80AB', '#E040FB', '#FF6D00', '#40C4FF'];

/**
 * The subtitle studio's controls, declared once.
 *
 * Every one of these has to cross six places to survive — markup, gather, restore, the client
 * whitelist, the server whitelist, the resolver — and a setting that misses the restore or a
 * whitelist works for exactly one video and is silently gone from the next. Thirty of them written
 * out by hand four times over is thirty chances to miss one, so gather and restore are generated
 * from this table and the whitelist IS this table's keys.
 *
 * `off` is the value that means "not set": it is what the control reads when the owner has not
 * touched it, and it is emitted as `undefined` so the channel's own setting still wins the merge
 * (mergeConfigLayers skips only undefined — see gatherConfig below).
 *
 * `off: null` means the control has no resting value that could stand for "unset" — a margin
 * slider parked at 12 is indistinguishable from someone choosing 12. Those emit only once touched,
 * the same rule colour pickers need. It matters: the burn's own default vertical margin is 7% on
 * a landscape frame, so a panel that shipped its slider's 12 would quietly move every caption up
 * the moment the subtitle settings were saved.
 */
export const SUB_FIELDS = [
  { k: 'subtitleWeight', el: '#cfgSubWeight', t: 'num' },
  { k: 'subtitleLetterSpacing', el: '#cfgSubLetterSpacing', t: 'num', off: 0, out: '#cfgSubLsL' },
  { k: 'subtitleScaleX', el: '#cfgSubScaleX', t: 'num', off: 100, out: '#cfgSubSxL' },
  { k: 'subtitleScaleY', el: '#cfgSubScaleY', t: 'num', off: 100, out: '#cfgSubSyL' },
  { k: 'subtitleAngle', el: '#cfgSubAngle', t: 'num', off: 0, out: '#cfgSubAngleL' },
  { k: 'subtitleItalic', el: '#cfgSubItalic', t: 'bool' },
  { k: 'subtitleUnderline', el: '#cfgSubUnderline', t: 'bool' },
  { k: 'subtitleStrike', el: '#cfgSubStrike', t: 'bool' },

  { k: 'subtitleBaseColor', el: '#cfgSubBaseColor', t: 'color', dflt: '#FFFFFF' },
  { k: 'subtitleDimUnread', el: '#cfgSubDimUnread', t: 'pct', off: 40, out: '#cfgSubDimUL' },
  { k: 'subtitleOutlineColor', el: '#cfgSubOutlineColor', t: 'color', dflt: '#000000' },
  { k: 'subtitleOutlineWidth', el: '#cfgSubOutlineWidth', t: 'num', off: 0, out: '#cfgSubOwL', auto: () => m('theo bộ mẫu') },
  { k: 'subtitleShadowColor', el: '#cfgSubShadowColor', t: 'color', dflt: '#000000' },
  { k: 'subtitleShadowDepth', el: '#cfgSubShadowDepth', t: 'num', off: 0, out: '#cfgSubSdL', auto: () => m('theo bộ mẫu') },
  { k: 'subtitleGlowColor', el: '#cfgSubGlowColor', t: 'color', dflt: '#00E5FF' },
  { k: 'subtitleGlow', el: '#cfgSubGlow', t: 'num', off: 0, out: '#cfgSubGlowL', auto: () => m('tắt') },

  { k: 'subtitleBox', el: '#cfgSubBox', t: 'bool' },
  { k: 'subtitleBoxColor', el: '#cfgSubBoxColor', t: 'color', dflt: '#0A0A10' },
  { k: 'subtitleBoxOpacity', el: '#cfgSubBoxOpacity', t: 'pct', off: null, dflt: 85, out: '#cfgSubBoxOpL' },
  { k: 'subtitleBoxRadius', el: '#cfgSubBoxRadius', t: 'num', off: null, dflt: 0, out: '#cfgSubBoxRL' },
  { k: 'subtitleBoxBorderColor', el: '#cfgSubBoxBorderColor', t: 'color', dflt: '#00E5FF' },
  { k: 'subtitleBoxBorderWidth', el: '#cfgSubBoxBorderWidth', t: 'num', off: null, dflt: 0, out: '#cfgSubBoxBwL' },

  { k: 'subtitleAlignH', el: '#cfgSubAlignH', t: 'str', off: 'center' },
  { k: 'subtitleMarginV', el: '#cfgSubMarginV', t: 'num', off: null, dflt: 12, out: '#cfgSubMvL' },
  { k: 'subtitleMarginH', el: '#cfgSubMarginH', t: 'num', off: null, dflt: 6, out: '#cfgSubMhL' },
  { k: 'subtitleMaxChars', el: '#cfgSubMaxChars', t: 'num', off: 0 },
  { k: 'subtitleMaxLines', el: '#cfgSubMaxLines', t: 'num', off: 0 },

  { k: 'subtitleKaraokeStyle', el: '#cfgSubKaraokeStyle', t: 'str', off: 'color' },
  { k: 'subtitleReveal', el: '#cfgSubReveal', t: 'bool' },
  { k: 'subtitlePopScale', el: '#cfgSubPopScale', t: 'num', off: null, dflt: 112, out: '#cfgSubPopL' },
  { k: 'subtitleFadeIn', el: '#cfgSubFadeIn', t: 'num', off: 0, out: '#cfgSubFiL' },
  { k: 'subtitleFadeOut', el: '#cfgSubFadeOut', t: 'num', off: 0, out: '#cfgSubFoL' },
];

/** What a field's control currently says, or `undefined` for "the owner has not set this". */
// Resolved once: every slider tick reads all 33 fields, and the group body is moved between the
// column and the modal, never cloned, so the node stays the right node.
const node = (f) => (f.node ||= $(f.el));
const outNode = (f) => (f.outNode ||= $(f.out));
function readSubField(f) {
  const el = node(f);
  if (!el) return undefined;
  if (f.t === 'bool') return el.checked ? true : undefined;
  // A colour input and an `off: null` slider both sit on a value that is not a decision, so what
  // counts is whether the owner has touched them.
  if (f.t === 'color' || f.off === null) {
    if (el.dataset.set !== '1') return undefined;
    if (f.t === 'color') return el.value.toUpperCase();
  }
  const raw = el.value;
  if (raw === '' || raw == null) return undefined;
  const n = f.t === 'pct' ? +raw / 100 : +raw;
  if (!Number.isFinite(n)) return undefined;
  // `off` is the control's resting position, not a choice — emitting it would pin the panel's
  // default over a channel that had said something else.
  const off = f.t === 'pct' && f.off != null ? f.off / 100 : f.off;
  return off != null && n === off ? undefined : n;
}

export function writeSubField(f, cfg) {
  const el = node(f);
  if (!el) return;
  const v = cfg[f.k];
  // UNCONDITIONAL, like every other subtitle restore: applyConfig runs on every channel switch,
  // so a guarded write leaves the previous channel's value sitting in the control.
  if (f.t === 'bool') el.checked = v === true;
  else if (f.t === 'color') {
    el.value = typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : (f.dflt || '#FFFFFF');
    el.dataset.set = typeof v === 'string' ? '1' : '';
  } else {
    const n = f.t === 'pct' && Number.isFinite(+v) ? +v * 100 : v;
    const has = v != null && Number.isFinite(+n);
    el.value = has ? String(Math.round(+n * 100) / 100) : String(f.dflt ?? f.off ?? '');
    // a stored value IS a decision — without this the next autosave would drop it again
    if (f.off === null) el.dataset.set = has ? '1' : '';
  }
  syncSubOut(f);
}

// Built per call, never at import: the catalogue is fetched after this module is evaluated.
const weightName = (w) => ({ 100: m('Mảnh'), 200: m('Rất nhẹ'), 300: m('Nhẹ'), 400: m('Thường'), 500: m('Vừa'), 600: m('Hơi đậm'), 700: m('Đậm'), 800: m('Rất đậm'), 900: m('Đen') }[w] || '');

/**
 * Offer only the weights this font actually has.
 *
 * The burn stages ONE file into fontsdir and picks it by nearest weight (fonts/files.js
 * resolveFace), so asking for a weight the family does not carry is answered silently with a
 * different one. A picker listing 100–900 for a font that ships only 400 would be a control that
 * appears to do something and does not.
 */
export function syncSubWeights() {
  const sel = $('#cfgSubWeight');
  if (!sel) return;
  const fam = $('#cfgSubFont')?.value;
  const entry = (state.fontFamilies || []).find((f) => f.family === fam);
  const weights = (entry?.weights?.length ? entry.weights : [400, 700]).slice().sort((a, b) => a - b);
  const cur = sel.value;
  sel.innerHTML = `<option value="">${m('Theo bộ mẫu')}</option>`
    + weights.map((w) => `<option value="${w}">${w} — ${weightName(w)}</option>`).join('');
  sel.value = weights.includes(+cur) ? cur : '';
}

/** Show only the rows that mean anything right now — the box's own settings, the pop scale. */
export function syncSubStudio() {
  $('#subBoxOpts')?.classList.toggle('hidden', !$('#cfgSubBox')?.checked);
  $('#subPopRow')?.classList.toggle('hidden', $('#cfgSubKaraokeStyle')?.value !== 'pop');
}

/**
 * Put every studio control back to "not set".
 *
 * Worth a button of its own because the settings are unset-by-omission: there is no value that
 * means default, so without this the only way back from an experiment is to remember what each
 * slider started at.
 */
export async function resetSubStudio() {
  const ok = await confirmDialog(m('Trả mọi tinh chỉnh phụ đề về mặc định? Bộ mẫu đang chọn được giữ nguyên.'));
  if (!ok) return;
  SUB_FIELDS.forEach((f) => writeSubField(f, {}));
  syncSubStudio(); updateSubPreview(); updateCfgChips();
  saveSubtitleDefaults({ now: true });
  toast('↺ Đã trả tinh chỉnh phụ đề về mặc định', 'success');
}

/** Every studio field the owner has actually set, plus the four-sided box padding. */
export function gatherSubFields() {
  const out = {};
  for (const f of SUB_FIELDS) {
    const v = readSubField(f);
    if (v !== undefined) out[f.k] = v;
  }
  // Padding is one setting with four numbers, and it only means anything with a box: sending it
  // otherwise would write a value the owner cannot see the effect of.
  if (out.subtitleBox) {
    const side = (id) => Math.max(0, Math.min(200, +($(id)?.value ?? 0) || 0));
    out.subtitleBoxPadding = {
      top: side('#cfgSubPadTop'), right: side('#cfgSubPadRight'),
      bottom: side('#cfgSubPadBottom'), left: side('#cfgSubPadLeft'),
    };
  }
  return out;
}

/** Keep a slider's number readout honest — including "theo bộ mẫu" for the ones that can be unset. */
export function syncSubOut(f) {
  if (!f.out) return;
  const out = outNode(f); const el = node(f);
  if (!out || !el) return;
  const off = f.t === 'pct' ? f.off : f.off;
  out.textContent = f.auto && +el.value === (off ?? 0) ? f.auto() : el.value;
}

export function buildSubColors() {
  const box = $('#cfgSubColors'); if (!box) return; box.innerHTML = '';
  SUB_COLORS.forEach((c) => {
    const s = el('button', 'sw' + (c === state.subColor ? ' active' : '')); s.style.background = c;
    s.addEventListener('click', () => { state.subColor = c; buildSubColors(); updateSubPreview(); saveSubtitleDefaults(); });
    box.appendChild(s);
  });
  // P43: the nine swatches are shortcuts, not the whole palette — any colour is allowed.
  const custom = $('#cfgSubColorCustom');
  if (custom) {
    custom.value = /^#[0-9a-f]{6}$/i.test(state.subColor) ? state.subColor : '#F7B500';
    custom.oninput = () => { state.subColor = custom.value; buildSubColors(); updateSubPreview(); saveSubtitleDefaults(); };
  }
}
/**
 * Say where the subtitles are drawn — and, for a project made before the rule, what moving it
 * over will cost.
 *
 * There is nothing to choose here any more. The panel used to offer a "vẽ trong từng cảnh" lane
 * and it was a trap: captions drawn inside a clip are an INPUT to that clip, so changing the font
 * meant re-rendering every scene, and once burned in they could not be taken back out.
 */
export function updateSubLaneHint(cfg = null) {
  const el = $('#subLaneHint');
  if (!el) return;
  const legacy = cfg && cfg.subtitleLane !== 'final' && !!state.current?.video_path;
  // ONE msgid per sentence: the source split these only to wrap the line, and a translator
  // handed half a clause cannot reorder it.
  el.innerHTML = m('💡 Phụ đề được in <strong>sau khi ghép video hoàn chỉnh</strong>, không nướng vào từng cảnh — nên đổi chữ, font, cỡ, màu hay vị trí về sau chỉ tốn <strong>một lượt ghép</strong>.')
    + (legacy
      ? '<br>' + m('⚠ Video này được dựng theo cách cũ (phụ đề nằm sẵn trong từng cảnh). Lần lưu cấu hình tới sẽ chuyển nó sang cách mới: phải dựng lại clip <em>không có</em> phụ đề <strong>một lần duy nhất</strong> — bảng chi phí sẽ báo trước khi chạy.')
      : '');
}

// ---------------- the channel remembers its subtitles ----------------
// Editing a channel's subtitles saves them for that channel, so the next video starts where the
// last one left off. Before this the style lived only in the project being
// edited, and carrying it forward meant finding a save icon inside the channel-management dialog
// that wrote the WHOLE panel over the channel — so most videos got their font picked again.
//
// The server owns what may be stored and what counts as a real value
// (api/services/subtitle-defaults.js). That is what makes the on/off switch safe: turning
// subtitles off sends `enableSubtitles: false` and nothing else changes, so turning them back on
// restores the same look.
const SUBTITLE_CFG_KEYS = ['enableSubtitles', 'subtitleMode', 'subtitleChunk', 'subtitleWordsPerCue',
  'subtitlePreset', 'subtitleFont', 'subtitleFontSize', 'subtitleTextCase', 'subtitleColor', 'subtitlePosition',
  // …and every control in the studio table, so the list cannot fall behind the panel
  ...SUB_FIELDS.map((f) => f.k), 'subtitleBoxPadding'];

export function gatherSubtitleConfig() {
  const all = gatherConfig();
  return Object.fromEntries(SUBTITLE_CFG_KEYS.filter((k) => all[k] !== undefined).map((k) => [k, all[k]]));
}

let subSaveTimer = null;
/** Persist the subtitle look onto the active channel. Debounced — this runs on every keystroke. */
export function saveSubtitleDefaults({ now = false } = {}) {
  if (applying || !state.activeChannel) return;
  clearTimeout(subSaveTimer);
  const go = async () => {
    const note = $('#subSaveNote');
    try {
      const r = await api.put(`/channels/${state.activeChannel}/subtitle-defaults`, { config: gatherSubtitleConfig() });
      const ch = (state.channels || []).find((c) => c.id === state.activeChannel);
      if (ch && r.channel) ch.config = r.channel.config; // keep the in-memory copy honest
      if (note) {
        note.textContent = tp`💾 Đã lưu kiểu phụ đề cho kênh ${ch?.name || ''}`.trim()
          + (r.presetUpdated ? m(' (kể cả preset mặc định)') : '') + m(' — video sau tự dùng lại.');
      }
    } catch (e) {
      if (note) note.textContent = tp`⚠ Chưa lưu được kiểu phụ đề cho kênh: ${e.message}`;
    }
  };
  if (now) go(); else subSaveTimer = setTimeout(go, 700);
}

// The effects the renderer draws, restated in CSS. Kept in the same order and with the same
// numbers as buildScenePage's capActFx branch so the two cannot drift apart quietly.
function previewEffect(effect, fs, color, boxBg, adv = {}) {
  // An explicit outline, shadow or glow beats the preset's effect — the same precedence the
  // renderer uses, and the reason to restate it here rather than keep two ideas of the look.
  const bits = [];
  if (adv.outlineWidth) bits.push(`-webkit-text-stroke:${adv.outlineWidth}px ${adv.outlineColor || 'rgba(0,0,0,.92)'}`);
  if (adv.glow) bits.push(`text-shadow:0 0 ${adv.glow * 1.6}px ${adv.glowColor || color},0 0 ${adv.glow * 0.6}px ${adv.glowColor || color}`);
  else if (adv.shadowDepth) bits.push(`text-shadow:0 ${adv.shadowDepth}px ${adv.shadowDepth * 1.4}px ${adv.shadowColor || 'rgba(0,0,0,.8)'}`);
  if (bits.length) return bits.join(';');
  if (effect === 'outline') return `-webkit-text-stroke:${Math.max(1, Math.round(fs * 0.045))}px rgba(0,0,0,.92);text-shadow:0 2px 8px rgba(0,0,0,.85)`;
  if (effect === 'box') return `background:${boxBg || 'rgba(10,10,16,.85)'};padding:.06em .28em;border-radius:.16em;box-decoration-break:clone;text-shadow:none`;
  if (effect === 'shadow') return 'text-shadow:0 2px 0 rgba(0,0,0,.85),0 5px 16px rgba(0,0,0,.7)';
  return `text-shadow:0 0 ${Math.round(fs * 0.5)}px ${color}, 0 0 ${Math.round(fs * 0.18)}px ${color}`;
}

/** `#RRGGBB` + 0..1 → `rgba()`, so the preview box can honour its opacity like the burn does. */
export function rgba(hex, alpha) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return `rgba(10,10,16,${alpha})`;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * Show what the video will look like, not a coloured word in the app's own font.
 *
 * The old preview set `fontFamily` and a colour. That was the entire extent of it — no effect, no
 * position, no karaoke, and (because the UI stylesheet carried two families) usually not even
 * the right typeface. It answered a question nobody had while looking like it answered the one
 * everybody did.
 */
export function updateSubPreview() {
  const p = $('#subPreview'); if (!p) return;
  const fam = $('#cfgSubFont').value.split(',')[0].replace(/['"]/g, '').trim();
  ensureFontLoaded(fam);
  const preset = state.subPresets?.find((x) => x.id === state.subPreset);
  const plain = $('#cfgSubMode')?.value === 'plain';
  const pos = $('#cfgSubPos')?.value || 'bot';
  const fs = Math.round((+$('#cfgSubSize').value || 80) * 0.28); // preview box ≈ 28% of frame height
  const accent = state.subColor || preset?.activeColor || '#F7B500';
  const base = preset?.baseColor || '#FFFFFF';
  const effect = preset?.effect || 'glow';

  let txt = plain ? m('Phụ đề thường — dòng tĩnh') : m('Phụ đề mẫu của bạn');
  // same precedence as captionStyleFrom / assStyleFrom: an explicit pick, else the preset's
  const c = $('#cfgSubCase').value || preset?.textCase || 'original';
  if (c === 'uppercase') txt = txt.toUpperCase();
  else if (c === 'lowercase') txt = txt.toLowerCase();
  else if (c === 'titlecase') txt = txt.replace(/\p{L}[\p{L}\p{M}']*/gu, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());

  const words = txt.split(' ');
  const hit = plain ? -1 : Math.min(words.length - 1, 2); // one word accented, like the renderer
  const align = { bot: 'flex-end', mid: 'center', top: 'flex-start' }[pos] || 'flex-end';

  // The studio's own settings, at the same scale the preview draws text — 28% of the frame. A
  // preview that ignored them is what let the reported bug live: it showed the owner's pick while
  // the renderer used something else, so it looked right until the video came out.
  const cfg = gatherSubFields();
  const k = fs / (+$('#cfgSubSize').value || 80); // the preview's own px-per-config-px
  const adv = {
    outlineColor: cfg.subtitleOutlineColor, outlineWidth: (cfg.subtitleOutlineWidth || 0) * k,
    shadowColor: cfg.subtitleShadowColor, shadowDepth: (cfg.subtitleShadowDepth || 0) * k,
    glowColor: cfg.subtitleGlowColor, glow: (cfg.subtitleGlow || 0) * k,
  };
  const baseCol = cfg.subtitleBaseColor || base;
  const dimU = cfg.subtitleReveal ? 0 : (cfg.subtitleDimUnread ?? 0.55);
  const hAlign = { left: 'flex-start', right: 'flex-end' }[cfg.subtitleAlignH] || 'center';
  const wordFx = (i) => {
    if (i !== hit) return '';
    if (cfg.subtitleKaraokeStyle === 'box') return `background:${accent};color:${readableOnHex(accent)};padding:.04em .22em;border-radius:.12em;box-decoration-break:clone`;
    if (cfg.subtitleKaraokeStyle === 'pop') return `display:inline-block;transform:scale(${(cfg.subtitlePopScale || 112) / 100})`;
    return '';
  };
  const pad = cfg.subtitleBoxPadding || {};
  const boxCss = cfg.subtitleBox
    ? `background:${rgba(cfg.subtitleBoxColor || '#0A0A10', cfg.subtitleBoxOpacity ?? 0.85)};`
      + `border-radius:${(cfg.subtitleBoxRadius || 0) * k}px;`
      + `padding:${(pad.top || 0) * k}px ${(pad.right || 0) * k}px ${(pad.bottom || 0) * k}px ${(pad.left || 0) * k}px;`
      + (cfg.subtitleBoxBorderWidth ? `border:${Math.max(1, cfg.subtitleBoxBorderWidth * k)}px solid ${cfg.subtitleBoxBorderColor || '#00E5FF'};` : '')
    : '';

  // A checkerboard, not a flat near-black: a dark caption box on a dark backdrop is invisible, and
  // the box's opacity — a setting the owner can now change — cannot be judged against anything
  // opaque. The squares make both readable at a glance.
  p.style.cssText = 'margin-top:8px;border-radius:8px;padding:12px;display:flex;'
    + 'background:#0d1018;background-image:linear-gradient(45deg,#191f2e 25%,transparent 25%,transparent 75%,#191f2e 75%),'
    + 'linear-gradient(45deg,#191f2e 25%,transparent 25%,transparent 75%,#191f2e 75%);'
    + 'background-size:22px 22px;background-position:0 0,11px 11px;'
    + `align-items:${align};justify-content:${hAlign};min-height:118px;overflow:hidden`;
  p.innerHTML = `<div style="${boxCss}font-family:'${fam}',sans-serif;`
    + `font-weight:${cfg.subtitleWeight || preset?.weight || 800};`
    + `font-size:${fs}px;line-height:1.2;text-align:center;`
    + `${cfg.subtitleItalic ? 'font-style:italic;' : ''}`
    + `${cfg.subtitleUnderline || cfg.subtitleStrike ? `text-decoration:${[cfg.subtitleUnderline && 'underline', cfg.subtitleStrike && 'line-through'].filter(Boolean).join(' ')};` : ''}`
    + `${cfg.subtitleLetterSpacing ? `letter-spacing:${cfg.subtitleLetterSpacing * k}px;` : ''}`
    + `${cfg.subtitleScaleX || cfg.subtitleScaleY || cfg.subtitleAngle ? `transform:scale(${(cfg.subtitleScaleX || 100) / 100},${(cfg.subtitleScaleY || 100) / 100}) rotate(${-(cfg.subtitleAngle || 0)}deg);` : ''}">`
    + words.map((w, i) => `<span style="color:${i === hit ? accent : baseCol};opacity:${i === hit ? 1 : (i < hit ? 0.95 : dimU)};`
      + `${previewEffect(effect, fs, i === hit ? accent : baseCol, preset?.boxBg, adv)};${wordFx(i)}">${w}</span>`).join(' ')
    + '</div>';
}

/** The same luminance rule the burn uses to pick text inside a per-word highlight box. */
function readableOnHex(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return '#000000';
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
  const lin = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) > 0.36 ? '#000000' : '#FFFFFF';
}
