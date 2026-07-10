# 🎬 AI Video Studio

App desktop **macOS** tạo video tự động từ **chủ đề / kịch bản JSON / link bài viết** — dài tuỳ ý
(từ 30 giây tới 30+ phút). Bản dựng lại tối ưu của `AI VIDEO Tool.app`: bỏ Chromium nặng làm vỏ UI,
thay bằng **WKWebView native**; backend **Node.js 22** gọn nhẹ; chạy được **hoàn toàn offline**.

> Pipeline: **B2 Kịch bản → B3+4 TTS+Phụ đề → B5 Dựng cảnh → B6 Render → B7 Ghép & Mix**.

---

## ✨ Tính năng

- **1 chạm, không thao tác gì thêm**: ở Trang chủ nhập chủ đề → **✨ Tạo video tự động** → ra video MP4 hoàn chỉnh.
- 💎 **Giao diện "Studio Pro"** — design system dark nhiều lớp (glass + hairline + spring motion), font **Lexend** (subset tiếng Việt, tự host), icon SVG stroke toàn app, titlebar trong suốt kiểu Linear/Arc trên bản native, **⌘K command palette** (điều hướng / tạo video / áp preset / mở dự án gần đây, tìm không cần gõ dấu), dialog + toast custom (không còn confirm/prompt hệ thống), skeleton loading, View Transitions khi chuyển trang.
- ⚡ **Frontend 60fps với dự án 200+ cảnh** — scene grid dùng event delegation (4 listener cho cả grid), WS update gộp 80ms + patch từng card (không rebuild), video preview chỉ gắn `src` khi hover, ảnh lazy-load, `content-visibility` bỏ layout/paint ngoài màn hình; render lần đầu 191 cảnh ~48ms. Code tách 20+ module ESM native (`public/js/{ui,views,features}`), không bundler.
- 🚀 **HYPERFRAME MODE** — AI **đạo diễn đồ hoạ riêng cho từng cảnh, bám theo từng chữ của lời thoại**: server trích **beats** từ word-timestamps thật (Whisper) → LLM viết `{css, html, script}` GSAP cho mỗi cảnh (keyword/số liệu/icon xuất hiện đúng giây voice nhắc tới rồi rút đi trước beat kế — màn hình mở đầu chỉ có ambient); **Phong cách video** khoá xuyên suốt (7 preset: **TuiLa1 HUD Cyber** (chưng cất từ kênh tham chiếu — semantic colors, concept→visual map, HUD kickers) · Chrome Kinetic · Neon Tech · Minimal Editorial · Glass Aurora · Bold Poster · Cinematic Dark, hoặc để AI tự thiết kế theo mô tả); thư viện ~125 icon offline + 20+ FX chuyên nghiệp (carrier-in, chrome sweep, whip-out, glitch, counter-roll, beam sweep, parallax, camera push…). Bật trong Config đầu ra → Chế độ hình ảnh → ✨ HyperFrame.
  - 🎬 **Art-director pass**: trước khi viết code, AI viết **chỉ đạo hình ảnh điện ảnh cho TỪNG cảnh** ([LAYOUT]/[ENVIRONMENT]/[MAIN FOCUS]/[CAMERA]/[MOTION FLOW]/[LIGHTING & FX]/[MOOD]) theo batch nhìn toàn cục — layout đa dạng giữa cảnh liền kề, cảnh kết **nhắc lại motif cảnh hook** (visual rhyme), khái niệm khớp concept-map thì dùng đúng công thức visual của phong cách. Video dài giờ có chỉ đạo thật cho mọi cảnh (trước đây chỉ video ngắn có).
  - 🛡 **Kiểm định 2 tầng chống lỗi**: mỗi cảnh do AI viết được **render thật rồi soi tự động** (lỗi runtime, tràn khung, đè phụ đề, kết cảnh rỗng, chữ bịa/sai ngôn ngữ) → phản hồi lại cho AI sửa; đạt mới nhận, không thì rơi về template dự phòng — pipeline **không bao giờ chết**, vẫn **deterministic từng frame**. Định dạng xuất **fenced (không JSON)** để model yếu không vỡ code.
  - 🎛 **Tuỳ chỉnh AI cho video**: **Mật độ chuyển động** (Tối giản/Cân bằng/Dày) · **Định hướng sáng tạo** (ghi chú áp cho mọi cảnh) · **Model AI riêng cho HyperFrame** (dùng model mạnh riêng cho khâu dựng cảnh — đòn bẩy chất lượng lớn nhất). On-screen text luôn lấy nguyên văn từ lời thoại, đúng ngôn ngữ.
