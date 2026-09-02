// Voice provider registry — one contract, ten providers.
import edge from './edge.js';
import say from './say.js';
import openai from './openai.js';
import elevenlabs from './elevenlabs.js';
import vbee from './vbee.js';
import larvoice from './larvoice.js';
import supertonic from './supertonic.js';
import azure from './azure.js';
import google from './google.js';
import polly from './polly.js';

export const PROVIDERS = { edge, say, supertonic, vbee, larvoice, elevenlabs, openai, azure, google, polly };

export function getProvider(id) { return PROVIDERS[id] || PROVIDERS.edge; }

export function listProviders() {
  return Object.values(PROVIDERS).map((p) => ({
    id: p.id, name: p.name, free: !!p.free, needsNetwork: !!p.needsNetwork, configSchema: p.configSchema || [],
  }));
}

/**
 * The file extension a provider actually writes.
 *
 * This was an if-chain in the TTS façade, which meant the voice-preview lane — which calls a
 * provider directly — saved Supertonic's wav bytes into a .mp3 file, and every provider added
 * later had to remember to edit a file it has nothing to do with.
 */
export function providerExt(pid) { return getProvider(pid).ext || '.mp3'; }

// Per-provider config: new-style settings.tts.providers[pid], falling back to legacy flat fields.
export function providerConfig(ttsSettings, pid) {
  const s = ttsSettings || {};
  const modern = (s.providers && s.providers[pid]) || {};
  const legacy = {
    say: { rate: s.rate },
    openai: { apiKey: s.apiKey, baseUrl: s.baseUrl, model: s.model },
    elevenlabs: { apiKey: s.apiKey, model: s.model },
    edge: {}, vbee: {}, supertonic: {},
  }[pid] || {};
  // Providers added after the picker existed have no legacy shape to inherit — only the modern
  // per-provider slot, which is where the settings UI writes them.
  return { ...legacy, ...modern };
}

/**
 * The voice chosen for this provider: the modern per-provider slot first, then the flat legacy
 * fields the settings shape used before the picker existed.
 *
 * The modern slot is what fixes a real bug. The Voice Picker writes a multilingual voice into
 * `voiceId`, and this function only read `voiceId` for openai and elevenlabs — so choosing any
 * Supertonic voice returned null, fell through to 'auto', and every scene was synthesized with
 * M1 regardless of what the owner picked.
 */
export function legacyVoice(ttsSettings, pid) {
  const s = ttsSettings || {};
  const own = s.providers && s.providers[pid] && s.providers[pid].voice;
  if (own) return own;
  if (pid === 'edge') return s.edgeVoice;
  if (pid === 'say') return s.voice;
  return s.voiceId;
}
