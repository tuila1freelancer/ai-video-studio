# Work order — final-video logo overlay (WYSIWYG) + Brand Asset page (reference-app clone)

Date: 2026-07-17. Owner-approved scope. Execute in THIS repo on `main` (no branches/PRs).
This document is self-contained: every reference-app fact needed (verbatim prompts, API
shapes, filename schemes, FE behaviors) is embedded below — the implementing session does
not need to open the reference app.

## 0. Mission

Two features, both to "reference-app quality or better":

**A. Logo burned into the FINAL assembled video** — configured in the existing
"Thương hiệu kênh" section: drag the logo anywhere on a true-aspect preview stage, resize
freely, and the preview position is **pixel-exact WYSIWYG** against the final rendered
video (same fraction math on both sides, proven by a render test).

**B. Brand Asset page** — a faithful clone of the reference app's "Tạo Brand Asset" page
(sections, behaviors, prompts), **plus** an in-page picker for the image-generation
provider and model, **plus** a hardened prompt line making the character background
mandatorily transparent (owner order).

## 1. Ground rules (repo conventions — all mandatory)

- Reference app `/Applications/AI VIDEO Tool.app` and its data dir
  `~/Library/Application Support/VideoPipeline/` are READ-ONLY. Never write there.
- Any real render/E2E runs in a sandbox `AVS_DATA_DIR` under the session scratchpad.
  Unit tests use fake fetch/LLM — no network, no real keys.
- Providers come from AI Settings (`aiSettings()` / the `ai` setting row). NEVER hardcode
  a model name, API key, or base URL in src/. The reference app's values below are DATA
  for defaults/placeholders in the UI, not constants in code paths.
- **No-fallback contract (P25 spirit)**: the selected image model gets up to 10 attempts,
  then a LOUD per-item failure naming provider+model. No silent provider/model failover.
  (The existing `generateImage` failover mesh in `src/providers/imagegen.js` is for scene
  backgrounds only — brand-gen must NOT use it.)
- Code/comments/commits/docs in English; UI label strings in Vietnamese (match existing UI).
- Protected behaviors P1–P25 (docs/architecture.md §7) must keep passing. `npm test` green
  (currently 176/176) before finishing. Code first, test once at the end.
- Git identity per repo rule (repo-local `tuila1freelancer <62372475+tuila1freelancer@users.noreply.github.com>`,
  verify after each commit, no AI attribution).
- Do not hand-edit JOURNAL.md.

## 2. Current state (verified in this repo — build on it, don't duplicate)

- `public/index.html` — "Thương hiệu kênh" cfg group (`#grpBrand`, ~line 302) + Brand Kit
  modal (`#brandModal`, ~line 711) with a drag stage `#brandStage`, logo ghost `#bstLogo`,
  size slider `#brandLogoSize` (4–20%), opacity `#brandLogoOpacity`, placement select
  `#brandPlacement` (smart / always / off), caption band `.bst-capband`.
- `public/js/features/brandkit.js` — modal logic; saves `channel.config.brandKit`
  `{ channelName, placement, logo: { assetPath, position: {xPct,yPct}, sizePct, opacity, style }, badge… }`.
- `src/animation/branding.js` — `resolveBrandKit(config)`; per-scene static brand layer
  composited into every scene page (smart corner avoidance). Deterministic, static DOM.
- `src/pipeline/stages/finalize.js` (~line 91): image mode maps brandKit.logo onto the
  legacy whole-video overlay `config.logo = {path, size(px@1080), position('br'…)}` which
  `concatScenes` (src/pipeline/render.js, logo branch ~line 221, `logoPos()` ~line 260)
  burns via ffmpeg. Animation/hyperframe modes currently get NO whole-video logo.
- Brand asset storage: library kind `'brand'` with brand folders (`DIRS.brand/<Brand>/`),
  `DB.addLibrary`, `DB.brandFolders()`; upload route `POST /library/:kind`; generic file
  serving via `fileUrl(path)` (`public/js/api.js`).
- Brand Asset page today is a placeholder: `#page-brandgen` (index.html ~407) with
  `#bgRef/#bgName/#bgStyle/#bgGo/#bgResults`, view `public/js/views/brandgen.js`,
  route `POST /api/brandgen` → `src/pipeline/brandgen.js` `brandGenImpl` which fabricates
  tinted posters offline ("Offline placeholder set"). **This whole placeholder lane is
  superseded — replace it.**
