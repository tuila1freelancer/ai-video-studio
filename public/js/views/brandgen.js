// Brand Asset generator — faithful clone of the reference app's page (P27):
// emotion list via AI or manual, batch-3 concurrent generation with stop/resume on a kept
// done-index, per-item log lines, live result grid, copy-to-brand. Plus (ours): the
// image-edit provider + model + size are picked RIGHT HERE and persist to AI settings;
// API keys never live in the browser — provider mutations go through dedicated routes.
import { $, $$, el, esc } from '../ui/dom.js';
import { toast } from '../ui/toast.js';
import { confirmDialog } from '../ui/dialog.js';
import { api, fileUrl, withLock } from '../api.js';
import { t, m, tp } from '../i18n.js';

const GENERATE_TIMEOUT_MS = 25 * 60 * 1000; // server does ×10 attempts — outlive them

let refFile = null;
let emotions = [];
let running = false, abort = false, doneIndex = 0;
let okCount = 0, failCount = 0;

const getBrand = () => $('#bgBrand').value || 'Default';
const getStyle = () => {
  const chip = $('#bgStyleChips .bg-chip.active');
  const v = chip?.dataset.style || '';
  return v || ($('#bgStyleCustom').value.trim() || '2D Anime style');
};

function log(line) {
  const box = $('#bgLog');
  box.classList.remove('hidden');
  box.appendChild(el('div', '', esc(line)));
  box.scrollTop = box.scrollHeight;
}
function setProgress(done, total) {
  $('#bgProgressWrap').classList.remove('hidden');
  $('#bgProgressFill').style.width = (total ? Math.round(done / total * 100) : 0) + '%';
  $('#bgProgressLabel').textContent = `${done} / ${total}`;
}

async function loadBrands(selectValue) {
  try {
    const { brands } = await api.get('/brands', { ttl: 5000 });
    const list = (brands && brands.length ? brands : ['Default']);
    if (!list.includes('Default')) list.unshift('Default');
    const cur = selectValue || getBrand();
    $('#bgBrand').innerHTML = list.map((b) => `<option value="${esc(b)}"${b === cur ? ' selected' : ''}>${esc(b)}</option>`).join('');
  } catch { /* offline — keep whatever is there */ }
}

// ---- provider & model (persisted in ai.imageGen.{editProviders, brandEdit}) ----
let editProviders = [];
async function loadImageProviders() {
  try {
    const { settings } = await api.get('/settings', { ttl: 5000 });
    const ig = settings.imageGen || {};
    editProviders = Array.isArray(ig.editProviders) ? ig.editProviders : [];
    const pick = ig.brandEdit || {};
    $('#bgProvider').innerHTML = editProviders.length
      ? editProviders.map((p) => `<option value="${esc(p.id)}"${p.id === pick.providerId ? ' selected' : ''}>${esc(p.label)}</option>`).join('')
      : `<option value="">${esc(m('— chưa có provider —'))}</option>`;
    $('#bgModel').value = pick.model || 'gpt-image-2';
    $('#bgSize').value = pick.size || '1024x1536';
    const ok = editProviders.length > 0;
    $('#bgGo').disabled = !ok;
    $('#bgProviderHint').textContent = ok
      ? m('Endpoint dạng OpenAI images/edits — mọi thay đổi ở đây được lưu ngay.')
      : t('ui.brandgen.chua-cau-hinh-provider-anh', null, 'Chưa cấu hình provider tạo ảnh — bấm ＋ để thêm (Base URL + API key, chuẩn OpenAI images/edits).');
  } catch { /* leave defaults */ }
}
// ---- the same provider catalogue as AI Setting, filtered to the ones that edit images ----
// Nobody knows that OpenAI's images/edits lives at https://api.openai.com/v1 — and getting it
// wrong shows up only as a failed generation. Ask for the key; the app knows the rest.
let pfPresets = [];
async function loadPfPresets() {
  if (pfPresets.length) return;
  try {
    pfPresets = ((await api.get('/llm/providers')).presets || []).filter((p) => p.lanes?.image && p.id !== 'custom');
  } catch { pfPresets = []; /* offline — the custom form still works */ }
  $('#bgPfPreset').innerHTML = pfPresets.map((p) => `<option value="${esc(p.id)}">${esc(p.label)}</option>`).join('')
    + `<option value="custom">${esc(m('✏️ Tuỳ chỉnh (tự nhập Base URL)'))}</option>`;
  renderPfPreset();
}
function renderPfPreset() {
  const p = pfPresets.find((x) => x.id === $('#bgPfPreset').value);
  $('#bgPfCustom').classList.toggle('hidden', !!p);
  $('#bgPfNote').innerHTML = p
    ? `${esc(p.note || '')}${p.keyUrl ? `<br><a href="${esc(p.keyUrl)}" target="_blank" rel="noreferrer noopener">${m('🔑 Lấy API key ↗')}</a>` : ''}`
    : tp`Bất kỳ endpoint nào nói chuẩn OpenAI ${'<code>images/edits</code>'}.`;
}

