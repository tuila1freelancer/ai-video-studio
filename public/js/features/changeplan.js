// "3 thay đổi đang chờ" — what this edit costs, before it is spent.
//
// The app has always been able to work this out: renderFingerprint and ttsFingerprint know
// exactly which scenes a config change invalidates. They were just never asked until after the
// owner had committed, so editing a subtitle font either took a minute or an hour and the only
// way to find out was to start it and watch.
//
// Two rules this panel keeps:
//   - Nothing is hidden. If a step will re-voice scenes (which costs real money) it says so in
//     those words. If a shortcut is being taken, the shortcut is named.
//   - The expensive answer is never the default-looking one. "Chỉ ghép lại" sits next to
//     "Áp dụng tất cả" whenever a cheap subset would do.
import { $ } from '../ui/dom.js';
import { api } from '../api.js';
import { toast } from '../ui/toast.js';
import { state } from '../state.js';
import { gatherConfig } from '../views/config.js';
import { confirmDialog } from '../ui/dialog.js';
import { showJournal } from './journal.js';
import { switchPage } from '../views/nav.js';

const fmt = (s) => {
  const n = Math.max(1, Math.round(s));
  if (n < 60) return `~${n} giây`;
  if (n < 3600) return `~${Math.round(n / 60)} phút`;
  return `~${(n / 3600).toFixed(1)} giờ`;
};
const ICON = { tts: '🎙', render: '🎬', concat: '🔗' };

function row(item) {
  return `<div class="row" style="align-items:flex-start;gap:8px;padding:8px 0;border-top:1px solid var(--line)">
    <span style="font-size:16px">${ICON[item.kind] || '•'}</span>
    <div style="flex:1">
      <div style="font-weight:600${item.costly ? ';color:var(--warn,#F7B500)' : ''}">${item.label}</div>
      <div class="hint">${item.detail}</div>
    </div>
    <div class="hint" style="white-space:nowrap;font-variant-numeric:tabular-nums">${fmt(item.seconds)}</div>
  </div>`;
}

export async function openChangePlan() {
  const id = state.current?.id;
  if (!id) return;
  const config = gatherConfig();
  let plan;
  try {
    plan = await api.post(`/projects/${id}/plan-changes`, { config });
  } catch (e) {
    toast(`✖ Không tính được chi phí: ${e.message}`, 'error');
    return;
  }
  const host = $('#changePlanModal');
  if (!host) return;

  if (!plan.items.length) {
    host.querySelector('[data-body]').innerHTML =
      '<div class="hint" style="padding:12px 0">Không có gì thay đổi so với bản đã xuất — video hiện tại đã đúng với cấu hình này.</div>';
    host.querySelector('[data-actions]').innerHTML = '<button class="btn" data-close>Đóng</button>';
  } else {
    const cheap = plan.items.filter((i) => i.kind === 'concat');
    const canSplit = cheap.length && cheap.length < plan.items.length;
    host.querySelector('[data-body]').innerHTML =
      `<div class="hint" style="margin-bottom:4px">${plan.items.length} thay đổi đang chờ`
      + `${plan.measured ? '' : ' · ước tính theo số liệu mặc định, chưa đo dự án này'}</div>`
      + plan.items.map(row).join('')
      + `<div class="row" style="justify-content:space-between;padding-top:8px;border-top:1px solid var(--line);font-weight:600">
           <span>Tổng</span><span style="font-variant-numeric:tabular-nums">${fmt(plan.totalSec)}</span></div>`
      + (plan.fadeBlocksFastJoin
        ? '<div class="hint" style="margin-top:8px">💡 Chỉ còn hiệu ứng mờ đầu/cuối video buộc phải encode lại. '
          + 'Tắt nó ở <strong>Nâng cao</strong> thì lượt ghép này gần như tức thì.</div>'
        : '');
    host.querySelector('[data-actions]').innerHTML =
      `<button class="btn" data-close>Huỷ</button>`
      + (canSplit ? '<button class="btn" id="cpCheap">Chỉ ghép lại</button>' : '')
      + `<button class="btn primary" id="cpAll">Áp dụng${plan.items.length > 1 ? ' tất cả' : ''}</button>`;
  }
  host.classList.add('open');

  const run = async (payload) => {
    try {
      await api.post(`/projects/${id}/apply-changes`, { config: payload });
      toast('▶️ Đã bắt đầu áp dụng thay đổi', 'success');
      host.classList.remove('open');
      // A re-render that reports nothing is indistinguishable from one that never started, and
      // the owner may well have launched this from the Brand Kit dialog with the pipeline screen
      // nowhere in sight. Show the log; it is already live over the websocket.
      switchPage('studio');
      showJournal();
    } catch (e) { toast(`✖ ${e.message}`, 'error'); }
  };
  $('#cpAll')?.addEventListener('click', () => run(config));
  // the cheap subset = the saved config with only the concat-level edits layered on, so the
  // clips are left exactly as they are
  $('#cpCheap')?.addEventListener('click', () => {
    const keep = ['brandKit', 'brandKitOverride', 'logo', 'watermark', 'watermarkText', 'bgmPath',
      'autoBgm', 'useDefaultBgm', 'transitions', 'transitionStyle', 'masterFade', 'concatEncoder'];
    run(Object.fromEntries(keep.filter((k) => k in config).map((k) => [k, config[k]])));
  });
}

/**
 * "You changed the logo / the subtitles. Want that on the video you already made?"
 *
 * Saving a Brand Kit used to end with a toast about future videos and nothing else, so the only
 * way to get a new logo onto a finished video was to know that the resume button on a 'done'
 * project had quietly become an apply-changes button. This asks at the moment of the edit, and
 * hands over to the cost table rather than starting anything on its own.
 *
 * @param {string} reason what the owner just did, in their own terms
 * @returns {Promise<boolean>} whether the change queue was opened
 */
export async function offerRerender(reason) {
  const p = state.current;
  if (!p?.id || !p.video_path) return false; // nothing finished to re-render
  if (['running', 'queued'].includes(p.status)) return false; // it is already working
  const ok = await confirmDialog({
    title: 'Dựng lại video đang mở?',
    // confirmDialog escapes its body — plain text only, no markup
    body: `${reason}. Video "${p.title || 'đang mở'}" đã xuất trước đó — có thể dựng lại bản hoàn chỉnh `
      + 'với thiết lập mới ngay bây giờ. Bước tiếp theo hiện bảng chi phí trước khi chạy bất cứ thứ gì.',
    okText: 'Xem chi phí & dựng lại',
    cancelText: 'Để sau',
  });
  if (ok) await openChangePlan();
  return ok;
}

export function initChangePlan() {
  const host = $('#changePlanModal');
  host?.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]') || e.target === host) host.classList.remove('open');
  });
}
