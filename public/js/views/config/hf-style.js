// The HyperFrame style guide picker ("Phong cách video").
import { $, esc } from '../../ui/dom.js';
import { toast } from '../../ui/toast.js';
import { api } from '../../api.js';
import { state } from '../../state.js';
import { m, tp } from '../../i18n.js';
import { updateCfgChips } from './groups.js';

// ---------------- HyperFrame style guide ("Phong cách video") ----------------
const HF_FALLBACK = { id: 'chrome-kinetic', name: 'Chrome Kinetic', palette: { bg: '#07070D', ink: '#F2F5FF', accents: ['#7C8CFF', '#22D3EE', '#F59E0B'] } };
export function hfCurrentStyle() {
  if (state.hfGuide) return state.hfGuide;
  return (state.hfPresets || []).find((p) => p.id === state.hfStyleId) || HF_FALLBACK;
}
function hfSwatches(g) {
  const cols = [g.palette?.bg, ...(g.palette?.accents || [])].filter(Boolean).slice(0, 4);
  return cols.map((c) => `<i style="background:${esc(c)}"></i>`).join('');
}
export function renderHfStyleButton() {
  const sw = $('#hfStyleSw'), nm = $('#hfStyleName');
  if (!sw || !nm) return;
  const g = hfCurrentStyle();
  sw.innerHTML = hfSwatches(g);
  nm.textContent = g.name || g.id;
}
async function loadHfPresets() {
  if (state.hfPresets?.length) return;
  try { state.hfPresets = (await api.get('/hyperframe/presets')).presets || []; } catch { state.hfPresets = []; }
}
function renderHfPresetGrid() {
  const grid = $('#hfPresetGrid'); if (!grid) return;
  const cards = (state.hfPresets || []).map((p) => hfCard(p, !state.hfGuide && state.hfStyleId === p.id));
  if (state.hfGuide) cards.push(hfCard({ ...state.hfGuide, id: 'custom' }, true, true));
  grid.innerHTML = cards.join('');
  grid.querySelectorAll('.hfp-card').forEach((c) => c.addEventListener('click', () => {
    if (c.dataset.id !== 'custom') { state.hfStyleId = c.dataset.id; state.hfGuide = null; }
    renderHfPresetGrid(); renderHfStyleButton(); updateCfgChips();
  }));
}
function hfCard(p, sel, custom = false) {
  const [a0 = '#7C8CFF', a1 = '#22D3EE'] = p.palette?.accents || [];
  const bg = p.palette?.bg || '#07070D', ink = p.palette?.ink || '#fff';
  const treat = p.textTreatment === 'chrome'
    ? 'background:linear-gradient(180deg,#fff,#98A2B8 46%,#EDF1F9 52%,#818BA2);-webkit-background-clip:text;color:transparent'
    : p.textTreatment === 'outline' ? `color:transparent;-webkit-text-stroke:1.2px ${ink}`
      : p.textTreatment === 'neon' ? `color:${ink};text-shadow:0 0 8px ${a0}` : `color:${ink}`;
  return `<div class="hfp-card${sel ? ' sel' : ''}" data-id="${esc(p.id)}">
    <div class="hfp-demo" style="background:radial-gradient(120% 120% at 30% 10%, ${bg} 30%, ${a0}22 100%),${bg}">
      <span class="hfp-kw" style="${treat}">Aa</span>
      <span class="hfp-dot" style="background:${a0}"></span><span class="hfp-dot" style="background:${a1}"></span>
    </div>
    <div class="hfp-name">${custom ? '🎨 ' : ''}${esc(p.name || p.id)}</div>
  </div>`;
}
export function wireHfStyle() {
  const btn = $('#btnHfStyle'); if (!btn) return;
  btn.addEventListener('click', async () => {
    await loadHfPresets();
    renderHfPresetGrid();
    $('#hfGenNote').textContent = '';
    $('#hfStyleModal').classList.add('open');
  });
  $('#btnHfGenerate').addEventListener('click', async () => {
    const describe = $('#hfDescribe').value.trim();
    if (!describe) { toast('Mô tả phong cách bạn muốn trước đã.', 'error'); return; }
    const note = $('#hfGenNote');
    note.textContent = m('⏳ AI đang thiết kế phong cách…');
    try {
      const r = await api.post('/hyperframe/styleguide', { describe, topic: $('#topic')?.value || '' });
      if (r.error) throw new Error(r.error);
      state.hfGuide = r.guide; state.hfStyleId = 'custom';
      renderHfPresetGrid(); renderHfStyleButton(); updateCfgChips();
      note.textContent = r.source === 'llm' ? tp`✓ Đã tạo phong cách "${r.guide.name}"` : m('⚠ LLM chưa cấu hình — dùng phong cách mặc định');
    } catch (e) { note.textContent = '✗ ' + e.message; }
  });
  // Persistent brand kit: pin the selected style as the CHANNEL's canonical guide —
  // every new project of the channel inherits it automatically.
  $('#btnHfSaveChannel')?.addEventListener('click', async () => {
    const note = $('#hfGenNote');
    try {
      const { active } = await api.get('/channels');
      if (!active) { toast('Chưa có kênh đang hoạt động.', 'error'); return; }
      const g = hfCurrentStyle();
      const guide = state.hfGuide || g; // custom guide object, or the chosen preset's full data
      await api.post(`/channels/${active}/style-guide`, { guide });
      note.textContent = tp`✓ Đã đặt "${guide.name || guide.id}" làm phong cách mặc định của kênh`;
      toast('Đã lưu phong cách cho kênh 🎨', 'success');
    } catch (e) { note.textContent = '✗ ' + e.message; }
  });
  renderHfStyleButton();
}
