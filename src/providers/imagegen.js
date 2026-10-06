// Image-to-image EDIT call (brand-asset lane, P27) — the one image feature that survives the
// single-visual-mode collapse (P36). The former `image` visual mode (Pollinations text-to-image
// generation + Ken-Burns posters) was removed; only editImage remains, used by the Brand Kit
// asset lane to restyle an uploaded reference into a brand asset.
import { readFileSync } from 'node:fs';

/**
 * ONE image-to-image edit call (brand-asset lane, P27) against an OpenAI-compatible
 * `/v1/images/edits` endpoint: multipart
 * `image, prompt, model, n=1, size` (+ `background=transparent` for gpt-image models).
 * Deliberately NO failover chain and it throws on failure: the caller owns the
 * primary-model ×N retry loop and the loud final error (no-fallback contract).
 * A provider that rejects the `background` field gets ONE immediate re-send without it —
 * an API-shape probe inside the same attempt, not a fallback.
 */
export async function editImage({ imagePath, prompt, baseUrl, apiKey, model, size,
  background = 'transparent', timeoutMs = 120000, fetchImpl = fetch }) {
  if (!baseUrl || !apiKey) throw new Error('image-edit provider not configured (baseUrl/apiKey)');
  if (!model) throw new Error('image-edit model not configured');
  const url = `${String(baseUrl).replace(/\/$/, '')}/images/edits`;
  const img = readFileSync(imagePath);
  const call = async (withBackground) => {
    const form = new FormData();
    form.append('image', new Blob([img], { type: 'image/png' }), 'reference.png');
    form.append('prompt', prompt);
    form.append('model', model);
    form.append('n', '1');
    if (size) form.append('size', size);
    if (withBackground && background) form.append('background', background);
    return fetchImpl(url, {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}` },
      body: form, signal: AbortSignal.timeout(timeoutMs),
    });
  };
  let res = await call(true);
  if (res.status === 400 && background) {
    const t = await res.text().catch(() => '');
    if (/background/i.test(t)) res = await call(false); // shape probe: field unsupported
    else throw new Error(`image edit HTTP 400: ${t.slice(0, 300)}`);
  }
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`image edit HTTP ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = (await res.json())?.data?.[0];
  if (data?.b64_json) return Buffer.from(data.b64_json, 'base64');
  if (data?.url) {
    const dl = await fetchImpl(data.url, { signal: AbortSignal.timeout(30000) });
    if (!dl.ok) throw new Error(`image edit: result download HTTP ${dl.status}`);
    return Buffer.from(await dl.arrayBuffer());
  }
  throw new Error('image edit: response carries neither b64_json nor url');
}
