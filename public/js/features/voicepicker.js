import { $, $$, esc, LANG_FLAGS } from '../ui/dom.js';
import { toast } from '../ui/toast.js';
import { api } from '../api.js';
import { state } from '../state.js';
import { loadVoices, loadSettings } from './settings.js';
import { m, tp } from '../i18n.js';

const vpFilter = { q: '', lang: '', gender: '', provider: '' };
let vpAudio = null, vpPlayingId = null;

let wired = false;
export function initVoicePicker() {
  if (wired) return;
  wired = true;
  // search debounced 200ms — one list render per pause, not per keystroke
  let debT = null;
  $('#vpSearch').addEventListener('input', () => {
    clearTimeout(debT);
    debT = setTimeout(() => { vpFilter.q = $('#vpSearch').value.trim().toLowerCase(); renderVpList(); }, 200);
  });
  $('#vpGender').addEventListener('change', () => { vpFilter.gender = $('#vpGender').value; renderVpList(); });
  $('#vpRefresh').addEventListener('click', async () => { toast('Đang tải lại danh sách giọng…'); await api.get('/voices?refresh=1'); await loadVoices(); renderVpChips(); renderVpList(); });
  // one delegated listener replaces ~450 per-render row bindings
  $('#vpList').addEventListener('click', (e) => {
    const play = e.target.closest('.vp-play'); if (play) return vpPreview(play.dataset.p, play.dataset.v);
    const fav = e.target.closest('.vp-fav'); if (fav) return vpToggleFav(fav.dataset.k);
    const pick = e.target.closest('.vp-pick'); if (pick) return vpChoose(pick.dataset.p, pick.dataset.v, pick.dataset.l);
  });
  $('#vpLangChips').addEventListener('click', (e) => {
    const b = e.target.closest('.gtab'); if (!b) return;
    vpFilter.lang = b.dataset.l; renderVpChips(); renderVpList();
  });
  $('#vpProvChips').addEventListener('click', (e) => {
    const b = e.target.closest('.gtab'); if (!b) return;
    vpFilter.provider = b.dataset.p; renderVpChips(); renderVpList();
  });
  // stop preview audio when picker closes
  document.addEventListener('click', (e) => {
    if (e.target.closest('#voicePickerModal [data-close]') || e.target.id === 'voicePickerModal') {
      if (vpAudio) { vpAudio.pause(); vpAudio = null; vpPlayingId = null; }
    }
  });
}

