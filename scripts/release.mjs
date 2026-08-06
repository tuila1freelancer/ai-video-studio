#!/usr/bin/env node
// One command, one release.
//
//   npm run release -- --version 1.1.0 --notes "Sửa lỗi ghép video"
//
// Bumps the version, bakes the store's public key into the build, assembles a self-contained
// bundle, zips and hashes it, signs it if Apple credentials are around, uploads it to the store
// and publishes the version. Nothing about this touches the store's web UI: a release that needs
// a human to click "upload" is a release that eventually does not happen.
//
// Environment (the vendor's machine only — none of this ever ships inside the app):
//   AVS_STORE_URL             production store origin
//   AVS_STORE_CLIENT_KEY      `client`-scope API key; gets BAKED into the build
//   AVS_STORE_PUBLISHER_KEY   `publisher`-scope API key; used to upload, never baked
//   APPLE_SIGNING_IDENTITY, APPLE_ID, APPLE_TEAM_ID, APPLE_APP_PASSWORD   optional, for notarising
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(ROOT, 'AI Video Studio.app');
const PLATFORM = 'macos-arm64';

const args = parseArgs(process.argv.slice(2));
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

// ---- 1. what are we releasing -------------------------------------------------------------
const pkgPath = join(ROOT, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const version = args.version || pkg.version;
if (!/^\d+\.\d+\.\d+/.test(version)) die(`--version "${version}" không phải semver`);

const notes = args['notes-file']
  ? readFileSync(join(ROOT, args['notes-file']), 'utf8').trim()
  : (typeof args.notes === 'string' ? args.notes : '');

const storeUrl = (process.env.AVS_STORE_URL || '').replace(/\/+$/, '');
const clientKey = process.env.AVS_STORE_CLIENT_KEY || '';
const publisherKey = process.env.AVS_STORE_PUBLISHER_KEY || '';
const dryRun = Boolean(args['dry-run']);

if (!storeUrl) die('thiếu AVS_STORE_URL');
if (!clientKey) die('thiếu AVS_STORE_CLIENT_KEY (khoá scope `client`, sẽ được bake vào app)');
if (!publisherKey && !dryRun) die('thiếu AVS_STORE_PUBLISHER_KEY (khoá scope `publisher` để phát hành)');

console.log(`\n▶ Phát hành AI Video Studio v${version}`);
console.log(`  store: ${storeUrl}${dryRun ? '  (dry-run — không upload)' : ''}\n`);

// ---- 2. bake the trust anchor -------------------------------------------------------------
// The public key is fetched from the SAME store this build will talk to, and written into the
// source before compiling. A shipped app must never ask the network who to trust: whoever answers
// that question can mint licences.
console.log('· lấy public key từ cửa hàng…');
const keyRes = await fetch(`${storeUrl}/api/v1/public-key`, { headers: { 'x-api-key': clientKey } });
if (!keyRes.ok) die(`không lấy được public key: HTTP ${keyRes.status}`);
const { publicKey } = await keyRes.json();
if (!/BEGIN PUBLIC KEY/.test(publicKey || '')) die('cửa hàng trả về public key không hợp lệ');

const configPath = join(ROOT, 'src', 'license', 'config.js');
const config = readFileSync(configPath, 'utf8');
const baked = config.replace(
  /(--- BEGIN BAKED CONFIG[^\n]*\n)[\s\S]*?(\/\/ --- END BAKED CONFIG)/,
  `$1const BAKED = {\n  storeUrl: ${JSON.stringify(storeUrl)},\n  clientApiKey: ${JSON.stringify(clientKey)},\n  publicKeyPem: ${JSON.stringify(publicKey)},\n};\n$2`,
);
if (baked === config) die('không tìm thấy khối BAKED CONFIG trong src/license/config.js');
writeFileSync(configPath, baked);
console.log('  ✓ đã bake store URL + client key + public key');

// The baked file carries a live API key: it must never reach a commit.
let restoreConfig = () => writeFileSync(configPath, config);
process.on('exit', () => restoreConfig());

try {
  // ---- 3. version bump ---------------------------------------------------------------------
  if (version !== pkg.version) {
    pkg.version = version;
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
    console.log(`· package.json → ${version}`);
  }

  // ---- 4. build ----------------------------------------------------------------------------
  console.log('· dựng bundle self-contained…');
  run('bash', ['shell/build-app.sh', '--dist']);

  // ---- 5. sign ------------------------------------------------------------------------------
  const identity = process.env.APPLE_SIGNING_IDENTITY;
  if (identity) {
    console.log('· ký mã…');
    run('codesign', ['--force', '--deep', '--options', 'runtime', '--timestamp', '--sign', identity, APP]);
  } else {
    console.log('· ký ad-hoc (không có APPLE_SIGNING_IDENTITY)');
    run('codesign', ['--force', '--deep', '--sign', '-', APP]);
  }

  // ---- 6. zip + hash ------------------------------------------------------------------------
  const zipName = `AI-Video-Studio-v${version}-${PLATFORM}.zip`;
  const zipPath = join(ROOT, 'dist', zipName);
  run('mkdir', ['-p', join(ROOT, 'dist')]);
  rmSync(zipPath, { force: true });
  console.log('· đóng gói zip…');
  // ditto, not `zip`: it is the only tool that preserves the resource forks and symlinks inside
  // an .app, and a bundle unzipped by `zip` can lose its executable bit.
  run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', APP, zipPath]);
  const bytes = readFileSync(zipPath);
  const checksum = createHash('sha256').update(bytes).digest('hex');
  const fileSize = statSync(zipPath).size;
  console.log(`  ✓ ${zipName} — ${(fileSize / 1024 / 1024).toFixed(1)} MB`);
  console.log(`    sha256 ${checksum}`);

  // ---- 7. notarise ---------------------------------------------------------------------------
  const { APPLE_ID, APPLE_TEAM_ID, APPLE_APP_PASSWORD } = process.env;
  if (identity && APPLE_ID && APPLE_TEAM_ID && APPLE_APP_PASSWORD) {
    console.log('· gửi notarize (có thể mất vài phút)…');
    run('xcrun', ['notarytool', 'submit', zipPath, '--apple-id', APPLE_ID, '--team-id', APPLE_TEAM_ID,
      '--password', APPLE_APP_PASSWORD, '--wait']);
    run('xcrun', ['stapler', 'staple', APP]);
    // Stapling changes the bundle, so the zip the customer downloads has to be rebuilt from it.
    rmSync(zipPath, { force: true });
    run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', APP, zipPath]);
    console.log('  ✓ đã notarize + staple');
  } else {
    console.log('\n  ⚠ BẢN NÀY CHƯA ĐƯỢC NOTARIZE.');
    console.log('    Khách tải về sẽ bị Gatekeeper chặn và phải chuột phải → Open để mở lần đầu.');
    console.log('    Muốn hết cảnh báo: cần Apple Developer ID (99 USD/năm) rồi đặt');
    console.log('    APPLE_SIGNING_IDENTITY, APPLE_ID, APPLE_TEAM_ID, APPLE_APP_PASSWORD.\n');
  }

  const finalBytes = readFileSync(zipPath);
  const finalChecksum = createHash('sha256').update(finalBytes).digest('hex');
  const finalSize = statSync(zipPath).size;

  if (dryRun) {
    console.log('· dry-run: bỏ qua upload\n');
  } else {
    // ---- 8. upload + publish ------------------------------------------------------------------
    console.log('· xin URL upload…');
    const uploadUrl = await postJson('/versions/upload-url', { filename: zipName });
    console.log('· tải bản build lên kho…');
    const put = await fetch(uploadUrl.uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': 'application/zip' },
      body: finalBytes,
    });
    if (!put.ok) die(`upload thất bại: HTTP ${put.status}`);

    console.log('· phát hành phiên bản…');
    await postJson('/versions', {
      version,
      platform: PLATFORM,
      channel: args.channel || 'stable',
      changelog: notes || undefined,
      storageKey: uploadUrl.storageKey,
      fileSize: finalSize,
      checksum: finalChecksum,
    });
  }

  console.log('\n✅ Xong.');
  console.log(`   phiên bản : ${version}`);
  console.log(`   file      : dist/${zipName}`);
  console.log(`   dung lượng: ${(finalSize / 1024 / 1024).toFixed(1)} MB`);
  console.log(`   sha256    : ${finalChecksum}`);
  console.log(`   sản phẩm  : ${storeUrl}/products/ai-video-generation`);
  console.log('\n   Git chưa được push — kiểm tra rồi commit/push thủ công.\n');
} finally {
  // Whatever happened, the working tree goes back to a config with no key in it.
  restoreConfig();
  restoreConfig = () => {};
  console.log('· đã khôi phục src/license/config.js (không commit khoá)');
}

async function postJson(path, body) {
  const res = await fetch(`${storeUrl}/api/v1${path}`, {
    method: 'POST',
    headers: { 'x-api-key': publisherKey, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) die(`POST ${path} → HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}
