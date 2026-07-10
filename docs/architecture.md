# Kiến trúc AI Video Studio — bản đồ hiện trạng & kiến trúc đích

> GĐ1 của đợt refactor. Tài liệu này là **bản đồ sống** cho cả người và AI coding agent: đọc để biết "muốn sửa X thì vào file nào", ranh giới trách nhiệm ở đâu, và chỗ nào tuyệt đối không được đụng.
> Chuỗi tài liệu: architecture.md (hiện trạng) → [refactor-plan.md](refactor-plan.md) (các bước R1..Rn) → [refactor-report.md](refactor-report.md) (kết quả).

---

## 1. Tổng quan hệ thống

AI Video Studio là app macOS tạo video tự động: nhập chủ đề → sinh kịch bản (LLM) → lồng tiếng + phụ đề → dựng đồ hoạ chuyển động từng cảnh → render → ghép + mix → QC. Không có bước build, không framework FE.

- **Stack**: Node.js 22 ESM thuần. `express` (REST) + `ws` (tiến độ realtime) + `better-sqlite3` (persistence) + `puppeteer-core` (render HTML→frame) + `ffmpeg`/`ffprobe` (media) + `whisper-cli` (phụ đề). FE là vanilla ESM trong `public/js/`.
- **Entry**: `src/server.js` → mount REST (`api/routes.js`) + WebSocket hub + static SPA.
- **Quy mô**: ~131 file, ~15.7k dòng (src ~8.6k). Chi tiết đếm dòng ở §8.
- **Pipeline (mã bước dùng xuyên codebase)**: `B2` kịch bản → `B34` TTS+SRT → `B5` visuals → `B6` render cảnh → `B7` ghép/mix → `B8` QC gate.

Hai chế độ visual song song, đây là điểm mấu chốt của toàn bộ kiến trúc:
- **animation mode** — planner chọn 1 template motion-graphics dựng sẵn cho mỗi cảnh (`src/animation/`).
- **hyperframe mode** — LLM tự viết `{css, html, script}` GSAP cho từng cảnh, validate bằng render thật (`src/hyperframe/`), rồi **render lại bằng chính engine của animation mode**.

---

## 2. Sơ đồ tầng hiện tại (thực tế, không lý tưởng hoá)

```
                         ┌──────────────┐
  Browser SPA  ────────► │  server.js   │  entry: express + ws + static
  (public/js)  ◄──ws───► └──────┬───────┘
                                │
                        ┌───────▼─────────┐
                        │  api/routes.js  │  464 dòng — 1 hàm mountRoutes khổng lồ,
                        │  (FAT ROUTER)   │  lẫn business logic (voice preview, batch,
                        └───────┬─────────┘  srt export, file-serving guard)
                                │
                    ┌───────────▼───────────┐
                    │  pipeline/queue.js     │  facade mỏng (active Map) — OK
                    └───────────┬───────────┘
                                │
                ┌───────────────▼────────────────┐
                │     pipeline/runner.js          │  723 dòng — GOD FILE
                │  runPipeline · finalize ·       │  trộn: orchestration + logic từng
                │  renderOnly · regenOne ·        │  stage + retry/self-heal + metadata
                │  brandGenImpl + 8 helper        │  + brand-gen
                └──┬───────┬────────┬─────────┬───┘
                   │       │        │         │
        ┌──────────▼─┐ ┌───▼────┐ ┌─▼──────┐ ┌▼─────────────┐
        │ providers/ │ │pipeline│ │animation│ │ hyperframe/  │
        │ llm tts    │ │/stages │ │/ (engine│ │ (LLM codegen)│
        │ subtitle   │ │direction│ │+templates)◄══╗ (VÒNG LẶP)│
        │ imagegen   │ │qc render│ │         │══►║           │
        │ fetchlink  │ │srt      │ │         │   ║           │
        └──────┬─────┘ │visuals  │ └────┬────┘   ╚═══════════╝
               │       └────┬────┘      │
        ┌──────▼────────────▼───────────▼──────────────┐
        │  infra: db/  media/(ffmpeg,puppeteer,whisper,say)  ws/hub  │
        │         config/paths  core/config  util/*  subtitles/presets │
        └───────────────────────────────────────────────────────────┘
```