- AI settings shape: `src/db/repositories/settings.js` →
  `imageGen: { provider:'pollinations', model:'flux', apiKey:'', baseUrl:'…', bestOf:1 }`.
  There is currently NO imageGen UI in `public/js/views/config.js`.

## 3. Feature A — final-video logo overlay (WYSIWYG)

### 3.1 Config schema (extend `channel.config.brandKit`)

```js
brandKit.finalOverlay = {
  enabled: false,        // owner turns on in the Brand Kit modal
  cxPct: 0.92,           // logo CENTER x as fraction of frame width  [0..1]
  cyPct: 0.08,           // logo CENTER y as fraction of frame height [0..1]
  wPct:  0.085,          // logo width as fraction of frame WIDTH (free range 0.02..0.45)
  opacity: 0.9,          // 0.2..1
}
```

Center+width fractions are THE single source of truth. Derived pixels (one shared helper,
`src/media/logo-overlay.js`, exported and unit-tested):

```js
export function logoRect({ cxPct, cyPct, wPct }, { W, H, logoW, logoH }) {
  const lw = Math.round(wPct * W);
  const lh = Math.round(lw * (logoH / logoW));
  return { lw, lh, x: Math.round(cxPct * W - lw / 2), y: Math.round(cyPct * H - lh / 2) };
}
```

The front-end preview MUST position the ghost with the same formula expressed in CSS
percentages (center anchoring via translate(-50%,-50%), width = `wPct*100`% of stage).
That identity — not calibration — is the WYSIWYG guarantee.

### 3.2 Render integration

- `concatScenes` (src/pipeline/render.js): extend the existing logo branch to accept the
  new shape `{ path, cxPct, cyPct, wPct, opacity }` alongside the legacy
  `{ size, position }` (back-compat branch stays for old configs). New path:
  `[logo]scale=lw:-1:flags=lanczos,format=rgba,colorchannelmixer=aa=<opacity>[lg];
  [base][lg]overlay=x:y` using `logoRect` — probe the logo file's intrinsic w/h with
  ffprobe once. Single encode pass as today; overlay covers intro/outro/transition frames
  (the whole program) by construction.
- `finalize.js`: replace the image-mode-only mapping (~line 91) with a unified rule —
  when `config.brandKit?.finalOverlay?.enabled && brandKit.logo?.assetPath`, build
  `config.logo = { path, cxPct, cyPct, wPct, opacity }` for ALL visual modes.
- Double-brand suppression: when `finalOverlay.enabled`, `resolveBrandKit()`
  (src/animation/branding.js) returns the per-scene layer WITHOUT the logo (badge/name
  may remain per its own toggle). One logo on screen, ever.
- `fingerprint.js` already includes `brandKit`/`logo` in RENDER_CFG_KEYS — verify the new
  fields invalidate the concat cache (they live under brandKit, so they do; add a test pin).

### 3.3 Brand Kit modal UX (public/js/features/brandkit.js + index.html)

- `#brandPlacement` gains a 4th option `final`:
  "🎞 Đóng dấu cả video — chèn 1 lần ở bước ghép cuối, đúng 100% vị trí xem trước".
  Selecting it sets `finalOverlay.enabled=true` (and placement stays stored so switching
  back restores per-scene behavior).
- Stage `#brandStage` must letterbox to the channel's actual aspect (9:16/16:9/1:1/4:5).
  Background: newest rendered frame of the channel (existing "cảnh thật gần nhất"
  mechanism) else a dark checkerboard (so transparent logos read clearly).
- Free resize: slider range widens to 2–40%; PLUS a drag handle on the ghost corner and
  mouse-wheel over the ghost (wheel = ±0.5%, shift+wheel = ±2%). Keyboard nudge when the
  ghost is focused: arrows ±0.5% position, shift+arrows ±2%.
- Snap guides at center-x, center-y, thirds, and 3% margins — thin guide lines flash while
  dragging within 1% of a guide; snapping is a position aid only (stored value is the
  snapped fraction, no hidden offsets).
- Live readout under the stage: `x=…px, y=…px, w=…px @ <W>×<H>` computed with `logoRect`
  for the channel's output resolution — the same numbers ffmpeg will use.
- Caption band `.bst-capband` stays visible as a collision hint.

### 3.4 Feature A tests

- Unit: `logoRect` exact values for known inputs (both orientations, odd sizes, rounding).
- Render (offline, deterministic): build a 2s solid-#003300 clip (ffmpeg lavfi), a
  100×100 solid-red PNG logo, `concatScenes` with `{cxPct:.75, cyPct:.25, wPct:.2, opacity:1}`
  at 640×360 → extract frame @1s → assert: pixel at the rect center is red; pixels 4px
  outside each rect edge are the background color (read raw RGB via ffmpeg rawvideo, no
  screenshots). This is the WYSIWYG proof.
