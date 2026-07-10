# Báo cáo nâng cấp — AI Video Studio đạt chuẩn kênh @TuiLa1Freelancer

> Ngày: 2026-07-10. Chuỗi tài liệu: [quality-bar.md](quality-bar.md) → [reference-app-analysis.md](reference-app-analysis.md) → [gap-analysis.md](gap-analysis.md) → báo cáo này.

## 1. Những gì đã thay đổi (theo danh sách U1–U10 của gap-analysis)

| # | Nâng cấp | File | Trạng thái |
|---|---|---|---|
| U1 | **Art-director pass** — chỉ đạo hình ảnh điện ảnh `[LAYOUT]/[ENVIRONMENT]/[MAIN FOCUS]/[CAMERA]/[MOTION FLOW]/[LIGHTING & FX]/[MOOD]` cho TỪNG cảnh, batch 14 cảnh nhìn toàn cục, visual rhyme hook↔climax, skip khi resume | `src/pipeline/direction.js` (mới), `src/pipeline/runner.js` | ✅ |
| U2 | **Style Guide v2** — schema thêm `semantics` (màu ngữ nghĩa), `conceptMap` (công thức khái niệm→visual), `hud` (kickers + statuses), `sceneRules`; preset mới **TuiLa1 HUD Cyber** chưng cất từ quality-bar; `generateStyleGuide` AI sinh đủ trường v2 | `src/animation/templates/hyperframe.js`, `src/hyperframe/styleguide.js` | ✅ |
| U3 | **Codegen v2** — guide v2 nhúng vào prompt mọi cảnh; visual-rhyme cho cảnh kết; brief có cấu trúc được tôn trọng; check "timid scene" mới trong renderValidate (hero < 34% width → yêu cầu phóng to) | `src/hyperframe/prompt.js`, `codegen.js`, `validate.js` | ✅ |
| U4 | **Script v2** — hook NỖI ĐAU→LỜI HỨA có con số; CTA giữa video + câu hỏi mồi comment cuối; lượng chữ theo tốc độ đọc từng ngôn ngữ (vi 4.4 từ/s — trước đây 2.6 làm cảnh hụt); chương sau thấy kết chương trước; ép đúng số cảnh (≥70%, retry 3 lần); `config.language` | `src/providers/llm.js` | ✅ |
| U5 | **Đồng nhất triệt để** — cảnh fallback + outro trong project HyperFrame dùng theme từ guide (hết lệch tông); thumbnail theo palette guide | `src/animation/index.js`, `src/pipeline/visuals.js`, `runner.js` | ✅ |
| U6 | **Voice v2** — voice-lock (retry cùng giọng 3× trước khi fallback + tự thử lại giọng chính cuối bước); loudnorm EBU R128 per-scene; pad hơi thở 650ms vi/400ms en; pick provider cấp dự án thắng mặc định langVoices (fix bug); cảnh câm = lỗi cứng | `src/providers/tts.js`, `src/media/ffmpeg.js`, `runner.js` | ✅ |
| U7 | **Quality gate B8** — decode video cuối soi blackdetect/silencedetect/stream/thời lượng; lỗi quy về cảnh → render lại đúng cảnh + ghép lại (1 chu kỳ); `qc_report.json`; per-scene check đủ 2 stream + A/V khớp voice | `src/pipeline/qc.js` (mới), `runner.js` | ✅ |
| U8 | **LLM retry v2** — nhiều API key xoay vòng (phẩy/xuống dòng), phân loại lỗi 401/403/quota (bỏ key) vs transient (backoff), `modelFallback`; **sàn max_tokens 16k** cho model reasoning (fix lỗi trả mẩu vụn); chatJson tự bỏ JSON-mode khi backend không hỗ trợ (fix proxy Gemini-like) | `src/providers/llm.js` | ✅ |
| U9 | **SFX chuyển chương** — whoosh tổng hợp offline deterministic đặt đúng timestamp chapter-break, mix dưới voice | `src/media/ffmpeg.js`, `src/pipeline/render.js`, `runner.js` | ✅ |
| U10 | Whisper retry ×2; metadata retry ×2 | `src/providers/subtitle.js`, `runner.js` | ✅ |

Ba bug thật của bản cũ được phát hiện và sửa nhờ test sống: (1) proxy Gemini-like trả rác khi bật `response_format: json_object` → mọi call chatJson chết im lặng; (2) model reasoning bị bóp `max_tokens` → kịch bản rơi về offline splitter; (3) `langVoices` đè lựa chọn TTS tường minh của dự án.

