// Number and time formatting the whole interface shares. Dates follow the interface language
// (they were hard-coded to vi-VN in eighteen places, so a Japanese interface showed Vietnamese dates).
import { uiLang, tp } from '../i18n.js';

const LOCALE = { vi: 'vi-VN', en: 'en-US', ja: 'ja-JP', ko: 'ko-KR', zh: 'zh-CN', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', pt: 'pt-BR', id: 'id-ID', th: 'th-TH', hi: 'hi-IN', ru: 'ru-RU' };
const locale = () => LOCALE[uiLang()] || 'vi-VN';

/** `m:ss` for a player clock or a clip length. */
export const fmtT = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** `12s` / `3p05s` for a measured duration. */
export function fmtMs(ms) {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}p${String(s % 60).padStart(2, '0')}s` : `${s}s`;
}

/** `~40 giây` / `~3 phút` / `~1.2 giờ` for an estimate. */
export function fmtApprox(s) {
  const n = Math.max(1, Math.round(s));
  if (n < 60) return tp`~${n} giây`;
  if (n < 3600) return tp`~${Math.round(n / 60)} phút`;
  return tp`~${(n / 3600).toFixed(1)} giờ`;
}

/** Bytes as `12 KB` / `3.4 MB` / `1.20 GB`. */
export function fmtBytes(n) {
  if (n >= 1073741824) return `${(n / 1073741824).toFixed(2)} GB`;
  if (n >= 1048576) return `${(n / 1048576).toFixed(n >= 104857600 ? 0 : 1)} MB`;
  return `${Math.round(n / 1024)} KB`;
}

/** A timestamp in the interface language. `style`: 'full' (date + time), 'date', 'time' or 'short' (dd/mm hh:mm). */
export function fmtDate(ms, style = 'full') {
  const d = new Date(ms);
  if (style === 'date') return d.toLocaleDateString(locale());
  if (style === 'time') return d.toLocaleTimeString(locale());
  if (style === 'short') return d.toLocaleString(locale(), { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
  return d.toLocaleString(locale());
}

/** A count with the interface language's digit grouping. */
export const fmtNum = (n) => Number(n).toLocaleString(locale());
