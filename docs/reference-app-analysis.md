# Mổ xẻ app tham chiếu: AI VIDEO Tool (`com.videopipeline.desktop`)

> Nguồn phân tích: `dist-backend/server.bundle.cjs` (1.9MB, reverse-engineered), `~/Library/Application Support/VideoPipeline/` (pipeline.db, sessions thật, settings), session mẫu `sess_1782526195852` (90 cảnh, video "12 thói quen nhỏ giúp người mới dùng AI", chính là loại video đăng trên kênh @TuiLa1Freelancer).

## 1. Sơ đồ pipeline

```
topic + styleId + duration
  │
  ├─ B0. STYLE GUIDE (AI, 1 lần/phong cách, lưu DB video_styles)
  │      7 section: MÀU khoá cứng → FONT SIZE px theo vai trò → quy tắc TIẾNG VIỆT (.txt)
  │      → TEXT EFFECT PRESETS (CSS nguyên văn) → DOMAIN ICONS (SVG inline sẵn)
  │      → AMBIENT GỢI Ý → MAPPING CONCEPT → VISUAL theo domain
  │
  ├─ B1. PLAN: sceneCount = ceil(duration/sceneDur[5..8s]); từ/cảnh theo bảng {5:24, 6:29, 7:34, 8:38, 10:48}
  │
  ├─ B2. KỊCH BẢN (AI, JSON): mỗi scene { stt, voice, visual, assets }
  │      • voice: khoảng an toàn ±(3..4) từ quanh mục tiêu, dặn "TTS đọc nhanh hơn tưởng — viết ĐỦ chữ"
  │      • visual: prompt đạo diễn CINEMATIC có cấu trúc (xem §3)
  │      • >30 cảnh → chia batch ~25, truyền tóm tắt 3 cảnh trước để nối mạch
  │      • validate đúng số cảnh, sai schema → tạo lại tối đa 2 lần
  │      • kèm thumbnail {title, prompt}
  │
  ├─ B3. per-scene, chạy song song (concurrency 8):
  │      TTS (LarVoice mặc định, pad silence 650ms vi / 400ms en)
  │      → SRT (aligned_srt từ LarVoice hoặc whisper-cli ggml-small, ≤5 từ/cue)
  │      → HTML (AI: visual + style guide + palette lock + beat timeline → GSAP một-file)
  │      → Puppeteer capture từng frame (CDP beginFrame hoặc screenshot) → ffmpeg h264
  │      → merge audio → burn karaoke ASS + logo
  │
  ├─ B4. CONCAT: xfade=fade:0.5 (video) + acrossfade (audio); validate resolution/audio/duration
  ├─ B5. MUSIC PLAN (AI): 1 BGM volume ~0.1 + ~20 SFX (whoosh/glitch/riser) đặt đúng timestamp chuyển section
  └─ B6. THUMBNAIL: HTML tĩnh → JPEG
```

Model LLM: 5 provider OpenAI-compatible (trollllm/infinity/yescale/shopaikey/custom), model tier cao (claude-opus-4-7, gpt-5.5, gemini-3.1-pro). Mọi prompt gửi dưới 1 message `role:user` duy nhất, stream SSE, timeout 5 phút/call.

## 2. Style Lock — vũ khí nhất quán chính

Bốn lớp chồng nhau, tất cả bằng **văn bản trong prompt** (không seed, không ảnh reference):

1. **`style_guide` chung** (DB `video_styles`): nhét nguyên văn vào prompt HTML của MỌI cảnh. Đây không phải mô tả chung chung mà là spec chi tiết: danh sách hex "chỉ dùng trong list này", cỡ chữ px theo vai trò (Hero 200-280px / Title 72-96px / Label 32-40px…), CSS text-effect nguyên văn, icon SVG inline viết sẵn, và **bảng MAPPING CONCEPT → VISUAL** (vd "Quy trình/Từng bước → staggered reveal, KHÔNG BAO GIỜ hiện toàn bộ danh sách cùng lúc").

