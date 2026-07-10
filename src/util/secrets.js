// Secret masking shared by API egress and channel.json export. Dependency-free
// so both db/ and core/ can import it without cycles.
const SECRET_KEY_RE = /(apiKey|api_key|token|secret|password)$/i;
const MASK = '••';

function isPlainObject(v) { return v != null && typeof v === 'object' && !Array.isArray(v); }

export function maskSecrets(obj) {
  if (Array.isArray(obj)) return obj.map(maskSecrets);
  if (!isPlainObject(obj)) return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && v && SECRET_KEY_RE.test(k)) {
      out[k] = v.length > 4 ? v.slice(0, 4) + MASK : MASK;
    } else {
      out[k] = maskSecrets(v);
    }
  }
  return out;
}

// Merge an incoming (possibly masked) update over saved data: any value still carrying
// the mask marker is treated as "unchanged" and the saved value is kept.
// Deep-merge needs an explicit delete marker: incoming `null` REMOVES the key
// (otherwise deletions get resurrected by the merge — e.g. removing a langVoice).
export function applyMaskedUpdate(saved, incoming) {
  if (Array.isArray(incoming)) return incoming;
  if (!isPlainObject(incoming)) return incoming;
  const out = { ...(isPlainObject(saved) ? saved : {}) };
  for (const [k, v] of Object.entries(incoming)) {
    if (v === null) { delete out[k]; continue; } // explicit delete
    if (typeof v === 'string' && v.includes(MASK)) continue; // unchanged secret
    if (isPlainObject(v)) out[k] = applyMaskedUpdate(out[k], v);
    else out[k] = v;
  }
  return out;
}
