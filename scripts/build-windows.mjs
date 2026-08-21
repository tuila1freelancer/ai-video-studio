// Build the Windows installer from macOS, then put this machine back the way it was.
//
// electron-builder runs @electron/rebuild, which REPLACES node_modules/better-sqlite3 with a
// win32-x64 binary. That is correct for the artifact and fatal for the checkout: the macOS app
// runs on plain Node and loads the same file, so a Windows build silently breaks the Mac app
// until somebody rebuilds. Doing the restore here means it cannot be forgotten.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit', ...opts });

// The Node the macOS app actually launches with — the ABI the restored module must match.
const MAC_NODE = process.env.AVS_NODE || '/opt/homebrew/opt/node@22/bin/node';

console.log('· dựng bộ cài Windows…');
let failed = null;
try {
  run(join(ROOT, 'node_modules', '.bin', 'electron-builder'), ['--win', '--publish', 'never'], {
    env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' }, // unsigned on purpose
  });
} catch (e) {
  failed = e;
}

console.log('\n· dựng lại better-sqlite3 cho macOS…');
const nodeDir = existsSync(MAC_NODE) ? dirname(MAC_NODE) : null;
run('npm', ['rebuild', 'better-sqlite3'], {
  env: nodeDir ? { ...process.env, PATH: `${nodeDir}:${process.env.PATH}` } : process.env,
});

// Prove it, rather than assume it: a rebuild that silently produced the wrong ABI would leave
// the owner with a Mac app that dies on its first query.
const probe = existsSync(MAC_NODE) ? MAC_NODE : process.execPath;
execFileSync(probe, ['-e', "require('better-sqlite3'); console.log('  ✓ macOS nạp được better-sqlite3')"],
  { cwd: ROOT, stdio: 'inherit' });

if (failed) { console.error('\n⨯ electron-builder lỗi — máy đã được khôi phục'); process.exit(1); }
console.log('\n✅ Xong. Bộ cài ở dist/electron/');