2. **PALETTE_LOCK** (khi bật "Scene nhất quán"), nguyên văn:
   > ⚠⚠⚠ CHẾ ĐỘ "SCENE NHẤT QUÁN" ĐANG BẬT ⚠⚠⚠ … Body background PHẢI dùng CHÍNH XÁC màu ĐẦU TIÊN trong "BG accent"… Text chính PHẢI dùng CHÍNH XÁC màu ĐẦU TIÊN trong "Primary"… Tất cả scenes trong video này PHẢI có CÙNG background color và CÙNG primary text color.

3. **VISUAL_STYLE_BLOCK**: 8 preset motion/màu cố định (Swiss Pulse, Velvet Standard, Deconstructed, Maximalist Type, Data Drift, Soft Signal, Folk Frequency, Shadow Cut) chọn theo mood của cảnh — cùng mood → cùng preset → cùng easing/typography/transition.

4. **VISUAL CALLBACK**: beat cuối cảnh phải nhắc lại 1 element của beat đầu ở scale +25% + glow mạnh hơn ("visual rhyme").

## 3. Ngôn ngữ đạo diễn cảnh (trường `scenes.visual`)

Sinh ngay trong prompt kịch bản B2 — mỗi cảnh một đoạn cấu trúc:

```
[ENVIRONMENT]  nền + TỐI THIỂU 3 lớp depth (far/mid/near) + atmosphere (particles/fog/bokeh)
[MAIN FOCUS]   chủ thể chính (keyword/object/số/icon) + vị trí + scale (dominant/subtle)
[CAMERA]       slow zoom in/out · pan · parallax shift giữa các layer
[MOTION FLOW]  Entry (glitch-in/scale-up/slide) → Idle (floating/drift/pulse) → Exit
[LIGHTING & FX] glow, shadow, light sweep, depth blur
[TEXT STYLE]   bold/minimal/futuristic/kinetic (hoặc None)
[MOOD]         cinematic/epic/clean/premium/dark/energetic
```

Kèm ràng buộc: "⛔ KHÔNG mô tả layout tĩnh, chỉ nói 'hiển thị text'… 🎯 cảnh phải như Apple keynote animation. Tối đa 2-3 yếu tố động chính — cảnh phức tạp quá = HTML lỗi."

Ví dụ thật từ session (cảnh 20): `[MAIN FOCUS] Large puzzle pieces assembling into a glowing square… Idle: pieces snap together, each piece showing an icon (User, Tone, Platform)…` — chủ thể là **một ẩn dụ hình ảnh đúng nghĩa của lời thoại** (bối cảnh = ghép puzzle), không phải chữ bay chung chung.

## 4. Prompt sinh HTML cảnh (điểm hay đáng học)

- GSAP timeline **paused** + `window.__timelines["main"] = tl` — renderer scrub từng frame (giống harness hiện tại của ta).
- `DUR = audioDuration/1000` chính xác đến ms; progress bar tự chạy `width 0→W trong DUR`.
- Cấm `repeat:-1`, CSS @keyframes, setTimeout; ambient loop phải `repeat: Math.ceil(DUR/cycle)-1`.
- **VOICE TIMELINE**: từng beat từ SRT kèm quy tắc "Visual enters at beat.from (±200ms). ENTER 350-500ms | HOLD ≥1500ms | EXIT 250-350ms. Last beat = CLIMAX: scale+15%, strong glow, hold to end."
- **Zone layout**: safe-zone px cụ thể theo aspect ratio, lower-third = vùng phụ đề.
- **Quy tắc tiếng Việt**: mọi text `class="txt"` (`line-height:1.5; overflow:visible; padding-top:0.15em`) + khối CSS ép `overflow:visible!important` lên mọi `[class*=title/label/hero/stat…]` — chống cắt dấu ắ/ế/ổ.
- **Brand mascot**: bộ PNG nhân vật theo pose/cảm xúc (`character … smiling brightly.png`) trong `brand-specificities/`, LLM chọn ảnh hợp cảm xúc cảnh và nhúng thẳng vào HTML.
- Code đích 300-650 dòng/cảnh; thực tế session: ~200 dòng, 7-17KB/file, chỉ GSAP (particles vẽ tay bằng JS thuần).

