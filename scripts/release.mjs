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
//   TOOLS_PLATFORM_URL             production store origin
//   TOOLS_STORE_CLIENT_KEY      `client`-scope API key; gets BAKED into the build
//   TOOLS_STORE_PUBLISHER_KEY   `publisher`-scope API key; used to upload, never baked
//   APPLE_SIGNING_IDENTITY, APPLE_ID, APPLE_TEAM_ID, APPLE_APP_PASSWORD   optional, for notarising
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Same override the build script honours, so a release candidate can be built without deleting
// the copy the owner has open.
const APP = process.env.AVS_APP_PATH || join(ROOT, 'AI Video Studio.app');
/**
 * How much of a build may travel in one request.
 *
 * Not our ceiling to raise: Cloudflare refuses a proxied body over 100 MB, and
 * it refuses it at the edge — the store never hears about the upload at all.
 * Anything bigger goes up in parts, which the store stitches back together.
 *
 * Declared up here, not beside `uploadBuild`: the main flow calls that function
 * before execution ever reaches the bottom of the file, and a `const` read
 * before its declaration line runs is a ReferenceError, not a hoisted value.
 */
const SINGLE_PUT_LIMIT = 64 * 1024 * 1024;
/** Parts in flight at once. Three fills a home uplink without starving any of them. */
const LANES = 3;
/** A part the network dropped is worth asking for again before failing a release. */
const ATTEMPTS = 3;


const args = parseArgs(process.argv.slice(2));

/** What this run publishes. macOS is the default because it is the build this machine signs. */
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

// ---- 1. what are we releasing -------------------------------------------------------------
const pkgPath = join(ROOT, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const version = args.version || pkg.version;
if (!/^\d+\.\d+\.\d+/.test(version)) die(`--version "${version}" không phải semver`);
if (!PLATFORMS.includes(PLATFORM)) die(`--platform "${PLATFORM}" phải là một trong: ${PLATFORMS.join(', ')}`);

const notes = args['notes-file']
  ? readFileSync(join(ROOT, args['notes-file']), 'utf8').trim()
  : (typeof args.notes === 'string' ? args.notes : '');

const storeUrl = (process.env.TOOLS_PLATFORM_URL || '').replace(/\/+$/, '');
const clientKey = process.env.TOOLS_STORE_CLIENT_KEY || '';
const publisherKey = process.env.TOOLS_STORE_PUBLISHER_KEY || '';
const dryRun = Boolean(args['dry-run']);

if (!storeUrl) die('thiếu TOOLS_PLATFORM_URL');
if (!clientKey) die('thiếu TOOLS_STORE_CLIENT_KEY (khoá scope `client`, sẽ được bake vào app)');
if (!publisherKey && !dryRun) die('thiếu TOOLS_STORE_PUBLISHER_KEY (khoá scope `publisher` để phát hành)');

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
  // build-app.sh bundles src/ into one file, compiles it to V8 bytecode, encrypts it with a key
  // it generates and compiles into the launcher, and bundles the UI. Nothing readable ships.
  console.log('· dựng bundle self-contained…');
  // Both builds compile the same baked source; only the shell around it differs.
  if (WINDOWS) run('npm', ['run', 'win:build']);
  else run('bash', ['shell/build-app.sh', '--dist']);

  // The sourcemap is the only way to read a customer's crash report, and it is overwritten by the
  // next build — so it gets the version in its name and stays here, outside the zip and outside git.
  const mapSrc = join(ROOT, 'dist', 'private', 'server.cjs.map');
  const mapKept = join(ROOT, 'dist', 'private', `server-v${version}.cjs.map`);
  if (existsSync(mapSrc)) {
    renameSync(mapSrc, mapKept);
    console.log(`  ✓ sourcemap giữ riêng: dist/private/server-v${version}.cjs.map (KHÔNG gửi cho ai)`);
  }

  // ---- 4b. the release refuses to ship readable code -----------------------------------------
  console.log('· kiểm tra bản dựng không còn mã nguồn…');
  if (WINDOWS) run('node', ['scripts/audit-windows.mjs']);
  else run('node', ['scripts/audit-release.mjs', '--app', APP]);

  // ---- 5. sign ------------------------------------------------------------------------------
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

  // ---- 6. package + hash --------------------------------------------------------------------
  const zipName = WINDOWS
    ? `AI-Video-Studio-v${version}-windows-x64.exe`
    : `AI-Video-Studio-v${version}-${PLATFORM}.zip`;
  const zipPath = join(ROOT, 'dist', zipName);
  run('mkdir', ['-p', join(ROOT, 'dist')]);
  rmSync(zipPath, { force: true });
  if (WINDOWS) {
    // electron-builder names it after the product, spaces and all; the customer downloads it
    // under the key's basename, so it gets the same shape as the macOS artefact here.
    const built = join(ROOT, 'dist', 'electron', `AI Video Studio-${version}-win-x64-setup.exe`);
    if (!existsSync(built)) die(`không thấy bộ cài Windows: ${built}`);
    copyFileSync(built, zipPath);
  } else {
    console.log('· đóng gói zip…');
    // ditto, not `zip`: it is the only tool that preserves the resource forks and symlinks inside
    // an .app, and a bundle unzipped by `zip` can lose its executable bit.
    run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', APP, zipPath]);
  }
  const bytes = readFileSync(zipPath);
  const checksum = createHash('sha256').update(bytes).digest('hex');
  const fileSize = statSync(zipPath).size;
  console.log(`  ✓ ${zipName} — ${(fileSize / 1024 / 1024).toFixed(1)} MB`);
  console.log(`    sha256 ${checksum}`);

  // ---- 7. notarise ---------------------------------------------------------------------------
  const { APPLE_ID, APPLE_TEAM_ID, APPLE_APP_PASSWORD } = process.env;
  if (WINDOWS) {
    console.log('\n  ⚠ BỘ CÀI WINDOWS CHƯA ĐƯỢC KÝ SỐ.');
    console.log('    SmartScreen sẽ cảnh báo "Unknown publisher" cho tới khi có chứng chỉ code-signing.\n');
  } else if (identity && APPLE_ID && APPLE_TEAM_ID && APPLE_APP_PASSWORD) {
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
    const storageKey = await uploadBuild(zipName, finalBytes);

    console.log('· phát hành phiên bản…');
    await postJson('/versions', {
      version,
      platform: PLATFORM,
      channel: args.channel || 'stable',
      changelog: notes || undefined,
      storageKey,
      fileSize: finalSize,
      checksum: finalChecksum,
    });
  }

  console.log('\n✅ Xong.');
  console.log(`   phiên bản : ${version}`);
  console.log(`   file      : dist/${zipName}`);
  console.log(`   dung lượng: ${(finalSize / 1024 / 1024).toFixed(1)} MB`);
  console.log(`   sha256    : ${finalChecksum}`);
  console.log(`   sản phẩm  : ${storeUrl}/store/products/ai-video-studio`);
  console.log('\n   Git chưa được push — kiểm tra rồi commit/push thủ công.\n');
} finally {
  // Whatever happened, the working tree goes back to a config with no key in it.
  restoreConfig();
  restoreConfig = () => {};
  console.log('· đã khôi phục src/license/config.js (không commit khoá)');
}

