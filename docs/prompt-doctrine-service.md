# Đưa doctrine lên server — ĐÃ CÂN NHẮC VÀ KHÔNG LÀM

> **Quyết định của chủ, 2026-08-19: KHÔNG thi công.**
> Yêu cầu thật là *"miễn không lộ source"*, và giai đoạn A đã đạt: bản phát hành không còn một
> dòng mã nguồn nào đọc được. Việc prompt hiện trong dashboard LLM của chính khách là **rủi ro
> được chấp nhận có ý thức**, không phải việc còn dang dở.
>
> Giữ tài liệu này vì lý do kỹ thuật vẫn đúng, và vì điều kiện để đảo quyết định là một con số
> cụ thể chứ không phải cảm tính: **nếu mô hình bán hàng đổi sang credit/thuê bao** (chủ trả tiền
> LLM), thì rào cản chính ở mục 2 biến mất và việc này đáng làm lại. Chừng nào khách còn mang key
> riêng, đừng mở lại.
>
> Chỗ nối phía app (`src/hyperframe/doctrine.js`) **vẫn giữ**. Nó không tốn gì lúc chạy, và nó là
> ranh giới đúng dù có bao giờ dùng đến hay không: vòng lặp re-ask không việc gì phải biết prompt
> trông thế nào.

---

## 1. Lỗ mà giai đoạn A không chạm tới được

Giai đoạn A đã làm bản phát hành không còn mã nguồn đọc được: `src/*.js` 161 → 0 file, bytecode được
mã hoá AES-256-GCM, khoá đi qua stdin. Quét 2.191 file trong bản `.app` không tìm ra một mẩu doctrine
nào.

**Nhưng có một lỗ mà không kỹ thuật đóng gói nào chạm tới được.**

`src/providers/llm.js:108` gửi prompt tới `baseUrl` + `apiKey` **do chính khách nhập**. Nhà cung cấp
LLM lưu toàn văn request và hiển thị cho chủ khoá. Khách chỉ cần mở dashboard OpenRouter/OpenAI của
họ là đọc được nguyên vẹn 181 KB doctrine — không cần đụng vào file app, không cần debugger, không
cần biết gì về kỹ thuật.

Chỉ có một cách bịt: **prompt không bao giờ rời máy chủ của anh**.

## 2. Vì sao dừng ở đây — và đây là lý do kinh doanh, không phải kỹ thuật

Nếu server của anh dựng prompt rồi gọi LLM bằng **khoá của khách**, thì prompt lại xuất hiện trong
dashboard của khách. Không giải quyết được gì.

→ Server phải gọi bằng **khoá của anh**. Kéo theo:

| Hôm nay | Sau giai đoạn B |
|---|---|
| Khách tự mang API key | Anh trả tiền LLM |
| Bán license một lần | Bán theo credit / thuê bao |
| Sinh nội dung chạy offline | Sinh nội dung cần mạng (render vẫn offline) |
| Anh không chịu chi phí biến đổi | Chi phí LLM tỉ lệ thuận với lượng dùng |

**Đây chính là chỗ quyết định dừng.** Chủ giữ mô hình "khách mang key riêng", nên không có
đường nào để prompt rời khỏi máy khách mà vẫn kín. Đổi mô hình bán hàng để bịt một lỗ mà chủ đã
chấp nhận là đánh đổi sai chiều.

## 3. Phần nào chuyển, phần nào ở lại

Chỉ chuyển đúng phần **doctrine + gọi model**. Mọi thứ cần trình duyệt vẫn ở máy khách.

| Ở lại máy khách | Lên server |
|---|---|
| `parseSpec`, `normalizeSpec`, `lintSpec` | `buildCodegenPrompt` (47 KB) |
| `renderValidate` (cần Chrome thật) | `codegenSystem`, các block ngưỡng bố cục |
| Vòng thử lại + quyết định re-ask | Gọi LLM, chọn model, thang nhiệt độ |
| Render, ghép, phụ đề, TTS | `master-script.js` (48 KB) khi làm kịch bản |

`animation/harness.js` (40 KB) **không chuyển được** — nó chạy trong trình duyệt lúc render. Nó ở lại
dưới dạng bytecode mã hoá, và đó là mức trần cho nó.

## 4. Hợp đồng API

Khớp hạ tầng đã có trong repo store (đã đọc, chưa sửa gì):

- `apps/api/src/licensing-api/licensing-v1.controller.ts` — `@Controller('v1')`, `ApiKeyGuard`,
  `@RequireApiKeyScopes(...)`, `@RateLimit(...)`, `@CurrentProduct()` suy ra từ API key.
- `apps/api/src/licensing-api/api-key.service.ts` — `ApiKeyScope = 'client' | 'publisher'`.

**Cần thêm scope thứ ba: `doctrine`.** Không dùng lại `client`: khoá `client` được bake vào mọi bản
app và ai cũng đọc được (đúng thiết kế, giống `pk_` của Stripe). Một khoá mở được doctrine mà nằm sẵn
trong app thì bằng không làm gì cả.

### Xác thực

Không phải API key. Dùng **license token RS256** mà app đã có sau khi kích hoạt
(`src/license/` — token đã gắn `deviceId`). Server xác minh chữ ký, còn hạn, đúng `productId`, và
`deviceId` khớp thiết bị đang gọi. Nghĩa là: **hết hạn license là hết doctrine**, tự động.

