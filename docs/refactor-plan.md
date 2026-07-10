# Kế hoạch refactor — AI Video Studio

> GĐ2. Dựa trên [architecture.md](architecture.md). Thực thi tuần tự R1→R12, **rủi ro thấp trước**. Mỗi bước = 1 commit Conventional Commits + qua verify gate mới sang bước kế. Bước hỏng: sửa tối đa 3 lần, không xong → `git revert`, ghi lý do vào [refactor-report.md](refactor-report.md).

## Nguyên tắc bất biến (nhắc lại từ architecture.md §7)
- **Behavior-preserving 100%**: không đổi REST endpoint/shape, WS message, schema DB, format config/video. Project cũ trong `data/` phải resume được.
- **8 nhóm + P1–P15 hành-vi-được-bảo-vệ**: chỉ di chuyển, cấm đổi logic/hằng số/thứ tự.
- Môi trường: `export PATH="/opt/homebrew/opt/node@22/bin:$PATH"` trước mọi lệnh node.

## Chuẩn code áp dụng cho mọi file mới/sửa
- File ≤ **300 dòng** (mục tiêu), **400 dòng** (trần cứng — vượt phải ghi lý do trong report).
- 1 module = 1 trách nhiệm. Không side-effect lúc import (trừ `server.js`, `db/index.js` connection).
- Mọi export công khai có JSDoc `@param`/`@returns`.
- File `kebab-case`, hàm `camelCase`, hằng số `UPPER_SNAKE`.
- Error message có ngữ cảnh (`projectId`, `scene idx`).
- Không magic number rải rác → gom về `config/constants.js` với tên có nghĩa.
- Xoá file/export nào cũng phải kèm **grep proof** không còn ai import.

## Verify gate (định nghĩa 1 lần, tham chiếu ở mỗi bước)
- **G1 (nhẹ)**: `node --check` file đổi + import-smoke từng entry (`node -e "await import('./src/...')"`); `node scripts/tpl-smoke.mjs`.
- **G2 (server)**: boot server, `GET /api/projects` trả JSON; với bước DB/routes: gọi thêm vài endpoint liên quan.
- **G3 (e2e)**: `node scripts/test-drive.mjs 'Chủ đề test refactor' 45 '9:16' 1800000 edge` → PASS + `qc_report.json` ok. **tts=edge bắt buộc** (LarVoice trả phí).
- **G4 (resume-compat)**: mở 1 project cũ trong DB qua API/`scripts/resume.mjs`, xác nhận đọc scenes + status không lỗi.

---

## Các bước

### PHA A — Dọn dẹp (rủi ro THẤP)

**R1 — Xoá dead code & file rác.** *(rủi ro: thấp · ~40 dòng giảm · G1)*
- Bỏ import `estimateSpeechSeconds` (`providers/llm.js:4`) và `projectDir` (`api/routes.js:7`, `pipeline/runner.js:7`).
- Xoá `sleep` trùng ở `util/util.js:10` (giữ bản `util/retry.js`); xoá export `clamp` (`util/util.js:12`).
- Hạ `export function run`→`function run` (`media/ffmpeg.js:5`).
- Xoá file `test-beats.mjs`, `test_overshoot_logic.js`, mọi `.DS_Store` (đã grep 0 importer — architecture.md §4).
- Verify: G1. (Lưu ý: `test-beats.mjs` import `extractBeats` — không ai import ngược lại nó, an toàn.)

**R2 — Gom trùng lặp helper/hằng số. → ĐÃ ĐÁNH GIÁ, BỎ QUA (không phải trùng lặp thật).**
Khi soi kỹ, các "trùng lặp" agent khảo sát nêu ra hoá ra là hàm KHÁC nhau, gộp sẽ đổi hành vi (vi phạm mandate) hoặc là abstraction non:
- `escapeHtml`: bản `harness.js` escape 4 ký tự (`& < > "`), bản `util.js` escape 5 (thêm `'`→`&#39;`). Khác nhau; harness nằm trên đường render nhạy → giữ nguyên.
- `clamp`: `branding.js` là hàm **4 tham-số có default** `(v,lo,hi,dflt)`, chỉ dùng trong branding, đã là local const sạch → gộp lên util là abstraction non.
- `PALETTES` (`imagesearch.js`, mảng `['0x..','0x..']`) vs `THEMES` (`visuals.js`, object `{a:'#..',b:'#..',…}`) — **khác cấu trúc**, không phải cùng dữ liệu.
Kết luận: không có bản-sao thật nào để gộp an toàn. Bỏ R2, các bước sau giữ nguyên số.

