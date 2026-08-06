# PROMPT — Phụ đề ở bước cuối · Hệ font thật · Studio hậu kỳ

> **Dành cho một phiên Claude Code mới** chạy trong
> `/Volumes/ExtremeSSD/Working/toannvs/ai-video-generation`.
> Ba slug công việc: **`subtitle-lane`**, **`fonts`**, **`restudio`**.
> Không dùng ký hiệu `P<số>` — quy ước đó đã bỏ từ 2026-08-05.

---

## 0. Luật phiên làm việc (đọc trước khi gõ dòng code đầu tiên)

1. **Ngôn ngữ**: mọi thứ nằm trong repo — code, tên biến, comment, docstring, README, commit
   message, PR — viết bằng **tiếng Anh**. Chỉ trò chuyện/báo cáo với chủ bằng **tiếng Việt**.
2. **Danh tính git** (bắt buộc, trước commit đầu tiên trong phiên):
   ```bash
   git config user.name tuila1freelancer && git config user.email 62372475+tuila1freelancer@users.noreply.github.com
   ```
   Sau mỗi commit kiểm lại: `git log -1 --format='%an <%ae> | %cn <%ce>'` phải in danh tính noreply
   **hai lần**. Không có dòng `Co-Authored-By: Claude` hay `🤖 Generated with Claude Code` ở bất kỳ
   đâu.
3. **Làm thẳng trên `main`**, commit từng đơn vị logic ngay khi nó xong và test xanh. Không tích luỹ
   thay đổi trong working tree.
4. `/Applications/AI VIDEO Tool.app` và data-dir của nó là **CHỈ ĐỌC** — đây là app tham chiếu.
5. **Node 22**: `/opt/homebrew/opt/node@22/bin` phải nằm đầu `PATH`. Shell chạy nền không kế thừa
   `export PATH` — đặt lại trong từng lệnh.
6. **Trước khi bật dev server**: huỷ mọi job `QUEUED`/`RUNNING` trong DB. Scheduler tự động chạy tiếp
   job đang chờ = tự động tiêu tiền API.
7. **Giết tiến trình cũ đúng PID**, không dùng `pkill` (bị hook chặn):
   ```bash
   PID=$(lsof -ti tcp:8123); [ -n "$PID" ] && kill "$PID"
   ```
8. Đọc `docs/architecture.md` §7 (bảng registry) trước khi sửa; thêm hàng mới cho ba slug ở cuối.
9. **`npm test` phải xanh sau MỖI nhóm commit.** Hiện tại: 378/378 qua, 53 file test.

---

## 1. Sự thật đã đo — không cần kiểm lại, chỉ cần đọc

Toàn bộ bảng dưới đây đã được xác minh trực tiếp trong code ngày 2026-08-06. Chúng là **tiền đề**
của prompt này; nếu một dòng nào đó không còn đúng khi bạn đọc, dừng lại và báo chủ trước khi sửa.