### Cái đúng đang có (giữ nguyên tinh thần khi refactor)
- `pipeline/queue.js` — facade mỏng chuẩn mực (in-flight `Map`, một chỗ vào duy nhất). Mẫu để nhân rộng.
- `core/config.js` — config layering sạch (channel → preset → request; AI settings theo section) + mask secret ở mọi egress. Là "single source of truth" đúng nghĩa.
- `config/paths.js` — resolve binary/dir theo thứ tự ENV → vendor → app bundle → PATH, graceful null. Rõ ràng.
- `server.js` — entry gọn, có boot-recovery zombie project, không chết vì stray async error.
- Tầng provider voice (`providers/voice/*`) — mỗi provider 1 file sau 1 interface (`index.js`). Đây là hình mẫu cho các provider khác.

---

## 3. HAI VẤN ĐỀ KIẾN TRÚC LỚN NHẤT

### 3.1 God file `pipeline/runner.js` (723 dòng)
Một file gánh toàn bộ: điều phối pipeline, logic chi tiết từng stage (B2→B8), chính sách retry/self-heal 3 tầng, sinh metadata + chapter, và cả brand-gen offline. Hệ quả: khó đọc, khó test từng stage, khó cho AI agent sửa 1 khâu mà không đọc cả file.

Bên trong gồm các khối tách được ngay:
| Khối | Dòng | Nên về đâu |
|---|---|---|
| helper: `mapPool`, `step/op/retryHook`, `progressPlan`, `visualOpts`, `resolveOutputDir` | 34–90 | `pipeline/progress.js` + `pipeline/util.js` |
| B2 script | 107–129 | `pipeline/stages/script.js` |
| B34 TTS+SRT (`ttsOne` + voice-lock heal) | 131–181 | `pipeline/stages/tts.js` |
| B5 visuals (animation + hyperframe + image) | 183–284 | `pipeline/stages/visuals.js` |
| B6 render + self-heal + verify | 286–374 | `pipeline/stages/render.js` + `pipeline/heal.js` |
| B7 finalize + B8 QC gate | 435–580 | `pipeline/stages/concat.js` + `pipeline/stages/qc-gate.js` |
| metadata + chapters | 381–403 | `pipeline/stages/metadata.js` |
| `renderOnly`, `regenOne`, `brandGenImpl` | 583–723 | `pipeline/render-only.js`, `pipeline/regen.js`, `pipeline/brandgen.js` |

`runPipeline` còn lại chỉ nên là orchestrator ~80 dòng: gọi stage, phát WS event, bắt lỗi + auto-resume.

### 3.2 Vòng lặp phụ thuộc `animation/` ↔ `hyperframe/`
Đây là mớ rối nặng nhất. Hai thư mục import lẫn nhau **hai chiều**:

```
animation/index.js  ──imports──►  hyperframe/styleguide.js   (themeFromGuide, resolveGuide)
hyperframe/styleguide.js ──imports──► animation/templates/hyperframe.js (HF_DEFAULT_GUIDE, normalizeGuide)
hyperframe/prompt.js     ──imports──► animation/templates/hyperframe.js (SAMPLE_SPEC)
hyperframe/validate.js   ──imports──► animation/{templates, harness, templates/hyperframe}
hyperframe/codegen.js    ──imports──► animation/{templates, themes}
hyperframe/icons.js      ──imports──► animation/templates/_shared.js (IC)
```

Gốc rễ: **file `animation/templates/hyperframe.js` (255 dòng) bị đặt nhầm chỗ.** Nội dung của nó (`normalizeGuide`, `HF_DEFAULT_GUIDE`, `SAMPLE_SPEC`, renderer cho template "hyperframe") là khái niệm của *hyperframe/style-guide*, nhưng lại nằm dưới `animation/templates/`. Và ngược lại, `themeFromGuide`/`resolveGuide` (khái niệm theme) lại nằm trong `hyperframe/styleguide.js` nhưng được `animation/index.js` tiêu thụ.

**Ranh giới đích (đã chốt) — tách 1 module chung, cắt vòng lặp:**

```
                 ┌────────────────────────────┐
                 │  styleguide/  (MỚI, chung) │  guide schema · normalizeGuide ·
                 │  không phụ thuộc 2 bên     │  resolveGuide · themeFromGuide ·
                 │                            │  HF_PRESETS · HF_DEFAULT_GUIDE · SAMPLE_SPEC
                 └───────▲───────────▲────────┘
                         │           │
         ┌───────────────┘           └───────────────┐
   ┌─────┴──────────┐                        ┌────────┴─────────┐
   │  animation/    │                        │  hyperframe/     │
   │  ENGINE render │◄──────depends on───────│  LLM CODEGEN     │
   │  (template lib,│   (buildTemplate,      │  (codegen,       │
   │  harness,      │    makeCtx, harness,   │   validate,      │
   │  renderer,     │    IC icons)           │   prompt, beats) │
   │  planner,themes│                        │                  │
   └────────────────┘                        └──────────────────┘
```