- Suppression: `resolveBrandKit` with finalOverlay.enabled returns logo:null (badge kept).
- Legacy shape still renders (back-compat branch).

## 4. Feature B — Brand Asset page (reference clone + provider/model picker)

### 4.1 Reference-app facts (verbatim — embed these EXACTLY)

**Endpoint semantics** (theirs → ours):

- `POST /api/brand-gen/emotions` body `{characterName, count, keys, context}` — count
  clamped 1..50, default 20; `domain = context.trim() || "general content"`.
- `POST /api/brand-gen/generate` multipart `image` + fields
  `{characterName, emotion, brandId, infinityKey, style}`; style default `2D Anime style`;
  output filename **`character ${name} ${emotion}.png`** (spaces kept) into
  `<brand-root>/<Brand>/`; default brand `Default`.
- `POST /api/brand-gen/copy-to-brand` `{sourceBrand, targetBrand, filenames}` — copies
  named files between brand folders (sanitizes `[\\/:*?"<>|]` and `..`).
- Their image API call: `POST https://infinityapis.com/v1/images/edits` — multipart
  `image=reference.png, prompt, model="gpt-image-2", n="1", size="1024x1536"`,
  `Authorization: Bearer <key>`, timeout 120s → `data[0].b64_json` else `data[0].url`
  (download). This is the OpenAI-compatible images/edits shape.

**Emotion-list prompt (VERBATIM — byte-identical, including blank lines):**

```
You are a character emotion/action designer for brand assets.

Given a character named "${characterName}", generate exactly ${count} unique emotions and actions.
${contextBlock}
The character's theme/domain: ${domain}

Rules:
- Each item is a short English phrase (3-8 words) describing an emotion or physical action
- ALL items must be relevant to the domain: "${domain}" — do NOT default to crypto/finance/trading
- Mix between pure emotions (crying, showing anger, laughing) and contextual actions specific to "${domain}"
- Include common reactions: happy, sad, angry, surprised, thinking, explaining
- Include domain-specific actions that match "${domain}"
- Format: lowercase, descriptive
- Must be diverse — no duplicates or near-duplicates
- Do NOT include the character name in the items

Return JSON: { "emotions": ["emotion or action 1", "emotion or action 2", ...] }
```

`contextBlock` when context is non-empty (verbatim, with its leading/trailing newlines
exactly as here; empty string otherwise):

```
IMPORTANT — The character's domain/context is: "${context}"
ALL emotions and actions MUST be relevant to this specific context. Do NOT generate finance/crypto/trading related content unless the context explicitly mentions it.
```

**Image-generation prompt** — reference original:

```
Generate a character illustration in ${style}: "${characterName}" ${emotion}. Same character design as the reference image. Art style: ${style}. Transparent or clean solid background. Full body or upper body visible. Expressive pose matching the emotion/action. PNG style, suitable for video overlay.
```

**Owner-ordered modification (the ONLY change)**: replace the sentence
`Transparent or clean solid background.` with:

```
Background MUST be fully transparent (true alpha PNG) — the image contains ONLY the character; no backdrop, no floor, no frame, no solid color behind the character.
```

Every other word stays verbatim.

**Reference FE behaviors (from their `js/features/brand-gen.js` — clone all):**

- Generation runs in batches of **3 concurrent** requests (`slice(i, i+3)` + Promise.all),
  sequential between batches.
- Stop/Resume: an abort flag stops after the current batch; the done-index is kept; the
  Start button relabels "▶ Tiếp tục" and resumes from the done-index. On completion:
  log `🏁 Hoàn tất: <ok> thành công, <fail> lỗi`, reset index, reload copy targets.
- Per-item log lines: start `→ character <name> <emotion>…`, success `✅ <filename> (<kb> KB)`,
  failure `❌ "<emotion>": <error>`. Progress bar = done/total with `X / Y` label.
- Result grid: thumbnail card per generated file (image + emotion caption), appended live.
- Emotion preview list before generation: numbered rows rendering
  `<n>. character <name> <emotion(bold)>`; generation is blocked until a list exists
  ("📋 … bấm "Sinh danh sách" … hoặc nhập thủ công trước.").