| # | Sự thật | Bằng chứng |
|---|---------|-----------|
| 1 | Phụ đề được vẽ **bên trong từng trang cảnh** bằng DOM, không có lane burn ở video cuối | `src/animation/harness.js:500` (`<span id="capText">`), `:84–110` (karaoke từ `S.captions`) |
| 2 | `assStyleFrom()` — bộ giải style ASS đầy đủ — **đã tồn tại và KHÔNG có ai gọi** | `src/subtitles/presets.js`; grep toàn repo chỉ thấy `captionStyleFrom` được dùng (`src/animation/index.js:129`) |
| 3 | Nó là **xác chết** còn lại của image-mode đã bị xoá | `src/config/paths.js:38` — "only needed by image-mode subtitle burn" |
| 4 | Bản ffmpeg **vendored CÓ libass** (filter `ass` + `subtitles`); bản Homebrew **KHÔNG có** | `vendor/ffmpeg/ffmpeg -filters` → có; `/opt/homebrew/bin/ffmpeg -filters` → không |
| 5 | `PATHS.ffmpegAss` đã trỏ đúng bản vendored | `src/config/paths.js:39-42` |
| 6 | Bản vendored là **x86_64 chạy dưới Rosetta, chậm 4–7×** khi encode | comment tại `src/config/paths.js:26-27` |
| 7 | Đã có sẵn công tắc "đẩy CẢ lượt encode qua `ffmpegAss`" | `src/pipeline/render.js:164` (`let useAssBinary = false`), dùng ở `:198` |
| 8 | `renderFingerprint` gộp mọi key `sub*` → **đổi một thiết lập phụ đề = huỷ toàn bộ clip** | `src/pipeline/fingerprint.js:42` `RENDER_CFG_KEYS = /^(sub\|brandKit\|…)/` |
| 9 | `vendor/fonts/fonts.css` chỉ có **8 họ font**, 516 KB, base64 inline vào **mọi** trang cảnh; trần cứng 1.3 MB | `scripts/build-fonts.mjs:28-36` (MANIFEST), `:22` (BUDGET), `src/animation/harness.js:20-26` |
| 10 | Trang UI chỉ nạp **2 họ** (Lexend, JetBrains Mono) | `public/css/fonts.css`, `public/fonts/*.woff2` |
| 11 | Ô chọn font phụ đề chào **10 lựa chọn cứng**, trong đó `Arial` và `Impact` không có trong `fonts.css` lẫn `vendor/fonts/ttf/` | `public/index.html:379-380` |
| 12 | **⇒ Preview phụ đề đang NÓI DỐI**: nó gán `fontFamily` cho một họ mà trang UI chưa bao giờ nạp → trình duyệt lặng lẽ thay bằng sans-serif hệ thống | `public/js/views/config.js:216-218` |
| 13 | Đã có đầu dò "font bị thay thầm" trong lúc render — **nhưng chỉ `logger.warn`, không chặn gì** | `src/animation/harness.js:292-299` (`fontMiss`), `src/animation/renderer.js:41-43` |
| 14 | Font chủ tải lên đã được nhúng base64 vào trang cảnh, trần 6 MB/font | `src/animation/userfonts.js:11`, `:22-40` |
| 15 | `fontFamilies()` đã gộp vendored + uploaded, và UI đã nối chúng vào `#cfgSubFont` | `src/animation/userfonts.js:41-58`, `public/js/views/config.js:376-390` |
| 16 | `vendor/fonts/ttf/` có **11 file TTF** — đây là fontsdir cho libass; font chủ tải lên **không** nằm ở đây | `ls vendor/fonts/ttf`; tiền lệ dùng fontsdir: `src/media/watermark.js:67` |
| 17 | Logo / watermark / BGM / SFX / chuyển cảnh đều áp ở **bước ghép cuối** — đổi chúng chỉ tốn 1 lượt ghép | `src/pipeline/render.js:66-200` (`concatScenes`) |
| 18 | `mode:'concat'` đã là ghép-thôi, không render lại | `src/pipeline/render-only.js:31` (`const renderPass = mode !== 'concat'`) |
| 19 | `srt.js` đã có `buildSrt(cues)` và `shiftCues(cues, offset)`; timing từng từ nằm ở `scenes.srt_json` | `src/pipeline/srt.js:13,18`; `src/db/connection.js:48` |
| 20 | `PUT /api/projects/:id` nhận thẳng `req.body` vào `updateProject` — **route sửa config đã có, không UI nào gọi** | `src/api/routes.js:340-344` |
| 21 | Nút "Tiếp tục" bị ẩn khi dự án `done` | `public/js/views/studio.js:310` và `:494` |
| 22 | `finalize` ghi file mới có timestamp, **không xoá bản cũ** — hạ tầng versioning đã có, thiếu giao diện | `src/pipeline/stages/finalize.js:253` |
| 23 | `scene_takes` đã lưu ảnh chụp từng cảnh (`kind: voice\|visual`) → hoàn tác 1 click | `src/db/connection.js:128-137` |

**Bài học lịch sử phải nhớ**: lỗi ngôn ngữ tháng trước xảy ra vì một van an toàn **kêu đúng 22 lần
rồi bị bỏ qua**. Sự thật #13 ở trên là **đúng cái van đó, cho font**. Nhóm 2 của prompt này tồn tại
chủ yếu để đóng nó lại.

---

## 2. Mục tiêu — ba câu, đo được

1. **Sửa phụ đề (chữ, font, cỡ, màu, vị trí, kiểu) trên một video đã hoàn thiện chỉ tốn MỘT lượt
   ghép**, không render lại cảnh nào. Đo: một video 95 cảnh, đổi font phụ đề → log phải in
   `🔗 Ghép lại từ 95 clip đã có`, và `0` dòng `🎬 Render cảnh`.
2. **Font hiển thị đúng ở cả ba nơi**: ô preview trong app, khung xem thử, và video xuất ra — cùng
   một họ chữ, không có thay thế thầm lặng. Đo: chọn `Anton`, chụp một khung của video cuối, so
   pixel với preview.
3. **Video đã `done` vẫn sửa được**: logo, phụ đề, nhạc, watermark — và app **nói trước chi phí** của
   mỗi thay đổi trước khi chủ bấm.

Ngoài ba điều đó, prompt này còn yêu cầu bốn tiện ích ở Nhóm 5. Chúng là *bắt buộc phải làm*, không
phải gợi ý.

---

## 3. NHÓM 1 — `subtitle-lane`: đưa phụ đề ra khỏi clip

### 3.1 Thiết kế

Thêm một thiết lập config duy nhất:

```
subtitleLane: 'scene' | 'final'      // mặc định 'scene' — hành vi hiện tại, KHÔNG ĐỔI
```

- **`'scene'`** (mặc định, và mọi dự án cũ): y hệt hôm nay. Phụ đề nằm trong trang cảnh, hiệu ứng DOM
  đầy đủ. **Đầu ra phải giống từng byte** — đây là ràng buộc cứng, có test neo.
- **`'final'`**: trang cảnh **không vẽ phụ đề**; `concatScenes` burn ASS lên chương trình đã ghép.

Đừng thay thế lane cũ. Hai lane cùng tồn tại và chủ chọn: một bên đổi nhanh, một bên đẹp hơn.

### 3.2 Việc phải làm

**a) `src/subtitles/ass.js` (file mới)** — thuần hàm, không I/O, không import tầng db:

```
buildAss(cues, style, { w, h, fps }) → string
```

