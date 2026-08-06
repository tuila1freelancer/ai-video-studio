# PROMPT — Thương mại hoá AI Video Studio: nối app với Tools Platform (license + download + update + release tự động)

> **Phiên làm việc này code trên CẢ HAI repo:**
> - **APP** — `/Volumes/ExtremeSSD/Working/toannvs/ai-video-generation` (AI Video Studio, Node 22 + Express + SQLite + vỏ Swift/WKWebView)
> - **STORE** — `/Volumes/ExtremeSSD/Working/toannvs/tuila1freelancer-tools-platform` (pnpm + Turborepo: Next.js 16 `apps/web` + NestJS 11/Fastify `apps/api` + BullMQ `apps/worker` + Prisma/PostgreSQL, deploy production)
>
> Mục tiêu cuối: **người dùng chỉ tải và dùng được app sau khi có license mua trên STORE**; mọi khâu
> (mua → phát key → kích hoạt → chạy offline có thời hạn ân hạn → thu hồi/hết hạn → tải bản mới →
> phát hành bản build) đều **tự động, không cần chủ động tay**, và toàn bộ thiết kế **dùng lại được
> cho các app sau** (Reup Video đã có sẵn trong catalog).

---

## 0. Quy tắc chuẩn (bắt buộc, áp dụng cho CẢ HAI repo)

1. **Danh tính git**: trước commit đầu tiên **ở mỗi repo**, chạy
   `git config user.name tuila1freelancer && git config user.email 62372475+tuila1freelancer@users.noreply.github.com`
   (repo-local, KHÔNG đổi global). Sau mỗi commit verify
   `git log -1 --format='%an <%ae> | %cn <%ce>'` phải in danh tính noreply **hai lần**.
2. **Không attribution Claude/Anthropic** trong commit lẫn PR (không `Co-Authored-By`, không
   `🤖 Generated with…`).
3. Code, comment, commit, docs: **tiếng Anh**. Chuỗi hiển thị cho người dùng cuối (UI app, email,
   trang store): **tiếng Việt** (store có i18n VI/EN — điền cả hai). Trao đổi với chủ: tiếng Việt.
4. **Commit thẳng `main` ở cả hai repo** (lệnh thường trực), mỗi nhóm việc một commit, xanh rồi mới
   commit. STORE **cưỡng chế Conventional Commits** qua commitlint + husky (`feat(scope): …`) và
   lint bằng **Biome** — commit sẽ bị chặn nếu sai format. APP giữ style commit hiện tại.
5. **Không P-tag** cho việc mới; đặt tên nhóm việc theo slug như tài liệu này.
6. Không hỏi chủ giữa chừng — mọi lựa chọn mở đã được chốt sẵn ở §2. Làm tuần tự, xong báo cáo.
7. **Node**: APP dùng Node 22 tại `/opt/homebrew/opt/node@22/bin` (shell nền không kế thừa PATH —
   export trong từng lệnh). STORE ghim Node 24.18 qua `.nvmrc` (engines ≥22.13), pnpm 11 qua
   corepack; hạ tầng dev bằng Docker (`pnpm docker:up`: Postgres :5434, Valkey :6380, MinIO :9100).
   **Kiểm tra `docker info` trước** — nếu máy không có Docker thì vẫn code + unit test được, nhưng
   phần e2e store phải ghi rõ "chưa chạy vì thiếu Docker" trong báo cáo, không được im lặng bỏ qua.
8. STORE đang có **cây làm việc BẨN** (~20 file: rebrand/polish UI, sdk, seed, env.validation —
   xem `git status`). Theo luật cô lập: **commit khối đó thành MỘT commit riêng trước khi bắt đầu**
   (chạy `pnpm lint` + `pnpm typecheck` + `pnpm test` trước; message kiểu
   `feat(web): brand polish pass` mô tả đúng nội dung diff). Tuyệt đối không trộn nó vào việc mới.

---

## 1. BẢNG SỰ THẬT ĐÃ KIỂM CHỨNG (đọc trước khi code — mọi dòng có file:line)

### STORE — cái đã có sẵn (đừng xây lại!)

