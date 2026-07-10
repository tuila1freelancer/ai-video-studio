// Voice provider registry — one contract, six providers.
import edge from './edge.js';
import say from './say.js';
import openai from './openai.js';
import elevenlabs from './elevenlabs.js';
import vbee from './vbee.js';
import larvoice from './larvoice.js';

export const PROVIDERS = { edge, say, vbee, larvoice, elevenlabs, openai };

export function getProvider(id) { return PROVIDERS[id] || PROVIDERS.edge; }

export function listProviders() {
  return Object.values(PROVIDERS).map((p) => ({
    id: p.id, name: p.name, free: !!p.free, needsNetwork: !!p.needsNetwork, configSchema: p.configSchema || [],
  }));
}

// Per-provider config: new-style settings.tts.providers[pid], falling back to legacy flat fields.
export function providerConfig(ttsSettings, pid) {
  const s = ttsSettings || {};
  const modern = (s.providers && s.providers[pid]) || {};
  const legacy = {
    say: { rate: s.rate },
    openai: { apiKey: s.apiKey, baseUrl: s.baseUrl, model: s.model },
    elevenlabs: { apiKey: s.apiKey, model: s.model },
    edge: {}, vbee: {},
  }[pid] || {};
  return { ...legacy, ...modern };
}

// Legacy per-provider chosen voice (pre-picker settings shape).
export function legacyVoice(ttsSettings, pid) {
  const s = ttsSettings || {};
  if (pid === 'edge') return s.edgeVoice;
  if (pid === 'say') return s.voice;
  if (pid === 'openai' || pid === 'elevenlabs') return s.voiceId;
  return null;
}
