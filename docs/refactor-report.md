# Báo cáo refactor — AI Video Studio

> GĐ5. Nhánh `refactor/architecture-v2`. Chuỗi tài liệu: [architecture.md](architecture.md) → [refactor-plan.md](refactor-plan.md) → báo cáo này.
> Nguyên tắc xuyên suốt: **behavior-preserving 100%** — không đổi REST/WS/schema/format; project cũ resume được.

## 1. Bảng các bước

| Bước | Nội dung | Trạng thái | Verify |
|---|---|---|---|
| R1 | Xoá dead code (import thừa `estimateSpeechSeconds`/`projectDir`, `sleep`/`clamp`/`estimateSpeechSeconds` chết ở util, hạ `export run`), xoá `test-beats.mjs` + `test_overshoot_logic.js` + `.DS_Store` | ✅ done | node --check, import-smoke 13/0, tpl-smoke 21/0 |
| R2 | Gom trùng lặp helper | ⏭️ bỏ (đánh giá: `escapeHtml`/`clamp`/`PALETTES` **không phải bản sao thật** — gộp sẽ đổi hành vi hoặc abstraction non) |
| R3 | magic number → hằng đặt tên | 🔀 lồng vào tách module (hằng cục bộ đặt tên khi tách; tránh sweep ngưỡng rủi ro) |
| R4 | Tách domain kịch bản khỏi `llm.js` | ⏳ hoãn (llm.js 382 < trần 400; ưu tiên file vượt trần) |
| R5 | **Tách `styleguide/` dùng chung → cắt vòng lặp `animation↔hyperframe`** | ✅ done | cycle broken ✓, import-smoke 10/0, hf-qa render 0 defect, guide/preset byte-identical |
| R6 | **Tách `db/index.js` (452) → connection + 5 repository** | ✅ done | DB smoke trên DB thật (8 project + 42-scene đọc OK), server boot, 4 endpoint |
| R7 | **Routes mỏng — rút business logic ra `api/services/`** (464→392) | ✅ done | node --check, batch→400, preview→400, file→403, /voices OK |
| R8–R10 | Mổ `runner.js` (723) → orchestrator + stages + heal | 📋 **còn lại** (kế hoạch chi tiết trong refactor-plan.md; rủi ro cao, cần phiên riêng + e2e) |
| R11 | Frontend dead code + naming | 📋 còn lại (rủi ro thấp) |

## 2. Số liệu trước/sau

| Chỉ số | Trước | Sau |
|---|---|---|
| File `src/` | 72 | 88 (module hoá nhỏ hơn, trách nhiệm đơn) |
| File vượt trần 400 dòng | 3 (runner 723, routes 464, db 452) | **1** (runner 723 — còn lại) |
| Vòng lặp phụ thuộc | 1 (animation↔hyperframe) | **0** |
| Dead code/file | 2 file + ~5 export/import chết | 0 |
| File lớn nhất | runner.js 723 | runner.js 723 (chưa mổ) |
| db/index.js | 452 (schema+8 domain+seed) | 31 (barrel) + repo ≤125 |
| routes.js | 464 (1 hàm khổng lồ) | 392 (mỏng) + services |

## 3. Kết quả kiểm chứng (verify gate)