- `style` chính là thứ **`assStyleFrom(config)` đã trả về** (sự thật #2). **Dùng nó, đừng viết lại
  bộ giải style thứ hai.** Nếu thiếu trường nào thì bổ sung *vào* `assStyleFrom`.
- Karaoke bằng tag `\k` lấy từ timing từng từ trong `cues[].words`.
- Ánh xạ `effect` sang ASS:
  `outline` → `BorderStyle=1` + `Outline`;
  `box` → `BorderStyle=3` + `BackColour` từ `boxBg`;
  `shadow` → `Shadow`;
  `glow` → xấp xỉ bằng outline mờ nhiều lớp — **và ghi comment thẳng thắn rằng đây là xấp xỉ**, vì
  libass không có blur như CSS `text-shadow`.
- `Alignment` + `MarginV` lấy từ `style.position` (`bot`/`mid`/`top`), dùng đúng bảng
  `POSITION_BOTTOM_PCT` ở `src/subtitles/presets.js:82` để hai lane khớp vị trí.
- `textCase` áp ở tầng text, không phải tầng style.
- Màu ASS là **`&HAABBGGRR`** (BGR + alpha ngược). Viết một hàm `toAssColor(hex)` và test nó riêng —
  đây là chỗ ai cũng sai lần đầu.

**b) Dựng danh sách cue cho cả video** — `src/subtitles/timeline.js` (file mới):

Ghép `scenes[].srt_json` lại bằng `shiftCues(cues, offset)`. **Điểm chết người**: `offset` **không**
phải tổng dồn `scene.duration`, vì xfade ăn mất thời gian ở mỗi mối nối (`transitionLoss(plan)`,
`src/pipeline/render.js:80`). Đoán offset = phụ đề lệch dần và càng về cuối càng lệch nặng.

**Cách đúng**: `concatScenes` **ghi ra offset thật của từng cảnh** mà nó vừa dùng để dựng graph, và
lưu vào `project.metadata.timeline = [{ sceneId, idx, start, end }]`. Danh sách cue được dựng **từ
bảng đó**, không tính lại. Bảng này còn được Nhóm 5 dùng lại cho tính năng nhảy-từ-thời-gian.

**c) `concatScenes` nhận thêm option `ass`** (`src/pipeline/render.js:66`):

- Chèn filter `ass=<file>:fontsdir=<dir>` vào chuỗi `vbase` **trước** `fade=t=in/out` (fade phải phủ
  lên cả phụ đề, không ngược lại).
