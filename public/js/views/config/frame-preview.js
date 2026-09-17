// The real-frame subtitle preview through the actual burn path.
import { $ } from '../../ui/dom.js';

import { state } from '../../state.js';
import { m } from '../../i18n.js';
import { gatherConfig } from './form.js';

// ---------------- real-frame preview ----------------
// The style preview above is CSS pretending to be the renderer. This one IS the renderer: the
// server pulls a frame out of the finished video and runs it through resolveConcatLogo/logoRect
// and libass — the same code the concat calls. About a second, against the fifteen minutes of
// re-concatenating it replaces.
export const fmtT = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function syncFramePreviewAvailability() {
  const box = $('#framePreviewBox');
  if (!box) return;
  const ok = !!state.current?.id && !!state.current?.video_path;
  box.classList.toggle('hidden', !ok);
  // projects carry no duration column; the scene rows do, and their sum is close enough to
  // scale a scrubber (the server clamps to the real file anyway)
  const dur = Math.max(1, Math.round((state.scenes || []).reduce((a, s) => a + (s.duration || 0), 0)));
  const sl = $('#framePreviewAt');
  if (sl && dur > 1) { sl.max = String(dur); if (+sl.value > dur) sl.value = String(Math.round(dur * 0.15)); }
  if (sl) $('#framePreviewT').textContent = fmtT(+sl.value);
}

export async function refreshFramePreview() {
  const img = $('#framePreviewImg'); const note = $('#framePreviewNote');
  const btn = $('#btnFramePreview');
  if (!img || !state.current?.id) return;
  const t = +($('#framePreviewAt')?.value || 15);
  btn.disabled = true; note.textContent = m('⏳ Đang dựng khung thật…');
  try {
    // the panel's LIVE values, not what is saved — the owner is previewing a change in progress
    const cfg = encodeURIComponent(JSON.stringify(gatherConfig()));
    const url = `/api/projects/${state.current.id}/frame-preview?t=${t}&cfg=${cfg}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    const warn = res.headers.get('X-Preview-Note');
    img.src = URL.createObjectURL(await res.blob());
    img.classList.remove('hidden');
    note.textContent = warn ? `⚠ ${decodeURIComponent(warn)}` : m('Khung thật của video — logo và phụ đề đi qua đúng đường ghép cuối.');
  } catch (e) {
    note.textContent = `✖ ${e.message}`;
  } finally { btn.disabled = false; }
}