- **`styleguide/`** = khái niệm phong cách/theme dùng chung. Cả hai bên `import` từ đây, **không bên nào import lên nó**. Vòng lặp biến mất.
- **`animation/`** = engine dựng + render (template library, harness, renderer, planner, branding, themes, gsap). Là "thư viện render" cấp thấp.
- **`hyperframe/`** = hệ "LLM viết GSAP" (codegen, validate, prompt, beats, icons, lint). **Được phép** phụ thuộc `animation/` (nó tái dùng engine để render+validate) và `styleguide/`. Đây là quan hệ một chiều, hợp lệ.

Nguyên tắc phân biệt để nhớ: *hyperframe sinh ra spec, animation biến spec thành pixel, styleguide quyết định spec/pixel mang màu-chữ-motif gì.*

---

## 4. Danh mục dead code (đã verify bằng grep — an toàn xoá/hạ cấp)

| Mục | Vị trí | Bằng chứng | Xử lý |
|---|---|---|---|
| import `estimateSpeechSeconds` thừa | `providers/llm.js:4` | chỉ xuất hiện ở đúng dòng import, 0 nơi gọi | bỏ khỏi danh sách import |
| `sleep` trùng lặp | `util/util.js:10` | mọi importer (`runner.js`, `larvoice.js`) đều lấy từ `util/retry.js`; 0 nơi import `sleep` từ `util.js` | xoá bản ở util.js, giữ ở retry.js |
| export `clamp` | `util/util.js:12` | 0 importer; `animation/branding.js` có `clamp` 4-tham-số riêng | xoá export (hoặc gộp branding về dùng chung — quyết trong plan) |
| import `projectDir` thừa | `api/routes.js:7`, `pipeline/runner.js:7` | chỉ dùng `DB.projectDirFor`; `projectDir` không được gọi | bỏ khỏi import |
| `export` thừa ở `run` | `media/ffmpeg.js:5` | chỉ dùng nội bộ (dòng 16, 20); 0 importer ngoài | hạ `export function run` → `function run` |
| file chết | `test-beats.mjs`, `test_overshoot_logic.js` (root) | 0 importer, không có trong npm scripts; là artifact debug/tuning | xoá (nếu muốn giữ quyết định thì chuyển `docs/explorations/`) |
| `.DS_Store` | rải rác | file rác macOS | xoá + đã có trong `.gitignore` |

**Đã kiểm và KHÔNG chết (đừng xoá nhầm):** `closeBrowser` (`media/puppeteer.js`) — dùng bởi `scripts/{hf-qa,build-icon,determinism}.mjs`; agent khảo sát chỉ soi `src/` nên báo nhầm.

Trùng lặp cần gộp (không phải dead, nhưng bẩn): `PALETTES` (`imagesearch.js`) vs `THEMES` (`visuals.js`) — cùng cấu trúc cặp màu; `escapeHtml` (harness.js tự định nghĩa dù `util.js` đã export); `clamp` (branding.js vs util.js). Gom vào `util/`/`config/constants.js`.

---

## 5. Kiến trúc đích theo tầng (mỗi quyết định + 1 lý do)