- Đặt `useAssBinary = true` — công tắc đã có sẵn (sự thật #7), không cần cơ chế mới.
- Escape đường dẫn cho filtergraph: dấu `:` `'` `\` và **dấu cách** đều phá cú pháp. Ghi file ASS vào
  thư mục tạm của dự án với **tên không dấu cách** và tránh hẳn vấn đề.

**d) ⚠️ Đo tốc độ TRƯỚC khi chốt thiết kế**

`ffmpegAss` là bản x86_64 chạy dưới Rosetta (sự thật #6). Đẩy **cả lượt encode cuối** qua nó có thể
khiến ghép 20 phút video chậm hơn nhiều lần — đúng ngược lại mục tiêu "render lại nhanh nhất".

**Bắt buộc làm, theo thứ tự:**

1. Đo thật: ghép cùng một dự án 2 lần, một lần qua `PATHS.ffmpeg`, một lần qua `PATHS.ffmpegAss`.
   Ghi con số vào commit message.
2. Nếu chậm hơn **> 2×**: thêm một ứng viên dò tìm ffmpeg **native có libass** vào `PATHS`
   (ví dụ `/opt/homebrew/bin/ffmpeg` của một formula khác, hoặc một bản build riêng đặt trong
   `vendor/ffmpeg-ass/`), ưu tiên nó, và **báo chủ bằng tiếng Việt** kèm lệnh cài cụ thể.
3. Dù chọn đường nào, **in thời gian ước tính cho chủ trước khi chạy** — không để chủ ngồi nhìn thanh
   tiến trình mà không biết bao lâu.
4. **Không** âm thầm chấp nhận một lượt ghép chậm gấp 5 lần rồi coi như xong việc.

**e) Trang cảnh khi `lane === 'final'`**

- `src/animation/index.js`: truyền `captions: []` và một cờ để harness **không sinh khối `.cap`**.
- **Điều kiện sống còn**: khi `lane === 'scene'` (hoặc không đặt), HTML sinh ra phải **giống từng
  byte** với hôm nay. Có test neo cho việc này (§9).

**f) Vân tay** — `src/pipeline/fingerprint.js:42`

Khi `lane === 'final'`, các key `sub*` **rời khỏi** `renderFingerprint` (phụ đề không còn là đầu vào
của clip). Khi `lane` vắng mặt hoặc `'scene'`, tập key giữ **nguyên xi**.

```js
// pseudo — hình thức tuỳ bạn, ràng buộc thì không
const keys = lane === 'final' ? RENDER_CFG_KEYS_NO_SUB : RENDER_CFG_KEYS;
```

> **Đây là chỗ nguy hiểm nhất của cả prompt.** Bỏ một key khỏi digest = đổi digest = mọi clip cũ bị
> đọc là "cũ" = render lại toàn bộ 43 dự án = một hoá đơn. Test hash đóng băng ở §9 biến rủi ro đó
> thành một test đỏ thay vì một hoá đơn. **Viết test trước, sửa sau.**

**g) `renderOnly` phải biết**: khi chỉ có thiết lập phụ đề đổi và `lane === 'final'`, đường đi đúng là
`mode: 'concat'`. Nhóm 4 sẽ tự chọn giúp chủ; ở nhóm này chỉ cần đảm bảo nó **có thể** đi đường đó.

---

### 3.4 Bổ sung (chủ yêu cầu 2026-08-06) — công tắc logo và tốc độ ghép lại

**Phần A — công tắc logo phải có hiệu lực mỗi lượt ghép.**

Hiện `finalize.js:76` chỉ gán logo khi `!config.logo?.path`:

```js
if (bkLogo && !config.logo?.path) { … config.logo = { path: bkLogo, ...fov }; }
```

Nghĩa là: một khi `config.logo` đã được ghi vào config dự án, **tắt công tắc logo trong Brand Kit
không còn tác dụng gì** — lượt ghép sau vẫn đóng dấu logo cũ. Đây đúng là lỗi chủ báo.

Sửa: một hàm giải quyết duy nhất, đọc lại **mỗi lượt ghép**, theo thứ tự ưu tiên rõ ràng:

1. `config.logo === null` → **tắt tường minh** cho video này (chủ tự tắt), dừng.
2. `config.logo.enabled === false` → tắt, dừng.
3. `config.logo.path` → ghi đè riêng của dự án, dùng nguyên.
4. Brand kit `finalOverlay.enabled === true` + có logo → đóng dấu.
5. Ngược lại → **không logo**.

Điểm mấu chốt: bước 4 và 5 phải được **đánh giá lại mỗi lần**, không phải chỉ khi `config.logo`
còn trống. Bật → có logo; tắt → không logo; không có trạng thái kẹt ở giữa.

**Phần B — ghép lại phải nhanh nhất có thể.**

Hiện `concatScenes` **luôn** dựng filter_complex và **luôn** encode lại toàn bộ video bằng
`libx264 -crf 18 -preset medium`. Với video 95 cảnh (~11 phút) đó là nhiều phút encode — kể cả khi
thay đổi duy nhất là *tắt logo*, tức là video không cần một filter nào.

Thêm một bộ chọn bậc — `src/pipeline/concat-plan.js` — quyết định **lượng công việc tối thiểu**:

| Bậc | Điều kiện | Việc làm | Chi phí |
|---|---|---|---|
| **T0** | Vân tay ghép không đổi và file cũ còn trên đĩa | **Không làm gì**, báo "không có gì thay đổi" | ~0 |
| **T1** | Chỉ phần ÂM THANH đổi (nhạc nền, âm lượng, SFX) | `-c:v copy` + encode lại audio | ~30 giây |
| **T2** | Không cần **bất kỳ** filter video nào (không logo, không watermark, không phụ đề burn, toàn cắt thẳng, không fade) | Concat demuxer + `-c:v copy` | ~30 giây |
| **T3** | Còn lại | Encode đầy đủ như hiện nay | vài phút |

**Vân tay ghép** (`project.metadata.concatFp`) băm mọi thứ ảnh hưởng tới file cuối: danh sách clip
(đường dẫn + mtime + size), khối logo đã giải quyết, khối watermark, bgm/sfx, kế hoạch chuyển cảnh,
nội dung file ASS, kích thước khung, fps, lựa chọn encoder. Tách riêng phần **video** và phần
**audio** của vân tay — đó chính là thứ phân biệt T1 với T3.

Ràng buộc bắt buộc:

- T2 chỉ mở khi **thật sự** không có filter video nào. Fade mở/đóng hiện đang **luôn bật**; đưa nó
  thành `config.masterFade` (mặc định `true`, giữ nguyên hành vi cũ). Khi bảng chi phí ở Nhóm 4
  thấy fade là thứ duy nhất chặn T2, nó **đề nghị** chủ tắt fade để ghép tức thì — đề nghị, không
  tự quyết.
- **Đo trước, chọn sau**: thử `h264_videotoolbox` (encoder phần cứng Apple Silicon) so với
  `libx264 -crf 18` trên **đúng một dự án thật**, so cả thời gian lẫn chất lượng chữ (đồ hoạ chữ nét
  là chỗ encoder phần cứng dễ lộ nhất). Ghi cả hai con số vào commit message. Chỉ đặt phần cứng làm
  mặc định nếu số liệu ủng hộ; nếu không thì để nó là lựa chọn "ghép nhanh" hiện rõ trong UI kèm
  đánh đổi. **Không âm thầm hạ chất lượng để lấy tốc độ.**
- Mỗi bậc phải **nói ra mình đang làm gì** bằng `op()`: `⏭️ Không có gì thay đổi`,
  `🔊 Chỉ ghép lại âm thanh`, `⚡ Ghép nhanh không encode lại`, `🎞 Encode lại toàn bộ`. Im lặng
  chọn đường tắt là cách sinh ra bug "sao video không cập nhật".

---

## 4. NHÓM 2 — `fonts`: font thật, ở cả ba nơi

### 4.1 Ba lời hứa phải giữ

1. **Một nguồn duy nhất**: danh sách font chủ thấy trong app = danh sách app thật sự dựng được.
   Không còn `<option>` cứng trong HTML.
2. **Preview là thật**: ô xem thử hiện đúng họ chữ đó, không phải sans-serif thay thế.
3. **Video cuối là thật**: font trong file xuất ra đúng họ đã chọn — và nếu không dựng được thì
   **báo lỗi to**, không thay thầm.

### 4.2 `src/fonts/registry.js` (file mới) — nguồn sự thật

Một entry mô tả đủ cho **cả ba** người tiêu dùng (trang cảnh Chrome, trang UI, libass):

```
{ family, weights[], scripts[], source: 'vendored'|'system'|'uploaded'|'downloadable',
  webFile?, ttfFile?, googleName? }
```

- `scripts` dùng để lọc theo ngôn ngữ video: `latin`, `vietnamese`, `cyrillic`, `greek`, `cjk-sc`,
  `cjk-tc`, `japanese`, `korean`, `arabic`, `thai`, `devanagari`, `hebrew`.
- **Font hệ thống macOS là bạn, không phải hạn chế**: `PingFang SC`, `Hiragino Sans`,
  `Apple SD Gothic Neo`, `Geeza Pro`, `Thonburi`, `Kohinoor Devanagari` — Chrome dùng được, libass
  dùng được qua fontconfig, và **không tốn byte nào**. Chúng đã có mặt một phần ở
  `perLangDefaults()` (`src/subtitles/presets.js:11-17`) — mở rộng chỗ đó thay vì tạo bảng thứ hai.
- Catalogue tối thiểu **30 họ** phủ các chữ viết trên. Latin/Việt lấy từ Google Fonts (Be Vietnam
  Pro, Montserrat, Oswald, Anton, Nunito, Archivo Black, Lexend, Inter, Roboto, Poppins, Playfair
  Display, Bebas Neue, Merriweather, Raleway, Josefin Sans, Space Grotesk…); CJK/Arabic/Thai/
  Devanagari ưu tiên font hệ thống + Noto khi cần.

### 4.3 Phân phát — bỏ mô hình "inline tất cả"

Hiện `fonts.css` nhồi **cả 8 họ** vào **mọi** trang cảnh (516 KB × 95 cảnh). Mô hình này không mở
rộng được: 30 họ sẽ vượt trần 1.3 MB ngay, và một font CJK đơn lẻ đã 5–20 MB.

**Đổi sang: chỉ nhúng font mà cảnh đó thật sự dùng.** Một trang cảnh chỉ cần font của style guide +
font phụ đề (+ font chủ tải lên nếu spec có gọi tên). Sau khi đổi:

- trang cảnh **nhẹ đi rõ rệt** (một lợi ích phụ đáng kể cho tốc độ render),
- trần 1.3 MB ở `scripts/build-fonts.mjs:22` **không còn ý nghĩa** — thay bằng trần *mỗi họ*,
- thư viện font mở rộng thoải mái.

Giữ nguyên cơ chế nhúng base64 (`data:` URI) cho trang cảnh — đừng đổi sang `http://127.0.0.1:8123`:
trang cảnh phải tự chứa, và một request mạng hỏng giữa chừng sẽ làm cảnh đó sai font mà không ai
biết.

**Trang UI** thì ngược lại — nạp qua file tĩnh:

- `GET /api/fonts/:family/css` → khối `@font-face` trỏ tới `GET /api/fonts/:family/file/:name`
- UI **chờ `document.fonts.load()` xong rồi mới vẽ preview**; trong lúc chờ hiện trạng thái "đang
  nạp", không hiện font sai.

### 4.4 Tải font theo yêu cầu

- Một nút **"Tải font"** trong Thư viện → Font chữ, mở danh mục registry, chủ bấm mới tải.
- **Không tự động tải trong lúc render** — tải font là một hành động ra ngoài mạng, phải do chủ khởi
  xướng, và một lượt render không được phụ thuộc vào mạng.
- Không có mạng → thông báo tiếng Việt rõ ràng + gợi ý font hệ thống thay thế cho cùng chữ viết.
- Tái sử dụng `scripts/build-fonts.mjs` (nó đã biết gọi Google Fonts css2 API và tách subset) thay vì
  viết bộ tải thứ hai.

### 4.5 Không bao giờ thay font thầm lặng

Đây là phần quan trọng nhất của Nhóm 2.

**Phía trang cảnh** — `src/animation/renderer.js:41-43` hiện chỉ `logger.warn`. Nâng thành **defect
có giới hạn**, đúng khuôn mà lane ngôn ngữ đã dùng (`src/hyperframe/codegen.js`, hằng
`LANG_REASK_MAX`):

- lần 1–2: coi là defect → thử lại (thường font chỉ chưa kịp nạp);
- từ lần 3: hạ xuống cảnh báo **và `op()` một dòng tiếng Việt rõ ràng cho chủ thấy trong nhật ký**.

Im lặng hạ cấp chính là cách 22 cảnh sai ngôn ngữ đã lọt ra video. Đừng lặp lại.

**Phía libass**: fontconfig **thay font không nói gì** khi không tìm thấy `FontName`. Không có cách
nào đọc được điều đó từ đầu ra ffmpeg một cách đáng tin. Vì vậy:

- dựng `fontsdir` gộp `vendor/fonts/ttf/` + `DIRS.font` (font chủ tải) + thư mục font đã tải thêm;
- **kiểm tra file của họ font đó tồn tại trong fontsdir TRƯỚC khi burn**;
- không có → **ném lỗi to, không burn**, kèm thông báo tiếng Việt: font nào thiếu, tải ở đâu.

Đây là ngoại lệ hợp lệ của học thuyết "validation chỉ mang tính khuyến cáo": một video xuất ra sai
font là **hàng hỏng đã trả tiền**, không phải một cảnh báo.

**Bổ sung `shaping=complex`** cho filter `ass` khi ngôn ngữ thuộc nhóm Arabic/Devanagari/Thai — thiếu
nó thì chữ ghép sai hình dạng.

### 4.6 Ô chọn font

Xoá 10 `<option>` cứng ở `public/index.html:379-380`. Ô `#cfgSubFont` **dựng hoàn toàn từ registry**,
nhóm theo chữ viết, ưu tiên hiện trước các họ hợp với `config.language` của video. Mỗi option **vẽ
bằng chính font đó** (`style="font-family:…"`) sau khi font đã nạp — chọn font mà không thấy mặt chữ
là vô nghĩa.

### 4.7 Preview phải là preview thật

Ô `#subPreview` hiện chỉ đổi `fontFamily` và `color` (`public/js/views/config.js:214-226`). Nâng nó
lên dựng **đúng thứ sẽ thấy trên video**: nền tối như khung phim, hiệu ứng outline/glow/box/shadow,
kiểu chữ (HOA/thường), vị trí, và **chạy thử karaoke** trên một câu mẫu. Lấy style từ **cùng**
`captionStyleFrom` / `assStyleFrom` — không tự viết bảng CSS thứ hai, vì hai bảng sẽ lệch nhau trong
vòng một tháng.

---

## 5. NHÓM 3 — `true-preview`: xem thử trên khung thật

Một tính năng nhỏ, rẻ, và giá trị cao nhất trên mỗi dòng code trong cả prompt này.

**`GET /api/projects/:id/frame-preview?t=<giây>&overrides=<json>`** → trả về một ảnh PNG:

1. trích **một khung** từ video cuối (hoặc từ clip của cảnh tại thời điểm đó) bằng `ffmpeg -ss`;
2. áp logo bằng **đúng** `logoRect()` / `resolveFinalOverlay()` (`src/media/logo-overlay.js`) mà lượt
   ghép thật dùng — không phải một bản mô phỏng CSS;
3. burn **một dòng phụ đề** qua **đúng** đường ASS của Nhóm 1;
4. trả PNG.

Chi phí ~1–2 giây, thay cho một lượt ghép 15–20 phút.

Nối vào ba chỗ trong UI: panel Brand Kit (logo), panel Phụ đề (font + kiểu), panel Watermark. Đổi
thanh trượt → khung thật cập nhật.

Đây cũng chính là **bằng chứng** cho lời hứa số 3 ở §4.1: nếu font hiện đúng trên khung này thì nó
đúng trên video, vì cả hai đi qua cùng một đoạn code.

---

## 6. NHÓM 4 — `restudio`: video đã xong vẫn sửa được

### 6.1 Mở khoá trạng thái `done`

- `public/js/views/studio.js:310` và `:494`: nút "Tiếp tục" hiện thêm khi `done`, đổi nhãn thành
  **"Áp dụng thay đổi"**. Cơ chế resume nhận biết vân tay vốn đã là đường đi nhanh và đúng nhất cho
  một loạt sửa hỗn hợp — hiện nó chỉ đang **bị giấu**.
- Panel cấu hình mở được trên dự án đã xong, và **gọi `PUT /api/projects/:id { config }`** — route đã
  tồn tại từ lâu, chưa UI nào dùng (sự thật #20).

### 6.2 Brand kit không được là ảnh chụp chết

`resolveProjectConfig` nhồi brand kit của kênh vào config dự án **lúc tạo**. Hậu quả đã đo: dự án
`pmsfzyvpdb4634c41` ("Why $5,000…") có `config.brandKit === undefined`, nên ghép lại bây giờ sẽ ra
video **không có logo** — dù kênh đã có logo.

Sửa: lúc ghép, brand kit đọc **live từ kênh**, trừ khi dự án có ghi đè rõ ràng. Kèm một nút **"Đồng
bộ brand kit từ kênh"** cho các dự án cũ. Nêu rõ đánh đổi trong comment: ghép lại một video cũ sau
khi kênh đổi logo **sẽ** ra logo mới — đó là điều chủ muốn, nhưng phải là hành vi *được ghi ra*, chứ
không phải một bất ngờ.

### 6.3 Hàng đợi thay đổi + bảng chi phí ⭐

Tính năng "xịn" nhất của nhóm này, và **gần như miễn phí** vì hệ vân tay đã làm sẵn phần khó.

Hiện mỗi lần sửa là lập tức huỷ clip. Thay bằng: gom thay đổi lại, rồi hiện bảng **trước khi** chủ
bấm:

```
3 thay đổi đang chờ
 · Logo mới                    → ghép lại          ~40 giây
 · Phụ đề cảnh 12              → render 1 cảnh     ~1 phút
 · Đổi font phụ đề toàn video  → GHÉP LẠI          ~40 giây   ← nhờ Nhóm 1
 [ Áp dụng tất cả ]  [ Chỉ áp dụng thay đổi nhanh ]
```

Cách dựng:

- **Việc phải làm** = diff `ttsFingerprint` / `renderFingerprint` giữa config hiện tại và config đề
  xuất. Hàm này đã có, chỉ chưa ai *hỏi* nó trước khi chạy.
- **Ước tính thời gian** = EMA giây/cảnh, ghi vào `project.metadata.renderStats` mỗi lượt render, cộng
  một hằng dự phòng cho dự án chưa có số liệu. Đừng bịa con số — nếu chưa có dữ liệu thì ghi "chưa
  có số liệu", đừng đoán.
- Dòng nào chỉ cần ghép thì nói **"ghép lại"**; dòng nào phải render thì nói rõ **bao nhiêu cảnh**.

Nguyên tắc: **không bao giờ âm thầm cắt bớt phạm vi.** Nếu app quyết định bỏ qua một việc, nó phải
nói ra dòng đó.

---

## 7. NHÓM 5 — bốn tiện ích bắt buộc

**a) Bảng phiên bản.** Bảng mới `renders(id, project_id, path, thumb, config_json, changes_json,
created_at)`; `finalize` chèn một hàng mỗi lần xuất. UI liệt kê: xuất lúc nào, đổi gì so với bản
trước, nút xem, nút **quay lại bản này** (khôi phục config + `video_path`). File cũ vốn đã nằm trên
đĩa (sự thật #22) — chỉ đang vô hình. Có cái này thì chủ mới **dám thử**.

**b) Nhiều bản xuất từ một dự án.** Vì logo/nhạc/watermark/chuyển cảnh đều ở bước ghép, cùng bộ clip
xuất được nhiều bản gần như miễn phí: *bản YouTube* (có logo, có nhạc), *bản không logo*, *bản không
nhạc*, *bản phụ đề tiếng Anh*. Mỗi biến thể = `{ name, configOverrides }`, chạy qua `mode:'concat'`.
Lưu trong `project.metadata.variants`.

**c) Từ thời gian nhảy tới cảnh.** Dùng lại `project.metadata.timeline` mà Nhóm 1 đã ghi. Trong trình
xem video cuối: bấm một điểm bất kỳ → mở đúng cảnh đó trong Scene Studio. **Đừng tính lại offset từ
`scene.duration`** — xfade làm nó sai, đó chính là cái bẫy ở §3.2b.