## 2. Kết quả kiểm chứng (GĐ5)

### 2.1 Các tầng tự phục hồi đã kiểm chứng SỐNG (không phải giả lập)

| Tình huống | Quan sát | Kết quả |
|---|---|---|
| LLM chết toàn phần (bug json-mode, trước khi fix) | B2 + direction rơi về offline/heuristic, pipeline vẫn ra video hoàn chỉnh | ✅ không bao giờ chết |
| Codegen model yếu trả sai format 4 lần | Cảnh rơi về template dự phòng, video vẫn xuất, theme vẫn theo guide (U5) | ✅ |
| Render frame timeout (Chrome quá tải) | Tự đổi template dự phòng render lại, B6 hoàn thành | ✅ |
| QC phát hiện lỗi ở cảnh | Tự render lại đúng cảnh đó + ghép lại + QC lần 2; còn cảnh báo thì xuất kèm `qc_report.json` | ✅ |
| TTS provider chính chết (elevenlabs không key) | Retry cùng giọng 3× → fallback edge, gắn cờ `fallback:true`, runner tự thử lại giọng chính cuối bước | ✅ (unit test) |
| Pick TTS cấp dự án | `tts:{provider:'edge'}` thắng mặc định langVoices | ✅ (unit test, sau fix) |
| Xóa clip cảnh + resume | Xóa `scene_001.mp4` của project đã done → `scripts/resume.mjs`: chỉ render bù đúng cảnh thiếu (giữ nguyên TTS + spec), ghép + QC lại, ra video mới | ✅ |
| Rate-limit 429 hàng loạt (39/42 cảnh) | Pipeline vẫn hoàn thành video 7.1 phút, QC sạch; cảnh fallback vẫn đúng chữ ký kênh nhờ U5; sau đó resume-heal với 429-backoff + modelFallback tự nâng cấp lại các cảnh | ✅ |

### 2.2 Video test

| | Test 1 | Test 2 |
|---|---|---|
| Cấu hình | 9:16, 60s, HyperFrame, preset TuiLa1 HUD Cyber, TTS edge, codegen `ag/claude-sonnet-4-6` | 16:9, 300s, như Test 1 + `modelFallback: ag/gemini-3.1-pro-low` |
| Kịch bản | 9 cảnh (đúng số), hook nỗi-đau→lời-hứa, ~50 từ/cảnh | 42 cảnh two-stage (5 chương + CTA giữa + mồi comment), tiêu đề "5 Sai Lầm Khi Dùng AI Khiến Bạn Mãi Dậm…" |
| Visual | **9/9 cảnh HyperFrame, 9/9 có chỉ đạo điện ảnh, 0 fallback** | 42/42 có chỉ đạo; lần đầu 3/42 HyperFrame (rate-limit 429) → **sau resume-heal: 41/42 HyperFrame** (§2.4) |
| QC (B8) | **✅ Sạch: không black-frame, không khoảng câm, thời lượng khớp** | ✅ Sạch cả 2 bản (qc_report.json `ok:true`, lệch thời lượng 0.03s) |
| Đầu ra | 105.4s, 15.5MB, 1080×1920@30 | 428.8s, 72.5MB (bản heal), 1920×1080@30 |
| Wall time | 37.8 phút | 44.4 phút (run đầu) + heal nền |

### 2.3 Chấm theo quality-bar (tự xem frame trích từ video thành phẩm)

**Đạt (so trực tiếp với frame video kênh):**
- A. Visual: nền deep-navy khoá cứng 100% cảnh, không cảnh nền sáng; ambient sống (particle + glow + grain); palette + semantic màu đúng (nguồn đúng = viền lá + ✓, link bịa = viền đỏ + cảnh báo, "lười biếng" = hồng risk); 1 focal element/cảnh.
- B. Motion: mỗi cảnh 1 animation chính + ambient; beat-sync đúng lời thoại (element hiện khi voice nhắc tới); progress bar gradient đáy; glitch chỉ ở cảnh cảnh báo.
- C. Typography: kicker mono UPPERCASE có tiền tố `//` trên mọi cảnh; heading UPPERCASE có glow; on-screen text là keyword trích lời thoại đúng ngôn ngữ; dấu tiếng Việt đúng 100% (kiểm tra Ắ Ậ Ữ trên frame).
- D. Kịch bản: cold-open hook đúng công thức; chương đánh số; CTA giữa + cuối + câu hỏi mồi comment (nghe kiểm bằng transcript kịch bản).
- E-F: karaoke chunk 2-6 từ có highlight keyword màu accent; watermark hiện 100% thời lượng; outro "CẢM ƠN ĐÃ XEM / ĐĂNG KÝ TUILA1FREELANCER"; visual rhyme (dấu hỏi hook quay lại ở cảnh kết scale lớn hơn).