## 5. Retry / tự phục hồi

| Khâu | Cơ chế |
|---|---|
| LLM call | Xoay vòng nhiều API key; mỗi key thử 6 lần, backoff tuyến tính 2s·n; lỗi 401/403/quota → bỏ key sang key kế; hết key mới throw |
| JSON parse | Bóc fence + bộ "vá" JSON cụt (đếm ngoặc, tự đóng chuỗi/ngoặc thiếu) |
| Kịch bản | Validate schema từng scene (stt/voice/visual); sai số cảnh → tạo lại tối đa 2 lần kèm nhắc "PHẢI trả đúng N cảnh" |
| HTML | AutoFix + validate sau sinh |
| TTS | LarVoice 3 lần/key + xoay key khi hết credit; poll job 90×3s; ElevenLabs 3 lần backoff 2s |
| Concat | Validate resolution/audio-stream/duration từng clip, lệch → yêu cầu render lại cảnh lỗi |

## 6. Điểm hay cần mô phỏng vs điểm yếu cần vượt

**Mô phỏng (đưa vào app hiện tại):**
1. Style guide "dày" 7 section — đặc biệt **MAPPING CONCEPT → VISUAL** và **TEXT EFFECT PRESETS** CSS nguyên văn.
2. Ngôn ngữ đạo diễn `[ENVIRONMENT]/[MAIN FOCUS]/[CAMERA]/[MOTION FLOW]/[LIGHTING & FX]/[MOOD]` sinh ở B2 cho TỪNG cảnh — hiện app ta chỉ có heuristic + `voice.slice(0,90)` cho video dài.
3. PALETTE_LOCK cưỡng chế + visual callback (visual rhyme).
4. Bảng từ/cảnh theo giây + lời dặn "TTS đọc nhanh hơn — viết ĐỦ chữ" (chống cảnh hụt).
5. Batch >30 cảnh kèm tóm tắt 3 cảnh trước.
6. **Music plan AI**: SFX whoosh/glitch đặt đúng timestamp chuyển section (app ta mới có BGM đều).
7. Brand mascot theo pose/cảm xúc.
8. Xoay vòng nhiều API key + phân loại lỗi auth/quota (bỏ key) vs transient (retry).
9. Pad silence cuối audio mỗi cảnh (650ms vi / 400ms en) — nhịp thở giữa các cảnh.

**Điểm yếu của nó (ta đang hơn — giữ vững):**
1. Render KHÔNG deterministic: CDN + Google Fonts (lệ thuộc mạng), không seed PRNG — app ta offline hoàn toàn + deterministic từng frame.
2. Không có kiểm định động render-thật (renderValidate của ta soi tràn khung/đè phụ đề/chữ bịa/kết cảnh rỗng — nó chỉ AutoFix tĩnh).
3. Không có beat từ word-timestamp thật lúc SINH code (nó đưa SRT vào prompt nhưng ta trích beat chuẩn hơn qua `extractBeats`).
4. 1 message user duy nhất, không system prompt, không multi-turn sửa lỗi — vòng re-prompt defect→fix của ta mạnh hơn hẳn.
5. Không có fallback offline: LLM chết là pipeline chết (ta có heuristic template + offline script).
6. Không loudnorm per-scene (giống ta — cả hai cùng thiếu).

## 7. Thông số kỹ thuật đầu ra (session thật)

- Video cảnh: h264 1920×1080@30fps yuvj420p, audio aac 24kHz mono; scene ~8-12s.
- Phụ đề burn karaoke ASS: Be Vietnam Pro size 80 (16:9 ×0.9), chunk ≤5 từ, `\fad(60,80)\blur1`.
- Logo overlay theo `logoPosition` per-aspect (16:9: x95% y7% w110px).
- final.mp4 ~15.5 phút cho cấu hình 12 phút (thực tế dài hơn đặt ~+29%).