- 🎬 **ANIMATION MODE (mặc định)** — video **motion graphics thuần code** (HTML/CSS/JS render từng frame, mượt 30/60fps) theo phong cách neon-tech: kinetic typography glow, HUD labels, icon line-art, thẻ glass, timeline, mindmap, chat demo, terminal scan… **20 template** tự chọn theo nội dung từng cảnh + caption karaoke tích hợp + progress bar + watermark. 3 theme (Neon Tech / Gradient Soft / Minimal Light), 1080p hoặc 4K.
- ✨ **GSAP 3.13 tích hợp sâu (toàn bộ plugin premium, miễn phí)** — mọi template đều có hiệu ứng cao cấp *và vẫn deterministic từng frame*: chữ bay 3D từng ký tự (SplitText), icon tự vẽ nét (DrawSVG), số đếm + vòng cung gauge, chữ giải mã kiểu hacker (ScrambleText), sao rơi bounce, confetti vật lý (Physics2D), thẻ 3D perspective, thanh bar đua nhau, rung lắc CustomWiggle. 6 template showcase mới: `split-cascade` · `counter-stat` · `orbit-3d` · `physics-burst` · `draw-diagram` · `bar-race`.
- 🩹 **Tự phục hồi, không cần trông máy** — mọi bước đều tự retry có backoff; LLM hỗ trợ **nhiều API key xoay vòng** (dán nhiều key cách nhau dấu phẩy/xuống dòng — key hết quota tự bị bỏ qua) + **model dự phòng** (`modelFallback`); cảnh render lỗi tự đổi template dự phòng rồi thử lại; sau render còn bước **soi từng file mp4** (ffprobe: thời lượng + đủ cả 2 stream + A/V khớp voice — cảnh câm là lỗi, không bao giờ xuất) và render bù cảnh hỏng; pipeline gặp lỗi bất ngờ tự resume sau 8 giây; server crash → mở lại là bấm Resume chạy tiếp. UI hiển thị rõ "🩹 đang tự thử lại".
- 🔬 **Quality gate cuối (B8)** — video ghép xong được **decode và soi thật**: black-frame (blackdetect), khoảng câm >3s (silencedetect), thiếu stream, thời lượng lệch >8%; lỗi quy được về cảnh nào thì **tự render lại đúng cảnh đó và ghép lại** (1 chu kỳ); kết quả lưu `qc_report.json` trong thư mục dự án — không bao giờ báo "xong" khi còn lỗi mà không ghi nhận. Tắt bằng `qcGate:false`.
- 🎙️ **Voice đồng nhất xuyên video** — giọng đã chọn được "khoá": lỗi TTS thử lại cùng giọng 3 lần rồi mới rơi fallback, cảnh phải dùng giọng dự phòng được **tự thử lại giọng chính** cuối bước; mọi cảnh qua **loudnorm chuẩn EBU R128 per-scene** (đều âm lượng bất kể provider) + đệm 650ms (vi)/400ms (en) hơi thở cuối cảnh.
- 🔊 **SFX chuyển chương tự động** — whoosh tổng hợp offline (deterministic) đặt đúng timestamp mỗi cảnh chuyển chương, mix dưới voice. Tắt bằng `autoSfx:false`.
- 📖 **Kịch bản 2 giai đoạn cho video dài** (khi cắm LLM): hook theo công thức **nỗi đau → lời hứa có con số**, dàn ý chương, **CTA giữa video** + CTA cuối kèm **câu hỏi mồi comment**; mỗi chương thấy phần kết chương trước nên không lặp ý; lượng chữ mỗi cảnh **tính theo tốc độ đọc của từng ngôn ngữ** (vi ≈ 4.4 từ/s) kèm khoảng an toàn — cảnh không còn hụt thời lượng; offline vẫn tự chia chương từ đoạn văn + cảnh chuyển chương + CTA cuối video.
- 🖼️ **Image mode (tuỳ chọn)** — ảnh AI điện ảnh mỗi cảnh (Pollinations, miễn phí không cần key) + Ken Burns.
- **Tự động đầy đủ (mặc định bật)**: 🎙️ **giọng neural tự khớp ngôn ngữ từng cảnh** (vi/en/ja/ko/zh/ru — không bao giờ đọc sai thứ tiếng) · phụ đề karaoke · 🎵 nhạc nền tự động · 🎬 intro + outro · chuẩn hoá âm lượng + fade · 📊 metadata **kèm YouTube Chapters** · thumbnail đẹp.
- 🎙️ **Kho giọng đa provider**: Edge Neural (322 giọng, miễn phí) · macOS say (offline) · **Vbee** (giọng Việt Bắc/Trung/Nam) · **LarVoice** (API chính thức larvoice.com — key Bearer tạo tại `larvoice.com/app/api`, ~300 giọng vi/en/zh/ja/ko, **nghe thử 0 credit** từ sample có sẵn) · ElevenLabs · OpenAI — search/lọc theo ngôn ngữ + giới tính, **▶ nghe thử mọi giọng** (cache), ⭐ ghim, đặt **giọng mặc định theo từng ngôn ngữ**; mỗi provider có form cấu hình riêng + nút 🔌 Test kết nối. API key mask `••` ở mọi lối ra.
- 📺 **Đa kênh (Channels)**: mỗi kênh 1 thư mục riêng (`~/Movies/AI Video Studio/<kênh>/` — projects, library, output, channel.json), config riêng (giọng, theme, watermark, tỉ lệ…) tự kế thừa vào mọi video mới; chuyển kênh 1 chạm ngay sidebar; video xong đổ về `output/` của kênh.
- 🏷 **Brand Kit theo kênh**: logo + tên kênh + sticker tự chèn vào **từng cảnh** — chế độ 🧠 *thông minh* tự né nội dung template & vùng phụ đề, hoặc 📌 cố định theo vị trí **kéo-thả tự do** trong Brand Editor (nền = cảnh thật của kênh); 3 kiểu logo (thường/glass/glow), 3 kiểu tên kênh (chữ/pill/gạch neon); tên kênh tự vào label cảnh mở đầu + CTA outro "Đăng ký <kênh>". Config phân tầng: kênh → preset mặc định → panel (1 điểm merge duy nhất `src/core/config.js`).
- 🎛 **Presets theo kênh**: lưu nguyên panel config thành preset đặt tên (vd "Short 4K", "Long 16:9"), đặt ⭐ mặc định — video mới của kênh (kể cả gọi qua API/batch) tự nhận. AI settings (LLM/giọng/phụ đề) **đè riêng từng kênh**, API key mask `••` ở mọi lối ra.
- 💬 **10 preset phụ đề đẹp sẵn** (gallery bấm chọn, render font thật): Karaoke Vàng, Impact Đậm, Neon Rực, Bản Tin (box), Điện Ảnh, Tối Giản, Pop Tròn, Thể Thao, Punch, Terminal — 8 font Việt vendor offline (build lại bằng `npm run fonts:build`) + tự đổi font hệ thống cho tiếng Nhật/Hàn/Trung; áp cho cả animation captions lẫn phụ đề burn image-mode (TTF cho libass đi kèm).
- 👁️ **Live preview từng cảnh** — bấm ▶ trên scene card: animation chạy thật + tiếng ngay trong app, không cần render.
- ✏️ **Sửa chữ trên cảnh** (heading/sub/label/props) + đổi template từng cảnh + tạo lại preview tức thì.
- 📦 **Chạy hàng loạt** — dán nhiều chủ đề (mỗi dòng 1 video), app tự làm lần lượt qua đêm.
- 📑 **Xuất file .SRT toàn video** (đúng timeline) để upload phụ đề YouTube.
- **Đầu vào linh hoạt**: văn bản · JSON kịch bản · link bài viết (tự lấy nội dung + ảnh).
- **Tỉ lệ**: 9:16 (TikTok/Reels), 16:9 (YouTube), 1:1, 4:5.
- **Video dài thoải mái**: xử lý theo từng cảnh + ghép dần → RAM không phình theo độ dài.
- **Phụ đề karaoke** đầy đủ tuỳ biến: font, cỡ, kiểu chữ, màu (bảng + custom), vị trí.
- **Scene grid**: xem/tạo lại giọng · tạo lại cảnh · render lại từng cảnh.
- **Thư viện** Brand / BGM / SFX, **Brand Asset Gen**, **Edit Video** (cắt), **Metadata** (title/desc/hashtag), **SRT editor**.
- **Tiến độ real-time** qua WebSocket, **dừng / tiếp tục**, **render song song**.
- **AI cắm được, có fallback offline**:
  | Khâu | Online (cắm key) | Offline mặc định |
  |------|------------------|------------------|
  | Kịch bản / Metadata | OpenAI-compatible (GPT/Gemini/Claude…) | Tách câu thông minh |
  | Giọng đọc (TTS) | OpenAI / ElevenLabs | **macOS `say`** (có giọng Việt) |
  | Phụ đề | — | **estimate** (chữ chuẩn từ kịch bản) hoặc **whisper.cpp** |
  | Dựng cảnh | (ảnh AI) | **Poster HTML** (Chrome headless) |
  | Tìm ảnh | Tavily | Placeholder gradient |
  | Ghép/Render | — | **ffmpeg** (kèm libass) |