- "Sinh danh sách" button disables itself with `⏳ Đang sinh...` while running.
- Manual mode: textarea, one emotion per line → same preview list.
- Style chips set a hidden style value; "Khác" reveals a free-text input whose value
  becomes the style. Chip values: `2D Anime style`, `Manhwa style`, `3D Pixar style`,
  `3D Realistic style`, `Minecraft style`.
- "+ Brand" prompts for a name, creates the brand folder, reloads and selects it.
- Copy-to-brand UI under the results: target select (excludes current brand) + button;
  status `✅ <n> file → "<target>"`.

**Page layout** (their UI — ours already matches the house style; keep Vietnamese labels):
`1. ẢNH THAM CHIẾU` (📁 Chọn ảnh + filename + preview) · `2. TÊN NHÂN VẬT` (placeholder
"Ví dụ: ema, luna, alex...") · `3. STYLE NHÂN VẬT` (chips 🎨 2D Anime · 📖 Manhwa ·
🧸 3D Pixar · 🎬 3D Realistic · ⛏ Minecraft · ✏️ Khác) · `4. BRAND ĐÍCH` (select + `+ Brand`)
· `5. DANH SÁCH CẢM XÚC / HÀNH ĐỘNG` (🤖 AI tự sinh / ✍ Nhập thủ công; "Số lượng: 20";
📋 Sinh danh sách; context textarea placeholder "(Tuỳ chọn) Mô tả thêm về nhân vật để AI
sinh emotions chính xác hơn. VD: nhân vật nữ, chủ đề crypto/tài chính, phong cách dễ
thương..."). Then (ours, added): `6. PROVIDER & MODEL TẠO ẢNH`, and the run area
(preview list → Start/Stop/progress/log → results grid → copy-to-brand).

### 4.2 Our backend (replace the placeholder lane)

New service `src/api/services/brand-gen.js` (+ routes in `src/api/routes.js`; delete the
old `POST /brandgen` + `src/pipeline/brandgen.js` placeholder and its queue/runner export):

- `POST /api/brandgen/emotions` `{characterName, count, context}` → builds the VERBATIM
  prompt above, calls `chatJson` with `aiSettings().llm` (attempts per house style,
  validate `Array.isArray(x.emotions)`), returns `{ok, characterName, emotions}`.
  (Deviation from reference, by design: LLM keys come from AI Settings server-side, never
  from the browser.)
- `POST /api/brandgen/generate` multipart `image` (optional after first call per run —
  cache the uploaded reference per request like the reference does per call; simplest:
  FE sends the file every call, exactly like the reference) + fields
  `{characterName, emotion, brand, style}` →
  1) Build the modified-verbatim image prompt.
  2) Call the images/edits provider selected in settings (see 4.3) with the reference
     image; **10 attempts, no fallback**, exponential backoff on 429/5xx; on final
     failure return HTTP 500 `{error}` naming provider+model+emotion.
  3) **Transparency gate** (owner mandate): verify the returned PNG really has a
     transparent background — helper `verifyTransparentBg(path)` in
     `src/media/ffmpeg.js`: pixel format must carry alpha AND the mean alpha of the four
     8×8 corner patches must be < 16/255 for at least 3 corners (ffmpeg
     `alphaextract` + `crop` + `signalstats`, parse YAVG; no new deps). A failed gate
     counts as a failed attempt: re-ask with one appended line
     `The previous image had a non-transparent background — regenerate with a TRUE alpha-channel transparent background.`
  4) Save to `DIRS.brand/<Brand>/character <name> <emotion>.png` (keep the reference
     filename scheme; sanitize only `[\\/:*?"<>|]` and path traversal) and register via
     `DB.addLibrary({kind:'brand', brandFolder, …})` so assets flow into the existing
     asset-match / IMAGE-FULL lanes (P18/P22).
  5) Respond `{ok, filename, path, size, item}` (item = library row for the grid).
- `POST /api/brands` `{name}` → create brand folder (under `DIRS.brand`), return
  `{ok, name}`; `GET /api/brands` → `{brands: DB.brandFolders()}`.
- `POST /api/brandgen/copy` `{sourceBrand, targetBrand, filenames}` → mirror the
  reference copy semantics + register copies in the library.

### 4.3 Image-edit provider layer (in-page provider & model — owner requirement)