**Chưa đạt hẳn (ghi ở §3):** độ "BOLD" — nhiều cảnh AI có focal element chỉ ~25-35% bề ngang khung so với chuẩn kênh 55-75% (đã thêm check "timid" 42% + luật SCALE CHECK vào prompt cho các run sau); thời lượng vượt mục tiêu (+75% test 1) do model viết ~50 từ/cảnh thay vì 28-36.

### 2.4 Resume-heal quy mô lớn (test 2) — chuỗi sự kiện thật

1. Run đầu: proxy rate-limit 429 model sonnet sau 5 cảnh → 39/42 cảnh rơi template dự phòng. **Pipeline vẫn hoàn thành video 7.1 phút, QC sạch** — video fallback vẫn đúng chữ ký kênh nhờ U5 (guide theme phủ cả cảnh fallback).
2. Phát hiện → vá 3 chỗ: backoff riêng cho 429 (8s/20s/45s, thử 4 lần/key), `hyperframe.modelFallback` (đổi model thay vì rơi template), B5 re-codegen xóa `video_path` cũ để cảnh nâng cấp được render lại khi resume.
3. `resume.mjs` (đổi model chính sang `ag/gemini-3.1-pro-low` vì sonnet kiệt quota): **B5 tự nâng 3/42 → 41/42 cảnh HyperFrame, render lại đúng các cảnh thay đổi, ghép + QC lại → PASS**, video mới 428.8s / 72.5MB, `qc_report.json` `ok:true` (lệch thời lượng 0.03s).
4. Đối chiếu frame bản heal: focal element to rõ (búa vàng hero-scale, card đầu-vào/đầu-ra semantic đỏ-vàng, stepper node sáng, mockup browser few-shot) — SCALE CHECK mới có tác dụng ngay trong vòng heal.

Kèm sự cố thật giữa chừng: 1 server bị kill giữa render → DB kẹt `running` (zombie) → kill process, resume lại → pipeline tiếp đúng chỗ (`already rendered: 11`, chỉ render phần thiếu). Đây chính là hành vi "server crash → Resume chạy tiếp" của README, kiểm chứng sống.

## 3. Hạn chế còn lại / việc nên làm tiếp

1. **Độ bold của cảnh AI**: check "timid scene" (42% width) mới chỉ là defect mềm — nếu model vẫn rụt rè sau 4 lần, cảnh vẫn ship. Cân nhắc: tăng cỡ mặc định các class `.hf-kw/.hf-card`, hoặc nâng thành defect cứng khi heroFrac < 30%.
2. **Thời lượng vượt mục tiêu**: model viết dài hơn khoảng an toàn (50 vs 28-36 từ/cảnh). Nên thêm bước cắt/tách cảnh quá dài sau B2 (split scene > maxWords×1.4), hoặc chấp nhận (kênh tham chiếu cũng vượt +29%).
3. **Rate-limit model mạnh**: 42 cảnh × 4 attempts ở concurrency 2 vắt kiệt quota sonnet của proxy. Đã có 429-backoff + modelFallback; cân nhắc thêm: giảm concurrency codegen khi gặp 429 liên tiếp, hoặc queue token-bucket.
4. **Phong cách kênh tiến hoá** (M8 quality-bar): icon 3D glossy ở video mới của kênh chưa hỗ trợ (hiện line-art thuần) — cần bổ sung nếu muốn bám video mới nhất.
5. Đề xuất dùng hàng ngày: Config → HyperFrame → Phong cách **TuiLa1 HUD Cyber**, model codegen mạnh (`ag/claude-sonnet-4-6`) + `modelFallback` (`ag/gemini-3.1-pro-low`), TTS chính LarVoice (đã có voice-lock + loudnorm nên an toàn), `qcGate`/`autoSfx` giữ mặc định bật.