| # | Sự thật | Bằng chứng |
|---|---|---|
| S-1 | Store đã **hoàn thiện R0–R6**: storefront, Google-only auth + `OWNER_EMAILS`, per-tool pricing (subscription + lifetime + trial), coupon, refund, build hosting S3/R2, admin device-reset, customer portal | `README.md` (roadmap toàn ✅) |
| S-2 | **Licensing API v1 đã tồn tại**: `POST /api/v1/licenses/activate` · `validate` · `deactivate` · `GET /api/v1/subscriptions/status` · `GET /api/v1/public-key`, guard bằng header `x-api-key` | `apps/api/src/licensing-api/licensing-v1.controller.ts` |
| S-3 | API key theo **product**: format `pk_<8hex>.<48hex>`, lưu sha256, tạo qua `POST /api/admin/products/:productId/api-keys` (JWT owner/admin) | `licensing-api/api-key.service.ts:17-22`, `admin-integrations.controller.ts:24-26` |
| S-4 | `activate` upsert device, **chặn quá `deviceLimit`**, trả **JWT RS256 offline** claims `{licenseKey, productId, productSlug, plan, features, deviceId, expiresAt, graceUntil, iat, exp}`; TTL token = `min(giây còn lại của grace, 30 ngày)`, sàn 1h; lifetime (`expiresAt null`) → grace null → TTL 30 ngày | `licensing-api/licensing-v1.service.ts:8,40-45,47-100` |
| S-5 | `validate` = heartbeat: cập nhật `lastSeenAt`, trả `{valid, status, expiresAt, graceUntil, deviceRegistered}` — **không** trả token mới | `licensing-v1.service.ts:103-119` |
| S-6 | `deactivate` public **BỊ TẮT CÓ CHỦ ĐÍCH** (403 "admin-managed"); trang portal devices ghi "Liên hệ shop để được reset" | `licensing-v1.service.ts:121-126`, `apps/web/app/dashboard/devices/page.tsx:13` |
| S-7 | Grace = `expiresAt + LICENSE_GRACE_DAYS` (mặc định 7, env) | `licensing-v1.service.ts:29-36`, `.env.example` |
| S-8 | Key RS256 từ env `LICENSE_PRIVATE_KEY_B64`/`LICENSE_PUBLIC_KEY_B64` (base64 PEM); để trống → **tự sinh ephemeral mỗi lần boot** (dev) — production BẮT BUỘC ghim key bền | `.env.example` |
| S-9 | License key dạng `TOOLS-XXXX-XXXX-XXXX-XXXX`; phát hành khi thanh toán xong (`fulfillment.service.ts:79-99`) và khi mở **trial** (`trial.service.ts:65`); `deviceLimit` copy từ plan | `licensing/license.service.ts:19-45` |
| S-10 | Email sau mua đã gửi **key** nhưng **chưa có link tải/hướng dẫn kích hoạt** | `email/email.service.ts:43-51` |
| S-11 | Download portal (user JWT): `GET /api/me/licenses/:id/versions` → `POST /api/me/licenses/:id/download` → redirect `/api/downloads/:token` → presigned R2/MinIO; token ngắn hạn có prefix+hash, đếm lượt, license phải `active` | `downloads/downloads.controller.ts`, `downloads.service.ts:17-46` |
| S-12 | Upload build (admin JWT): `POST /api/admin/products/:id/versions/upload-url {filename}` → `{uploadUrl, storageKey}` → PUT bytes → `POST /api/admin/products/:id/versions {version, platform, channel, changelog, storageKey, fileSize, checksum}`; unique `(productId, version, platform)` | `downloads/admin-versions.controller.ts:23-31`, `versions.service.ts:29-52`, `schema.prisma` AppVersion |
| S-13 | **CHƯA CÓ** endpoint nào cho app gọi bằng license key: không có "latest version" public, không có mint-download bằng licenseKey — portal đòi JWT user | grep toàn `apps/api/src` |
| S-14 | **CHƯA CÓ rate limiting** ở bất kỳ route nào (không throttler trong `app.module.ts`) — `/v1/licenses/*` hiện brute-force được key | grep `Throttler\|rate` |
| S-15 | Seed đã có product **`ai-video-generation`** (3 plan: `pro-monthly` trial 7d/2 máy, `pro-yearly` trial 7d/2 máy, `lifetime` 3 máy) + product `reup-video`; features đang là **chuỗi marketing** ("Xuất 4K", "30 video/tháng"…) không phải mã máy đọc | `packages/db/prisma/seed.ts:132-230` |
| S-16 | SDK client đã có: `packages/sdk/src/index.ts` — `LicenseClient` (x-api-key, `baseUrl` hoặc env `TOOLS_PLATFORM_URL`), `verifyLicenseToken` (RS256 offline), `isWithinGrace` | đọc toàn file |
| S-17 | Payment provider trừu tượng: `manual` (dev, settle qua simulate-paid) / `payos` (VietQR) / `polar` (MoR quốc tế), chọn bằng env `PAYMENT_PROVIDER` | `.env.example`, `apps/api/src/payments/providers/` |
| S-18 | Webhook-out chỉ mới bắn `subscription.activated` | `checkout/fulfillment.service.ts:89` |
| S-19 | Port dev: web 4310, api 4311 (global prefix `/api`), PG 5434, Valkey 6380, MinIO 9100/9101; dev-login `POST /api/auth/dev-login {email}` (tắt ở production), owner seed `owner@tools.local` | `README.md`, `.env.example` |
| S-20 | Cây làm việc **đang bẩn** ~20 file (rebrand UI, sdk baseUrl bỏ default cứng, seed, env.validation) — chưa commit | `git status`, `git diff --stat` |

### APP — hiện trạng và điểm móc

