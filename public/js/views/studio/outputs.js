// What a finished project shows: the final video and its caption tracks, the publish ledger, the metadata panel.
import { $, esc } from '../../ui/dom.js';
import { toast } from '../../ui/toast.js';
import { api, fileUrl } from '../../api.js';
import { state } from '../../state.js';
import { t, m, tp } from '../../i18n.js';
import { openImageViewer } from './source.js';
import { fmtBytes, fmtDate } from '../../ui/format.js';
import { LANGS } from '../../ui/langs.js';

// Caption tracks the owner can export. Named in the language itself, like the interface picker.
// i18n-exempt: endonyms — a language names itself, so the picker stays usable in any interface.

// ---------------- final + meta ----------------
export function renderFinal() {
  const p = state.current;
  const show = p && p.video_path && p.status === 'done';
  $('#finalView').classList.toggle('hidden', !show);
  if (show) {
    import('../../features/aftercare.js').then((m) => m.initAftercare()); // its buttons exist only here
    $('#finalVideo').src = fileUrl(p.video_path);
    $('#btnDownload').href = fileUrl(p.video_path);
    $('#btnDownloadSrt').href = '/api/projects/' + p.id + '/srt';
    // One video, many caption tracks. YouTube takes a track per language on an existing upload,
    // so this reaches another audience for the price of some text and no render at all.
    const langSel = $('#btnSrtLang');
    if (langSel) {
      const own = p.config?.language && p.config.language !== 'auto' ? p.config.language : null;
      langSel.innerHTML = `<option value="">${esc(t('ui.finalView.srt-goc', null, '⬇ Ngôn ngữ gốc'))}</option>`
        + LANGS.filter(([c]) => c !== own).map(([c, label]) => `<option value="${c}">${esc(label)}</option>`).join('');
      langSel.value = '';
      langSel.onchange = () => {
        if (!langSel.value) return;
        // A download, not a fetch: the reply is a file, and translating a long video takes a while.
        window.location.href = `/api/projects/${p.id}/srt?lang=${langSel.value}&format=vtt`;
        langSel.value = '';
      };
    }
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
  if (!rows.length) { box.innerHTML = `<span style="opacity:.6">${m('Chưa đăng ở đâu.')}</span>`; return; }
  const ICON = { youtube: '▶️', facebook: '📘' };
  box.innerHTML = rows.slice(0, 6).map((r) => {
    const when = r.created_at ? fmtDate(r.created_at) : '';
    const mark = r.status === 'done' ? '✅' : (r.status === 'error' ? '❌' : '⏳');
    const link = r.url ? ` <a href="${esc(r.url)}" target="_blank" rel="noopener">${m('mở')}</a>` : '';
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
  const md = state.current && state.current.metadata;
  if (!md) { box.innerHTML = ''; return; }
  const pf = md.platforms || {};
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
          <button class="mf-c" data-copy="${esc(val)}" title="${esc(m('Sao chép'))}">⧉</button></div>
        <div class="mf-v${f.list ? ' chips' : ''}">${f.list
          ? (row[f.key] || []).map((x) => `<span class="tag-chip">${esc(x)}</span>`).join('')
          : esc(val)}</div>
      </div>`;
    }).join('');
    return `<div class="meta-card"><div class="mt">${spec.icon} ${esc(spec.label)}</div>${fields}</div>`;
  }).join('');
  // Covers are captured at DOUBLE the platform's pixels, so the chip reports the file's REAL size
  // and what it is 2× of — a number that disagrees with the file is worse than no number.
  const coverList = md.covers || [];
  const covers = coverList.map((c, i) => {
    const px = c.px || { w: c.w, h: c.h };
    const note = c.scale > 1 ? tp`${px.w}×${px.h} · 2× của ${c.w}×${c.h}` : `${px.w}×${px.h}`;
    return `<button class="cover-chip" type="button" data-cover="${i}" title="${esc(m('Bấm để xem lớn'))}">
      <img src="${fileUrl(c.path)}" loading="lazy" decoding="async">
      <span>${esc(c.label)}<small>${note}${c.bytes ? ` · ${fmtBytes(c.bytes)}` : ''}</small></span></button>`;
  }).join('');
  box.innerHTML = (covers
    ? `<div class="sec-label">${m('🖼 Ảnh bìa theo nền tảng')}</div><div class="cover-row">${covers}</div>
       <div class="row wrap" style="gap:6px;margin:8px 0 4px">
         <button class="btn sm" id="btnCoversSave">${m('💾 Lưu vào thư mục dự án')}</button>
         <button class="btn sm" id="btnCoversPick">${m('📁 Chọn thư mục…')}</button>
       </div>`
    : '')
    + (cards || `<div class="meta-card"><div class="mt">${esc(md.title || '')}</div>
        <div style="color:var(--muted);white-space:pre-wrap">${esc(md.description || '')}</div>
        <div class="tags">${(md.hashtags || []).map((h) => `<span class="tag-chip">${esc(h)}</span>`).join('')}</div></div>`);
  box.querySelectorAll('.mf-c').forEach((b) => b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy); toast('⧉ Đã sao chép', 'success'); }
    catch { toast('Không sao chép được', 'error'); }
  }));
  // Look at a cover full size before uploading it — the same viewer the image search uses, because
  // "is this actually good" is the same question either way.
  box.querySelectorAll('[data-cover]').forEach((b) => b.addEventListener('click', () => {
    openImageViewer(coverList.map((c) => {
      const px = c.px || { w: c.w, h: c.h };
      return { url: fileUrl(c.path), title: `${c.label} — ${px.w}×${px.h}`, path: c.path };
    }), +b.dataset.cover);
  }));
  const exportCovers = async (body, btn) => {
    btn.disabled = true;
    try {
      const r = await api.post(`/projects/${state.current.id}/covers/export`, body);
      if (r?.cancelled) return;
      toast(tp`💾 Đã lưu ${r.files.length} ảnh bìa → ${r.dir.split('/').pop()}`, 'success');
    } catch (e) { toast(`✖ ${e.message}`, 'error'); }
    finally { btn.disabled = false; }
  };
  $('#btnCoversSave')?.addEventListener('click', (e) => exportCovers({}, e.currentTarget));
  $('#btnCoversPick')?.addEventListener('click', (e) => exportCovers({ pick: true }, e.currentTarget));
}

/** The platform table, fetched once — the panel and the writer must agree on the limits. */
async function loadPlatformSpecs() {
  if (state.platformSpecs) return;
  try {
    state.platformSpecs = (await api.get('/platforms')).platforms || [];
    renderMeta();
  } catch { state.platformSpecs = []; }
}
