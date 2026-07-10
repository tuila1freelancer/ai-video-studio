# QUALITY BAR — Kênh @TuiLa1Freelancer

> Chuẩn chất lượng hình ảnh & nội dung cho AI Video Studio, tổng hợp từ 4 bản phân tích độc lập trên 4 video của kênh (2 video 23 phút, 1 video 17 phút, 1 video 15 phút). Quy tắc chỉ được đưa vào checklist khi xuất hiện nhất quán ở ≥3/4 video; quy tắc chỉ thấy ở 1–2 video được đánh dấu **(tuỳ chọn)**.

---

## 1. Chữ ký hình ảnh (Visual Signature)

Kênh có phong cách **"HUD cyber tối trên nền vũ trụ navy"**: toàn bộ video diễn ra trên nền deep-navy gần đen (#0A0E1A ± tint), không bao giờ có cảnh nền sáng. Mỗi cảnh là một "màn hình hệ thống" tối giản với **đúng 1 focal element** — một từ khóa UPPERCASE khổng lồ phát sáng neon, một con số hero cực lớn, hoặc một diagram line-art — bao quanh bởi negative space rộng (≥50–60% khung) luôn "sống" nhờ particle trôi, glow blob thở chậm, grid phối cảnh mờ và scanline nhẹ. Chữ chia 3 tầng nghiêm ngặt: kicker monospace nhỏ giãn cách rộng (tiền tố `//`, `[ ]`, `01 /`) → heading sans extrabold khổng lồ (1 từ nhấn đổi màu accent giữa dòng) → subtext xám 1–2 dòng. Màu mang **ngữ nghĩa cố định** (cyan = AI/trung tính, hồng = rủi ro/cảnh báo, xanh lá = đúng/thành công, vàng = tiền/mục tiêu, đỏ = lỗi nghiêm trọng). HUD text tiếng Anh dạng SNAKE_CASE mờ rải ở các góc, đường bar mảnh sát mép đáy, watermark kênh thường trực — tất cả tạo cảm giác người xem đang nhìn vào giao diện một hệ thống AI đang chạy, trong khi giọng miền Nam thân mật xưng "mình – các bạn" nói nhanh ~270 âm tiết/phút.

---

## 2. SPEC cụ thể

### 2.1 Palette (khóa cứng toàn video)

| Vai trò | Màu | Hex chuẩn (dải chấp nhận) | Ngữ nghĩa |
|---|---|---|---|
| Nền chính | Deep-navy | `#0A0E1A` → `#131A33` (vignette về `#070812`) | Mọi cảnh; cấm nền trắng |
| Nền phụ (nebula/tint) | Tím/hồng/teal mờ | opacity 15–20% radial | Làm nền không phẳng |
| Accent chủ đạo (~50–60%) | Cyan | `#22D3EE`–`#38C8F5` | AI / giải pháp / trung tính / heading |
| Accent 2 | Magenta/hồng | `#FF2E88`–`#EC4899` | Rủi ro / cảm xúc / cảnh báo nhẹ / nút Subscribe |
| Accent 3 | Tím | `#7B5CFF`–`#8B5CF6` | Phụ trợ / gradient / branding / avatar |
| Accent 4 | Xanh lá neon | `#22C55E`–`#34E87B` | CHỈ cho đúng / đạt / ✓ / thành công / tiền lãi |
| Accent 5 | Vàng amber/gold | `#FBBF24`–`#FFC43D` | Tiền / mục tiêu / giá trị (dùng tiết chế) |
| Cảnh báo nặng | Đỏ | `#EF4444`–`#FF3B4E` | CHỈ cảnh lỗi/rủi ro nghiêm trọng; cả cảnh đổi tông đỏ |
| Chữ chính | Trắng lạnh | `#EAEAF5`–`#F5F7FF` | Heading |
| Subtext | Xám lam | `#8B93B0`–`#B8BCD0` | Body/mô tả |
| Card | Navy sáng hơn | `#151A30`, viền 1px accent mờ | Grid card, panel |

**Quy luật:** list đánh số xoay màu theo chu kỳ (01 cyan → 02 hồng/tím → 03 xanh lá). Tint nền được phép đổi tạm theo chương (đỏ cho chương lỗi, ấm cho chương tiền) rồi quay về navy.

### 2.2 Typography

| Tầng | Font | Cỡ | Quy tắc |
|---|---|---|---|
| T1 Heading hero | Sans geometric ExtraBold/Black (Montserrat / Be Vietnam Pro) | 90–160px (từ/số hero đơn: tới 250–400px) | LUÔN UPPERCASE, tối đa 2 dòng; 1 từ/dòng nhấn đổi màu accent; neon outer-glow blur 15–25px cùng hue; cấm serif |
| T2 Kicker/HUD | Monospace (JetBrains Mono / Space Mono) | 14–24px | UPPERCASE, letter-spacing ≥0.2em; tiền tố `//`, `[ ]`, `01 /`, `SYS_`, `PROMPT N`; đặt ngay trên heading |
| T3 Subtext/body | Sans regular | 18–32px | ≤2–3 dòng ngắn, màu xám; từ khóa in đậm + tô accent |
| Số hero | Display digits đậm | 150–400px | Màu cyan (hoặc accent chương) + glow; có thể làm ghost number mờ 8–12% chìm sau nội dung |

**Hiệu ứng chữ:** scanline mờ trên heading lớn; glitch/RGB-split CHỈ cho cảnh lỗi; gradient fill (cyan→tím, cam→vàng) và metallic/chrome cho từ hero **(tuỳ chọn)**. On-screen text luôn là **keyword 2–6 từ trích lời thoại**, không bao giờ là câu đầy đủ. Tiếng Việt đủ dấu 100% ở mọi cỡ/weight/font (test Ắ Ậ Ữ Ỡ Ề Ệ).

### 2.3 Ambient (bắt buộc mọi cảnh)

- Particle/bụi sao trôi chậm khắp nền
- ≥1 glow blob/nebula "thở" chậm ở góc
- Grid phối cảnh mờ hoặc đường bezier sáng chạy nền (theo cảnh)
- Film grain/scanline CRT rất nhẹ phủ toàn khung
- HUD trang trí: bracket `[ ]` góc khung, vòng tròn dashed xoay, đường quỹ đạo/radar

### 2.4 Layout patterns (7 mẫu hợp nhất)

| # | Mẫu | Mô tả |
|---|---|---|
| L1 | **Hero-center** | 1 từ/số khổng lồ giữa màn + kicker trên + label mono dưới (~40% số cảnh) |
| L2 | **Trái chữ – phải hình** | Kicker + heading + body lệch trái (~40%) + prop/icon/diagram/avatar phải (hoặc đảo) |
| L3 | **List dọc đánh số** | 3–5 item 01–05, số xoay màu, connector dot/line dọc |
| L4 | **So sánh A\|B** | 2 card/panel đối xứng nối line giữa; đạt = viền xanh lá ✓, lỗi = viền hồng ✗ |
| L5 | **Grid card 2–4 cột** | Card `#151A30` viền accent 1px, mỗi card = số + icon + keyword |
| L6 | **Timeline/stepper ngang** | 5–7 node, node active phát sáng, label mono dưới |
| L7 | **Radial hub-spoke** | Icon core trung tâm + 4–8 vệ tinh nối dây neon |

Mỗi cảnh **đúng 1 focal element**, negative space ≥50%, đáy khung chừa trống (~120px nếu có phụ đề).

### 2.5 Motion language

- **Xuất hiện:** heading fade + slide ~20px hoặc scale-in kèm glow bùng rồi settle; list item stagger tuần tự; số counter đếm tăng; icon line-art stroke draw-on; typewriter cho terminal
- **Nhịp cảnh:** trung bình 6–12s/cảnh, không cảnh nào tĩnh >15s không có build/motion mới
- **Mật độ:** 1 animation chính + 2–3 ambient nhỏ đồng thời; không bao giờ >2 phần tử động lớn cùng lúc; camera tĩnh hoặc push-in chậm
- **Chuyển cảnh:** cắt nhanh, flash sáng <0.5s hoặc wipe glow
- **FX nhận diện:** đường bar mảnh 3–6px sát mép đáy; equalizer theo voice **(tuỳ chọn)**; light-sweep chéo, laser đỏ quét ở chương rủi ro

### 2.6 Branding

- **Watermark:** logo "TIF AI + tuila1 freelancer" (icon tròn gradient tím-cyan + wordmark), rộng ~140px, hiện 100% thời lượng, opacity ~80%, không bị đè (vị trí: xem mục Mâu thuẫn)
- **HUD text tiếng Anh** dạng SNAKE_CASE (`SYSTEM: ACTIVE`, `STATUS_ERROR`, `TARGET_LOCKED`, `AGENT_STATE 100%`) ở ≥50% cảnh, cỡ <24px, opacity 30–50%, đặt góc, không tranh focal
- **Avatar 3D** host (hoodie đen viền neon tím-cyan): xuất hiện ~15–35% cảnh, full-body, đứng 1/3 trái hoặc phải, cỡ ~1/3 chiều cao khung, không bao giờ che chữ; có prop theo ngữ cảnh **(tuỳ chọn)**
- **Intro:** KHÔNG có intro logo — cold-open vào hook từ giây 0; chào kênh ở giây ~50–57
- **Outro:** CTA subscribe (nút pill hồng hoặc nút đỏ 3D kiểu YouTube) + avatar + card "CẢM ƠN / HẸN GẶP LẠI" neon

---

## 3. Danh mục loại cảnh (Scene Taxonomy)

| Loại cảnh | Layout | Khi nào dùng |
|---|---|---|
| **S1. Hook/Pain** | Heading trắng+hồng lệch trái hoặc icon trung tâm + chữ khổng lồ mờ sau; prop cảnh báo hồng (X, tam giác, dấu ?) | 0–60s đầu, đánh vào nỗi đau khán giả |
| **S2. Promise/Number hero** | Số khổng lồ cyan glow trung tâm + vòng HUD xoay + badge lợi ích bay quanh | Ngay sau pain: hứa hẹn giá trị bằng con số cụ thể |
| **S3. Chapter title** | Kicker mono (`// SECTION`, `PHẦN 05`, `PROMPT 3`) + heading 2 màu lệch trái + prop/ghost number phải | Mở mỗi chương/bước, ngắn 4–6s |
| **S4. Hero keyword punch** | 1–2 từ khổng lồ chiếm màn, glow/gradient/italic | Nhấn từ khóa đắt trong thoại |
| **S5. List dọc đánh số** | 3–5 item 01–05 xoay màu + connector, avatar phải (~50%) | Liệt kê bước/sai lầm/tiêu chí |
| **S6. So sánh A vs B** | 2 card/panel đối xứng, chip VS giữa; hoặc split chéo vệt sáng; đạt ✓ xanh vs lỗi ✗ hồng | Đối chiếu 2 lựa chọn, trước/sau, mẫu đạt/mẫu lỗi |
| **S7. Grid card ngang** | 2–4 card kính mờ đều nhau, số + icon + keyword | Checklist, quy trình song song, so sánh nhiều mốc |
| **S8. Timeline/stepper** | Dot progress ngang 5–7 node, node active sáng | Lộ trình (7-day plan, quy trình 5 bước), recap |
| **S9. Diagram/data** | Radar, pyramid, bar/pie, đường cong, hub-spoke, mindmap phân nhánh — mỗi diagram 1 cảnh riêng | Trực quan hóa khái niệm/số liệu |
| **S10. Terminal/prompt** | Cửa sổ code viền neon, mono gõ typewriter + cursor nhấp nháy, traffic-light dots | Mọi lúc nói về prompt/lệnh AI |
| **S11. Warning/Error** | Toàn cảnh đổi tông đỏ, chữ glitch, banner mono đỏ, laser quét, shield/tam giác đỏ | Sai lầm nghiêm trọng, rủi ro, lỗi |
| **S12. Icon/prop hero** | 1 icon line-art neon tự vẽ hoặc prop 3D glossy trung tâm + label mono | Ẩn dụ (cân, khiên, chìa khóa, đồng hồ cát) |
| **S13. Avatar spotlight** | Nhân vật 3D đứng mép/trong vòng dashed + heading đối diện | Lời khuyên cá nhân, ví dụ của host |
| **S14. CTA giữa video** | Nút pill SUBSCRIBE hồng + chuông + avatar + icon like cyan | ~50% thời lượng video |
| **S15. Outro** | 2 card "CẢM ƠN" → "HẸN GẶP LẠI" neon + nút đăng ký + câu hỏi mồi comment | 60–90s cuối |

---

## 4. CHECKLIST QUALITY BAR

### A. Visual (nền – màu – bố cục)

- ☐ A1. Nền mọi cảnh là deep-navy trong dải `#05080F`–`#141A33`; 0 cảnh nền trắng/sáng (chỉ cho phép flash chuyển cảnh <0.5s).
- ☐ A2. Toàn video chỉ dùng hệ accent khóa cứng: cyan, magenta/hồng, tím, xanh lá, vàng amber (+ đỏ riêng cho lỗi); không xuất hiện màu ngoài hệ.
- ☐ A3. Ngữ nghĩa màu bất biến: xanh lá CHỈ cho đúng/đạt/✓; hồng cho sai lầm/cảnh báo/✗; đỏ CHỈ cho lỗi/rủi ro nghiêm trọng; vàng cho tiền/mục tiêu; cyan cho AI/trung tính.
- ☐ A4. Mỗi cảnh có đúng 1 focal element chính; không có 2 heading cạnh tranh trong cùng khung.
- ☐ A5. Negative space ≥50% diện tích khung ở mọi cảnh.
- ☐ A6. Cảnh cảnh báo/lỗi đổi cả tông cảnh sang họ đỏ/hồng rồi quay về navy ngay cảnh sau.
- ☐ A7. List đánh số dùng số 2 chữ số (01/02/03…) xoay màu theo chu kỳ cyan → hồng/tím → xanh lá.
- ☐ A8. Icon minh họa là line-art neon tự vẽ (stroke draw-on) hoặc 3D neon cùng palette; không dùng ảnh stock/emoji hệ thống.

### B. Motion

- ☐ B1. Ambient sống ở 100% cảnh: particle trôi + ≥1 glow thở chậm + grain/scanline nhẹ.
- ☐ B2. Mỗi cảnh có đúng 1 animation chính (fade+slide / scale-in+glow / draw-on / typewriter / counter) + tối đa 2–3 ambient nhỏ; không bao giờ >2 phần tử động lớn đồng thời.
- ☐ B3. Thời lượng cảnh trung bình 6–12s; không cảnh nào tĩnh >15s mà không có build/motion mới.
- ☐ B4. Camera tĩnh hoặc push-in chậm; không zoom/lia mạnh.
- ☐ B5. Đường bar mảnh 3–6px chạy sát mép đáy màn hình hiện ở ≥90% cảnh (gradient cyan→magenta hoặc progress theo accent chương — xem Mâu thuẫn M3).
- ☐ B6. Glitch/RGB-split chỉ xuất hiện ở cảnh lỗi/cảnh báo, không dùng trang trí bừa.

### C. Typography

- ☐ C1. Heading luôn UPPERCASE sans geometric ExtraBold 90–160px (hero đơn tới 400px), có neon glow; tuyệt đối không serif.
- ☐ C2. Cấu trúc 3 tầng bắt buộc: kicker mono UPPERCASE 14–24px letter-spacing ≥0.2em (tiền tố `//`, `[ ]`, `01 /`) → heading lớn → subtext ≤2–3 dòng xám.
- ☐ C3. Mỗi heading có đúng 1 từ/cụm hoặc dòng 2 đổi màu accent; không tô accent quá 1 vị trí/heading.
- ☐ C4. On-screen text là keyword 2–6 từ trích lời thoại; không bao giờ hiển thị câu thoại đầy đủ trên canvas.
- ☐ C5. Tiếng Việt đủ dấu, render đúng 100% ở mọi cỡ/weight/font kể cả mono uppercase và heading 160px+ (test: Ắ Ậ Ữ Ỡ Ề Ệ Ấ Đ).
- ☐ C6. HUD text mono tiếng Anh SNAKE_CASE (`SYSTEM:`, `STATUS_`, `DATA_`) ở ≥50% cảnh, cỡ <24px, opacity 30–50%, đặt góc, không đè focal.
- ☐ C7. Cửa sổ code/terminal luôn gõ typewriter kèm cursor nhấp nháy; chrome macOS 3 chấm + syntax highlight ≥3 màu **(tuỳ chọn — chỉ thấy rõ ở 1 video)**.

### D. Kịch bản (Script)

- ☐ D1. Cold-open thẳng vào hook từ giây 0, không intro logo; hook pain→promise gói trong 35–60s đầu.
- ☐ D2. Promise nêu giá trị cụ thể (con số, framework) trước phút 1:30; chào kênh chèn ngắn ~10s sau hook.
- ☐ D3. Nội dung chia chương/bước đánh số rõ; số đọc bằng lời ("bước thứ hai", "sai lầm thứ tư") khớp 100% với số hiển thị on-screen.
- ☐ D4. Có CTA giữa video tại ~50% thời lượng (lưu/đăng ký/comment) và CTA cuối trong 60–90s trước khi hết (like + comment mồi + đăng ký).
- ☐ D5. Câu hỏi mồi comment cụ thể ở outro (hứa dùng comment làm nội dung video sau).
- ☐ D6. Xưng hô cố định "mình – bạn/các bạn" toàn video (xem Mâu thuẫn M5), giọng mentor thân mật, câu ngắn, nhiều liệt kê đánh số.
- ☐ D7. Outro chuẩn: CTA subscribe + card "CẢM ƠN" → "HẸN GẶP LẠI"; không endcard trống dài.

### E. Voice & Phụ đề

- ☐ E1. Tốc độ voice-over 260–280 âm tiết/phút, đều, gần như không nghỉ dài.
- ☐ E2. Quyết định phụ đề burned-in phải nhất quán toàn video: hoặc KHÔNG có (thông tin truyền bằng keyword on-screen), hoặc CÓ karaoke-chunk 2–6 từ đáy giữa (~92% chiều cao), sans bold ~44–52px 1 màu đồng nhất có viền tối, đổi chunk mỗi 1–2s (xem Mâu thuẫn M1).
- ☐ E3. Nếu có phụ đề: chừa vùng an toàn đáy ~120px, không phần tử nào của cảnh lấn vào; dấu tiếng Việt trong phụ đề đúng 100%.

### F. Kỹ thuật & Branding

- ☐ F1. Watermark logo kênh hiện 100% thời lượng, rộng ~140px, opacity ~80%, không bị element nào đè (vị trí: xem Mâu thuẫn M2).
- ☐ F2. Video ~15–23 phút có ~100–140 cảnh khác nhau (mật độ ≥5–6 cảnh/phút).
- ☐ F3. Avatar 3D host xuất hiện định kỳ (tối thiểu mỗi 8–10 cảnh có 1 lần), đứng 1/3 trái/phải, không che focal/chữ.
- ☐ F4. Tương phản chữ/nền luôn rất cao (chữ trắng/neon trên nền gần đen, mục tiêu ≥7:1).
- ☐ F5. Không dùng tông pastel, không drop-shadow mềm kiểu UI sáng — mọi độ sâu tạo bằng glow/viền neon.

---

## 5. Mâu thuẫn giữa 4 phân tích — CẦN CON NGƯỜI QUYẾT

| # | Vấn đề | Phân tích nói gì | Đề xuất xử lý |
|---|---|---|---|
| **M1** | **Phụ đề burned-in** | Video 1 & 2 (23'): KHÔNG có phụ đề đáy (chỉ dùng auto-caption YouTube). Video 3 (17'): CÓ karaoke chunk màu **cyan #38BDF8**. Video 4 (15'): CÓ karaoke chunk màu **vàng gold #FFC43D**. | Kênh đang chuyển style. Chọn 1 chuẩn cho app: khuyến nghị làm thành **tùy chọn bật/tắt**, mặc định theo video mới nhất (có phụ đề); nếu bật thì phải chọn 1 màu cố định (cyan hay gold?). |
| **M2** | **Vị trí watermark** | Video 1, 2, 4: góc **TRÊN-PHẢI**. Video 3: góc **PHẢI-DƯỚI**. | Chọn trên-phải (3/4 video); nhưng nếu bật phụ đề đáy thì trên-phải cũng tránh xung đột tốt hơn. |
| **M3** | **Đường bar mép đáy** | Video 1: đường **gradient cyan→magenta trang trí tĩnh**. Video 3 & 4: **progress bar chạy trái→phải, đổi màu theo accent chương**. Video 2: không nhắc rõ. | Quyết định: bar trang trí tĩnh hay progress thực theo tiến độ chương? (Progress bar hữu ích hơn cho retention.) |
| **M4** | **Nhịp cắt cảnh** | Video 1 & 2 (23'): trung bình 8–14s/cảnh. Video 3 & 4 (15–17'): 5–10s/cảnh, nhanh hơn rõ. | Có thể là hàm của thời lượng video — video ngắn cắt nhanh hơn. Cân nhắc quy tắc theo thời lượng thay vì 1 con số cứng. |
| **M5** | **Xưng hô** | Video 1, 2, 4: "mình – các bạn". Video 3: "tui" ("TUI là 1 Freelancer"). | Chọn "mình" làm mặc định (3/4); "tui" chỉ dùng khi chơi chữ với tên kênh. |
| **M6** | **Số accent mỗi cảnh** | Phân tích 3: mỗi cảnh khóa đúng **1 màu accent**, không trộn ≥3. Phân tích 1 & 2: list/card trong 1 cảnh dùng **3 màu xoay** (01 cyan/02 hồng/03 lá). | Hòa giải khả dĩ: cảnh hero/keyword khóa 1 accent; riêng cảnh list/grid được phép xoay màu theo số. Cần xác nhận. |
| **M7** | **Cảnh nền sáng "đảo cực"** | Phân tích 1, 2, 3: cấm tuyệt đối nền sáng. Phân tích 4: cho phép 2–3 cảnh punch nền vàng/kem, <5% thời lượng. | Quyết định có cho phép "punch scene" nền sáng làm điểm nhấn hay cấm hẳn. |
| **M8** | **Style icon/prop** | Video 1: line-art neon stroke draw-on thuần. Video 2–4: thêm icon **3D glossy/gradient glassy** (chìa khóa, trophy, pyramid). | Kênh đang tiến hóa sang 3D. Chọn 1 trong 2 hoặc cho phép cả hai nhưng không trộn trong cùng 1 cảnh. |
| **M9** | **Cấu trúc thân bài** | Video 2 có đoạn "mục lục nói nhanh 14 phần" trong 3 phút đầu rồi mới đi sâu — không thấy ở 3 video còn lại. | Coi là **tuỳ chọn** cho video dạng roadmap/nhiều phần, không bắt buộc. |
| **M10** | **Hex xanh lá & cyan lệch nhau** | Xanh lá: #22C55E / #34E87B / #34D399 / #2EE6A8; cyan: #22D3EE / #2EE6D6 / #38BDF8 / #38C8F5. | Sai số đo màu từ frame nén. Chốt 1 token/màu cho design system (đề xuất: cyan `#22D3EE`, lá `#34D399`) và cho phép dải ±10%. |