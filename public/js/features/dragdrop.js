// Drag & drop onto the window (P43 — the reference app has this and we did not). Dropping a file
// is the obvious gesture, and the alternative was hunting for the right hidden <input> every time.
//
// Where a file GOES is decided by what it is, not by where it lands, so the owner can drop
// anywhere on the window:
//   image  → project assets (the same list the image search and upload button feed)
//   video  → the "Sửa video" source, so the enhance flow is one drop away
//   audio  → the BGM/SFX library
//   font   → the font library
// Nothing is uploaded silently: every drop reports what it did, and an unknown type says so
// rather than disappearing.
import { $, el, esc } from '../ui/dom.js';
import { toast } from '../ui/toast.js';
import { api, fileUrl } from '../api.js';
import { state } from '../state.js';

const IMG = /\.(png|jpe?g|webp|gif|svg)$/i;
const VID = /\.(mp4|mov|m4v|webm)$/i;
const AUD = /\.(mp3|wav|m4a|aac|ogg|flac)$/i;
const FONT = /\.(ttf|otf|woff2?)$/i;

/** Group the dropped files by what we can do with them. */
export function classifyDrop(names = []) {
  const out = { images: [], videos: [], audio: [], fonts: [], unknown: [] };
  for (const n of names) {
    if (IMG.test(n)) out.images.push(n);
    else if (VID.test(n)) out.videos.push(n);
    else if (AUD.test(n)) out.audio.push(n);
    else if (FONT.test(n)) out.fonts.push(n);
    else out.unknown.push(n);
  }
  return out;
}

async function uploadTo(path, files, extra = {}) {
  const fd = new FormData();
  for (const f of files) fd.append('files', f);
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  return api.upload(path, fd);
}

export function initDragDrop() {
  const zone = document.body;
  let depth = 0;
  const hint = el('div', 'dropzone-hint');
  hint.textContent = '⬇ Thả file vào đây — ảnh vào asset, video vào Sửa video, nhạc vào thư viện';
  hint.style.cssText = 'position:fixed;inset:0;z-index:9999;display:none;place-items:center;'
    + 'background:rgba(6,8,18,.72);backdrop-filter:blur(3px);font-size:18px;font-weight:700;color:#fff;pointer-events:none';
  document.body.appendChild(hint);

  const show = (on) => { hint.style.display = on ? 'grid' : 'none'; };
  // dragenter/leave fire per element as the pointer crosses children — count depth, or the
  // overlay flickers the whole way across the page.
  zone.addEventListener('dragenter', (e) => { if (e.dataTransfer?.types?.includes('Files')) { depth++; show(true); } });
  zone.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) show(false); });
  zone.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
  zone.addEventListener('drop', async (e) => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    depth = 0; show(false);
    const files = [...e.dataTransfer.files];
    const kinds = classifyDrop(files.map((f) => f.name));
    const done = [];
    try {
      if (kinds.images.length) {
        const r = await uploadTo('/upload', files.filter((f) => IMG.test(f.name)));
        (r.files || []).forEach((f) => {
          state.assets.push(f.path);
          $('#assetList')?.appendChild(el('span', 'badge', esc(f.name.slice(0, 14))));
        });
        done.push(`${r.files?.length || 0} ảnh → asset dự án`);
      }
      if (kinds.videos.length) {
        const r = await uploadTo('/upload', files.filter((f) => VID.test(f.name)));
        const p = r.files?.[0]?.path;
        if (p) {
          state.evPath = p;
          if ($('#evName')) $('#evName').textContent = r.files[0].name;
          const v = $('#evPreview');
          if (v) { v.src = fileUrl(p); v.classList.remove('hidden'); }
          done.push('video → tab Sửa video');
        }
      }
      if (kinds.audio.length) {
        // a short file is a sound effect, a long one is background music — but we cannot read the
        // duration here, so go by the folder the owner is looking at, defaulting to BGM.
        const kind = state.libKind === 'sfx' ? 'sfx' : 'bgm';
        const r = await uploadTo(`/library/${kind}`, files.filter((f) => AUD.test(f.name)));
        done.push(`${r.items?.length || 0} audio → thư viện ${kind.toUpperCase()}`);
      }
      if (kinds.fonts.length) {
        const r = await uploadTo('/library/font', files.filter((f) => FONT.test(f.name)));
        done.push(`${r.items?.length || 0} font → thư viện`);
      }
    } catch (err) {
      return toast('Thả file lỗi: ' + (err?.message || err), 'error');
    }
    if (kinds.unknown.length) done.push(`bỏ qua ${kinds.unknown.length} file không hỗ trợ`);
    toast(done.length ? `✅ ${done.join(' · ')}` : 'Không có file nào dùng được', done.length ? 'success' : 'error');
  });
}