**d) Tab "Kiểm tra video".** Quét một dự án đã xong và báo cáo, không tự sửa:
- chữ trên màn sai ngôn ngữ (dùng lại `textLanguageLeak` ở `src/hyperframe/validate.js`),
- quy ước số/tiền tệ lạc ngôn ngữ (`84.000.000 đ` trong một video tiếng Anh),
- nhãn bị xoá trắng,
- **clip trên đĩa có khớp với `props` hiện tại không** — so `renderFingerprint` đã lưu với vân tay
  tính lại.

Mục cuối là mục quan trọng nhất: tháng trước DB nói "tiếng Anh" trong khi clip vẫn đang là tiếng
Việt, và chỉ có trích khung mới phát hiện ra. Máy kiểm được điều đó; mắt người thì không.

---

## 8. Rào chắn hồi quy — BẮT BUỘC, viết test TRƯỚC khi sửa

| Rủi ro | Rào chắn |
|---|---|
| **Bỏ `sub*` khỏi `renderFingerprint` làm đổi digest → 43 dự án cũ bị render lại toàn bộ** | Test hash **đóng băng**: chép hằng số digest hiện tại vào `tests/fingerprint.test.js` **trước** khi sửa; `renderFingerprint(scene, {config:{}})` và với `config.subtitleLane === 'scene'` phải bằng đúng hằng đó |
| Đổi trang cảnh làm lệch video tiếng Việt đang tốt | Test: `buildScenePage` với config không có `subtitleLane` sinh ra chuỗi **giống từng byte** với bản hiện tại (chụp một golden trước khi sửa) |
| Bỏ inline-toàn-bộ font làm mất font trong cảnh cũ | Test: một spec có gọi tên font nào thì trang cảnh phải chứa `@font-face` của font đó; và `fontMiss` rỗng khi render thật một cảnh mẫu |
| ASS burn qua Rosetta làm ghép chậm gấp nhiều lần | Đo và **ghi số vào commit message**; nếu > 2× thì phải có đường native (§3.2d) |
| Phụ đề lệch dần về cuối video | Test: dựng cue từ `metadata.timeline` với một kế hoạch có xfade, so mốc cue cuối cùng với `total` thật của `concatScenes` |
| libass thay font thầm | Test: burn với một họ font không tồn tại phải **ném lỗi**, không phải trả về video |
| Preview và video lệch nhau | Test: preview UI và `assStyleFrom` cùng đọc một nguồn — neo bằng cách so trường (`color`/`font`/`position`/`textCase`) chứ không so ảnh |
| Danh sách font trong UI lệch với thứ dựng được | Test: mọi `<option>` của `#cfgSubFont` phải có entry trong registry, và mọi entry `vendored` phải có file trên đĩa |

