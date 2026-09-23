#!/usr/bin/env node
// Mint, list and revoke the API tokens an agent authenticates with.
//
//   node scripts/token.mjs create --name "claude-code" --scopes read,produce,publish [--channels ch1,ch2]
//   node scripts/token.mjs list [--all]
//   node scripts/token.mjs revoke <id>
//
// Deliberately a local command and not an HTTP route: a token is the key to the whole API, so
// handing one out is something the owner does at the machine, never something the API can be
// talked into doing.
import { createApiToken, listApiTokens, revokeApiToken, SCOPES } from '../src/db/index.js';

const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (name, fallback = '') => {
  const i = argv.indexOf(`--${name}`);
  return i > 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const list = (name) => opt(name).split(',').map((s) => s.trim()).filter(Boolean);
const die = (msg) => { process.stderr.write(`✖ ${msg}\n`); process.exit(1); };
const out = (s) => process.stdout.write(`${s}\n`);

if (cmd === 'create') {
  const scopes = list('scopes').length ? list('scopes') : ['read'];
  const bad = scopes.filter((s) => !SCOPES.includes(s));
  if (bad.length) die(`unknown scope(s): ${bad.join(', ')} — pick from ${SCOPES.join('|')}`);
  const channels = list('channels');
  const t = createApiToken({ name: opt('name', 'agent'), scopes, channelIds: channels.length ? channels : null });
  out(`token   ${t.token}`);
  out(`id      ${t.id}   name: ${t.name}`);
  out(`scopes  ${t.scopes.join(', ')}   channels: ${t.channelIds ? t.channelIds.join(', ') : 'all'}`);
  out('\nStore it now — the secret is hashed here and cannot be shown again.');
} else if (cmd === 'list') {
  const rows = listApiTokens({ includeRevoked: argv.includes('--all') });
  if (!rows.length) out('(no tokens)');
  for (const r of rows) {
    const used = r.lastUsedAt ? new Date(r.lastUsedAt).toISOString() : 'never';
    out(`${r.id}  ${r.name.padEnd(20)} ${r.scopes.join(',').padEnd(24)} ${r.channelIds ? r.channelIds.join(',') : 'all'}  used: ${used}${r.revokedAt ? '  REVOKED' : ''}`);
  }
} else if (cmd === 'revoke') {
  if (!argv[1]) die('usage: node scripts/token.mjs revoke <id>');
  out(revokeApiToken(argv[1]) ? `revoked ${argv[1]}` : `no live token with id ${argv[1]}`);
} else {
  die('usage: token.mjs create|list|revoke — see the header of this file');
}