/** What the object is stored as; the download sets its own filename on top of this. */
const CONTENT_TYPE = WINDOWS ? 'application/vnd.microsoft.portable-executable' : 'application/zip';

async function putBytes(url, bytes) {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'content-type': CONTENT_TYPE },
    body: bytes,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

/** Send the build to the store and answer with the key it was filed under. */
async function uploadBuild(zipName, bytes) {
  if (bytes.length <= SINGLE_PUT_LIMIT) {
    console.log('· xin URL upload…');
    const { uploadUrl, storageKey } = await postJson('/versions/upload-url', { filename: zipName });
    console.log('· tải bản build lên kho…');
    await putBytes(uploadUrl, bytes).catch((e) => die(`upload thất bại: ${e.message}`));
    return storageKey;
  }

  console.log('· mở phiên upload nhiều phần…');
  const { storageKey, uploadId, partSize } = await postJson('/versions/multipart', {
    filename: zipName,
  });
  const count = Math.ceil(bytes.length / partSize);
  console.log(`· tải lên ${count} phần × ${(partSize / 1024 / 1024).toFixed(0)} MB…`);
  try {
    const { urls } = await request('/versions/multipart/urls', {
      storageKey,
      uploadId,
      parts: Array.from({ length: count }, (_, i) => i + 1),
    });
    const byPart = new Map(urls.map((u) => [u.partNumber, u.url]));

    let next = 0;
    let done = 0;
    const lane = async () => {
      for (let i = next++; i < count; i = next++) {
        const chunk = bytes.subarray(i * partSize, Math.min((i + 1) * partSize, bytes.length));
        for (let attempt = 1; ; attempt += 1) {
          try {
            await putBytes(byPart.get(i + 1), chunk);
            break;
          } catch (e) {
            if (attempt >= ATTEMPTS) throw new Error(`phần ${i + 1}: ${e.message}`);
          }
        }
        console.log(`  · ${++done}/${count}`);
      }
    };
    await Promise.all(Array.from({ length: Math.min(LANES, count) }, lane));

    console.log('· ghép các phần…');
    const stitched = await request('/versions/multipart/complete', { storageKey, uploadId });
    if (stitched.fileSize !== bytes.length) {
      throw new Error(`kho nhận ${stitched.fileSize} byte, file là ${bytes.length}`);
    }
    return storageKey;
  } catch (e) {
    // Parts nobody completes sit in the bucket and are billed for; say so and clear them.
    await request('/versions/multipart/abort', { storageKey, uploadId }).catch(() => {});
    return die(`upload thất bại: ${e.message}`);
  }
}

/** Like `postJson`, but it throws instead of exiting — the caller still has cleanup to do. */
async function request(path, body) {
  const res = await fetch(`${storeUrl}/api/v1${path}`, {
    method: 'POST',
    headers: { 'x-api-key': publisherKey, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} → HTTP ${res.status}: ${await res.text()}`);
  return res.json();
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
