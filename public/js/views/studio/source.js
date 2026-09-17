// The input side: input-mode detection, the fetched source article, image search, the viewer, asset uploads.
import { $, el, esc } from '../../ui/dom.js';
import { toast } from '../../ui/toast.js';
import { api, fileUrl } from '../../api.js';
import { state } from '../../state.js';
import { m, tp } from '../../i18n.js';

// ---------------- input helpers ----------------
// Mirror of the master engine's input modes (SCRIPT_MODE_MIN_WORDS = 80 backend-side):
// topic → AI writes everything · detailed script → light polish + slicing, wording kept ·
// scenes JSON → direct import, no script-writing LLM call.
export function detectType() {
  const v = $('#topic').value.trim();
  const words = v.split(/\s+/).filter(Boolean).length;
  let t = m('văn bản'), hint = '';
  if (!v) { $('#inputTypeHint').textContent = ''; return; }
  if (/^https?:\/\/\S+$/i.test(v.split(/\s+/)[0]) && v.split(/\s+/).length <= 3) {
    t = m('link 🔗'); hint = m(' → lấy nội dung rồi AI viết kịch bản từ đó');
  } else if (v.startsWith('{') || v.startsWith('[')) {
    t = m('scenes JSON 🧩'); hint = m(' → nhập trực tiếp từng cảnh (voice + visual), không tốn AI viết kịch bản');
  } else if (words >= 80) {
    t = tp`kịch bản chi tiết 📜 (${words} từ)`; hint = m(' → AI biên tập nhẹ + cắt cảnh, giữ ~90% lời của bạn; thời lượng theo nội dung');
  } else {
    t = m('chủ đề 💡'); hint = m(' → AI viết toàn bộ kịch bản + visual từng cảnh theo thời lượng đã chọn');
  }
  $('#inputTypeHint').textContent = tp`Nhận diện: ${t}${hint}`;
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
  $('#srcTitle').textContent = d.title || d.url || m('Nội dung đã lấy');
  $('#srcTitle').title = d.url || '';
  $('#srcText').value = d.text;
  const words = d.text.trim().split(/\s+/).filter(Boolean).length;
  const bits = [tp`${words.toLocaleString('vi')} từ`, tp`${d.chars ?? d.text.length} ký tự`];
  // Show the filtering as a RATIO, not a total: "62/373 đoạn" is the only way to see that the page
  // furniture actually got thrown away.
  if (d.blocks) bits.push(d.found && d.found !== d.blocks ? tp`${d.blocks}/${d.found} đoạn` : tp`${d.blocks} đoạn`);
  if (d.siteName) bits.push(esc(d.siteName));
  const how = d.ai ? m('🤖 AI đã lọc bỏ phần thừa') : m('⚙️ lọc theo cấu trúc trang');
  // Say it out loud when the page was longer than the engine can read — the old extractor cut at
  // 8000 characters mid-sentence and nothing anywhere said a word about it.
  $('#srcMeta').innerHTML = tp`${bits.join(' · ')} · ${how} → AI sẽ viết kịch bản MỚI từ tư liệu này`
    + (d.note ? `<br><b class="warn">⚠ ${esc(d.note)}</b>` : '')
    + (d.truncated ? `<br><b class="warn">${m('⚠ Bài quá dài — đã lấy tối đa engine đọc được')}${d.dropped ? tp`, bỏ ${d.dropped} đoạn cuối` : ''}.</b>` : '');
}

export async function fetchLink() {
  const url = $('#topic').value.trim().split(/\s+/)[0];
  if (!/^https?:/.test(url)) { toast('Dán 1 link http(s) trước.', 'error'); return; }
  const btn = $('#btnFetch');
  btn.disabled = true;
  toast('Đang lấy nội dung…');
  try {
    const r = await api.post('/fetch-link', { url });
    if (r.error) throw new Error(r.error);
    if (!r.text?.trim()) throw new Error(m('trang này không có nội dung bài viết đọc được'));
    setSourceDoc(r);
    if (r.images?.length) {
      showImages(r.images.map((u) => ({ url: u })),
        r.foundImages && r.foundImages !== r.images.length ? tp`ảnh trong bài (bỏ ${r.foundImages - r.images.length} ảnh ngoài bài)` : m('ảnh trong bài'));
    } else $('#imgResults').innerHTML = '';
    toast(tp`Đã lấy ${r.chars} ký tự ✓${r.ai ? m(' (AI đã lọc)') : ''}`, 'success');
  } catch (e) { toast(tp`Không lấy được nội dung: ${e.message}`, 'error'); }
  finally { btn.disabled = false; }
}

export async function imageSearch() {
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
    if (!items.length) throw new Error(m('không tìm thấy ảnh nào'));
    showImages(items, r.note ? `${r.source} — ${r.note}` : `${r.source}${r.keywords?.[0] ? ` · “${r.keywords[0]}”` : ''}`);
    // Gradient placeholders are a legitimate answer, but handing them over without saying why
    // reads as "there are no pictures of this" instead of "the catalogue is throttling us".
    if (r.note) toast(tp`⚠ ${r.note} — đang dùng ảnh nền tạm`, 'error');
    else toast(tp`Tìm thấy ${items.length} ảnh (${r.source})`, 'success');
  } catch (e) { toast(tp`Tìm ảnh lỗi: ${e.message}`, 'error'); }
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
  if (sourceLabel) box.appendChild(el('div', 'imgres-src', esc(tp`${items.length} ảnh · ${sourceLabel}`)));
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
    add.title = m('Thêm vào assets của video');
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
  } catch (e) { toast(tp`Không tải được ảnh: ${e.message}`, 'error'); }
  finally { cell?.classList.remove('busy'); }
}

/** Full-size viewer: the point of "xem trực tiếp ảnh trong app". Arrows walk the result set. */
export function openImageViewer(items, startAt) {
  let i = Math.max(0, startAt);
  const modal = $('#imgViewer');
  const show = () => {
    const it = items[i];
    $('#ivImg').src = it.thumb && !it.url ? it.thumb : it.url;
    $('#ivCap').textContent = it.title || it.path || it.url;
    $('#ivPos').textContent = `${i + 1}/${items.length}`;
    $('#ivOpen').href = it.url;
    // A cover already ON this machine has nothing to add to the project's assets, and offering it
    // would just be a button that downloads a file to where it already is.
    $('#ivAdd').classList.toggle('hidden', !!it.path);
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
export async function uploadAssets(e) {
  const fd = new FormData();
  [...e.target.files].forEach((f) => fd.append('files', f));
  const r = await api.upload('/upload', fd);
  (r.files || []).forEach((f) => { state.assets.push(f.path); const tag = el('span', 'badge', esc(f.name.slice(0, 14))); $('#assetList').appendChild(tag); });
  toast(tp`Đã thêm ${(r.files || []).length} file`, 'success');
}
