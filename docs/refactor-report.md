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
| R8 | Tách helper khỏi runner.js → `stop.js` + `progress.js` + `helpers.js` (723→665) | ✅ done | node --check, tpl-smoke 21/0, queue import OK |
| R9 | **Mổ runner.js → orchestrator + `stages/{script,tts,visuals,render,finalize,metadata}.js`** (665→68) | ✅ done | node --check, import-smoke, boot; e2e ↓ |
| R10 | Tách `renderOnly`/`regenOne`/`brandGenImpl` → `render-only.js`/`regen.js`/`brandgen.js` | ✅ done | queue re-export intact |
| R11 | Frontend dead code + naming | 📋 còn lại (rủi ro thấp — không phải file backend) |

## 2. Số liệu trước/sau

| Chỉ số | Trước | Sau |
|---|---|---|
| File `src/` | 72 | 101 (module hoá nhỏ hơn, trách nhiệm đơn) |
| File vượt trần 400 dòng | 3 (runner 723, routes 464, db 452) | **0** ✅ |
| Vòng lặp phụ thuộc | 1 (animation↔hyperframe) | **0** |
| Dead code/file | 2 file + ~7 export/import chết | 0 |
| File lớn nhất backend | runner.js 723 | routes.js 392 |
| runner.js | 723 (god: orchestration+stage+heal+metadata+brandgen) | 68 (orchestrator) + stages ≤168 |
| db/index.js | 452 (schema+8 domain+seed) | 31 (barrel) + repo ≤125 |
| routes.js | 464 (1 hàm khổng lồ) | 392 (mỏng) + services |

## 3. Kết quả kiểm chứng (verify gate)

- **G1 (static)** sau mỗi bước: `node --check` + import-smoke + `tpl-smoke` (21 template) — **xanh toàn bộ**.
- **G2 (server)** sau R6/R7: boot sạch, `/api/{health,projects,channels,styles,hyperframe/presets,voices}` trả đúng; guard `/file`→403 ngoài allowlist; `/batch`,`/voices/preview` validate→400.
- **R5 render**: `hf-qa.mjs` render `SAMPLE_SPEC` headless → 0 defect / 0 warning (chuỗi styleguide→renderer→trang HTML nguyên vẹn).
- **Byte-identity**: `diff` xác nhận `HF_PRESETS` + prompt `generateStyleGuide` + toàn bộ SQL/schema y hệt bản gốc.
- **G3 (e2e) sau R5+R6+R7**: `test-drive.mjs … edge` → **PASS ✅** — pipeline B2→B8 ra video **4/4 cảnh HyperFrame AI-directed, 0 fallback**, QC sạch, 46.9s/9.36MB.
- **G3 (e2e) sau R9 (mổ runner)**: pipeline mới chạy đúng qua mọi stage đã tách (B2 script.js → B34 tts.js → B5 visuals.js: 4/4 cảnh codegen → B6 render.js). Lần chạy tươi chạm **trần thời gian 20 phút của harness** khi codegen LLM chậm (B5 mất 582s) → dừng giữa B6 (KHÔNG phải pipeline lỗi). **Verify hoàn tất bằng resume**: `resume.mjs pmrehssz5f1e71e37` → recover zombie (P13) → skip B2/B34/B5 → render 2 cảnh thiếu (render.js) → **B7+B8 finalize.js (ghép+mix+QC) → done**, video 48s/9.0MB, phủ narration ≥92% → **PASS ✅**. Chứng minh orchestrator + toàn bộ stage + finalize + resume bảo toàn hành vi.
- **G4 (resume-compat)**: (a) DB smoke đọc 8 project cũ (gồm project 42 cảnh `status=done`) OK; (b) `buildContext` dựng ctx từ project cũ OK; (c) resume thật ở trên chạy trọn vẹn qua code mới — dữ liệu cũ nguyên vẹn.

## 4. Vị trí MỚI của các hành-vi-được-bảo-vệ (P1–P15)

Tất cả giữ nguyên logic; các mục bị di chuyển:
- **P1–P5** (LLM: floor 16k, json-mode-attempt-1, 429-trước-dead-key, minScenes, LANG_WPS) — **nguyên tại `providers/llm.js`** (chưa đụng).
- **P6** (QC) — `pipeline/qc.js` + repair cycle **chuyển** vào `pipeline/stages/finalize.js` (đệ quy `_qcAttempt`, logic y hệt).
- **P7/P9** (voice-lock, loudnorm/pad) — `providers/tts.js`, `media/ffmpeg.js`; vòng heal + `padMsFor` **chuyển** vào `pipeline/stages/tts.js`.
- **P8** (skip chapter-break, `video_path:null`) — **chuyển** vào `pipeline/stages/visuals.js` (từng dòng giữ nguyên).
- **P10** (self-heal render đa tầng, auto-resume) — render heal **chuyển** vào `pipeline/stages/render.js`; auto-resume (`_auto<1`) ở `pipeline/runner.js` (orchestrator); stop signal ở `pipeline/stop.js`.
- **P11/P12** (beats, PSNR/frozen-tail) — nguyên `hyperframe/beats.js`, `validate.js`, scripts.
- **P13** (recover zombie) — **chuyển** `db/index.js` → `db/repositories/projects.js` (`recoverZombieProjects`, logic y hệt).
- **P14** (mask secret) — nguyên `util/secrets.js` + `core/config.js`; `writeChannelJson` chuyển sang `db/repositories/channels.js`.
- **P15** (file allowlist) — **chuyển** `routes.js` → `api/services/file-access.js` (`inAllowedRoots`, logic y hệt).
- Guide schema/preset/theme (không phải P nhưng nhạy) — **chuyển** từ `animation/templates/hyperframe.js` + `hyperframe/styleguide.js` → `styleguide/` (byte-identical).

## 5. Cố tình KHÔNG làm & vì sao

- **R2 (gom helper)**: các "trùng lặp" agent khảo sát nêu không phải bản sao thật — gộp `escapeHtml` (4 vs 5 ký tự), `clamp` (3 vs 4 tham-số), `PALETTES` vs `THEMES` (mảng `0x` vs object `#`) sẽ **đổi hành vi** hoặc abstraction non. Chọn an toàn.
- **R4 (tách llm domain)**: `llm.js` 382 < trần cứng; để nguyên (đã tổ chức theo section rõ). Có thể tách `domain/script.js` sau nếu muốn.
- **R11 (frontend)**: `public/js/` là code trình duyệt, không phải backend; rủi ro thấp nhưng khó verify tự động (không có build/test). Để phiên riêng với preview thủ công.

## 6. Đề xuất bước tiếp theo (theo thứ tự)
1. **R11**: dọn `public/js/` (rút parse `?path=` lặp 4 chỗ về `api.js`, tách state HyperFrame/subtitle khỏi `views/config.js` 400 dòng) — verify bằng preview.
2. **R4**: tách `domain/script.js` khỏi `llm.js` (offlineScript + prompt builders) nếu muốn llm.js gọn hơn.
3. JSDoc nốt các public export cũ (runner/stages đã có); bổ sung `docs/architecture.md` bảng "sửa X→Y" theo path mới.
4. Cân nhắc thêm test tự động cho pipeline (giờ mỗi stage đã tách, dễ unit-test từng khâu).