async function saveBrandEditPick() {
  await api.put('/settings', {
    imageGen: { brandEdit: { providerId: $('#bgProvider').value, model: $('#bgModel').value.trim() || 'gpt-image-2', size: $('#bgSize').value } },
  }).catch(() => {});
}

// ---- emotion list ----
function showPreview() {
  const name = $('#bgName').value.trim() || 'ema';
  $('#bgPreviewCount').textContent = emotions.length;
  $('#bgPreviewList').innerHTML = emotions
    .map((e, i) => `<div>${i + 1}. character ${esc(name)} <strong>${esc(e)}</strong></div>`).join('');
  $('#bgPreviewSec').classList.toggle('hidden', !emotions.length);
  doneIndex = 0; okCount = 0; failCount = 0;
  $('#bgGo').textContent = m('✨ Bắt đầu tạo ảnh');
}

async function genEmotions() {
  const characterName = $('#bgName').value.trim();
  if (!characterName) return toast('Vui lòng nhập tên nhân vật.', 'error');
  const btn = $('#bgGenEmotions');
  btn.disabled = true; btn.textContent = m('⏳ Đang sinh...');
  try {
    const r = await api.post('/brandgen/emotions', {
      characterName, count: Number($('#bgCount').value) || 20, context: $('#bgContext').value.trim(),
    });
    emotions = r.emotions || [];
    showPreview();
  } catch (e) { toast(tp`Lỗi sinh emotions: ${e.message}`, 'error'); }
  finally { btn.disabled = false; btn.textContent = m('📋 Sinh danh sách'); }
}

// ---- generation loop (batch-3, stop/resume like the reference) ----
async function generateOne(emotion) {
  log(`→ character ${$('#bgName').value.trim()} ${emotion}…`);
  try {
    const fd = new FormData();
    fd.append('image', refFile);
    fd.append('characterName', $('#bgName').value.trim());
    fd.append('emotion', emotion);
    fd.append('brand', getBrand());
    fd.append('style', getStyle());
    const res = await fetch('/api/brandgen/generate', { method: 'POST', body: fd, signal: AbortSignal.timeout(GENERATE_TIMEOUT_MS) });
    const data = await res.json().catch(() => null);
    if (!res.ok || data?.error) throw new Error(data?.error || `HTTP ${res.status}`);
    okCount++;
    log(`✅ ${data.filename} (${Math.round(data.size / 1024)} KB)`);
    const card = el('div', 'libitem',
      `<div class="lp"><img src="${fileUrl(data.path)}" loading="lazy"></div><div class="ln">${esc(emotion)}</div>`);
    card.dataset.filename = data.filename;
    $('#bgResults').appendChild(card);
  } catch (e) {
    failCount++;
    log(`❌ "${emotion}": ${e.message}`);
  }
}