export function openVoicePicker() {
  initVoicePicker();
  $('#voicePickerModal').classList.add('open');
  renderVpChips(); renderVpList();
}
function vpLangs() {
  const counts = {};
  state.voiceCatalog.forEach((v) => { counts[v.lang] = (counts[v.lang] || 0) + 1; });
  const pri = ['vi', 'en', 'ja', 'ko', 'zh', 'fr', 'es', 'multi'];
  return pri.filter((l) => counts[l]).concat(Object.keys(counts).filter((l) => !pri.includes(l)).slice(0, 4));
}
function renderVpChips() {
  $('#vpLangChips').innerHTML = `<button class="gtab ${!vpFilter.lang ? 'active' : ''}" data-l="">${esc(m('Tất cả'))}</button>`
    + vpLangs().map((l) => `<button class="gtab ${vpFilter.lang === l ? 'active' : ''}" data-l="${l}">${LANG_FLAGS[l] || ''} ${l}</button>`).join('');
  // Only chip a provider the catalog can actually show. A chip that filters to an empty list is
  // worse than no chip: it reads as "this provider has no voices" when the truth is "no key yet".
  const present = new Set((state.voiceCatalog || []).map((v) => v.provider));
  $('#vpProvChips').innerHTML = `<button class="gtab ${!vpFilter.provider ? 'active' : ''}" data-p="">${esc(m('Mọi provider'))}</button>`
    + state.providers.filter((p) => present.has(p.id))
      .map((p) => `<button class="gtab ${vpFilter.provider === p.id ? 'active' : ''}" data-p="${p.id}">${esc(p.name.split(' ')[0])}</button>`).join('')
    + state.providers.filter((p) => !present.has(p.id))
      .map((p) => `<button class="gtab" disabled title="${esc(tp`Chưa có API key cho ${p.name} — nhập ở AI Setting`)}" style="opacity:.45">${esc(p.name.split(' ')[0])} 🔑</button>`).join('');
}
function renderVpList() {
  const favs = new Set(state.settings?.tts?.favVoices || []);
  const list = state.voiceCatalog.filter((v) =>
    (!vpFilter.lang || v.lang === vpFilter.lang)
    && (!vpFilter.gender || v.gender === vpFilter.gender)
    && (!vpFilter.provider || v.provider === vpFilter.provider)
    && (!vpFilter.q || v.name.toLowerCase().includes(vpFilter.q) || v.id.toLowerCase().includes(vpFilter.q)));
  list.sort((a, b) => (favs.has(b.provider + '/' + b.id) - favs.has(a.provider + '/' + a.id)) || a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name));
  // Render up to 600 rows — one delegated listener + plain innerHTML handles this fine, and it
  // shows a full single-provider/single-language catalog (LarVoice alone has 300+ voices) instead
  // of hiding most of it. The cap only trips in the rare all-providers + all-languages view.
  const CAP = 600;
  const shown = list.slice(0, CAP);
  $('#vpList').innerHTML = shown.map((v) => {
    const key = v.provider + '/' + v.id;
    return `<div class="vp-row">
      <button class="btn sm vp-play" data-p="${v.provider}" data-v="${esc(v.id)}" title="${esc(m('Nghe thử'))}">${vpPlayingId === key ? '⏸' : '▶'}</button>
      <span class="vp-meta">
        <strong>${LANG_FLAGS[v.lang] || ''} ${esc(v.name)}</strong>
        <span class="hint">${v.gender === 'f' ? '♀' : v.gender === 'm' ? '♂' : ''} · ${esc(v.provider)}${(v.tags || []).length ? ' · ' + esc(v.tags.join(', ')) : ''}</span>
      </span>
      <button class="btn sm ghost vp-fav" data-k="${esc(key)}" title="${esc(m('Ghim'))}">${favs.has(key) ? '⭐' : '☆'}</button>
      <button class="btn sm primary vp-pick" data-p="${v.provider}" data-v="${esc(v.id)}" data-l="${v.lang}">${esc(m('Chọn'))}</button>
    </div>`;
  }).join('') + (list.length > CAP ? `<div class="hint" style="padding:10px">${esc(tp`…còn ${list.length - CAP} giọng — thu hẹp bộ lọc để xem.`)}</div>` : '');
}
// play-state change touches only the two affected buttons — no list re-render mid-audio
function syncPlayGlyphs() {
  $$('#vpList .vp-play').forEach((b) => {
    const glyph = vpPlayingId === b.dataset.p + '/' + b.dataset.v ? '⏸' : '▶';
    if (b.textContent !== glyph) b.textContent = glyph;
  });
}
async function vpPreview(provider, voiceId) {
  const key = provider + '/' + voiceId;
  if (vpAudio && vpPlayingId === key) { vpAudio.pause(); vpAudio = null; vpPlayingId = null; syncPlayGlyphs(); return; }
  if (vpAudio) { vpAudio.pause(); vpAudio = null; }
  vpPlayingId = key; syncPlayGlyphs();
  const r = await api.post('/voices/preview', { provider, voiceId, text: $('#vpCustomText').value.trim() || undefined });
  if (r.error) { toast(r.error, 'error'); vpPlayingId = null; syncPlayGlyphs(); return; }
  vpAudio = new Audio(r.url);
  vpAudio.onended = () => { vpPlayingId = null; syncPlayGlyphs(); };
  vpAudio.play().catch(() => {});
}
async function vpToggleFav(key) {
  const favs = new Set(state.settings?.tts?.favVoices || []);
  favs.has(key) ? favs.delete(key) : favs.add(key);
  await api.put('/settings', { tts: { ...state.settings.tts, favVoices: [...favs] } });
  state.settings.tts.favVoices = [...favs];
  renderVpList(); // sort order changes (pinned first)
}
async function vpChoose(provider, voiceId, lang) {
  const tts = { ...(state.settings?.tts || {}) };
  if (lang === 'multi') {
    // Into the provider's OWN slot, not the shared voiceId field: that field was only ever read
    // back for openai and elevenlabs, so picking a Supertonic voice silently kept M1.
    tts.provider = provider;
    tts.voiceId = voiceId;
    tts.providers = { ...(tts.providers || {}), [provider]: { ...(tts.providers?.[provider] || {}), voice: voiceId } };
  }
  else { tts.langVoices = { ...(tts.langVoices || {}), [lang]: { provider, voice: voiceId } }; }
  await api.put('/settings', tts ? { tts } : {});
  await loadSettings();
  const scope = lang === 'multi' ? m('chính') : tp`mặc định cho ${lang}`;
  toast(tp`Đã đặt ${voiceId} làm giọng ${scope} ✓`, 'success');
}