### PHA B — Tầng thuần & config (rủi ro THẤP–VỪA)

**R3 — magic number → hằng đặt tên. → LỒNG VÀO R9.**
Các hằng tuned (`padMs`, `pix_th=0.04`, `PSNR=70`) là giá-trị-một-chỗ kèm comment giải thích "vì sao" NGAY tại call site — tách ra file trung tâm làm "why" xa "what", giảm rõ ràng và đụng ngưỡng render/QC (rủi ro thừa). Thay vào đó, khi tách module (R9) sẽ khai báo hằng đặt tên cục bộ (vd `PAD_MS` trong `stages/tts.js`). Đạt chuẩn "no magic number" mà không cần bước sweep rủi ro.

**R4 — Tách domain kịch bản khỏi `providers/llm.js`. → HOÃN (dưới trần 400).**
`llm.js` 382 dòng, dưới trần cứng; tổ chức theo section đã khá rõ. Ưu tiên context cho các file VƯỢT trần (runner 723, routes 464, db 452) và cắt vòng lặp. Làm R4 nếu còn ngân sách sau R10.

### PHA C — Cắt vòng lặp visual (rủi ro VỪA — mấu chốt kiến trúc)

**R5 — Tạo `src/styleguide/` dùng chung, cắt vòng lặp animation↔hyperframe.** *(rủi ro: vừa · ~260 dòng di chuyển · G1+G3)*
- Chuyển vào `styleguide/`:
  - từ `animation/templates/hyperframe.js`: `normalizeGuide`, `HF_DEFAULT_GUIDE`, `SAMPLE_SPEC`;
  - từ `hyperframe/styleguide.js`: `themeFromGuide`, `resolveGuide`, `HF_PRESETS`, `generateStyleGuide`.
- `animation/templates/hyperframe.js` chỉ còn **renderer template "hyperframe"** (buildTemplate case), import guide từ `styleguide/`.
- Cập nhật mọi importer (grep sẵn): `animation/index.js`, `hyperframe/{prompt,codegen,validate,styleguide,icons}.js`, `pipeline/{runner,visuals}.js`, `api/routes.js`, `scripts/{tpl-smoke,determinism,hf-qa}.mjs`.
- Kết quả: `styleguide/` không import lên ai; `hyperframe/`→`animation/`+`styleguide/` một chiều; vòng lặp biến mất.
- Verify: G1 (import-smoke phải hết cảnh báo circular) + **G3** + `node scripts/hf-qa.mjs`.

### PHA D — Persistence (rủi ro VỪA)

**R6 — Tách `db/index.js` thành connection + repositories.** *(rủi ro: vừa · ~450 dòng tổ chức lại · G1+G2+G4)*
- `db/index.js`: giữ connection, `db.exec` schema, migrations, seed, **re-export toàn bộ** để `import * as DB from '../db/index.js'` không đổi (bảo toàn mọi call site).
- `db/repositories/`: `projects.js`, `scenes.js`, `channels.js`, `presets.js`, `styles.js`, `library.js`, `voices.js`, `settings.js`. Prepared statement gom theo domain.
- **Không đổi 1 ký tự SQL/schema** (resume-compat). Giữ P13 (recover zombie).
- Verify: G1 + G2 (`/api/projects`, `/api/channels`) + **G4**.

### PHA E — API (rủi ro VỪA)

**R7 — Tách `api/routes.js` thành router theo domain + services.** *(rủi ro: vừa · ~464 dòng tổ chức lại · G1+G2)*
- `api/index.js`: `mountRoutes` chỉ wiring các router.
- `api/routes/`: `projects.js`, `channels.js`, `scenes.js`, `voices.js`, `styles.js`, `library.js`, `media.js` (file-serving + edit-cut), `hyperframe.js`, `misc.js` (health/settings/estimate).
- `api/services/`: business logic rút khỏi route — `voice-preview.js`, `batch.js`, `srt-export.js`, `file-guard.js` (allowlist P15). Route chỉ validate→gọi service→JSON.
- Giữ nguyên path, method, shape, mã lỗi. Giữ P14/P15.
- Verify: G1 + G2 (hit ≥1 endpoint mỗi router: projects, channels, voices, styles, library, file, hyperframe/presets).

