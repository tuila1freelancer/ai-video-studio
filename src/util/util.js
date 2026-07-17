// Small shared utilities.
import { randomBytes } from 'node:crypto';

export function newId(prefix = '') {
  const t = Date.now().toString(36);
  const r = randomBytes(4).toString('hex');
  return `${prefix}${t}${r}`;
}

/** FNV-1a 32-bit string hash — stable, cheap; used to salt per-project randomness (P31). */
export function hash32(str) {
  let h = 0x811c9dc5;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

export function safeJson(v, fallback) {
  if (v == null) return fallback;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return fallback; }
}

// Detect input type: url | json | text
export function detectInputType(raw) {
  const s = (raw || '').trim();
  if (!s) return 'text';
  if (/^https?:\/\/\S+$/i.test(s.split(/\s+/)[0]) && s.split(/\s+/).length <= 3) return 'url';
  if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
    try { JSON.parse(s); return 'json'; } catch { /* not json */ }
  }
  return 'text';
}

// crude word counter that works for Vietnamese + Latin
export function wordCount(s) {
  return (s || '').trim().split(/\s+/).filter(Boolean).length;
}

export function ratioToSize(aspect) {
  // base on 1080 short side, even dimensions for h264
  switch (aspect) {
    case '16:9': return { w: 1920, h: 1080 };
    case '1:1': return { w: 1080, h: 1080 };
    case '4:5': return { w: 1080, h: 1350 };
    case '9:16':
    default: return { w: 1080, h: 1920 };
  }
}

export function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function applyTextCase(text, mode) {
  const t = String(text || '');
  switch (mode) {
    case 'uppercase': return t.toUpperCase();
    case 'lowercase': return t.toLowerCase();
    case 'titlecase': return t.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
    case 'sentence': return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
    default: return t;
  }
}