---

## 9. Kiểm thử

Tạo mới, **đặt tên theo hành vi, không theo mã số**:

- `tests/subtitle-final-lane.test.js` — ASS builder, `toAssColor`, `\k` timing, ánh xạ effect, dựng
  cue từ timeline, `concatScenes` chèn filter đúng chỗ, `lane:'scene'` không đổi gì.
- `tests/font-fidelity.test.js` — registry ↔ đĩa ↔ ô chọn, không thay thầm ở cả hai phía, preview
  cùng nguồn style.
- `tests/restudio.test.js` — nút hiện đúng ở `done`, `PUT /projects/:id` được UI gọi, bảng chi phí
  phân loại đúng ghép-lại / render-N-cảnh, brand kit đọc live.
- Bổ sung vào `tests/fingerprint.test.js` — các hằng đóng băng ở §8.

**Nghiệm thu end-to-end** (không có bước này thì chưa xong):

1. Lấy đúng dự án `pmsfzyvpdb4634c41` ("Why $5,000 Is the Number That Changes Everything", 95 cảnh).
2. Bật `subtitleLane: 'final'`, đổi font phụ đề sang một họ **không** nằm trong 8 họ vendored hiện
   tại (ví dụ `Bebas Neue` — buộc đi qua đường tải font).
3. Bấm "Áp dụng thay đổi". Nhật ký phải in `🔗 Ghép lại từ 95 clip đã có` và **không có** dòng
   `🎬 Render cảnh` nào.
