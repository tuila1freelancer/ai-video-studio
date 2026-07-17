// Sandboxed E2E wrapper: prepares an isolated AVS_DATA_DIR (never the real one), copies the
// repo DB's `ai` setting into it (read-only source — the constraint: providers come from AI
// Settings, never hardcoded), then hands off to scripts/e2e.mjs with the caller's env.
//   AVS_SANDBOX=/tmp/dir node scripts/e2e-sandbox.mjs [topic] [duration] [timeoutMs]
//   extra env: AVS_MODE / AVS_AR / AVS_CFG_JSON (merged into the project config)
import { mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SANDBOX = process.env.AVS_SANDBOX || join(process.env.TMPDIR || '/tmp', `avs-e2e-${Date.now()}`);
mkdirSync(SANDBOX, { recursive: true });

// 1) copy the ai setting from the repo DB (readonly) into the sandbox DB
const src = join(ROOT, 'data/studio.sqlite');
if (existsSync(src)) {
  const Database = require('better-sqlite3');
  const from = new Database(src, { readonly: true });
  const row = from.prepare("SELECT value FROM settings WHERE key='ai'").get();
  from.close();
  if (row) {
    process.env.AVS_DATA_DIR = SANDBOX;
    const DB = await import('../src/db/index.js');
    DB.setSetting('ai', JSON.parse(row.value));
    // media library rows ride along (absolute paths into the repo's data/library files) so
    // the LLM sound-design lane has a real BGM/SFX catalog to pick from in the sandbox.
    const from2 = new Database(src, { readonly: true });
    let copied = 0;
    try {
      for (const r of from2.prepare("SELECT * FROM library WHERE kind IN ('bgm','sfx')").all()) {
        if (!existsSync(r.path)) continue;
        try { DB.addLibrary({ kind: r.kind, brandFolder: r.brand_folder, name: r.name, filename: r.filename, path: r.path, size: r.size }); copied++; } catch { /* dup */ }
      }
    } catch { /* no library table */ }
    from2.close();
    console.log(`[e2e-sandbox] ai settings + ${copied} library rows copied into`, SANDBOX);
  }
}

// 2) run the existing E2E driver inside the sandbox
const child = spawn(process.execPath, [join(ROOT, 'scripts/e2e.mjs'), ...process.argv.slice(2)], {
  env: { ...process.env, AVS_DATA_DIR: SANDBOX },
  stdio: 'inherit',
});
child.on('exit', (code) => process.exit(code ?? 1));