```
src/
  server.js                 # entry (gần như nguyên trạng)
  api/
    index.js                # mountRoutes: chỉ wiring các router con
    routes/                 # router mỏng theo domain — CHỈ validate→gọi service→trả JSON
      projects · channels · scenes · voices · styles · library · media · hyperframe
    services/               # business logic rút khỏi routes (voice-preview, batch, srt-export, file-guard)
  pipeline/
    index.js                # facade (nguyên queue.js)
    orchestrator.js         # runPipeline mỏng: gọi stage, phát WS, auto-resume
    stages/                 # 1 file/stage: script tts visuals render concat qc metadata
    heal.js                 # chính sách retry/self-heal (renderHealed, voice-lock, auto-resume)
    progress.js             # progressPlan, step/op/retryHook, chapter helpers
    render-only.js · regen.js · brandgen.js
  providers/                # mọi provider sau 1 contract; retry/multi-key ở ĐÚNG 1 chỗ (llm client)
    llm/  tts + voice/*  image(imagegen,imagesearch)  subtitle  fetchlink
  styleguide/               # MỚI: guide/theme dùng chung — cắt vòng lặp animation↔hyperframe (§3.2)
  animation/                # engine render: templates/*, harness, renderer, planner, branding, themes, gsap
  hyperframe/               # LLM codegen: codegen, validate, prompt, beats, icons, lint
  domain/                   # logic THUẦN, không I/O: script(offline+prompt), srt, lang, word-budget
  db/
    index.js                # connection + schema + migrations
    repositories/           # query theo domain: projects scenes channels presets styles library voices settings
  infra/  (hoặc giữ media/ + ws/)  media/(ffmpeg,puppeteer,say,whisper)  ws/hub
  config/                   # paths · config-layering · secrets · constants(magic numbers)
```

Lý do từng lớp:
- **`api/routes/` tách theo domain** — routes.js 464 dòng hiện là 1 hàm; tách để mỗi domain ≤120 dòng, dễ tìm endpoint, dễ thêm mới. Business logic (batch, voice-preview, file-guard) xuống `services/` để route thuần I/O.
- **`pipeline/stages/` 1 file/stage** — mỗi khâu B2..B8 test/sửa độc lập; orchestrator chỉ còn điều phối. Đây là mục tiêu rủi ro cao nhất, làm cuối.
- **`providers/` sau 1 contract** — retry/backoff/multi-key hiện nằm trong `llm.js`; gom mọi provider về cùng khuôn để không rải logic resilience.
- **`styleguide/` riêng** — như §3.2, là mấu chốt để hai hệ visual hết chồng chéo mà không phải đổi tên cả thư mục (giảm churn import, an toàn cho resume-compat).
- **`domain/` thuần** — `offlineScript`, `twoStageScript` prompt-building, `LANG_WPS`, `srt`, `beats`, `lang` không đụng I/O → tách ra để unit-test được và AI đọc nhanh.
- **`db/repositories/`** — `db/index.js` 452 dòng gộp schema + 8 domain query + seed + side-effect-lúc-import; tách schema/migration khỏi query theo domain, giữ nguyên schema SQL (bắt buộc, resume-compat).

> Lưu ý phạm vi: đổi tên thư mục lớn (`animation/`→…) tạo churn import khổng lồ và rủi ro resume-compat. Plan sẽ ưu tiên **tách file & tạo module mới** hơn là đổi tên hàng loạt; các folder gốc có thể giữ tên, quan trọng là ranh giới trách nhiệm và chiều phụ thuộc đúng như trên.

---

## 6. Bảng "muốn sửa X → vào file Y" (sau refactor sẽ cập nhật theo cấu trúc mới)

| Muốn làm | Hiện tại vào file |
|---|---|
| Thêm provider TTS mới | `providers/voice/<tên>.js` + đăng ký ở `providers/voice/index.js` |
| Đổi chuỗi retry/backoff/multi-key LLM | `providers/llm.js` (`chat`, `chatOnce`) |
| Sửa cách tách kịch bản offline / prompt sinh kịch bản | `providers/llm.js` (`offlineScript`, `generateScript`, `twoStageScript`) |
| Thêm 1 template animation | tạo `animation/templates/<tên>.js` + đăng ký `animation/templates/index.js` |
| Đổi prompt codegen HyperFrame | `hyperframe/prompt.js` |
| Đổi luật validate cảnh HyperFrame (timid/overshoot…) | `hyperframe/validate.js` |
| Thêm preset phong cách (màu/motif/HUD) | `hyperframe/styleguide.js` (`HF_PRESETS`) |
| Sửa ngưỡng QC (black/silence/tolerance) | `pipeline/qc.js` + chỗ gọi trong `runner.js` `finalize` |
| Thêm/sửa REST endpoint | `api/routes.js` |
| Đổi schema DB / thêm cột | `db/index.js` (khối `db.exec` + migrations) |
| Sửa điều phối pipeline (thứ tự B2..B8, auto-resume) | `pipeline/runner.js` `runPipeline` |
| Đổi loudnorm / pad / SFX / ambient | `media/ffmpeg.js` |
| Sửa layer config (channel/preset/request) | `core/config.js` |
| Đổi binary path / thư mục runtime | `config/paths.js` |
| Sửa UI cấu hình xuất video | `public/js/views/config.js` |
| Sửa hiển thị tiến độ realtime | `public/js/views/progress.js` + `ws/hub.js` |