- **G1 (static)** sau mỗi bước: `node --check` + import-smoke + `tpl-smoke` (21 template) — **xanh toàn bộ**.
- **G2 (server)** sau R6/R7: boot sạch, `/api/{health,projects,channels,styles,hyperframe/presets,voices}` trả đúng; guard `/file`→403 ngoài allowlist; `/batch`,`/voices/preview` validate→400.
- **R5 render**: `hf-qa.mjs` render `SAMPLE_SPEC` headless → 0 defect / 0 warning (chuỗi styleguide→renderer→trang HTML nguyên vẹn).
- **Byte-identity**: `diff` xác nhận `HF_PRESETS` + prompt `generateStyleGuide` + toàn bộ SQL/schema y hệt bản gốc.
- **G3 (e2e)**: `node scripts/test-drive.mjs 'Ba thói quen giúp bạn học nhanh hơn' 30 '9:16' … edge` → **PASS ✅**. Pipeline đầy đủ B2→B8 (script LLM → TTS edge → HyperFrame codegen → render → ghép → QC) cho ra video **4/4 cảnh HyperFrame do AI đạo diễn, 0 fallback**, **QC sạch** (không black-frame/khoảng câm, thời lượng khớp), 46.9s / 9.36MB. Chứng minh R1+R5+R6+R7 bảo toàn hành vi end-to-end qua render thật.
- **G4 (resume-compat)**: DB smoke đọc 8 project cũ (gồm project 42 cảnh `status=done`) + `projectDirFor`/`channelOf` OK — dữ liệu cũ nguyên vẹn qua tầng DB mới.

## 4. Vị trí MỚI của các hành-vi-được-bảo-vệ (P1–P15)

Tất cả giữ nguyên logic; các mục bị di chuyển:
- **P1–P5** (LLM: floor 16k, json-mode-attempt-1, 429-trước-dead-key, minScenes, LANG_WPS) — **nguyên tại `providers/llm.js`** (chưa đụng).
- **P6** (QC) — nguyên `pipeline/qc.js`.
- **P7/P9** (voice-lock, loudnorm/pad) — nguyên `providers/tts.js`, `media/ffmpeg.js`, `runner.js`.
- **P8/P10** (skip chapter-break, video_path:null, self-heal) — nguyên `runner.js` (chưa mổ).
- **P11/P12** (beats, PSNR/frozen-tail) — nguyên `hyperframe/beats.js`, `validate.js`, scripts.
- **P13** (recover zombie) — **chuyển** `db/index.js` → `db/repositories/projects.js` (`recoverZombieProjects`, logic y hệt).
- **P14** (mask secret) — nguyên `util/secrets.js` + `core/config.js`; `writeChannelJson` chuyển sang `db/repositories/channels.js`.
- **P15** (file allowlist) — **chuyển** `routes.js` → `api/services/file-access.js` (`inAllowedRoots`, logic y hệt).
- Guide schema/preset/theme (không phải P nhưng nhạy) — **chuyển** từ `animation/templates/hyperframe.js` + `hyperframe/styleguide.js` → `styleguide/` (byte-identical).

## 5. Cố tình KHÔNG làm & vì sao

- **R2 (gom helper)**: các "trùng lặp" agent khảo sát nêu không phải bản sao thật — gộp `escapeHtml` (4 vs 5 ký tự), `clamp` (3 vs 4 tham-số), `PALETTES` vs `THEMES` (mảng `0x` vs object `#`) sẽ **đổi hành vi** hoặc abstraction non. Chọn an toàn.
- **R4 (tách llm domain)**: `llm.js` 382 < trần; hoãn để dành ngân sách cho file vượt trần.
- **R8–R10 (mổ runner)**: file god lớn nhất (723) + dày P8/P10 self-heal — rủi ro behavior-break cao nhất; tách vội dưới áp lực = nguy hiểm hơn để nguyên. Kế hoạch chi tiết đã có trong refactor-plan.md, nên làm ở phiên riêng với e2e đầy đủ.

## 6. Đề xuất bước tiếp theo (theo thứ tự)
1. **R8–R10**: mổ `runner.js` → `orchestrator.js` + `stages/{script,tts,visuals,render,concat,qc,metadata}.js` + `heal.js`, mỗi stage nhận ctx, giữ từng nhánh self-heal. E2e sau mỗi bước.
2. **R4**: tách `domain/script.js` khỏi `llm.js`.
3. **R11**: dọn `public/js/` (rút parse `?path=`, tách state HyperFrame/subtitle khỏi `config.js` 400 dòng).
4. JSDoc nốt các public export cũ; bổ sung `docs/architecture.md` bảng "sửa X→Y" theo path mới.
