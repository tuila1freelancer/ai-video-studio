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

export function initChangePlan() {
  const host = $('#changePlanModal');
  host?.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]') || e.target === host) host.classList.remove('open');
  });
}