---

## 🚀 Chạy

**Cách 1 — Trình duyệt (đơn giản nhất):**
```bash
./run.command            # hoặc double-click trong Finder
```
Mở trình duyệt tại `http://127.0.0.1:8123`.

**Cách 2 — App native macOS (WKWebView):**
```bash
npm run shell:build      # build "AI Video Studio.app"
open "AI Video Studio.app"
```
App tự khởi động backend rồi hiện cửa sổ native.

**Dev:**
```bash
npm install              # cần Node 22 (vd: /opt/homebrew/opt/node@22/bin)
npm start                # server tự chọn cổng, in "AVS_READY <url>"
npm run test:e2e         # test tạo video end-to-end
npm run fonts:build:ui   # tải lại Lexend/JetBrains Mono cho UI (public/fonts) — KHÔNG đụng fonts scene
npm run fonts:build      # ⚠ fonts cho SCENE render (vendor/fonts) — đổi là ảnh hưởng byte-compat video
npm run icon:build       # render shell/icon.svg → shell/AppIcon.icns (Chrome headless + sips + iconutil)
```

---

## 🧱 Kiến trúc

```
AI Video Studio.app   ← vỏ Swift + WKWebView (shell/main.swift)
   └─ spawn Node 22 backend (src/server.js) → chờ /api/health → load localhost
src/
  server.js            Express + WebSocket + static SPA
  config/paths.js      resolve ffmpeg/whisper/chrome/say (vendor → app gốc → system)
  core/config.js       config layering (channel → preset → request) + AI settings + mask secret
  db/
    connection.js        handle + schema + migrations (better-sqlite3)
    repositories/        query theo domain: settings · projects · scenes · channels · catalogs
    index.js             barrel: re-export mọi repo + seed/backfill + export default db
  api/
    routes.js            REST API — handler mỏng: validate → gọi service → JSON
    services/            business logic: file-access (allowlist) · voice-preview · voice-catalog · batch
  pipeline/            runner B2→B8 · render (ffmpeg) · visuals (poster) · srt (ASS karaoke) · qc (gate)
  styleguide/          🎨 hợp đồng phong cách DÙNG CHUNG (cắt vòng lặp animation↔hyperframe):
    guide.js             schema + normalizeGuide + HF_DEFAULT_GUIDE + SAMPLE_SPEC (thuần)
    theme.js             themeFromGuide (guide → theme render)
    presets.js           7 preset (chrome-kinetic, tuila1-hud-cyber…) + resolveGuide
    generate.js          generateStyleGuide (AI thiết kế guide từ mô tả)
  animation/           🎬 engine motion-graphics deterministic:
    harness.js           trang scene tự chứa + runtime __seek(t) (pause & seek CSS animation + scrub GSAP timeline)
    gsap.js              bundle GSAP 3.13 + 12 plugin premium (vendor, offline, nhúng inline)
    renderer.js          frame-loop Puppeteer → JPEG → ffmpeg image2pipe → mp4 (RAM phẳng)
    templates/           21 template neon-tech, mỗi template 1 file + _shared.js (FX runtime GSAP)
    planner.js           chọn template + props theo nội dung (heuristic VN + LLM 1 call)
    themes.js            design tokens (neon-tech / gradient-soft / minimal-light)
  hyperframe/          ✨ hệ LLM-viết-GSAP: codegen · validate · prompt · beats · icons · lint
  providers/           llm · tts · subtitle · imagesearch · fetchlink (đều có fallback)
  media/               ffmpeg · say · whisper · puppeteer (Chrome headless)
public/                SPA "Studio Pro": index.html + css/(app,fonts).css + fonts/*.woff2 (Lexend UI)
  js/                  ESM modules: main.js · state.js · api.js
    ui/                  dom · icons (SVG set) · toast · dialog · modals · palette (⌘K)
    views/               nav · home · studio · scenes (grid+patch) · progress · config · library…
    features/            settings · voicepicker · channels · brandkit · srt · batch
vendor/ffmpeg/         ffmpeg/ffprobe static (có libass — bản Homebrew thiếu)
vendor/fonts/          fonts.css cho SCENE render (data-URI, offline — đừng nhầm với UI fonts)
vendor/gsap/           GSAP 3.13.0 + SplitText/DrawSVG/MorphSVG/MotionPath/Physics2D/ScrambleText/CustomEase…
```

**Phụ thuộc hệ thống** (tự dò, ưu tiên `vendor/` rồi app gốc rồi system):
ffmpeg (libass), whisper.cpp + model `ggml-small.bin`, Chrome for Testing, `say` (macOS).

---

## ⚙️ Cấu hình AI (tuỳ chọn)

Vào **⚙️ AI Setting** trong app để cắm:
- **LLM**: Base URL + API Key + model (OpenAI-compatible — dùng được proxy rẻ).
- **TTS**: chọn `say` (offline) / OpenAI / ElevenLabs + voice.
- **Phụ đề**: `estimate` (khuyên dùng — chữ đúng 100% từ kịch bản) hoặc `whisper`.

Không cắm gì vẫn chạy đầy đủ bằng giọng macOS + ffmpeg.

---

## 📂 Dữ liệu

Mọi dự án, media, DB nằm trong `data/` (gitignored). Mỗi dự án có thư mục riêng:
`data/projects/<id>/{audio,srt,html,render,output}`.