| # | Sự thật | Bằng chứng |
|---|---|---|
| A-1 | Express: `mountRoutes(app)` rồi mới static SPA; router gắn tại `app.use('/api', r)`; `/api/health` trả `{ok, version, deps{ffmpeg, whisper, chrome, say}}` | `src/server.js:44`, `src/api/routes.js:33-38,1654` |
| A-2 | `VERSION = '1.0.0'` **hard-code** ở `src/server.js:14`, lặp lại trong `package.json` và Info.plist của build script — chưa có nguồn duy nhất | `src/server.js`, `shell/build-app.sh` |
| A-3 | **Scheduler tự chạy job QUEUED ngay khi boot** (`startScheduler()` trong khối recovery) — khoá license mà quên chỗ này thì app "bị khoá" vẫn âm thầm render tiếp | `src/server.js:26-28` |
| A-4 | `DATA_DIR = process.env.AVS_DATA_DIR \|\| ROOT/data` — đã override được bằng env | `src/config/paths.js:10` |
| A-5 | Vỏ Swift là **launcher mỏng**: `Config.swift` bake `NODE_PATH` + `PROJECT_ROOT` (đường dẫn **tuyệt đối trên máy dev**) + `AVS_PORT=8123`; chạy `node src/server.js` với cwd=repo; poll `/api/health` rồi load WebView. **⇒ bản .app hiện tại KHÔNG thể phân phối cho khách** — nó trỏ vào repo của máy chủ sở hữu | `shell/build-app.sh:19-24`, `shell/main.swift:86-109` |
| A-6 | Phụ thuộc nặng lúc chạy: ffmpeg/ffprobe homebrew + **ffmpeg vendored có libass** (`vendor/ffmpeg/ffmpeg`, bắt buộc cho phụ đề in cuối), whisper-cli + model (tải bằng `npm run whisper:build`), **Chrome** (render cảnh — bắt buộc), `say` (macOS built-in) | `src/config/paths.js`, `/api/health` deps |
| A-7 | Server ghi `data/server.url`, in sentinel `AVS_READY`; handler `EADDRINUSE` phải đứng **trước** `hub.attach` (ws re-throw) — đừng phá thứ tự này khi sửa boot | `src/server.js:60-83` |
| A-8 | Frontend boot: `public/js/main.js` `init()` — gọi `/api/health`, load channels/projects…; client API wrapper có sẵn xử lý lỗi tập trung tại `public/js/api.js` (`request()` ném `ApiError(status)`) — **điểm móc lock-screen 403** | `public/js/main.js`, `public/js/api.js` |
| A-9 | Test style: `node:test`, file `tests/*.test.js`, cách ly DB bằng `tests/_env.mjs` (AVS_DATA_DIR tạm); hiện **495 test xanh** — phải giữ | `tests/` |
| A-10 | `better-sqlite3` là native module (arm64) trong `node_modules` — đóng gói phân phối phải mang đúng binary | `package.json` |

---

## 2. QUYẾT ĐỊNH THIẾT KẾ (đã chốt — không mở lại, không hỏi)

1. **STORE là nguồn sự thật duy nhất** về license/plan/thiết bị/build. APP chỉ là client. Không viết
   hệ license thứ hai, không thêm bảng license nào vào SQLite của app.
2. **Offline-first bằng token RS256**: app verify token bằng **public key NHÚNG lúc build** (không
   TOFU ở bản phân phối); subscription sống offline tới `graceUntil` (hết hạn + 7 ngày); lifetime
   token 30 ngày — tự làm mới nền khi có mạng. Đây là mô hình JetBrains/Sketch, đủ cho hàng triệu
   máy vì heartbeat chỉ ~1 request/máy/ngày.
3. **API key nhúng trong app là "publishable key"**: nó chỉ mở activate/validate/status — chấp nhận
   lộ (app là JS trên máy khách). Bù lại: **rate limit phía server là hàng rào thật** (S2), và key
   phát hành build phải là **key scope khác, không bao giờ nhúng vào app** (S1).
4. **Enforcement trung thực**: chặn ở edge server app (middleware `/api/*`) + chặn scheduler + khoá
   UI. Ghi thẳng vào code comment: đây là **cơ chế thương mại (deterrence)**, không phải DRM chống
   crack — người dùng sở hữu máy và source JS; **không phí công obfuscate**, đổi lại giữ UX tử tế.
5. **Không có biến môi trường bypass nào hoạt động trong bản phân phối.** Dev thoát hiểm duy nhất:
   `AVS_LICENSE_BYPASS=1` chỉ có tác dụng khi **không** có `AVS_DIST=1` (Config.swift của bản dist
   luôn set `AVS_DIST=1`). Chạy từ repo dev → bypass được; bản khách tải về → không.
6. **Self-service reset thiết bị** trên portal (S3) — thay dòng "Liên hệ shop": mỗi license tự gỡ
   thiết bị tối đa **1 lần / 30 ngày**, có audit + email. Đây là vé support số 1 của mọi shop
   license; không tự động hoá nó thì "không cần động tay" là nói suông. Admin override giữ nguyên.