4. **Trích khung từ video xuất ra và nhìn bằng mắt.** Font phải là Bebas Neue thật.
   *Kiểm bằng pixel, không bao giờ kiểm bằng metadata* — đây là bài học đắt nhất của lần sửa trước.
5. Đo thời gian tổng và báo cho chủ.

---

## 10. Thứ tự commit

Mỗi commit build được, test xanh, revert được mà không vỡ.

| # | Nội dung | Prefix |
|---|---|---|
| 1 | Test hash đóng băng + golden trang cảnh (**chưa sửa gì cả**) | `test(subtitle-lane):` |
| 2 | `src/subtitles/ass.js` + `timeline.js` + test thuần hàm | `feat(subtitle-lane):` |
| 3 | `concatScenes` nhận ASS; đo tốc độ Rosetta, ghi số vào message | `feat(subtitle-lane):` |
| 4 | `subtitleLane` config, harness bỏ caption, vân tay có điều kiện, UI bật/tắt | `feat(subtitle-lane):` |
| 5 | `src/fonts/registry.js` + phân phát theo nhu cầu + route font | `feat(fonts):` |
| 6 | Ô chọn font từ registry + preview thật | `feat(fonts):` |
| 7 | Không thay font thầm (hai phía) | `fix(fonts):` |
| 8 | `frame-preview` + nối vào ba panel | `feat(true-preview):` |
| 9 | Mở khoá `done` + brand kit live + `PUT` config từ UI | `feat(restudio):` |
| 10 | Hàng đợi thay đổi + bảng chi phí | `feat(restudio):` |
| 11 | Bảng phiên bản + biến thể xuất + nhảy-tới-cảnh + tab kiểm tra | `feat(restudio):` |
| 12 | `docs/architecture.md` §7 (ba hàng slug) + README | `docs:` |

