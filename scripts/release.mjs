#!/usr/bin/env node
// One command, one build to hand out.
//
//   npm run release -- --version 1.1.0
//
// Bumps the version, assembles a self-contained bundle, audits that no readable source survived,
// signs it, zips and hashes it, and notarises it when Apple credentials are around. The result is
// a file in dist/ — there is no store to upload it to, and nothing in the app phones one.
//
// Environment (optional, macOS only):
//   APPLE_SIGNING_IDENTITY, APPLE_ID, APPLE_TEAM_ID, APPLE_APP_PASSWORD   for signing + notarising
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Same override the build script honours, so a release candidate can be built without deleting
// the copy the owner has open.
const APP = process.env.AVS_APP_PATH || join(ROOT, 'AI Video Studio.app');

const args = parseArgs(process.argv.slice(2));

/** What this run builds. macOS is the default because it is the build this machine signs. */
const PLATFORMS = ['macos-arm64', 'windows-x64'];
const PLATFORM = typeof args.platform === 'string' ? args.platform : 'macos-arm64';
const WINDOWS = PLATFORM === 'windows-x64';

const run = (cmd, argv, opts = {}) =>
  execFileSync(cmd, argv, { cwd: ROOT, stdio: 'inherit', ...opts });

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    out[key] = next && !next.startsWith('--') ? (i += 1, next) : true;
  }
  return out;
}

function die(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

// ---- 1. what are we building ---------------------------------------------------------------
const pkgPath = join(ROOT, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const version = args.version || pkg.version;
if (!/^\d+\.\d+\.\d+/.test(version)) die(`--version "${version}" không phải semver`);
if (!PLATFORMS.includes(PLATFORM)) die(`--platform "${PLATFORM}" phải là một trong: ${PLATFORMS.join(', ')}`);

console.log(`\n▶ Dựng bản phát hành AI Video Studio v${version} (${PLATFORM})\n`);

// ---- 2. version bump -----------------------------------------------------------------------
if (version !== pkg.version) {
  pkg.version = version;
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`· package.json → ${version}`);
}

// ---- 3. build ------------------------------------------------------------------------------
// build-app.sh bundles src/ into one file, compiles it to V8 bytecode, encrypts it with a key
// it generates and compiles into the launcher, and bundles the UI. Nothing readable ships.
console.log('· dựng bundle self-contained…');
if (WINDOWS) run('npm', ['run', 'win:build']);
else run('bash', ['shell/build-app.sh', '--dist']);

// The sourcemap is the only way to read a crash report, and it is overwritten by the next build —
// so it gets the version in its name and stays here, outside the zip and outside git.
const mapSrc = join(ROOT, 'dist', 'private', 'server.cjs.map');
const mapKept = join(ROOT, 'dist', 'private', `server-v${version}.cjs.map`);
if (existsSync(mapSrc)) {
  renameSync(mapSrc, mapKept);
  console.log(`  ✓ sourcemap giữ riêng: dist/private/server-v${version}.cjs.map (KHÔNG gửi cho ai)`);
}

// ---- 3b. the build refuses to ship readable code --------------------------------------------
console.log('· kiểm tra bản dựng không còn mã nguồn…');
if (WINDOWS) run('node', ['scripts/audit-windows.mjs']);
else run('node', ['scripts/audit-release.mjs', '--app', APP]);

// ---- 4. sign -------------------------------------------------------------------------------
// The Windows installer is already its own signed-or-not artefact by the time electron-builder
// is done; there is nothing here to sign, zip or notarise, so that half is skipped whole.
const identity = WINDOWS ? '' : process.env.APPLE_SIGNING_IDENTITY;
if (WINDOWS) {
  // nothing to do: the installer is what electron-builder produced
} else if (identity) {
  console.log('· ký mã…');
  run('codesign', ['--force', '--deep', '--options', 'runtime', '--timestamp', '--sign', identity, APP]);
} else {
  console.log('· ký ad-hoc (không có APPLE_SIGNING_IDENTITY)');
  run('codesign', ['--force', '--deep', '--sign', '-', APP]);
}

// ---- 5. package + hash ---------------------------------------------------------------------
const zipName = WINDOWS
  ? `AI-Video-Studio-v${version}-windows-x64.exe`
  : `AI-Video-Studio-v${version}-${PLATFORM}.zip`;
const zipPath = join(ROOT, 'dist', zipName);
run('mkdir', ['-p', join(ROOT, 'dist')]);
rmSync(zipPath, { force: true });
if (WINDOWS) {
  // electron-builder names it after the product, spaces and all; it gets the same shape as the
  // macOS artefact here.
  const built = join(ROOT, 'dist', 'electron', `AI Video Studio-${version}-win-x64-setup.exe`);
  if (!existsSync(built)) die(`không thấy bộ cài Windows: ${built}`);
  copyFileSync(built, zipPath);
} else {
  console.log('· đóng gói zip…');
  // ditto, not `zip`: it is the only tool that preserves the resource forks and symlinks inside
  // an .app, and a bundle unzipped by `zip` can lose its executable bit.
  run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', APP, zipPath]);
}
console.log(`  ✓ ${zipName} — ${(statSync(zipPath).size / 1024 / 1024).toFixed(1)} MB`);

// ---- 6. notarise ---------------------------------------------------------------------------
const { APPLE_ID, APPLE_TEAM_ID, APPLE_APP_PASSWORD } = process.env;
if (WINDOWS) {
  console.log('\n  ⚠ BỘ CÀI WINDOWS CHƯA ĐƯỢC KÝ SỐ.');
  console.log('    SmartScreen sẽ cảnh báo "Unknown publisher" cho tới khi có chứng chỉ code-signing.\n');
} else if (identity && APPLE_ID && APPLE_TEAM_ID && APPLE_APP_PASSWORD) {
  console.log('· gửi notarize (có thể mất vài phút)…');
  run('xcrun', ['notarytool', 'submit', zipPath, '--apple-id', APPLE_ID, '--team-id', APPLE_TEAM_ID,
    '--password', APPLE_APP_PASSWORD, '--wait']);
  run('xcrun', ['stapler', 'staple', APP]);
  // Stapling changes the bundle, so the zip has to be rebuilt from it.
  rmSync(zipPath, { force: true });
  run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', APP, zipPath]);
  console.log('  ✓ đã notarize + staple');
} else {
  console.log('\n  ⚠ BẢN NÀY CHƯA ĐƯỢC NOTARIZE.');
  console.log('    Máy khác tải về sẽ bị Gatekeeper chặn và phải chuột phải → Open để mở lần đầu.');
  console.log('    Muốn hết cảnh báo: cần Apple Developer ID (99 USD/năm) rồi đặt');
  console.log('    APPLE_SIGNING_IDENTITY, APPLE_ID, APPLE_TEAM_ID, APPLE_APP_PASSWORD.\n');
}

const finalBytes = readFileSync(zipPath);
console.log('\n✅ Xong.');
console.log(`   phiên bản : ${version}`);
console.log(`   file      : dist/${zipName}`);
console.log(`   dung lượng: ${(finalBytes.length / 1024 / 1024).toFixed(1)} MB`);
console.log(`   sha256    : ${createHash('sha256').update(finalBytes).digest('hex')}`);
console.log('\n   Git chưa được push — kiểm tra rồi commit/push thủ công.\n');