---

## 7. Sổ đăng ký "HÀNH VI ĐƯỢC BẢO VỆ" (di chuyển được, XOÁ/ĐƠN GIẢN HOÁ = hỏng)

Rút từ `docs/upgrade-report.md` + khảo sát code. Refactor được phép **đổi chỗ**, cấm đổi logic/hằng số/thứ tự.

| # | Hành vi | Vị trí hiện tại |
|---|---|---|
| P1 | `chatOnce` sàn `max_tokens = 16000` (model reasoning đốt token vào hidden thinking) | `providers/llm.js:57` |
| P2 | `chatJson` chỉ bật `response_format:json_object` ở attempt đầu (proxy gemini trả rác) | `providers/llm.js:121,124` |
| P3 | Bắt **429/rate-limit TRƯỚC dead-key**, backoff [8s,20s,45s]×4 | `providers/llm.js:26,38–42` |
| P4 | `minScenes ≥70%` (single) / `≥60%` (per-chapter) chống model trả thiếu cảnh | `providers/llm.js:281,331` |
| P5 | `LANG_WPS` (vi 4.4…) — lượng chữ theo tốc độ đọc thật | `providers/llm.js:217` |
| P6 | `qc.probeStreams` strip dấu phẩy cuối ffprobe csv; `pix_th=0.04`; `tailAllowance`; map defect ưu tiên exact-containment | `pipeline/qc.js` |
| P7 | TTS: explicit `ttsOverride.provider` thắng `langVoices`; voice-lock retry 3× cùng giọng | `providers/tts.js` |
| P8 | B5 hyperframe **skip cảnh `chapter-break` có props** (giữ anchor SFX); codegen thành công set `video_path:null` (để resume re-render) | `pipeline/runner.js:244,247,257` |
| P9 | loudnorm EBU R128 per-scene + `apad` theo ngôn ngữ (vi 650ms/en 400ms) | `media/ffmpeg.js:normalizeVoice`, `runner.js:146` |
| P10 | Self-heal đa tầng: render retry → swap template `kinetic-statement` → deferred sequential → QC repair (guard `_qcAttempt<1`); auto-resume 1 lần (`_auto<1`) | `pipeline/runner.js:319–372,415–422,549–560` |
| P11 | beats: `MIN_GAP=1.2 HOLD_MAX=2.6 LEAD=0.12`; lọc beat chỉ-dấu-câu | `hyperframe/beats.js:61–63,137` |
| P12 | QA/determinism `PSNR_OK=70`; `FROZEN_TAIL` khi `tlDur<dur-0.4`; `SUBTITLE_COLLISION cy>0.82H` | `scripts/{determinism,hf-qa}.mjs`, `hyperframe/validate.js` |
| P13 | recover zombie 'running'→'paused' lúc boot | `db/index.js:214` |
| P14 | mask secret mọi egress + `applyMaskedUpdate` round-trip `••` | `util/secrets.js`, `core/config.js` |
| P15 | `/api/file` path allowlist (data/ + channel roots + app bundle read-only) | `api/routes.js:426` |

Quy tắc vàng khi refactor: gặp regex/hằng số/guard trông "thừa" → grep trong `docs/` + bảng này trước khi động.

---

## 8. Phụ lục — đếm dòng file lớn (baseline trước refactor)

| Dòng | File | Ghi chú |
|---|---|---|
| 723 | `pipeline/runner.js` | god file — mục tiêu tách chính (§3.1) |
| 464 | `api/routes.js` | fat router — tách theo domain |
| 452 | `db/index.js` | schema + 8 domain query — tách repository |
| 400 | `public/js/views/config.js` | FE fat — tách config serializer/UI |
| 382 | `providers/llm.js` | tổ chức theo section khá tốt; tách domain/script |
| 255 | `animation/templates/hyperframe.js` | **đặt nhầm chỗ** → về `styleguide/` (§3.2) |
| 253 | `animation/harness.js` | engine — OK |
| 263 | `public/js/views/scenes.js` | FE — OK |
| 256 | `public/js/views/studio.js` | FE — OK |

Mục tiêu sau refactor: **không file nào >400 dòng** (ngoại lệ ghi lý do trong report).
