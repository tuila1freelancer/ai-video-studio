// DOM helpers + tiny formatters shared by every view.
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

export function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
export function badgeText(s) { return ({ draft: 'Nháp', running: 'Đang chạy', done: 'Hoàn thành', error: 'Lỗi', paused: 'Tạm dừng', review: 'Chờ duyệt' }[s] || s); }
export function statusIcon(s) { return ({ script: '📝', tts: '🎙️', html: '🎨', rendered: '✅', error: '⚠️', retrying: '🩹', pending: '⏳' }[s] || ''); }
export function fmtDur(s) { return s >= 60 ? `${Math.round(s / 60)} phút` : `${s}s`; }

export const LANG_FLAGS = { vi: '🇻🇳', en: '🇺🇸', ja: '🇯🇵', ko: '🇰🇷', zh: '🇨🇳', ru: '🇷🇺', fr: '🇫🇷', de: '🇩🇪', es: '🇪🇸', multi: '🌐' };