---

## 11. Build lại và chạy

App bundle là **vỏ Swift mỏng**, không nhúng JS — nó chạy thẳng `src/server.js` trong repo. Với thay
đổi JS thì thứ *bắt buộc* là thoát tiến trình cũ; `shell:build` vẫn nên chạy (rẻ, `build-app.sh` có
`rm -rf` nên luôn sạch).

```bash
cd "/Volumes/ExtremeSSD/Working/toannvs/ai-video-generation"
osascript -e 'quit app "AI Video Studio"'
PID=$(lsof -ti tcp:8123); [ -n "$PID" ] && kill "$PID"
npm test
npm run shell:build
open "AI Video Studio.app"
```

Xác nhận sau khi mở: tiến trình `node src/server.js` mang **PID mới**, `/api/health` trả 200. Nếu
cổng 8123 còn bị chiếm, server sẽ **từ chối khởi động và in `AVS_PORT_IN_USE`** — đó là hành vi đúng,
hãy giết PID cũ rồi mở lại, đừng vô hiệu hoá cái chốt đó.

---

## 12. Báo cáo cuối phiên (tiếng Việt, gửi chủ)

1. Ba lời hứa ở §4.1 — từng cái: đạt hay không, kèm bằng chứng.
2. Con số thời gian: ghép có ASS so với không ASS; sửa font phụ đề toàn video mất bao lâu **trước** và
   **sau**.
3. Ảnh trích khung từ video nghiệm thu, chỉ rõ font.
4. Việc nào **không** làm được và **vì sao** — nói thẳng, đừng thu hẹp phạm vi trong im lặng.
5. Danh sách commit kèm xác minh danh tính author + committer.
