# Gap Analysis 3 chiều — Kênh @TuiLa1Freelancer (chuẩn) · AI VIDEO Tool (tham chiếu) · AI Video Studio (hiện tại)

> Đầu vào: [quality-bar.md](quality-bar.md) (chuẩn kênh), [reference-app-analysis.md](reference-app-analysis.md) (app đối thủ), bản đồ codebase hiện tại. Danh sách nâng cấp xếp theo impact tới chất lượng video đầu ra.

## 1. Bảng so sánh 5 khâu

### Khâu 1 — Kịch bản

| | Kênh (chuẩn) | App tham chiếu | App hiện tại |
|---|---|---|---|
| Hook | Cold-open pain→promise trong 35–60s, promise có con số | Dặn "mở đầu thu hút" chung | Outline có "hook 2-3 câu gây tò mò" — chưa có công thức pain→promise |
| Cấu trúc | Chương đánh số, số đọc = số hiển thị; CTA giữa video ~50%; mồi comment cuối | Structure guide theo độ dài | 2 giai đoạn outline→chương (≥180s); **không CTA giữa, không mồi comment** |
| Lượng chữ | ~260–280 âm tiết/phút, cảnh 6–12s | Bảng từ/cảnh {5s:24, 6:29, 7:34, 8:38, 10:48} + khoảng an toàn ±3-4 từ + dặn "TTS đọc nhanh hơn — viết ĐỦ chữ" | `wordsPerScene` ước từ 2.6 từ/s, không khoảng an toàn, không lời dặn → nguy cơ cảnh hụt |
| Nối mạch video dài | — | Batch 25 cảnh + tóm tắt 3 cảnh trước | Chương viết tuần tự nhưng **không thấy lời thoại chương trước** → nguy cơ lặp ý |
| Ngôn ngữ | vi (+ video en) | `outputLanguage` đa ngữ + wordsPerSecond/lang | **Không có tham số** — prompt nghiêng tiếng Việt |

### Khâu 2 — Visual từng cảnh

| | Kênh (chuẩn) | App tham chiếu | App hiện tại |
|---|---|---|---|
| Chỉ đạo cảnh | Mỗi cảnh 1 focal element, 7 layout pattern, 12 loại cảnh | **B2 sinh `[ENVIRONMENT]/[MAIN FOCUS]/[CAMERA]/[MOTION FLOW]/[LIGHTING & FX]/[TEXT STYLE]/[MOOD]` cho TỪNG cảnh** | Video ngắn: brief `[MAIN OBJECT]/[ON-SCREEN TEXT]/[MOTION]/[MOOD]`; **video dài (≥180s): `visualPrompt = voice.slice(0,90)` — KHÔNG có chỉ đạo thật** ← gap chí mạng |
| Style guide | Palette semantic (cyan=AI, hồng=rủi ro, lá=đúng, vàng=tiền), HUD language, kicker mono | 7 section: màu khoá + font size px + quy tắc dấu vi + text-effect CSS + icon SVG + ambient + **MAPPING CONCEPT→VISUAL** | Guide chỉ có palette/fonts/motif/treatment/personality — **thiếu concept-map, text-effects, semantic colors, HUD vocabulary** |
| Codegen | — | HTML GSAP 1 file, zone layout px, visual callback (beat cuối nhắc lại beat đầu +25%) | CODEGEN_SYSTEM đã rất tốt (beats thật, FX vocab, contract) — thiếu visual callback, semantic color, layout taxonomy |
| Kiểm định | — | AutoFix tĩnh | **2 tầng lint + renderValidate (hơn hẳn — GIỮ)** |

### Khâu 3 — Đồng nhất xuyên video

| | Kênh | App tham chiếu | App hiện tại |
|---|---|---|---|
| Cơ chế | Palette + motion khoá cứng cả video | style_guide chung + PALETTE_LOCK cưỡng chế + 8 preset mood + visual callback | Guide nhúng mọi prompt + theme harness ngoài LLM (mạnh) — NHƯNG: **cảnh fallback template dùng theme classic ≠ guide**; **title card/intro/outro/thumbnail hardcode màu xanh `#1e3a8a` bỏ qua guide**; chapter-break không nhận guide |

### Khâu 4 — Voice

| | Kênh | App tham chiếu | App hiện tại |
|---|---|---|---|
| Giọng | 1 giọng chủ đạo cả video, đều | LarVoice 1 voice, pad silence 650ms/400ms cuối cảnh | Per-lang default tốt; **fallback chain edge→say có thể ĐỔI GIỌNG giữa video khi 1 cảnh lỗi**; không pad silence; **không loudnorm per-scene** (chỉ loudnorm cả video ở B7) |

### Khâu 5 — Retry / QC

| | App tham chiếu | App hiện tại |
|---|---|---|
| LLM | Nhiều key xoay vòng, 6 lần/key backoff tuyến tính, phân loại 401/403/quota bỏ key | 1 key, withRetry ×2-3 — **không key rotation, không model fallback, không phân loại lỗi** |
| Scene render | Validate concat | ffprobe từng mp4 + render bù + deferred pass (hơn) |
| QC cuối | Duration check | Duration check — **cả hai cùng thiếu: black-frame, audio-silence, A/V sync** |
| Nhạc/SFX | Music plan AI: BGM + ~20 SFX whoosh/glitch đặt đúng timestamp chuyển section | BGM đều + fade — **không SFX chuyển cảnh** |

