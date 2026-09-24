// The Agent panel: turn the lane on, hand out a key, take it back.
//
// Everything an agent needs already existed — tokens, scopes, an MCP server in the kit — and none
// of it was reachable by someone who installed the app rather than cloned it. This is that path:
// one switch, one button, and a command with this machine's real paths already in it.
import { $, esc } from '../../ui/dom.js';
import { api } from '../../api.js';
import { toast } from '../../ui/toast.js';
import { openDialog, confirmDialog } from '../../ui/dialog.js';
import { fmtDate } from '../../ui/format.js';
import { m, tp } from '../../i18n.js';

/** Where this copy lives. Asked once: it cannot change while the page is open. */
let host = null;

async function hostInfo() {
  if (!host) host = (await api.get('/boot', { ttl: 5000 }))?.host || {};
  return host;
}

/** Quote a path only when it needs it — an unquoted command is the one people read. */
const q = (p) => (/[\s"]/.test(String(p)) ? `"${p}"` : String(p));

/**
 * The line the owner pastes into their agent, with this machine's paths in it.
 * No `--url`: the port changes every boot, so the kit finds the running app by itself.
 */
export function mcpCommand(info, token = '<TOKEN>') {
  if (!info?.node || !info?.kit?.mcp) return null;
  return `claude mcp add avs -- ${q(info.node)} ${q(info.kit.mcp)} --token ${token}`;
}

function renderCommand(info) {
  const cmd = mcpCommand(info);
  const box = $('#agentCmd');
  if (!box) return;
  if (!cmd) {
    box.textContent = m('Bản dựng này không kèm Agent Kit — xem Hướng dẫn để cài kit rời.');
    return;
  }
  box.innerHTML = `<code>${esc(cmd)}</code><button class="mf-c" data-copy="${esc(cmd)}" title="${esc(m('Sao chép'))}">⧉</button>`;
}

const SCOPE_HINT = () => ({
  read: m('đọc'), produce: m('tạo video'), publish: m('đăng'), admin: m('toàn quyền'),
});

function renderTokens(tokens) {
  const box = $('#agentTokens');
  if (!box) return;
  if (!tokens.length) {
    box.textContent = m('Chưa cấp token nào.');
    return;
  }
  const names = SCOPE_HINT();
  box.innerHTML = tokens.map((t) => `<div class="agent-tok">
    <span class="agent-tok-n">${esc(t.name)}</span>
    <span class="agent-tok-s">${esc(t.scopes.map((s) => names[s] || s).join(' · '))}</span>
    <span class="agent-tok-u">${esc(t.lastUsedAt ? tp`dùng ${fmtDate(t.lastUsedAt, 'short')}` : m('chưa dùng'))}</span>
    <button class="mf-c" data-revoke="${esc(t.id)}" title="${esc(m('Thu hồi'))}">✖</button>
  </div>`).join('');
}

/** The one moment the secret exists outside the app: show it, offer it, say it will not come back. */
function showNewToken(token, info) {
  const cmd = mcpCommand(info, token.token);
  return openDialog(`
    <div class="dlg-title">${esc(m('Token mới — chỉ hiện một lần'))}</div>
    <div class="dlg-body">${esc(m('Sao chép ngay. Đóng hộp thoại này là không xem lại được nữa; mất thì cấp cái khác.'))}</div>
    <div class="agent-cmd mt-8"><code>${esc(token.token)}</code>
      <button class="mf-c" data-copy="${esc(token.token)}" title="${esc(m('Sao chép'))}">⧉</button></div>
    ${cmd ? `<div class="label mt-10">${esc(m('Cài vào agent trên máy này'))}</div>
    <div class="agent-cmd"><code>${esc(cmd)}</code>
      <button class="mf-c" data-copy="${esc(cmd)}" title="${esc(m('Sao chép'))}">⧉</button></div>` : ''}
    <div class="dlg-actions"><button class="btn primary" data-a="ok">${esc(m('Xong'))}</button></div>`, {
    onReady(dlg, close) {
      dlg.querySelector('[data-a=ok]').addEventListener('click', () => close(true));
      dlg.querySelector('[data-a=ok]').focus();
    },
  });
}

/** The token list, or the reason there is none to show. */
async function loadTokens() {
  const warn = $('#agentWarn');
  try {
    const { tokens } = await api.get('/tokens');
    renderTokens(tokens || []);
    if (warn) warn.textContent = '';
  } catch (e) {
    renderTokens([]);
    // 403 here means this page is not the app's own window — a browser tab, or a server deployment.
    if (warn) warn.textContent = e.status === 403 ? m('Chỉ cửa sổ ứng dụng mới cấp được token. Mở app rồi thử lại.') : e.message;
  }
}

/**
 * Show or hide the token half, and keep the command in step with it.
 * @param {{enabled?: boolean}} agent the reply's own `agent` block — a sibling of `settings`,
 * not a field inside it, which is what this read used to get wrong.
 */
export async function loadAgent(agent) {
  const on = agent?.enabled === true;
  const box = $('#agentBox');
  if ($('#setAgentOn')) $('#setAgentOn').checked = on;
  if (box) box.hidden = !on;
  if (!on) return;
  renderCommand(await hostInfo());
  await loadTokens();
}

/** Turning it on changes how every later request is answered, so it is asked before it is done. */
async function toggleAgent(next) {
  const info = await hostInfo();
  if (next) {
    const ok = await confirmDialog({
      title: m('Bật quyền gọi API cho Agent?'),
      body: info.launcher
        ? m('Từ giờ mọi lời gọi API đều cần token. Cửa sổ ứng dụng vẫn vào được như thường.')
        : m('Từ giờ mọi lời gọi API đều cần token — kể cả trang này, vì nó không phải cửa sổ ứng dụng. Bạn sẽ phải dán token vào màn hình truy cập.'),
    });
    if (!ok) { $('#setAgentOn').checked = false; return; }
  }
  await api.put('/settings', { agent: { enabled: next } });
  if (next) toast('Đã bật quyền cho Agent ✓', 'success');
  else toast('Đã tắt quyền của Agent.', 'success');
  await loadAgent({ enabled: next });
}

/**
 * Spending caps live here rather than with the provider keys: they are the other half of letting
 * something else spend your money. Empty means no cap, which is what an app with no agent had.
 */
export function renderBudget(budget) {
  const val = (n) => (n > 0 ? String(n) : '');
  if ($('#setBudVideo')) $('#setBudVideo').value = val(+budget?.perVideoUsd);
  if ($('#setBudDay')) $('#setBudDay').value = val(+budget?.perChannelDayUsd);
  if ($('#setBudVideos')) $('#setBudVideos').value = val(+budget?.perChannelDayVideos);
  if ($('#setBudHard')) $('#setBudHard').checked = budget?.hardStop === true;
}

/** What "Lưu cấu hình" sends. A blank field is 0, and 0 means "no cap" to the server. */
export function budgetForSave() {
  const num = (id) => Math.max(0, +($(id)?.value || 0) || 0);
  return {
    perVideoUsd: num('#setBudVideo'),
    perChannelDayUsd: num('#setBudDay'),
    perChannelDayVideos: num('#setBudVideos'),
    hardStop: $('#setBudHard') ? $('#setBudHard').checked : false,
  };
}

export function initAgentPanel({ onGuide } = {}) {
  $('#setAgentOn')?.addEventListener('change', (e) => toggleAgent(e.currentTarget.checked));
  $('#btnAgentNew')?.addEventListener('click', async () => {
    const info = await hostInfo();
    const made = await api.post('/tokens', { name: 'agent', scopes: ['read', 'produce'] });
    if (!made?.token) return toast('Không cấp được token.', 'error');
    await showNewToken(made.token, info);
    await loadTokens();
  });
  $('#btnAgentGuide')?.addEventListener('click', () => onGuide?.());
  // The rows are re-rendered on every change, so the listeners live on the box, not on the buttons.
  $('#agentBox')?.addEventListener('click', async (e) => {
    const copy = e.target.closest('[data-copy]');
    if (copy) {
      try { await navigator.clipboard.writeText(copy.dataset.copy); toast('⧉ Đã sao chép', 'success'); }
      catch { toast('Trình duyệt không cho sao chép.', 'error'); }
      return;
    }
    const kill = e.target.closest('[data-revoke]');
    if (!kill) return;
    if (!await confirmDialog({ title: m('Thu hồi token này?'), body: m('Agent đang dùng nó sẽ bị từ chối ngay.'), danger: true })) return;
    await api.del(`/tokens/${kill.dataset.revoke}`);
    toast('Đã thu hồi ✓', 'success');
    await loadTokens();
  });
}