7. **V1 không gating tính năng theo plan**: mọi license `active` = full app (khác nhau ở thời hạn,
   số máy, giá). Sửa copy seed bỏ "30 video/tháng" (không có metering v1 — đừng bán thứ không
   enforce). `features[]` vẫn đi trong token claims để v2 gating mà không đổi contract.
8. **Trial giữ nguyên** (store phát license ngắn hạn — vẫn thoả "chỉ dùng khi có license"). Chủ muốn
   tắt trial thì set `trialDays=0` trong admin, không cần code.
9. **Update**: app tự check bản mới qua endpoint mới `GET /v1/versions/latest` (cache 6h), hiện
   banner; nút tải mint URL qua `POST /v1/downloads` bằng licenseKey (S1) — tải thẳng trong app,
   không bắt mở browser đăng nhập.
10. **Phát hành = MỘT lệnh** `npm run release` ở APP: build bundle self-contained → zip + sha256 →
    (codesign/notarize nếu có env Apple) → upload lên STORE qua admin API bằng **publisher key** →
    tạo `AppVersion`. Không thao tác tay trên web.
11. **SDK cho app**: port `packages/sdk` sang `src/license/sdk.js` (JS thuần ~120 dòng, app không có
    build TS; ghi rõ nguồn gốc + ngày sync trong docblock). Các app sau copy module `src/license/`
    nguyên khối — đó là đơn vị tái sử dụng.
12. **Dist data dir** = `~/Library/Application Support/AI Video Studio` (Config.swift set
    `AVS_DATA_DIR`); repo dev giữ `ROOT/data` như cũ.

---

## 3. NHÓM VIỆC — STORE (`tuila1freelancer-tools-platform`)

> Thứ tự: S0 → S1 → S2 → S3 → S4 → S5. Mỗi nhóm: code + unit test (Vitest cạnh file) + cập nhật
> Swagger decorator + `pnpm lint && pnpm typecheck && pnpm test` xanh → commit (Conventional Commits).

### S0 — Dọn cây bẩn (bắt buộc trước tiên)
Commit toàn bộ diff đang treo thành một commit riêng đúng nội dung của nó (S-20). Nếu test/lint đỏ
vì diff đó → sửa tối thiểu cho xanh, ghi trong message.

### S1 — `/v1` cho desktop app: latest-version, in-app download, publisher key
Mở rộng module `licensing-api` (đừng tạo module mới — API key guard, product resolution có sẵn):

1. **Migration additive** trên `ApiKey`: cột `scope String @default("client")`
   (`client` = nhúng trong app, chỉ license routes; `publisher` = phát hành build, chỉ nằm trong
   `.env` máy chủ sở hữu). `ApiKeyService.create(productId, name, scope)`;
   `admin-integrations.controller` nhận `scope` trong DTO (zod enum, default `client`).
2. `GET /v1/versions/latest?platform=macos-arm64&channel=stable` (guard `ApiKeyGuard`, mọi scope):
   trả `{version, channel, platform, changelog, fileSize, checksum, publishedAt}` của bản
   `published` mới nhất theo `(productId từ key, platform, channel)`; 404 nếu chưa có. **Cache 60s**
   trong Valkey (key `latest:{productId}:{platform}:{channel}`) — hàng triệu máy poll thì đây là
   endpoint nóng nhất.
3. `POST /v1/downloads {licenseKey, deviceId, versionId?}` (guard `ApiKeyGuard` scope bất kỳ):
   license phải thuộc product của key, `status='active'`, **device đã đăng ký** (chống share key
   tải chùa); `versionId` bỏ trống = bản mới nhất của platform trong body (`platform` optional,
   default `macos-arm64`). Mint qua `DownloadTokenService` sẵn có → `{url, expiresAt, version}`.
4. `POST /v1/versions` + `POST /v1/versions/upload-url` (guard `ApiKeyGuard` **chỉ scope
   `publisher`** — thêm decorator/param cho guard hoặc check trong controller): shape y hệt admin
   routes (S-12), để release script không cần JWT Google (dev-login tắt ở production — không có
   đường tự động hoá nào khác; publisher key là giải pháp đúng thay vì chế PAT).
5. Test: scope guard (client key gọi `/v1/versions` → 403), device chưa đăng ký → 403, cache hit.

### S2 — Rate limiting + audit (điều kiện để dám nhúng key vào app)
1. `@nestjs/throttler` (hoặc `@fastify/rate-limit` nếu hợp Fastify adapter hơn — chọn cái chạy được,
   storage Valkey qua ioredis sẵn có): mặc định toàn API **120 req/phút/IP**; riêng
   `/v1/licenses/activate|validate` **10 req/phút/IP** và **30 req/phút/licenseKey**;
   `/api/auth/*` 20/phút/IP. Trả 429 chuẩn.
2. Activate/validate **thất bại** (key sai, limit, revoked) → ghi `AuditLog` (`action:
   'license.activate.denied'`, metadata lý do + IP) — dữ liệu chống abuse sau này.