- `src/providers/imagegen.js`: add `editImage({ imagePath, prompt, provider, model, size })`
  implementing ONLY the OpenAI-compatible `/v1/images/edits` multipart shape (the
  reference shape above): fields `image, prompt, model, n=1, size`, Bearer key, 120s
  timeout, `data[0].b64_json | url`. Also send `background=transparent` (supported by
  OpenAI gpt-image models); if the API rejects it (HTTP 400 whose error text names the
  field), retry the same attempt once without the field — a shape probe, not a fallback,
  and it does not consume an attempt. NO failover chain here.
- Settings: extend the `ai` setting with
  `imageGen.editProviders: [{id, label, baseUrl, apiKey}]` and
  `imageGen.brandEdit: {providerId, model, size}`.
- Page section `6. PROVIDER & MODEL TẠO ẢNH`: provider `<select>` from `editProviders` +
  "＋ Provider" inline mini-form (label, baseUrl, apiKey → saved via the existing
  settings PUT); model text input with datalist suggestions
  `gpt-image-2` (reference default), `gpt-image-1`, `gemini-2.5-flash-image`,
  `seedream-4.5`, `flux-kontext-pro`; size select `1024x1536` (default, = reference),
  `1024x1024`, `1536x1024`. Every change persists to `imageGen.brandEdit` immediately;
  the generate route reads ONLY settings (client never sends keys/model).
- If no edit provider is configured, the Start button is disabled with hint
  "Chưa cấu hình provider tạo ảnh — thêm ở mục 6." (no placeholder images, ever).

### 4.4 Front-end (public/index.html `#page-brandgen` + public/js/views/brandgen.js rewrite)

Rebuild the page to §4.1's layout and clone ALL listed FE behaviors (batch-3 concurrency,
stop/resume with done-index, per-item log lines, live grid, preview gating, chip logic,
+ Brand, copy-to-brand). Use house utilities (`$`, `el`, `api`, `api.upload`, `fileUrl`,
`toast`) and house CSS (cards/`.field`/`.seg`/`.libitem`); results also appear in
Thư viện → Brand Asset (they're library rows).

### 4.5 Feature B tests (fake fetch/LLM only)

- Prompt builders: byte-equality fixtures for the emotions prompt (with and without
  context) and the image prompt (must contain the mandatory-transparent sentence and must
  NOT contain "or clean solid background"); count clamp 1..50/default 20; filename scheme.
- No-fallback: fake fetch failing 12× → exactly 10 attempts, loud error names
  provider+model, no second base URL touched.
- Transparency gate: generate two fixture PNGs with ffmpeg (one true-alpha transparent,
  one opaque) → helper passes/fails respectively; opaque result consumes an attempt and
  triggers the appended re-ask line.
- Shape probe: fake 400 `"unknown parameter: background"` → same attempt retried without
  the field, attempt counter unchanged.
- Routes: emotions (fake LLM) round-trip; generate happy-path writes the file into a temp
  `DIRS.brand` and registers a library row; copy endpoint sanitization (`../evil` rejected).

## 5. Registry + docs (do these, keep them small)

- docs/architecture.md §7: add **P26** (final-overlay WYSIWYG: `logoRect` is the single
  source of truth for preview AND ffmpeg; per-scene logo suppressed when enabled) and
  **P27** (brand-gen fidelity: verbatim reference prompts with the single mandated
  transparency edit; primary image model ×10 then loud fail, no fallback; alpha gate).
  Pin both with named tests. Update §5/§6 tables for the new routes/stage behavior.
- docs/reference/gap-matrix.md: flip "Mascot/brand-gen — DROP" to IMPLEMENTED
  (owner order 2026-07-17; in-page provider/model made it viable).
- README feature list: one line each.

## 6. Acceptance checklist

1. `npm test` fully green including the new suites; P1–P25 untouched.
2. WYSIWYG render test proves pixel-exact logo placement (rect probe on a real ffmpeg frame).
3. Brand Kit modal: placement "final" + free drag/resize (2–40%, wheel + handle + arrows),
   snap guides, px readout, true-aspect stage; saved config survives reload.
4. Brand Asset page matches §4.1 layout/behaviors; emotions + generation work end-to-end
   against a fake provider in tests; with a real provider configured the flow is
   reference-identical (batch-3, resume, logs, grid, copy-to-brand).
5. Generated files land in `DIRS.brand/<Brand>/character <name> <emotion>.png`, appear in
   Thư viện → Brand Asset, and are pickable wherever library brand assets already are.
6. No hardcoded provider/model/key/baseURL in src/ (grep-clean); no placeholder-image lane left.
7. Commits on main, correct identity, English messages; report to the owner in Vietnamese
   with evidence paths (test output, WYSIWYG frame, screenshots of both UIs).