async function start() {
  if (running) return;
  if (!refFile) return toast('Vui lòng chọn ảnh tham chiếu.', 'error');
  if (!$('#bgName').value.trim()) return toast('Vui lòng nhập tên nhân vật.', 'error');
  if (!emotions.length) return toast('Chưa có danh sách — bấm "Sinh danh sách" hoặc nhập thủ công trước.', 'error');
  if (!editProviders.length) return toast(t('ui.brandgen.chua-cau-hinh-provider-muc6', null, 'Chưa cấu hình provider tạo ảnh — thêm ở mục 6.'), 'error');
  await saveBrandEditPick(); // the server reads ONLY settings — pin the current pick first
  running = true; abort = false;
  $('#bgGo').disabled = true;
  $('#bgStop').classList.remove('hidden');
  if (doneIndex === 0) { $('#bgResults').innerHTML = ''; okCount = 0; failCount = 0; $('#bgLog').innerHTML = ''; }
  const total = emotions.length;
  setProgress(doneIndex, total);
  for (let i = doneIndex; i < total && !abort; i += 3) {
    const batch = emotions.slice(i, i + 3);
    await Promise.all(batch.map(generateOne));
    doneIndex = Math.min(total, i + batch.length);
    setProgress(doneIndex, total);
  }
  running = false;
  $('#bgGo').disabled = false;
  $('#bgStop').classList.add('hidden');
  if (abort && doneIndex < total) {
    log(tp`⏹ Đã dừng tại ${doneIndex}/${total} — bấm "▶ Tiếp tục" để tạo tiếp.`);
    $('#bgGo').textContent = m('▶ Tiếp tục');
  } else {
    log('\n' + tp`🏁 Hoàn tất: ${okCount} thành công, ${failCount} lỗi`);
    doneIndex = 0;
    $('#bgGo').textContent = m('✨ Bắt đầu tạo ảnh');
    loadCopyTargets();
  }
}

async function loadCopyTargets() {
  try {
    const { brands } = await api.get('/brands', { ttl: 5000 });
    const others = (brands || []).filter((b) => b !== getBrand());
    if (!$$('#bgResults .libitem').length) return;
    $('#bgCopySec').classList.remove('hidden');
    $('#bgCopyTarget').innerHTML = `<option value="">${esc(m('— chọn brand đích —'))}</option>`
      + others.map((b) => `<option value="${esc(b)}">${esc(b)}</option>`).join('');
  } catch { /* optional */ }
}

async function copyToBrand() {
  const target = $('#bgCopyTarget').value;
  if (!target) return toast('Chọn brand đích trước.', 'error');
  const filenames = $$('#bgResults .libitem').map((c) => c.dataset.filename).filter(Boolean);
  if (!filenames.length) return toast('Chưa có ảnh nào để copy.', 'error');
  $('#bgCopyStatus').textContent = m('⏳ Đang copy…');
  try {
    const r = await api.post('/brandgen/copy', { sourceBrand: getBrand(), targetBrand: target, filenames });
    // hoisted: a tp` ` nested inside another tp` ` is invisible to the msgid extractor
    const skipped = r.skipped ? tp` (bỏ qua ${r.skipped})` : '';
    $('#bgCopyStatus').textContent = tp`✅ ${r.copied} file → "${target}"${skipped}`;
  } catch (e) { $('#bgCopyStatus').textContent = tp`❌ Lỗi: ${e.message}`; }
}