3. Test: vượt ngưỡng → 429; audit row xuất hiện.

### S3 — Self-service device reset (tự động hoá vé support số 1)
1. Migration additive: `License.lastDeviceReleaseAt DateTime?`.
2. `POST /api/me/licenses/:id/devices/:deviceId/release` (JWT customer, license phải của user):
   từ chối nếu `lastDeviceReleaseAt` < 30 ngày trước (message nói rõ ngày được phép tiếp theo);
   xoá `LicenseDevice`, set `lastDeviceReleaseAt`, ghi audit, gửi email xác nhận (template mới
   trong `EmailService`, VI).
3. `apps/web/app/dashboard/devices/page.tsx`: mỗi thiết bị có nút "Gỡ thiết bị này" + cooldown hiển
   thị; bỏ câu "Liên hệ shop để được reset"; i18n VI/EN.
4. Admin reset giữ nguyên (không cooldown).
5. Test: cooldown chặn lần 2; license không thuộc user → 404.

### S4 — Email + trang sản phẩm dẫn lối kích hoạt
1. `sendLicense` (S-10) thêm: link **"Tải app & xem hướng dẫn kích hoạt"** →
   `{NEXT_PUBLIC_APP_URL}/dashboard/downloads`, và 3 bước ngắn: cài app → mở app → dán key. Kèm
   ghi chú số thiết bị của plan.
2. Trang product `ai-video-generation` (`apps/web/app/products/[slug]`): block "Cách kích hoạt"
   (3 bước + ảnh minh hoạ text-only cũng được), block yêu cầu hệ thống (macOS 11+, Apple Silicon,
   Chrome). i18n VI/EN.