### PHA F — Pipeline runner (rủi ro CAO — làm cuối, verify nặng nhất)

**R8 — Rút helper điều phối khỏi `runner.js`.** *(rủi ro: vừa · ~90 dòng · G1+G3)*
- `pipeline/progress.js`: `progressPlan`, `step`, `op`, `retryHook`.
- `pipeline/util.js`: `mapPool`, `resolveOutputDir`, `visualOpts`, `styleNameOf`, `subtitleStyleFrom`.
- `runner.js` import lại. Không đổi hành vi.
- Verify: G1 + G3.

**R9 — Tách các stage B2..B8 thành `pipeline/stages/*`.** *(rủi ro: CAO · ~400 dòng tách · G1+G3)*
- `stages/script.js` (B2), `stages/tts.js` (B34 + `ttsOne` + voice-lock heal P7/P9), `stages/visuals.js` (B5 animation/hyperframe/image, giữ P8), `stages/render.js` (B6), `stages/concat.js` (B7 finalize), `stages/qc-gate.js` (B8, giữ P6/P10 repair), `stages/metadata.js`.
- `runner.js` → `pipeline/orchestrator.js`: `runPipeline` mỏng gọi stage theo thứ tự + phát WS + bắt lỗi/auto-resume (P10 `_auto<1`).
- **Bảo toàn từng nhánh self-heal & guard.** Đây là bước dễ vỡ nhất.
- Verify: G1 + **G3 bắt buộc** + so `qc_report.json` với baseline.

**R10 — Tách `renderOnly`/`regenOne`/`brandGenImpl` + `heal.js`.** *(rủi ro: cao · ~180 dòng · G1+G3+G4)*
- `pipeline/render-only.js`, `pipeline/regen.js`, `pipeline/brandgen.js`, `pipeline/heal.js` (gom `renderHealed`, voice-lock heal, auto-resume policy).
- `pipeline/index.js` (nguyên `queue.js`) cập nhật import.
- Verify: G1 + G3 + **G4** (resume + regen 1 cảnh của project cũ).

### PHA G — Frontend (rủi ro THẤP — CHỈ dead code + naming, KHÔNG redesign)

**R11 — Dọn `public/js/` + gom trích xuất path.** *(rủi ro: thấp · ~60 dòng · G2 + tải trang)*
- Rút hàm parse `?path=` (lặp 4 chỗ) về `public/js/api.js`.
- Tách state HyperFrame/subtitle khỏi `views/config.js` (400 dòng) sang `features/` nếu giảm rõ; xoá dead/nhất quán naming. KHÔNG đổi hành vi UI, KHÔNG đổi giao diện.
- Verify: G2 + tải SPA (preview) kiểm không lỗi console, tạo thử 1 project.

### PHA H — Tài liệu & JSDoc (rủi ro THẤP)

**R12 — JSDoc public export + cập nhật README + architecture.md.** *(rủi ro: thấp · G3 lần cuối)*
- JSDoc mọi export công khai còn thiếu (ưu tiên module vừa tách).
- `README.md` khớp cấu trúc mới; `architecture.md` cập nhật sơ đồ + bảng "sửa X→Y" theo path mới.
- Verify: **full gate G1+G2+G3+G4**.

---

## Thứ tự & lý do rút gọn
1. **A,B** trước vì rủi ro thấp, dọn nền sạch để các bước sau đọc dễ.
2. **C** (cắt vòng lặp) trước D/E/F vì nó gỡ nút thắt phụ thuộc, giúp các bước sau import gọn.
3. **D,E** (DB, API) là med, độc lập tương đối với pipeline.
4. **F** (mổ runner) rủi ro cao nhất → làm sau cùng khi nền đã vững, verify e2e nặng.
5. **G,H** khép lại: FE + tài liệu.

## Ước lượng
- ~12 commit, ròng **giảm** tổng dòng (xoá dead + gom trùng) dù thêm file (tách nhỏ).
- File >400 dòng sau refactor: mục tiêu **0**.
- Mỗi bước PHA F chạy G3 (~e2e vài phút giọng edge) — tốn thời gian nhất nhưng bắt buộc.