let wired = false;
/** First show of the page: wire the controls once, then (re)load the catalogues every show. */
export function openBrandGen() {
  if (!wired) { wired = true; initBrandGen(); }
  loadBrands(); loadImageProviders();
}
export function initBrandGen() {
  if (!$('#bgGo')) return;
  // reference image
  $('#bgRef').addEventListener('change', (e) => {
    refFile = e.target.files[0] || null;
    $('#bgRefName').textContent = refFile?.name || m('Chưa chọn');
    const prev = $('#bgRefPreview');
    if (refFile) { prev.src = URL.createObjectURL(refFile); prev.classList.remove('hidden'); }
    else prev.classList.add('hidden');
  });
  // style chips ('Khác' reveals the custom input)
  $$('#bgStyleChips .bg-chip').forEach((chip) => chip.addEventListener('click', () => {
    $$('#bgStyleChips .bg-chip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    $('#bgStyleCustom').classList.toggle('hidden', chip.dataset.style !== '');
  }));
  // emotion modes
  $$('.bg-mode').forEach((b) => b.addEventListener('click', () => {
    $$('.bg-mode').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    $('#bgModeAuto').classList.toggle('hidden', b.dataset.mode !== 'auto');
    $('#bgModeManual').classList.toggle('hidden', b.dataset.mode !== 'manual');
  }));
  $('#bgGenEmotions').addEventListener('click', (e) => withLock(e.currentTarget, genEmotions));
  $('#bgParseManual').addEventListener('click', () => {
    emotions = $('#bgManual').value.split('\n').map((s) => s.trim()).filter(Boolean);
    if (!emotions.length) return toast('Vui lòng nhập danh sách (mỗi dòng một mục).', 'error');
    showPreview();
  });
  $('#bgName').addEventListener('input', () => { if (emotions.length) showPreview(); });
  // brand đích
  $('#bgBrandNew').addEventListener('click', () => $('#bgBrandForm').classList.toggle('hidden'));
  $('#bgBrandSave').addEventListener('click', (e) => withLock(e.currentTarget, async () => {
    const name = $('#bgBrandName').value.trim();
    if (!name) return toast('Nhập tên brand.', 'error');
    try {
      const r = await api.post('/brands', { name });
      $('#bgBrandForm').classList.add('hidden');
      $('#bgBrandName').value = '';
      await loadBrands(r.name);
      toast(tp`🏷 Đã tạo brand "${r.name}"`, 'success');
    } catch (err) { toast(err.message, 'error'); }
  }));
  // provider & model
  $('#bgProvider').addEventListener('change', saveBrandEditPick);
  $('#bgModel').addEventListener('change', saveBrandEditPick);
  $('#bgSize').addEventListener('change', saveBrandEditPick);
  $('#bgProviderNew').addEventListener('click', () => { $('#bgProviderForm').classList.remove('hidden'); loadPfPresets(); });
  $('#bgPfCancel').addEventListener('click', () => $('#bgProviderForm').classList.add('hidden'));
  $('#bgPfPreset').addEventListener('change', renderPfPreset);
  $('#bgPfSave').addEventListener('click', (e) => withLock(e.currentTarget, async () => {
    try {
      // A preset carries its own label and endpoint, so the form only asks for the key.
      await api.post('/brandgen/providers', {
        presetId: $('#bgPfPreset').value,
        label: $('#bgPfLabel').value.trim(), baseUrl: $('#bgPfUrl').value.trim(), apiKey: $('#bgPfKey').value,
      });
      $('#bgProviderForm').classList.add('hidden');
      $('#bgPfLabel').value = ''; $('#bgPfUrl').value = ''; $('#bgPfKey').value = '';
      await loadImageProviders();
      toast('💾 Đã lưu provider', 'success');
    } catch (err) { toast(err.message, 'error'); }
  }));
  $('#bgProviderDel').addEventListener('click', async () => {
    const id = $('#bgProvider').value;
    if (!id) return;
    const label = editProviders.find((p) => p.id === id)?.label || id;
    if (!await confirmDialog({ title: tp`Xoá provider "${label}"?`, body: 'API key đã lưu sẽ bị xoá.', okText: 'Xoá', danger: true })) return;
    await api.del(`/brandgen/providers/${id}`);
    await loadImageProviders();
  });
  // run
  $('#bgGo').addEventListener('click', start);
  $('#bgStop').addEventListener('click', () => { abort = true; log(m('⏳ Đang dừng sau batch hiện tại…')); });
  $('#bgCopyGo').addEventListener('click', (e) => withLock(e.currentTarget, copyToBrand));
}