### S5 — Seed/copy khớp với enforcement thật
Sửa `packages/db/prisma/seed.ts`: bỏ "30 video/tháng" ở `pro-monthly` (thay bằng "Không giới hạn
video"); features còn lại giữ nguyên chuỗi hiển thị. (Seed dùng upsert theo slug — chạy lại an toàn.)

### S6 — `docs/DEPLOY-PROD.md` (checklist vận hành, KHÔNG tự deploy)
Viết file mới ở STORE, tiếng Việt, từng mục copy-paste được:
sinh RS256 bền (`openssl genrsa 2048` → base64 vào `LICENSE_PRIVATE_KEY_B64/PUBLIC`), cảnh báo
"để trống = key đổi mỗi lần restart = mọi token khách vô hiệu"; PayOS keys + webhook URL; Resend +
domain; R2 (endpoint/bucket/keys, thay MinIO); `OWNER_EMAILS`; Coolify + Caddy same-origin;
`pg_dump` cron + giữ 30 bản; tạo **client key** + **publisher key** cho product `ai-video-generation`
qua admin API (lệnh curl mẫu) và nơi cất (client key → bake vào app build; publisher key → `.env`
máy build của chủ).

---

## 4. NHÓM VIỆC — APP (`ai-video-generation`)

> Thứ tự: L1 → L2 → L3 → L4 → L5. Sau mỗi nhóm `npm test` xanh (495 test cũ + test mới) → commit.

### L1 — Module `src/license/` (client + trạng thái, chưa chặn gì)
File mới, không đụng pipeline:

- `src/license/sdk.js` — port `LicenseClient`/`verifyLicenseToken`/`isWithinGrace` từ
  `packages/sdk/src/index.ts` của STORE sang JS thuần (docblock ghi nguồn + ngày; thêm timeout
  fetch 10s + phân loại lỗi mạng vs lỗi 4xx).
- `src/license/device.js` — `deviceId()`: macOS `IOPlatformUUID` qua
  `ioreg -rd1 -c IOPlatformExpertDevice` (execFile, cache); fallback: UUID ngẫu nhiên persist vào
  license store (đừng hash hostname — đổi tên máy là mất kích hoạt). `deviceInfo()`:
  `{hostname, platform: 'macos-arm64', osVersion, appVersion}`.
- `src/license/config.js` — `STORE_URL`, `CLIENT_API_KEY`, `PUBLIC_KEY_PEM` (hằng bake lúc build;
  dev override bằng env `AVS_STORE_URL`, `AVS_STORE_API_KEY`; public key dev: cho phép fetch
  `/api/v1/public-key` một lần rồi cache — **bản dist tuyệt đối chỉ dùng key bake**, xem D2).
- `src/license/store.js` — đọc/ghi `join(DATA_DIR, 'license.json')`:
  `{key, token, claims, activatedAt, lastValidatedAt, lastOnlineAt, deviceFallbackId?}`; ghi atomic
  (tmp + rename); chmod 600.
- `src/license/state.js` — **máy trạng thái, thuần, test được**:
  `licenseState({file, now, device})` →
  `{state: 'missing'|'valid'|'grace'|'locked', reason?: 'expired'|'revoked'|'suspended'|'device-mismatch'|'token-expired-offline'|'clock-rollback', claims?, daysLeft?}`.
  Luật: token verify RS256 + chưa quá `exp` → check `claims.deviceId === device` → subscription:
  `isWithinGrace` (quá `expiresAt` nhưng còn grace → `'grace'` kèm daysLeft để UI nhắc gia hạn) →
  clock-rollback: `now < lastValidatedAt - 24h` → locked `'clock-rollback'` (bắt online validate).
- `src/license/refresh.js` — vòng nền (setInterval 6h + chạy lúc boot): `validate` → nếu
  `status ∈ {revoked, suspended}` → cập nhật file (giữ key, xoá token) và **phát sự kiện khoá**;
  nếu token còn <7 ngày `exp` → `activate` lại lấy token mới (activate idempotent với device đã
  đăng ký — S-4); lỗi mạng → chỉ ghi `lastOnlineAt` không đổi, im lặng (offline là hợp lệ).

### L2 — Gate ở edge + scheduler (điểm chặn thật)
1. `src/license/gate.js` — express middleware, mount trong `mountRoutes` **trước** mọi route:
   allowlist `/health`, `/license/*`; còn lại khi state ∉ {valid, grace} → 403
   `{error: 'license_required', state, reason}`. Bypass: chỉ khi
   `process.env.AVS_LICENSE_BYPASS === '1' && process.env.AVS_DIST !== '1'` (quyết định §2.5).
2. `src/server.js` — `startScheduler()` (A-3) chỉ gọi khi state ok; nếu bị khoá lúc boot → log rõ
   một dòng tiếng Việt + KHÔNG start (job QUEUED nằm yên, không mất). Khi kích hoạt thành công qua
   API → start scheduler ngay lúc đó (đừng bắt restart app). Sự kiện khoá từ refresh.js → dừng
   nhận job mới (scheduler check state ở điểm pick-next), job đang render **cho chạy nốt** — cắt
   ngang giữa video là phá của khách.
3. Routes mới trong `routes.js`:
   `GET /license/status` → `{state, reason, claims: {plan, expiresAt, graceUntil, features}, deviceId, storeUrl}` (không trả key đầy đủ — mask `TOOLS-…-XXXX`);
   `POST /license/activate {key}` → activate với store, lưu, trả status mới; lỗi store map sang
   message tiếng Việt (`404` key sai · `403 limit` → "Hết slot thiết bị — gỡ máy cũ trong trang
   quản lý: <link portal>" · `403 revoked/suspended`);
   `POST /license/refresh` → chạy chu trình refresh ngay;
   `GET /license/update` → gọi `GET /v1/versions/latest` (cache 6h trong RAM) so `package.json`
   version → `{current, latest, changelog, hasUpdate}`;
   `POST /license/update/download` → `POST /v1/downloads` bằng key+deviceId → `{url}` (UI mở URL —
   trình duyệt tải).
4. `VERSION` (A-2): đọc từ `package.json` một lần ở boot (`createRequire`/`readFileSync`), bỏ hằng.

### L3 — UI khoá + kích hoạt (tiếng Việt, đúng chất app)
1. `public/js/features/license.js` — màn khoá full-screen (overlay z-index trên cùng, theme app):
   logo, ô dán key (auto-format `TOOLS-…`), nút **Kích hoạt**, nút **Mua license** (mở
   `storeUrl/products/ai-video-generation` bằng `window.open`), hiển thị lỗi thân thiện, trạng thái
   đang kích hoạt. Khi state `grace`: banner vàng đếm ngày + nút gia hạn (link portal billing).
   Trial: badge "Dùng thử — còn N ngày".
2. `public/js/api.js` — `request()` bắt `ApiError` 403 body `license_required` → phát event;
   `main.js` boot: gọi `/api/license/status` TRƯỚC các load khác; state khoá → chỉ render lock
   screen (đừng gọi tiếp các API khác cho đỡ rác console).
3. Badge thường trực ở sidebar (cạnh AI Setting): tên plan + ngày còn lại (subscription) — click mở
   modal chi tiết license (device, portal links, nút refresh).
4. Banner update khi `hasUpdate` (góc dưới): "Có bản {latest} — Tải về" → `/license/update/download`.
5. Shell Swift không đổi hành vi boot (health vẫn mở qua allowlist — A-7 giữ nguyên).

### L4 — Tests (node:test, style repo)
- `tests/license-state.test.js`: sinh keypair RSA test trong test, tự ký token → mọi nhánh của
  `licenseState` (valid/grace/expired/revoked-file/device-mismatch/clock-rollback/lifetime 30d),
  không mạng.
- `tests/license-gate.test.js`: middleware — allowlist qua, route khác 403 đúng body, bypass đúng
  điều kiện env (cả chiều `AVS_DIST=1` phải VÔ HIỆU bypass).
- `tests/license-routes.test.js`: mock `fetch` (undici MockAgent hoặc stub global) — activate lưu
  file + trả claims; limit 403 → message có link portal; update so version đúng semver.
- Guard hồi quy: scheduler không start khi locked (assert bằng đọc source như style
  `tests/subtitles-after-concat.test.js` nếu khó test runtime).

### L5 — Registry + README
- `docs/architecture.md` §7: thêm hàng `store-license` (mô tả quyết định §2, các bẫy: bypass/AVS_DIST,
  scheduler gate, public-key bake, grace máy trạng thái) theo format bảng hiện có.
- `README.md`: mục "Thương mại hoá" ngắn: mua ở store → kích hoạt → offline 7 ngày grace.

---

## 5. NHÓM VIỆC — PHÂN PHỐI & PHÁT HÀNH (APP repo)

### D1 — Bundle self-contained (sửa A-5: bản .app tải về phải chạy được máy khách)
Sửa `shell/build-app.sh` thêm mode `--dist` (mode cũ giữ nguyên cho dev):

1. Copy vào `AI Video Studio.app/Contents/Resources/app/`: `src/`, `public/`, `package.json`,
   `node_modules` **production** (`npm ci --omit=dev` vào staging dir — mang đúng `better-sqlite3`
   arm64, A-10), `vendor/` (ffmpeg libass — A-6).
2. Copy **node binary** (`NODE_PATH` đã resolve) → `Resources/node`.
3. Bundle thêm **ffmpeg + ffprobe tĩnh** cho dist (không dựa homebrew của khách): dùng chính binary
   vendored nếu đủ (kiểm `vendor/ffmpeg/ffmpeg -version` có đủ encoder x264/aac + ffprobe; nếu
   vendor thiếu ffprobe → copy từ homebrew kèm `otool -L` kiểm không link lib homebrew ngoài
   /usr/lib+System; link ngoài → ghi chú rõ trong báo cáo và giữ yêu cầu "cài ffmpeg" ở first-run
   thay vì ship binary hỏng).
   `src/config/paths.js`: thứ tự resolve mới `bundled (AVS_BUNDLE_DIR) → vendor → homebrew → PATH`.
4. `Config.swift` (dist): `PROJECT_ROOT = Bundle.main.resourcePath + "/app"`, `NODE_PATH = … + "/node"`,
   env `AVS_DIST=1`, `AVS_DATA_DIR = ~/Library/Application Support/AI Video Studio`,
   `AVS_BUNDLE_DIR = resourcePath`. (Template hoá Config.swift theo mode; main.swift đọc như cũ.)
5. **First-run check** (server-side, route `/api/health` đã trả deps): frontend khi thiếu `chrome`
   → banner hướng dẫn cài Chrome (bắt buộc render); thiếu whisper → chỉ cảnh báo mờ (chỉ cần cho
   Sửa video/copy-transcript). Model whisper KHÔNG bundle (nặng) — nút tải trong Settings gọi
   script sẵn có.
6. Info.plist version lấy từ `package.json` (sed trong build script) — hết hard-code 1.0.0 (A-2).
7. Smoke test bắt buộc sau build dist: copy .app sang `/tmp`, chạy với `AVS_DATA_DIR` sạch,
   `curl /api/health` 200 và `/api/license/status` trả `missing` (chứng minh không phụ thuộc repo).

### D2 — `scripts/release.mjs` — một lệnh phát hành
`npm run release -- --version 1.1.0 --notes "..."` (hoặc `--notes-file CHANGELOG-entry.md`):

1. Bump `package.json` version (+ commit `chore(release): v1.1.0` — danh tính đúng luật §0).
2. **Bake config**: fetch `GET {AVS_STORE_URL}/api/v1/public-key` từ **production URL** trong env
   `AVS_STORE_URL` → ghi `src/license/config.js` (PUBLIC_KEY_PEM + STORE_URL + CLIENT_API_KEY từ
   env `AVS_STORE_CLIENT_KEY`). Thiếu env nào → fail to, không build bản thiếu key.
3. `shell/build-app.sh --dist` → zip `AI-Video-Studio-v{v}-macos-arm64.zip` (ditto -c -k giữ quyền),
   sha256.
4. Codesign/notarize nếu có `APPLE_SIGNING_IDENTITY` + `APPLE_ID`/`APPLE_TEAM_ID`/`APPLE_APP_PASSWORD`
   (codesign --deep --options runtime → notarytool submit --wait → stapler); thiếu env → ad-hoc
   sign + in cảnh báo to: "bản chưa notarize — khách phải chuột phải Open; cần Apple Developer ID
   ($99/năm) để phân phối chuẩn" (quyết định của chủ, ngoài phạm vi session).
5. Upload qua `POST /v1/versions/upload-url` + PUT + `POST /v1/versions` bằng env
   `AVS_STORE_PUBLISHER_KEY` (S1.4) — platform `macos-arm64`, channel `stable`, checksum, fileSize,
   changelog.
6. In tổng kết: version, size, sha256, URL sản phẩm. KHÔNG tự push git (chủ push).

---

## 6. NGHIỆM THU END-TO-END (dev, cả hai repo trên máy này — làm thật, chụp bằng chứng vào báo cáo)

> STORE: `pnpm docker:up && pnpm db:migrate && pnpm db:seed && pnpm dev` (web 4310/api 4311,
> `PAYMENT_PROVIDER=manual`). APP: `AVS_STORE_URL=http://localhost:4311 AVS_STORE_API_KEY=<client key> npm start`.
> Trước khi boot app: **huỷ job QUEUED tồn đọng** (scheduler tự chạy — luật cũ vẫn áp dụng).

1. **Phát key tự động**: dev-login owner → tạo client key + publisher key cho `ai-video-generation`
   (curl, lưu lại). Dev-login customer → mua `pro-monthly` (coupon WELCOME10 cho vui) → simulate-paid
   → log email dev có key + link tải (S4).
2. **Khoá → kích hoạt**: mở app chưa có license → lock screen; gọi thử `POST /api/projects` → 403
   `license_required`; dán key → mở khoá, badge plan hiện, scheduler start (log), `license.json`
   đúng shape, token verify offline bằng public key.
3. **Giới hạn thiết bị**: activate deviceId giả thứ 3 (curl thẳng store, plan 2 máy) → 403 limit;
   portal self-release máy giả → activate lại OK; release lần 2 trong cooldown → chặn kèm ngày.
4. **Thu hồi**: admin revoke license → `POST /api/license/refresh` trong app → state locked
   `revoked`, UI khoá lại, scheduler ngừng nhận job mới.
5. **Offline + grace**: tắt api store → app vẫn chạy (token còn hạn); unit test phủ grace/lifetime/
   clock-rollback (không chỉnh clock máy thật).
6. **Rate limit**: vòng curl 15 lần activate key sai/phút → 429 + audit rows.
7. **Update + download**: `npm run release -- --version 1.0.1` (store local, MinIO) → app báo có
   bản 1.0.1 → nút tải trả URL MinIO tải được file đúng sha256. Smoke test D1.7 pass.
8. **Hồi quy**: APP `npm test` xanh toàn bộ (495 + mới); STORE `pnpm lint && pnpm typecheck &&
   pnpm test` xanh (+ e2e Playwright nếu môi trường cho phép).
9. Báo cáo cuối (tiếng Việt): bảng commit hai repo, bằng chứng từng mục 1–8, danh sách việc chủ
   phải tự làm (mục §7).

---

## 7. VIỆC CHỦ PHẢI TỰ LÀM (ghi lại trong báo cáo cuối — session KHÔNG tự làm)

1. Mua/điền: PayOS merchant thật, Resend + domain, Cloudflare R2, VPS + Coolify, domain store.
2. Sinh và cất RS256 keypair production (theo `docs/DEPLOY-PROD.md`), set toàn bộ env production.
3. Apple Developer ID ($99/năm) nếu muốn bản notarized không bị Gatekeeper chặn.
4. Quyết định giá/trial cuối cùng trong admin (seed chỉ là khởi điểm).
5. Push git + deploy (session chuẩn bị mọi thứ chạy được, chủ bấm nút cuối).

## 8. RÀO HỒI QUY (vi phạm = làm lại)

| Rào | Kiểm bằng |
|---|---|
| 495 test cũ của APP không đỏ cái nào; STORE suite xanh | chạy full ở mỗi commit |
| `/api/health` không bao giờ bị gate (Swift shell poll nó để boot — A-7) | test allowlist |
| Scheduler: locked → không start; activate xong → start ngay không cần restart; job đang chạy không bị giết | L2.2 + test/source-guard |
| Bản dist không đọc gì từ đường dẫn repo dev; bypass env vô hiệu khi `AVS_DIST=1` | D1.7 smoke + test |
| `/v1` contract cũ không đổi shape (SDK đã phát hành vẫn chạy); migration Prisma additive-only | diff Swagger + `prisma migrate diff` |
| Client key không thể phát hành build (scope guard) | test S1.5 |
| Không secret nào bị commit (publisher key, Apple creds chỉ ở env/.env đã gitignore) | `git diff` từng commit |
| Email/URL production không hard-code — đọc env (`NEXT_PUBLIC_APP_URL`, `AVS_STORE_URL`) | grep |

## 9. THỨ TỰ COMMIT GỢI Ý

STORE: `S0 chore/feat(web): brand polish (pending tree)` → `feat(licensing): publisher scope +
latest-version + in-app downloads` → `feat(api): rate limiting + license audit` →
`feat(portal): self-service device release with cooldown` → `feat(store): activation guidance in
email + product page` → `chore(db): align seed copy with enforcement` → `docs: production deploy
checklist`.

APP: `feat(license): client, state machine, storage` → `feat(license): edge gate + scheduler +
routes` → `feat(license): activation UI, status badge, update banner` → `test(license): state/gate/
routes` → `feat(dist): self-contained bundle + first-run checks` → `feat(release): one-command
publish to the store` → `docs: registry row + README`.