## 2. Danh sách nâng cấp (impact-first)

| # | Việc | Impact | File chính |
|---|---|---|---|
| **U1** | **Visual Direction per-scene**: sinh chỉ đạo cinematic `[ENVIRONMENT]/[MAIN FOCUS]/[CAMERA]/[MOTION FLOW]/[LIGHTING & FX]/[MOOD]` + loại cảnh (taxonomy S1-S12) cho TỪNG cảnh ở cả 2 nhánh script (ngắn + dài ≥180s); pass riêng theo batch để không phình prompt kịch bản | ★★★★★ | `src/providers/llm.js`, mới: `src/pipeline/direction.js` |
| **U2** | **Style Guide v2**: mở rộng schema guide (semanticColors, conceptMap, textEffects, hud{kickers, statusTexts}, sceneRules); preset mới **"TuiLa1 HUD Cyber"** khớp chữ ký kênh (bg #0A0E1A, cyan #22D3EE / magenta #FF2E88 / tím #8B5CF6 / lá #34D399 / vàng #FBBF24 semantic); nâng `generateStyleGuide` sinh đủ section | ★★★★★ | `src/hyperframe/styleguide.js`, `src/animation/templates/hyperframe.js` |
| **U3** | **CODEGEN v2**: nhúng guide v2 (concept-map + semantic colors + HUD vocab) vào prompt; thêm visual-callback (cảnh climax nhắc lại motif hook); layout taxonomy hints theo direction; giữ nguyên contract + validate | ★★★★☆ | `src/hyperframe/prompt.js` |
| **U4** | **Script v2**: công thức hook pain→promise (promise có con số); CTA giữa video + mồi comment cuối; bảng từ/cảnh theo giây + khoảng an toàn + lời dặn "viết ĐỦ chữ"; chương sau thấy tóm tắt chương trước; `outputLanguage` config | ★★★★☆ | `src/providers/llm.js` |
| **U5** | **Đồng nhất triệt để**: title card / cta-outro / chapter-break / thumbnail / poster nhận guide (bỏ hardcode #1e3a8a); cảnh HyperFrame fallback dùng `themeFromGuide` thay classic theme | ★★★★☆ | `src/pipeline/visuals.js`, `src/pipeline/runner.js`, `src/animation/index.js` |
| **U6** | **Voice v2**: loudnorm per-scene (`loudnorm I=-16` ngay sau TTS); pad silence 650ms vi / 400ms en; **voice-lock**: retry cùng giọng ×3 trước khi fallback, cảnh nào phải đổi giọng → đánh dấu `voice_fallback` + tự re-TTS ở cuối pipeline khi provider hồi phục; không bao giờ render cảnh câm (audio rỗng = lỗi cứng, retry) | ★★★★☆ | `src/providers/tts.js`, `src/pipeline/runner.js` |
| **U7** | **Quality gate cuối (B8)**: sau concat — ffprobe từng cảnh + video cuối: black-frame detect (`blackdetect`), audio silence detect (`silencedetect` > 2.5s), A/V duration lệch >300ms/cảnh, tổng thời lượng ±5% kịch bản; fail → render bù đúng cảnh hỏng rồi ghép lại; báo cáo QC lưu `qc_report.json` | ★★★★☆ | mới: `src/pipeline/qc.js`, `src/pipeline/runner.js` |
| **U8** | **LLM retry v2**: nhiều API key xoay vòng; phân loại lỗi (401/403/quota → bỏ key; transient → backoff); model fallback (`llm.modelFallback`); giữ nguyên withRetry hiện có phía trên | ★★★☆☆ | `src/providers/llm.js` (`chatRaw`) |
| **U9** | **SFX chuyển cảnh**: whoosh/riser tại chapter-break + climax (thư viện SFX offline sẵn có), volume 0.7-0.8, đặt theo timestamp thật | ★★★☆☆ | `src/pipeline/render.js` hoặc runner B7 |
| **U10** | Whisper retry ×2; metadata/thumbnail retry ×2 (đang nuốt lỗi im lặng) | ★★☆☆☆ | `src/providers/subtitle.js`, `runner.js` |

## 3. Quyết định cho các mâu thuẫn M1–M10 của quality-bar (áp mặc định, user đổi được qua config)

- M1 phụ đề: **bật karaoke** mặc định (app đã có sẵn, video mới của kênh có), màu theo accent guide.
- M2 watermark: **trên-phải** (3/4 video + tránh vùng phụ đề).
- M3 bar đáy: **progress bar thật** (app đã có sẵn progress bar — giữ).
- M4 nhịp cảnh: theo thời lượng video (dài → 8-14s, ngắn → 5-10s) — map vào `sceneDuration` config hiện có.
- M5 xưng hô: "mình – các bạn" (đưa vào prompt script v2).
- M6 accent: cảnh hero khoá 1 accent; cảnh list/grid xoay màu theo số (đưa vào sceneRules của guide v2).
- M7 punch-scene nền sáng: không đưa vào mặc định (cấm nền sáng trong preset TuiLa1).
- M8 icon: line-art stroke (hệ icon offline hiện có), 3D glossy để sau.
- M10 token màu: cyan `#22D3EE`, lá `#34D399` (chuẩn hoá trong preset).
