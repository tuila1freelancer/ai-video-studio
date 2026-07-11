// Publisher registry — one contract per platform, mirroring the voice provider pattern.
// Each publisher: { id, name, configured(), connected(), authUrl(), exchangeCode(), upload() }.
import youtube from './youtube.js';

export const PUBLISHERS = { youtube };

export function getPublisher(id) {
  const p = PUBLISHERS[id];
  if (!p) throw new Error(`nền tảng chưa hỗ trợ: ${id}`);
  return p;
}

export function publisherStatus() {
  return Object.values(PUBLISHERS).map((p) => ({ id: p.id, name: p.name, configured: p.configured(), connected: p.connected() }));
}