### `POST /api/v1/doctrine/scene-spec`

Mở một phiên hoặc tiếp tục phiên đang có. Đây chính là hình dạng của `doctrine.js` hôm nay.

```jsonc
// mở phiên
{
  "licenseToken": "<RS256 JWT>",
  "scene":     { "voiceText": "...", "keywords": [...], "duration": 6 },
  "beats":     [...],
  "direction": { "isClimax": false, ... },
  "guide":     { /* brand kit đã normalize */ },
  "canvas":    { "w": 1080, "h": 1920 },
  "index":     { "idx": 0, "total": 6 },
  "options":   { "density": "balanced", "captionsOn": true, "language": "vi",
                 "diversitySalt": 0, "modeBlocks": ["overlay"] }
}
```

```jsonc
// tiếp tục — tương ứng doctrine.reaskIssues()
{ "licenseToken": "...", "sessionId": "ds_...", "issues": ["off-screen", "overlap"],
  "lastSpec": { "css": "...", "html": "...", "script": "..." } }

// tiếp tục — tương ứng doctrine.reaskFormat()
{ "licenseToken": "...", "sessionId": "ds_...", "formatViolation": true }
```

Trả về:

```jsonc
{ "sessionId": "ds_...", "raw": "@@@CSS@@@...@@@END@@@",
  "usage": { "promptTokens": 8100, "completionTokens": 5200, "creditsSpent": 3 },
  "creditsLeft": 812 }
```

**`raw` là văn bản thô, không phải spec đã parse.** Vì `parseSpec`/`lintSpec` phải chạy ở máy khách —
chúng là đầu vào cho `renderValidate`, mà cái đó cần Chrome.

### `POST /api/v1/doctrine/script`

Cùng khuôn, cho `master-script.js`. Vào: chủ đề, thời lượng, ngôn ngữ, giọng kênh. Ra: kịch bản.

### `GET /api/v1/doctrine/credits`

Số dư, để app hiện trước khi chạy chứ không báo lỗi giữa chừng.

### Giới hạn tốc độ

Theo đúng khuôn `LICENSE_RATE_LIMIT` sẵn có, nhưng chặn theo `deviceId` chứ không theo IP —
một studio ngồi chung một đường mạng không được làm nhau nghẽn:

```ts
const DOCTRINE_RATE_LIMIT = [
  { limit: 60,  windowSec: 60,   by: 'deviceId', name: 'device' },
  { limit: 600, windowSec: 3600, by: 'deviceId', name: 'device-hour' },
];
```

### Vòng đời phiên

TTL 15 phút, giữ trong Redis (store đã có `apps/api/src/redis`). Một cảnh tối đa 10 vòng; hết phiên
thì app mở phiên mới — mất ngữ cảnh sửa lỗi, không mất cảnh.

## 5. Chỗ nối phía app đã sẵn sàng

`src/hyperframe/doctrine.js` đã tách prompt và lời gọi model ra khỏi vòng lặp. `codegen.js` giờ chỉ
biết ba động tác: `ask`, `reaskFormat`, `reaskIssues`.

Thi công B = viết `remoteDoctrine` cài đúng ba hàm đó, cộng một khoá config chọn `local`/`remote`.
Vòng lặp re-ask, lint, render-validate **không đụng tới một dòng nào**.

`tests/doctrine-seam.test.js` khoá cuộc hội thoại của bản `local` theo từng byte, nên bản `remote`
có một chuẩn đối chiếu rõ ràng để so.

## 6. Rủi ro phải xử lý khi thi công

| Rủi ro | Cách chặn |
|---|---|
| Store sập → không ai tạo được video | Hàng đợi retry + thông báo rõ. **Không** fallback về prompt cục bộ — làm vậy là ship lại doctrine |
| Trễ thêm một chặng mạng mỗi vòng re-ask (tới 10 vòng/cảnh) | Đo trước trên video 100 cảnh; giữ HTTP keep-alive |
| Khách MITM chính máy mình để đọc request | TLS pinning nâng rào; debugger thì vẫn qua được. Nhưng bắt được **prompt gửi lên**, không phải doctrine — server chỉ nhận brief, không trả prompt |
| Chi phí LLM vượt doanh thu | `creditsSpent` chốt theo token thực, kiểm tra số dư **trước** khi gọi model |
| Video cũ render lại sau khi hết hạn | Render lại cảnh không cần LLM (`mode:'scenes'`) — đường đó phải luôn chạy được offline |

## 7. Thứ tự làm — CHỈ dùng nếu quyết định ở đầu tài liệu bị đảo

1. Chốt mô hình bán hàng (mục 2). Mọi thứ dưới đây phụ thuộc vào nó.
2. Store: scope `doctrine` + xác minh license token + bảng credit.
3. Store: `/doctrine/scene-spec`, chuyển `prompt.js` sang, giữ nguyên từng chữ.
4. App: `remoteDoctrine` + khoá config, đối chiếu byte với `local` qua test đã có.
5. Đo song song trên một video thật: `local` và `remote` phải ra cùng một spec với cùng seed.
6. Bật cho bản phát hành mới; bản cũ giữ `local` cho tới khi hết vòng đời.
