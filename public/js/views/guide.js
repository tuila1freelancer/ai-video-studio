// The manual, inside the app.
//
// Content is data, not markup: one array of sections, each a list of typed blocks. That is what
// makes the search box possible — it filters the same structure the page renders from, so a
// section can never be findable and unreadable, or readable and unfindable.
//
// Every "Mở …" button navigates to the real screen instead of describing where it is. A manual
// that can open the thing it is explaining stops being a document and starts being part of the UI.
import { $, $$, esc } from '../ui/dom.js';
import { registerPageHook, switchPage } from './nav.js';
import { uiLang } from '../i18n.js';

/* ---------------------------------------------------------------------------
   CONTENT
   Block types:
     h      sub-heading
     p      paragraph                     (**bold**, `code`)
     steps  numbered walkthrough          [{ n, t }]
     list   bullets                       [str]
     defs   control reference             [[name, meaning]]
     note   callout                       { kind: tip|warn|cost|key, text }
     where  breadcrumb to the screen
     go     buttons that open that screen [{ label, act, arg }]
     grid   feature cards                 [{ i, t, d }]
     keys   shortcut table                [[combo, meaning]]
--------------------------------------------------------------------------- */

const SECTIONS = [
  // ======================================================================= 1
  {
    id: 'start', grp: 'Bắt đầu', ic: '🚀', title: 'Ba phút đầu tiên',
    lede: 'Từ một dòng chủ đề đến video hoàn chỉnh, không cần chạm vào bất cứ cài đặt nào.',
    blocks: [
      { t: 'steps', items: [
        { n: 'Mở Trang chủ, gõ chủ đề', t: 'Một câu là đủ: *"5 thói quen buổi sáng của người thành công"*. Chọn tỉ lệ khung hình bên dưới — **9:16** cho TikTok/Reels/Shorts, **16:9** cho YouTube.' },
        { n: 'Bấm “Tạo video tự động”', t: 'App tự viết kịch bản, dựng cảnh, lồng tiếng, làm phụ đề karaoke, chọn nhạc, render và ghép. Bạn không phải làm gì thêm.' },
        { n: 'Theo dõi dây chuyền', t: 'Màn hình chuyển sang **Tạo Video**. Thanh tiến độ chạy qua 5 chặng B2 → B7, mỗi chặng ghi rõ đang làm gì. Có thể đóng app rồi mở lại — tiến độ vẫn còn.' },
        { n: 'Xem, sửa, tải về', t: 'Video xong nằm ở cuối trang, kèm phụ đề `.SRT`, ảnh bìa và metadata cho từng nền tảng. Không ưng cảnh nào thì sửa riêng cảnh đó, không phải làm lại cả video.' },
      ] },
      { t: 'note', kind: 'tip', text: 'Lần chạy đầu nên để **mọi cài đặt mặc định**. App đã được chỉnh sẵn theo bộ thông số cho kết quả ổn định nhất. Khi đã quen nhịp, hãy mở cột Config bên phải và tinh chỉnh từng thứ.' },
      { t: 'note', kind: 'cost', text: 'Muốn duyệt trước khi tốn tiền lồng tiếng? Bật **“Dựng cảnh trước — duyệt xong mới lồng tiếng”** trong Config → Nâng cao. App dựng toàn bộ hình ảnh rồi dừng lại chờ bạn.' },
      { t: 'go', items: [{ label: '🏠 Mở Trang chủ', act: 'page', arg: 'home' }, { label: '🎬 Mở Tạo Video', act: 'page', arg: 'studio' }] },
    ],
  },

  // ======================================================================= 2
  {
    id: 'map', grp: 'Bắt đầu', ic: '🗺', title: 'Bản đồ giao diện',
    lede: 'Sáu màn hình trên thanh trên cùng, và những gì luôn nằm bên phải nó.',
    blocks: [
      { t: 'grid', items: [
        { i: '🏠', t: 'Trang chủ', d: 'Ô nhập chủ đề + thư viện video đã làm. Nơi bắt đầu mọi thứ.' },
        { i: '🎬', t: 'Tạo Video', d: 'Bàn làm việc chính: nhập liệu, dây chuyền, lưới cảnh, cột cấu hình.' },
        { i: '📚', t: 'Thư viện', d: 'Brand asset, nhạc nền, hiệu ứng âm thanh, font chữ.' },
        { i: '🎨', t: 'Brand Asset', d: 'Xưởng sinh nhân vật thương hiệu bằng AI, nền trong suốt.' },
        { i: '✂️', t: 'Edit Video', d: 'Cắt video có sẵn, bóc lời thoại, phủ đồ hoạ lên footage.' },
        { i: '📖', t: 'Hướng dẫn', d: 'Trang bạn đang đọc.' },
      ] },
      { t: 'h', text: 'Góc phải thanh trên cùng' },
      { t: 'defs', items: [
        ['Ô chọn kênh', 'Kênh đang làm việc. Mỗi kênh có thư mục lưu, brand kit, giọng đọc và cấu hình riêng — đổi kênh là đổi toàn bộ ngữ cảnh sản xuất.'],
        ['⚙ (cạnh ô kênh)', 'Quản lý kênh: tạo kênh mới, đổi thư mục, đặt watermark.'],
        ['⚠ Thiếu công cụ', 'Chỉ hiện khi máy thiếu ffmpeg / Chrome / whisper. Im lặng là bình thường; hiện lên là phải xử lý, nếu không render sẽ hỏng.'],
        ['Huy hiệu bản quyền', 'Trạng thái license và thiết bị đang kích hoạt.'],
        ['⚙️ AI Setting', 'Khoá API, model, giọng đọc, engine phụ đề, kết nối YouTube/Facebook.'],
      ] },
      { t: 'note', kind: 'key', text: 'Nhấn **⌘K** (hoặc **Ctrl K**) ở bất cứ đâu để mở bảng lệnh: nhảy màn hình, mở modal, áp preset, mở lại dự án gần đây — tất cả bằng bàn phím.' },
    ],
  },

  // ======================================================================= 3
  {
    id: 'home', grp: 'Màn hình', ic: '🏠', title: 'Trang chủ',
    lede: 'Ô lệnh để tạo video, và toàn bộ video đã làm bày ra bên dưới.',
    blocks: [
      { t: 'where', text: 'Thanh trên cùng → Trang chủ' },
      { t: 'defs', items: [
        ['Ô nhập chủ đề', 'Gõ ý tưởng bằng tiếng Việt. Càng cụ thể càng tốt — “5 thói quen buổi sáng” cho kết quả sắc hơn “thói quen tốt”.'],
        ['Tỉ lệ khung hình', 'Quyết định khổ video. Đổi được sau, nhưng đổi trước thì bố cục cảnh được thiết kế đúng khổ ngay từ đầu.'],
        ['🗂 Tác vụ', 'Mọi việc đang chờ / đang chạy / vừa xong trên **tất cả** dự án. Đây là nơi trả lời “app đang làm gì lúc này”.'],
        ['Hàng loạt', 'Dán nhiều chủ đề, mỗi dòng một video. App xếp hàng và chạy lần lượt.'],
        ['🛰 Trợ lý', 'Gợi ý chủ đề theo xu hướng, lịch sản xuất, lịch đăng cố định hằng tuần.'],
        ['Tạo video tự động', 'Chạy ngay với cấu hình mặc định của kênh đang chọn.'],
      ] },
      { t: 'h', text: 'Thư viện video' },
      { t: 'p', text: 'Hai tab **Short (dọc)** và **Landscape** tách video theo khổ. Bấm vào một video để mở lại dự án của nó — kèm nguyên vẹn kịch bản, từng cảnh, nhật ký và cấu hình đã dùng.' },
      { t: 'go', items: [{ label: '🏠 Mở Trang chủ', act: 'page', arg: 'home' }] },
    ],
  },

  // ======================================================================= 4
  {
    id: 'studio', grp: 'Màn hình', ic: '🎬', title: 'Tạo Video — bàn làm việc',
    lede: 'Ba cột: nhập liệu bên trái, tiến trình ở giữa, cấu hình bên phải.',
    blocks: [
      { t: 'where', text: 'Thanh trên cùng → Tạo Video' },
      { t: 'h', text: 'Cột trái — đầu vào' },
      { t: 'p', text: 'Ô nhập nhận **ba loại** nội dung và tự nhận diện:' },
      { t: 'defs', items: [
        ['Văn bản', 'Một chủ đề. AI viết kịch bản mới hoàn toàn, vừa khít thời lượng bạn chọn.'],
        ['JSON kịch bản', 'Dán kịch bản có sẵn theo đúng khuôn scenes JSON. Lời thoại được giữ **nguyên văn**, không viết lại.'],
        ['Link bài viết', 'Dán `https://…`. Bấm **🔗 Lấy thông tin** để app bóc nội dung bài viết ra một khung riêng bên dưới, dùng làm tư liệu nghiên cứu.'],
      ] },
      { t: 'note', kind: 'warn', text: 'Nội dung bài viết lấy về nằm ở khung riêng, **không** bị nhét ngược vào ô chủ đề. Đó là chủ ý: nếu nó nằm trong ô chủ đề, engine sẽ hiểu nhầm là kịch bản của bạn và giữ nguyên từng chữ thay vì viết bài mới từ tư liệu.' },
      { t: 'defs', items: [
        ['🖼 Tìm ảnh AI', 'Tìm ảnh theo chủ đề, xem trước rồi thêm thẳng vào asset của dự án.'],
        ['File ảnh / video', 'Kéo thả hoặc chọn file. Ảnh của bạn sẽ được dùng làm hero trong cảnh nếu bật Image-full.'],
        ['▶ Bắt đầu', 'Chạy dây chuyền với cấu hình đang hiển thị ở cột phải.'],
        ['Danh sách dự án', 'Mọi dự án của kênh này. Bấm để mở lại; “Xoá tất cả” dọn sạch danh sách.'],
      ] },
      { t: 'h', text: 'Cột giữa — dự án đang mở' },
      { t: 'defs', items: [
        ['▶ Xem nháp', 'Phát thử cả video ngay từ trang cảnh sống — không tốn một giây render nào.'],
        ['📱 Đổi tỉ lệ', 'Nhân bản dự án sang khổ khác. Giữ nguyên giọng đọc và phụ đề, chỉ dàn lại bố cục rồi render.'],
        ['♻️ Làm lại từ đầu', 'Chạy lại cùng chủ đề, cùng cấu hình, thành một dự án mới. Bản cũ vẫn nguyên để so sánh.'],
        ['🧲 Lấy asset từ dự án khác', 'Mượn lại bộ ảnh/asset đã dùng ở dự án trước.'],
        ['📤 Xuất nền tảng', 'Xuất bản sao đúng chuẩn từng nền tảng. Vượt trần thời lượng thì app cắt fade — và luôn hỏi trước.'],
        ['🎬 Render lại', 'Dựng lại toàn bộ clip rồi ghép.'],
        ['🔤 Sửa lỗi tiếng Việt', 'Chỉ hiện khi app quét thấy cảnh bị mất dấu hoặc đè dòng. Dựng lại đúng những cảnh đó rồi ghép lại.'],
        ['⏹ Dừng / ▶ Tiếp tục', 'Dừng giữa chừng an toàn, tiếp tục từ đúng chỗ đã dừng.'],
        ['📝 SRT · 📊 Metadata', 'Sửa timeline phụ đề; xem tiêu đề/mô tả/hashtag cho từng nền tảng.'],
      ] },
      { t: 'go', items: [{ label: '🎬 Mở Tạo Video', act: 'page', arg: 'studio' }] },
    ],
  },

  // ======================================================================= 5
  {
    id: 'pipeline', grp: 'Sản xuất', ic: '⚙️', title: 'Dây chuyền B2 → B7',
    lede: 'Năm chặng, chạy theo thứ tự hình-trước-tiếng-sau để bạn duyệt được storyboard trước khi tốn credit.',
    blocks: [
      { t: 'defs', items: [
        ['B2 · Kịch bản', 'AI viết lời thoại, chia cảnh, đặt hook và CTA. Chiếm ~8% thời gian.'],
        ['B5 · Dựng cảnh', 'AI viết đồ hoạ + hoạt ảnh riêng cho từng cảnh. Đây là chặng quyết định video đẹp hay xấu (~25%).'],
        ['B34 · TTS + Phụ đề', 'Lồng tiếng và bóc mốc thời gian từng từ để làm phụ đề karaoke (~32%).'],
        ['B6 · Render', 'Quay từng cảnh thành clip video (~25%).'],
        ['B7 · Ghép & Mix', 'Nối clip, chuyển cảnh, trộn nhạc nền, in phụ đề, đóng dấu logo (~10%).'],
      ] },
      { t: 'note', kind: 'tip', text: 'Thứ tự **dựng cảnh trước, lồng tiếng sau** là cố ý: bạn xem được toàn bộ hình ảnh và sửa thoải mái ở chặng B5, trước khi bất kỳ đồng credit TTS nào bị tiêu.' },
      { t: 'h', text: 'Nhật ký xử lý' },
      { t: 'p', text: 'Khung nhật ký dưới thanh tiến độ ghi lại từng bước, **sống sót qua cả việc tắt app**. Video làm tuần trước vẫn kể lại đầy đủ câu chuyện của nó.' },
      { t: 'defs', items: [
        ['Ô chọn lần chạy', 'Một dự án chạy lại nhiều lần thì mỗi lần là một nhật ký riêng.'],
        ['Lọc ⚠ / ⛔', 'Chỉ hiện cảnh báo hoặc lỗi — cách nhanh nhất để tìm chỗ hỏng.'],
        ['Tìm trong nhật ký', 'Lọc theo từ khoá.'],
        ['📋 · ⬇ · ⛶', 'Sao chép, tải `.txt`, phóng to khung nhật ký.'],
      ] },
      { t: 'note', kind: 'warn', text: 'Khi bạn cuộn lên đọc, nhật ký **tự giữ vị trí** thay vì nhảy xuống dòng mới. Bấm dải “đang giữ vị trí” ở đáy để theo dõi tiếp.' },
    ],
  },

  // ======================================================================= 6
  {
    id: 'scenes', grp: 'Sản xuất', ic: '🎞', title: 'Lưới cảnh & Scene Studio',
    lede: 'Mỗi cảnh là một đơn vị độc lập — sửa một cảnh không đụng đến 20 cảnh còn lại.',
    blocks: [
      { t: 'h', text: 'Thanh công cụ trên lưới' },
      { t: 'defs', items: [
        ['Chọn tất cả', 'Tick nhiều cảnh rồi thao tác hàng loạt.'],
        ['🎙 Voice đã chọn', 'Lồng tiếng lại đúng những cảnh được tick.'],
        ['🔄 HTML đã chọn', 'Bắt AI dựng lại visual cho những cảnh được tick.'],
        ['🎬 Render đã chọn', 'Quay lại clip của những cảnh được tick.'],
        ['🎬 Render + Ghép', 'Render toàn bộ rồi nối thành video hoàn chỉnh.'],
        ['⬇ scenes.json · 📋 Copy JSON', 'Xuất kịch bản chuẩn để lưu trữ, chỉnh tay hoặc dùng lại cho dự án sau.'],
      ] },
      { t: 'h', text: 'Năm nút trên mỗi thẻ cảnh' },
      { t: 'defs', items: [
        ['🎬 Scene Studio', 'Mở xưởng chỉnh sửa đầy đủ của cảnh đó.'],
        ['▶ Xem trước', 'Phát hoạt ảnh kèm tiếng, không cần render.'],
        ['🎙 Tạo lại giọng', 'Lồng tiếng lại riêng cảnh này.'],
        ['✨ Dựng lại visual', 'AI thiết kế lại hình ảnh cảnh này từ đầu.'],
        ['🎞 Render cảnh', 'Quay lại clip của riêng cảnh này.'],
      ] },
      { t: 'h', text: 'Năm tab trong Scene Studio' },
      { t: 'defs', items: [
        ['📝 Lời thoại', 'Sửa câu chữ rồi lưu — app tự lồng tiếng lại và dựng lại phụ đề khớp từng từ.'],
        ['✨ Visual', 'Mô tả bạn muốn thấy gì, AI dựng lại hình ảnh theo mô tả đó.'],
        ['&lt;/&gt; HTML', 'Sửa thẳng mã nguồn cảnh (**⌘↵** để áp dụng), hoặc **Sửa bằng lời** — nói bạn muốn đổi gì, AI chỉnh đúng chỗ đó và giữ nguyên phần còn lại. “Bỏ bản sửa tay” trả cảnh về bản AI dựng.'],
        ['🔊 Âm thanh', 'Gắn hiệu ứng âm thanh từ Thư viện → SFX cho riêng cảnh này, rồi ghép lại video.'],
        ['🕘 Takes', 'Mọi phiên bản đã dựng của cảnh này. Bấm để quay lại bản cũ bất cứ lúc nào.'],
      ] },
      { t: 'note', kind: 'tip', text: '**📸 Contact sheet** ghép khung hình giữa của mọi cảnh thành một tấm ảnh duy nhất — duyệt cả storyboard trong một cái nhìn thay vì mở từng cảnh.' },
    ],
  },

  // ======================================================================= 7
  {
    id: 'config', grp: 'Sản xuất', ic: '🎛', title: 'Cột Config đầu ra',
    lede: 'Năm nhóm cài đặt quyết định video ra sao. Lưu lại thành preset để không phải chỉnh lần hai.',
    blocks: [
      { t: 'where', text: 'Tạo Video → cột phải' },
      { t: 'note', kind: 'tip', text: 'Thanh trên cùng của cột cho phép **lưu toàn bộ panel thành preset của kênh** (💾) và đặt preset mặc định (⋯). Mọi video sau của kênh sẽ mở sẵn cấu hình đó.' },

      { t: 'h', text: '🎞 Định dạng & chất lượng' },
      { t: 'defs', items: [
        ['Phong cách video', 'Bộ màu + font + tinh thần đồ hoạ áp cho mọi cảnh. Chọn từ bộ mẫu, hoặc mô tả bằng lời để AI thiết kế riêng một phong cách cho kênh.'],
        ['Mật độ chuyển động', '**Tối giản** cho nội dung nghiêm túc · **Cân bằng** cho hầu hết trường hợp · **Dày đặc** cho video giải trí nhịp nhanh.'],
        ['Định hướng sáng tạo', 'Một câu ghi chú áp cho **mọi** cảnh, ví dụ “trẻ trung năng động” hay “nghiêm túc tối giản”.'],
        ['Model AI riêng cho HyperFrame', 'Khâu dựng cảnh đẹp nhất với model mạnh. Để trống là dùng chung model ở AI Setting.'],
        ['🎨 Scene nhất quán', 'Khoá nền và màu chữ chính cho toàn video — trông như một bộ, không như 20 cảnh rời.'],
        ['🖼️ Image-full', 'Ảnh bạn tải lên trở thành hero giữa khung, chiếm 75% và có hiệu ứng Ken Burns.'],
        ['🎭 Asset thương hiệu tự động', 'AI tự chọn nhân vật/concept art từ Thư viện → Brand cho từng cảnh hợp nội dung, giữ nền trong suốt. Cảnh nào không hợp thì để trống.'],
        ['🎥 Overlay mode', 'Dựng đồ hoạ trong suốt rồi ghép lên video nền có sẵn của bạn.'],
        ['FPS · Chất lượng', '30 hoặc 60 khung hình/giây; 1080p hoặc 4K.'],
        ['Ngôn ngữ video', '13 ngôn ngữ, hoặc để **Tự nhận theo chủ đề**. Quyết định cả lời thoại, chữ trên màn hình lẫn giọng đọc.'],
        ['Tỉ lệ khung hình', '9:16 · 16:9 · 1:1 · 4:5.'],
        ['Chế độ thời lượng', '**🎯 Mục tiêu** — kịch bản được viết vừa khít thời lượng bạn chọn (±12%). **🪄 Tự động theo kịch bản** — dán kịch bản chi tiết, giữ nguyên văn, video dài theo nội dung.'],
      ] },

      { t: 'h', text: '🏷 Thương hiệu kênh' },
      { t: 'p', text: 'Tóm tắt Brand Kit đang áp, nút mở trình chỉnh Brand Kit, và ô chọn **font thương hiệu cho riêng video này** (áp cho chữ đồ hoạ trong cảnh). Font riêng tải ở Thư viện → Font chữ.' },

      { t: 'h', text: '🎙 Giọng đọc & nhạc' },
      { t: 'defs', items: [
        ['Chọn giọng đọc', 'Mở kho giọng, nghe thử trước khi chọn.'],
        ['🎵 Nhạc nền', 'Chọn tay từ Thư viện, hoặc bật **Nhạc nền tự động**.'],
        ['🎼 AI sound design', 'AI chọn nhạc nền hợp nội dung và đặt hiệu ứng âm thanh đúng chỗ.'],
        ['🔇 Không lời', 'Video chỉ có nhạc + đồ hoạ + phụ đề. Không tốn một credit TTS nào.'],
      ] },

      { t: 'h', text: '⚙ Nâng cao' },
      { t: 'defs', items: [
        ['🔀 Chuyển cảnh điện ảnh', 'Mọi cảnh nối nhau bằng dissolve ngắn, kèm 1–2 chuyển cảnh “hero” theo vai trò kể chuyện: zoom vào cảnh chốt, fade đen vào CTA. Tắt để dùng cắt cứng.'],
        ['Kiểu chuyển cảnh', '**Tự động theo nhịp kể** (khuyên dùng), Đa dạng xoay vòng, hoặc chọn cứng một trong 11 kiểu.'],
        ['📊 Tạo Metadata', 'Sinh tiêu đề, mô tả, hashtag cho từng nền tảng. Lưu được nhiều **phong cách SEO** có tên.'],
        ['Tự động ghép (B7)', 'Tắt nếu bạn muốn dừng lại sau khi render, tự ghép sau.'],
        ['🧐 Duyệt từng cảnh trước khi ghép', 'Dừng trước bước ghép để bạn xem lại từng clip.'],
        ['🎬 Dựng cảnh trước — duyệt xong mới lồng tiếng', 'Dựng toàn bộ hình rồi **dừng**. Bạn duyệt/chỉnh thoải mái, chưa tốn phí lồng tiếng; ưng ý mới bấm “Lồng tiếng & Render”.'],
        ['TTS song song · Render song song', 'Chạy nhiều việc cùng lúc — nhanh hơn, nhưng máy phải khoẻ.'],
      ] },
      { t: 'note', kind: 'cost', text: 'Dòng ước tính ở cuối nhóm thời lượng cho biết video sẽ dài bao nhiêu và tốn khoảng bao nhiêu **trước khi** bạn bấm chạy.' },
    ],
  },

  // ======================================================================= 8
  {
    id: 'subtitle', grp: 'Sản xuất', ic: '💬', title: 'Xưởng phụ đề',
    lede: 'Ba cột: bộ mẫu, chữ và màu, khung nền và vị trí. Mọi thứ xem thử được ngay trên khung hình thật.',
    blocks: [
      { t: 'where', text: 'Tạo Video → Config → 💬 Phụ đề' },
      { t: 'defs', items: [
        ['Kiểu hiển thị', '**🎤 Karaoke** — nhấn từng từ theo giọng đọc. **📄 Thường** — dòng tĩnh.'],
        ['Cách ngắt dòng', '**✨ Tự nhiên** (cụm 5–7 từ) · **📝 Theo câu** · **🔢 Theo số từ** do bạn đặt.'],
      ] },
      { t: 'note', kind: 'tip', text: 'Mọi cách ngắt đều dựng lại từ **mốc thời gian từng từ** của chính giọng đọc, nên phụ đề không bao giờ lệch tiếng.' },
      { t: 'h', text: 'Cột 1 — Bộ mẫu & xem thử' },
      { t: 'p', text: 'Chọn một bộ mẫu để lấy toàn bộ kiểu chữ, màu, viền, vị trí cùng lúc. Chỉnh xong lưu lại thành bộ mẫu riêng. Nút **🎞 Xem trên khung thật** dựng đúng một khung hình đi qua đúng đường ghép cuối — thấy sao thì video ra vậy.' },
      { t: 'h', text: 'Cột 2 — Chữ & màu' },
      { t: 'list', items: [
        'Font, độ đậm, cỡ chữ (30–160), kiểu chữ HOA/thường/Hoa Đầu, giãn chữ, bề ngang/bề dọc, nghiêng khung, in nghiêng · gạch chân · gạch ngang.',
        'Màu **từ đang đọc** và **từ chưa đọc**, kèm độ mờ của phần chưa đọc.',
        'Viền, bóng đổ và quầng sáng — mỗi thứ có màu và độ dày riêng.',
      ] },
      { t: 'h', text: 'Cột 3 — Khung nền, vị trí, chuyển động' },
      { t: 'list', items: [
        'Khung nền sau chữ: màu, độ mờ, bo góc, padding bốn cạnh, viền khung.',
        'Vị trí: canh ngang, vị trí dọc, cách đáy, lề hai bên, ký tự tối đa mỗi dòng, số dòng tối đa.',
        'Cách nhấn từ đang đọc: **đổi màu** · **khối màu chạy theo từ** · **phóng to từ**. Kèm hiện dần từng từ và thời gian mờ vào/mờ ra.',
      ] },
      { t: 'note', kind: 'warn', text: 'Phụ đề luôn được in **sau khi** ghép video hoàn chỉnh, không vẽ vào từng cảnh. Nhờ vậy đổi font hay đổi màu chỉ tốn một lần in lại, không phải render lại toàn bộ cảnh.' },
    ],
  },

  // ======================================================================= 9
  {
    id: 'brand', grp: 'Sản xuất', ic: '🏷', title: 'Brand Kit của kênh',
    lede: 'Logo, tên kênh, watermark, giọng đọc và font — đặt một lần, mọi video sau đều mang dấu ấn đó.',
    blocks: [
      { t: 'where', text: 'Config → 🏷 Thương hiệu kênh → “Chỉnh Brand Kit của kênh…”' },
      { t: 'defs', items: [
        ['Tên kênh trên video', 'Chuỗi chữ hiện trong cảnh.'],
        ['Logo', 'Nhận PNG, JPG, WebP, SVG, HEIC… App tự chuyển đổi.'],
        ['Đóng dấu logo lên video hoàn chỉnh', 'Vị trí nhanh sát bốn góc, cỡ logo theo % khung hình, độ mờ.'],
        ['Watermark trôi chậm', 'Chữ trôi chậm quanh khung để chống ăn cắp nội dung — chỉnh được nội dung, tốc độ, cỡ và độ mờ.'],
        ['Mặc định của kênh', 'Provider giọng đọc, model LLM, engine phụ đề và font thương hiệu — áp cho mọi video mới của kênh.'],
      ] },
      { t: 'go', items: [{ label: '🏷 Mở Brand Kit', act: 'brandkit' }] },
    ],
  },

  // ====================================================================== 10
  {
    id: 'library', grp: 'Màn hình', ic: '📚', title: 'Thư viện tài nguyên',
    lede: 'Bốn kho dùng chung cho mọi dự án.',
    blocks: [
      { t: 'where', text: 'Thanh trên cùng → Thư viện' },
      { t: 'grid', items: [
        { i: '🎨', t: 'Brand Asset', d: 'Nhân vật, concept art, ảnh nền theo thư mục brand. AI lấy từ đây khi bật “Asset thương hiệu tự động”.' },
        { i: '🎵', t: 'Nhạc nền', d: 'Kho BGM. Xuất hiện trong ô chọn nhạc ở Config.' },
        { i: '🔊', t: 'SFX', d: 'Hiệu ứng âm thanh, gắn cho từng cảnh trong Scene Studio → Âm thanh.' },
        { i: '🔤', t: 'Font chữ', d: 'Tải font riêng về máy để dùng cho phụ đề và chữ đồ hoạ trong cảnh.' },
      ] },
      { t: 'note', kind: 'warn', text: 'Font phải **tải về máy** thì render mới dùng được. Chọn một font chưa tải, app sẽ báo và cho tải ngay tại chỗ — nó không bao giờ âm thầm thay bằng font khác.' },
      { t: 'go', items: [{ label: '📚 Mở Thư viện', act: 'page', arg: 'library' }] },
    ],
  },

  // ====================================================================== 11
  {
    id: 'brandgen', grp: 'Màn hình', ic: '🎨', title: 'Tạo Brand Asset',
    lede: 'Một ảnh tham chiếu → cả bộ nhân vật với hàng chục cảm xúc, nền trong suốt.',
    blocks: [
      { t: 'where', text: 'Thanh trên cùng → Brand Asset' },
      { t: 'steps', items: [
        { n: 'Ảnh tham chiếu', t: 'Chọn một ảnh nhân vật. AI giữ đặc điểm nhận dạng qua toàn bộ bộ ảnh.' },
        { n: 'Tên nhân vật', t: 'Dùng để đặt tên file và gom nhóm.' },
        { n: 'Style', t: '2D Anime · Manhwa · 3D Pixar · 3D Realistic · Minecraft, hoặc gõ style tuỳ ý.' },
        { n: 'Brand đích', t: 'Thư mục brand sẽ nhận bộ ảnh. Tạo brand mới ngay tại đây.' },
        { n: 'Danh sách cảm xúc', t: '**🤖 AI tự sinh** — chọn số lượng, mô tả thêm ngữ cảnh nếu muốn. **✍ Nhập thủ công** — mỗi dòng một cảm xúc/hành động.' },
        { n: 'Provider & model', t: 'Chọn nhà cung cấp ảnh, model và kích thước. Thêm provider riêng bằng base URL + API key.' },
      ] },
      { t: 'p', text: 'Bấm **✨ Bắt đầu tạo ảnh** rồi theo dõi thanh tiến độ. Dừng giữa chừng được. Xong có thể **copy cả bộ sang brand khác**.' },
      { t: 'note', kind: 'tip', text: 'Nền ảnh luôn trong suốt, nên nhân vật chèn thẳng vào cảnh video mà không cần tách nền.' },
      { t: 'go', items: [{ label: '🎨 Mở Brand Asset', act: 'page', arg: 'brandgen' }] },
    ],
  },

  // ====================================================================== 12
  {
    id: 'editvideo', grp: 'Màn hình', ic: '✂️', title: 'Edit Video',
    lede: 'Cho footage có sẵn: cắt, bóc lời thoại, phủ đồ hoạ động lên trên.',
    blocks: [
      { t: 'where', text: 'Thanh trên cùng → Edit Video' },
      { t: 'defs', items: [
        ['Cắt nhanh', 'Cắt đoạn bằng ffmpeg, không mã hoá lại nên gần như tức thì.'],
        ['Bóc lời thoại', 'Whisper nghe video và tạo phụ đề khớp tiếng.'],
        ['Cắt khoảng lặng', 'Cắt **trước** khi bóc lời thoại, nên phụ đề và cảnh vẫn khớp tuyệt đối. Video sẽ ngắn lại.'],
        ['Tự động zoom nhẹ (Ken Burns)', 'Cảnh chẵn zoom vào, cảnh lẻ zoom ra — chống cảm giác đứng hình khi quay một góc máy cố định.'],
        ['✨ Dựng đồ hoạ & ghép', 'AI dựng lớp đồ hoạ động rồi phủ lên footage của bạn.'],
      ] },
      { t: 'go', items: [{ label: '✂️ Mở Edit Video', act: 'page', arg: 'editvideo' }] },
    ],
  },

  // ====================================================================== 13
  {
    id: 'after', grp: 'Vận hành', ic: '✅', title: 'Sau khi video xong',
    lede: 'Video hoàn thành là một **phiên bản**, không phải dấu chấm hết.',
    blocks: [
      { t: 'grid', items: [
        { i: '🕘', t: 'Phiên bản', d: 'Mọi bản đã xuất đều còn trên đĩa. Xem lại và quay về bản cũ bất cứ lúc nào.' },
        { i: '📦', t: 'Bản khác', d: 'Bốn bản dựng sẵn từ cùng bộ clip: **không logo** · **không nhạc nền** · **không watermark** · **ghép nhanh**. Mỗi bản chỉ tốn một lượt ghép, video chính giữ nguyên.' },
        { i: '🔬', t: 'Kiểm tra', d: 'Quét chữ sai ngôn ngữ, quy ước số, clip không khớp thiết kế. Nó **báo cáo**, không tự sửa.' },
        { i: '📸', t: 'Contact sheet', d: 'Khung giữa của mọi cảnh trong một ảnh.' },
        { i: '📤', t: 'Đăng video', d: 'Đăng thẳng lên YouTube / Facebook Page. Mặc định **không** công khai ngay.' },
        { i: '📂', t: 'Mở thư mục', d: 'Mở thư mục chứa video, phụ đề, ảnh bìa và metadata.' },
      ] },
      { t: 'h', text: 'Ảnh bìa' },
      { t: 'p', text: 'App dựng ảnh bìa cho **mọi kích thước nền tảng**, giữ lại từng phiên bản đã tạo và cho quay về bản cũ. Bấm tạo lại để có phương án bố cục khác, hoặc sửa thẳng HTML của ảnh bìa.' },
      { t: 'note', kind: 'tip', text: 'Đổi bất cứ cài đặt nào sau khi video đã xong, một dải **“thay đổi chưa áp dụng”** sẽ hiện ở đầu cột Config, ghi rõ việc gì cần chạy lại và tốn bao lâu.' },
    ],
  },

  // ====================================================================== 14
  {
    id: 'cost', grp: 'Vận hành', ic: '💰', title: 'Chi phí & cách tiết kiệm',
    lede: 'Không có gì tiêu tiền mà không nói trước. Đây là bốn cái van.',
    blocks: [
      { t: 'defs', items: [
        ['Ước tính trước khi chạy', 'Dòng ước tính dưới thanh thời lượng cho biết độ dài và chi phí dự kiến **trước** khi bấm Bắt đầu.'],
        ['Cổng duyệt cảnh', 'Bật “Dựng cảnh trước — duyệt xong mới lồng tiếng”: app dựng hết hình rồi dừng. Sửa bao nhiêu lần cũng chưa tốn credit TTS.'],
        ['Bảng chi phí thay đổi', 'Mỗi lần bạn đổi cấu hình của video đã xong, app tính đúng những cảnh nào bị ảnh hưởng. Nếu một bước sẽ **lồng tiếng lại** (tốn tiền thật), nó nói thẳng bằng đúng từ đó.'],
        ['🔇 Không lời', 'Video chỉ nhạc + phụ đề, bỏ hẳn khâu lồng tiếng.'],
      ] },
      { t: 'note', kind: 'cost', text: 'Trong bảng chi phí, phương án **rẻ** luôn nằm cạnh phương án đắt — “Chỉ ghép lại” không bao giờ bị giấu sau “Áp dụng tất cả”. Đọc kỹ trước khi bấm.' },
    ],
  },

  // ====================================================================== 15
  {
    id: 'channels', grp: 'Vận hành', ic: '📺', title: 'Kênh',
    lede: 'Làm nhiều kênh trên cùng một máy mà không lẫn lộn.',
    blocks: [
      { t: 'where', text: 'Thanh trên cùng → ô chọn kênh → ⚙' },
      { t: 'p', text: 'Mỗi kênh giữ **thư mục lưu riêng**, brand kit riêng, watermark riêng, giọng đọc và cấu hình mặc định riêng. Đổi kênh là đổi toàn bộ ngữ cảnh: danh sách dự án, thư viện brand, preset — tất cả theo kênh đó.' },
      { t: 'defs', items: [
        ['Tên kênh', 'Bắt buộc.'],
        ['Thư mục', 'Bỏ trống thì app tự đặt trong `~/Movies/AI Video Studio/`.'],
        ['Watermark của kênh', 'Chuỗi mặc định cho mọi video của kênh.'],
        ['Sao chép cấu hình', 'Kênh mới thừa hưởng cấu hình của kênh đang dùng.'],
      ] },
      { t: 'go', items: [{ label: '📺 Mở Quản lý kênh', act: 'channels' }] },
    ],
  },

  // ====================================================================== 16
  {
    id: 'assistant', grp: 'Vận hành', ic: '🛰', title: 'Trợ lý nội dung & chạy hàng loạt',
    lede: 'Từ “hôm nay làm video gì” đến lịch đăng cố định hằng tuần.',
    blocks: [
      { t: 'where', text: 'Trang chủ → 🛰 Trợ lý' },
      { t: 'defs', items: [
        ['💡 Gợi ý', 'Trợ lý đề xuất chủ đề theo nguồn bạn khai báo. Kho gợi ý được lưu lại — chạy lần nữa chỉ **thêm** ý mới, không xoá ý cũ.'],
        ['🕘 Lịch sử', 'Vòng đời đầy đủ của từng ý tưởng: đã nhận, đã hẹn lịch, đã bỏ qua.'],
        ['🗓 Lịch sản xuất', 'Lên kế hoạch cả tuần, hoặc đặt **khung giờ cố định hằng tuần** để app tự chuẩn bị.'],
        ['Cấu hình mặc định', 'Lưu nguyên cột Config hiện tại làm cấu hình mặc định cho mọi video trợ lý tạo.'],
      ] },
      { t: 'note', kind: 'warn', text: 'Trợ lý **không bao giờ tự chạy** một dây chuyền tốn tiền. Mọi lần nhận ý tưởng hay hẹn lịch đều đi qua một bảng cấu hình để bạn xem lại và bấm xác nhận.' },
      { t: 'h', text: 'Chạy hàng loạt' },
      { t: 'p', text: 'Trang chủ → **Hàng loạt**: dán nhiều chủ đề, mỗi dòng một video. App xếp hàng và chạy lần lượt. Theo dõi tất cả ở **🗂 Tác vụ**.' },
      { t: 'go', items: [{ label: '🛰 Mở Trợ lý', act: 'assistant' }, { label: '🗂 Mở Tác vụ', act: 'tasks' }] },
    ],
  },

  // ====================================================================== 17
  {
    id: 'settings', grp: 'Vận hành', ic: '🤖', title: 'AI Setting',
    lede: 'Nơi cắm khoá API và chọn model. Không cắm gì thì app vẫn chạy được offline.',
    blocks: [
      { t: 'where', text: 'Thanh trên cùng → ⚙️ AI Setting' },
      { t: 'defs', items: [
        ['Công cụ hệ thống', 'Đèn trạng thái của ffmpeg · whisper · TTS · Chrome. Thiếu Chrome thì mọi ảnh bìa và phép đo phụ đề đều hỏng.'],
        ['LLM', 'Chọn nhà cung cấp, dán API key, lấy danh sách model rồi chọn. **Test LLM** kiểm tra kết nối ngay.'],
        ['Model dựng đồ hoạ (HyperFrame)', 'Model riêng cho khâu dựng cảnh. Đây là thứ ảnh hưởng nhiều nhất đến chất lượng hình ảnh — nên dùng model mạnh nhất bạn có.'],
        ['TTS', 'Nhà cung cấp giọng đọc ưu tiên, giọng mặc định theo từng ngôn ngữ, và kho giọng để nghe thử.'],
        ['Phụ đề', 'Engine bóc mốc thời gian, kèm tuỳ chọn để LLM sửa lỗi chính tả của bản bóc.'],
        ['Đăng video', 'Kết nối YouTube (OAuth Client dạng Desktop app) và Facebook Page (Page ID + Page Access Token).'],
      ] },
      { t: 'note', kind: 'tip', text: 'API key được lưu **theo từng nhà cung cấp**. Đổi sang provider khác rồi quay lại, key cũ vẫn còn — không phải vào dashboard lấy lại.' },
      { t: 'go', items: [{ label: '⚙️ Mở AI Setting', act: 'settings' }, { label: '🎙 Mở kho giọng', act: 'voices' }] },
    ],
  },

  // ====================================================================== 18
  {
    id: 'keys', grp: 'Trợ giúp', ic: '⌨️', title: 'Phím tắt',
    blocks: [
      { t: 'keys', items: [
        ['⌘ K', 'Bảng lệnh — nhảy màn hình, mở modal, áp preset, mở dự án gần đây'],
        ['↑ ↓', 'Di chuyển trong bảng lệnh'],
        ['Enter', 'Chạy lệnh đang chọn'],
        ['Esc', 'Đóng bảng lệnh hoặc hộp thoại đang mở'],
        ['⌘ ↵', 'Áp dụng HTML trong Scene Studio → tab HTML'],
        ['F', 'Toàn màn hình khi đang xem nháp'],
      ] },
      { t: 'note', kind: 'key', text: 'Trên Windows dùng **Ctrl** thay cho **⌘**.' },
    ],
  },

  // ====================================================================== 19
  {
    id: 'trouble', grp: 'Trợ giúp', ic: '🩺', title: 'Xử lý sự cố',
    lede: 'Sáu tình huống hay gặp và cách xử lý dứt điểm.',
    blocks: [
      { t: 'defs', items: [
        ['⚠ Thiếu công cụ ở thanh trên', 'Mở AI Setting → mục Công cụ hệ thống để xem thiếu gì. Thiếu **ffmpeg** thì không render được; thiếu **Chrome** thì hỏng ảnh bìa và phép đo phụ đề.'],
        ['Chữ tiếng Việt mất dấu hoặc đè dòng', 'Nút **🔤 Sửa lỗi tiếng Việt** hiện ở đầu dự án khi app quét thấy. Bấm để dựng lại đúng những cảnh hỏng rồi ghép lại — không phải làm lại cả video.'],
        ['Video ra sai ngôn ngữ', 'Đặt cứng ngôn ngữ ở Config → Định dạng thay vì để “Tự nhận theo chủ đề”. Nếu model trả về sai, app tự hỏi lại một lần chứ không im lặng bỏ qua.'],
        ['Video xong nhưng không giống cài đặt hiện tại', 'Dải “thay đổi chưa áp dụng” ở đầu cột Config nói rõ chênh ở đâu. Bấm **Chi tiết** để xem bảng chi phí trước khi chạy lại.'],
        ['Dây chuyền đang chạy mà cần dừng', '**⏹ Dừng** dừng an toàn; **▶ Tiếp tục** chạy lại từ đúng chỗ. Xem toàn bộ việc đang chờ ở 🗂 Tác vụ và huỷ từng việc tại đó.'],
        ['Không chắc video có lỗi gì không', 'Bấm **🔬 Kiểm tra** ở video đã xong: quét chữ sai ngôn ngữ, quy ước số và clip lệch thiết kế. Nó chỉ báo cáo, không tự sửa gì.'],
      ] },
      { t: 'note', kind: 'tip', text: 'Khi cần báo lỗi, mở **Nhật ký xử lý** → lọc **⛔ Lỗi** → bấm **⬇** để tải nhật ký `.txt`. Đó là thứ trả lời chính xác chuyện gì đã xảy ra.' },
    ],
  },

  // ====================================================================== 20
  {
    id: 'license', grp: 'Trợ giúp', ic: '🔑', title: 'Bản quyền & cập nhật',
    blocks: [
      { t: 'p', text: 'Đăng nhập bằng Google hoặc nhập mã kích hoạt. Huy hiệu bản quyền trên thanh trên cùng cho biết trạng thái và thiết bị đang dùng. Khi có bản mới, một dải thông báo hiện ra kèm nút tải — bạn tự chọn lúc cập nhật.' },
      { t: 'note', kind: 'warn', text: 'Một license gắn với số thiết bị nhất định. Đổi máy thì gỡ liên kết máy cũ trước, tránh dùng hết lượt kích hoạt.' },
    ],
  },

  // ====================================================================== 21
  {
    id: 'glossary', grp: 'Trợ giúp', ic: '📖', title: 'Thuật ngữ',
    blocks: [
      { t: 'defs', items: [
        ['HyperFrame', 'Cách app dựng cảnh: AI viết mã đồ hoạ + hoạt ảnh riêng cho từng cảnh, thay vì ghép template có sẵn. Đây là lý do hai video không bao giờ trông giống nhau.'],
        ['Scene / Cảnh', 'Một đơn vị video độc lập: có lời thoại, hình ảnh, âm thanh và clip riêng. Sửa một cảnh không ảnh hưởng cảnh khác.'],
        ['Take', 'Một lần dựng của cùng một cảnh. Mọi take đều được giữ lại để quay về.'],
        ['TTS', 'Text-to-speech — khâu lồng tiếng. Đây là khâu tốn tiền nhất khi dùng giọng neural.'],
        ['Karaoke', 'Phụ đề nhấn sáng đúng từ đang được đọc, dựa trên mốc thời gian từng từ.'],
        ['Ken Burns', 'Zoom/pan chậm trên ảnh tĩnh để khung hình không bị chết cứng.'],
        ['Contact sheet', 'Ảnh ghép khung giữa của mọi cảnh, để duyệt storyboard trong một cái nhìn.'],
        ['Preset', 'Toàn bộ cột Config được lưu lại dưới một cái tên, áp lại bằng một cú bấm.'],
        ['Overlay mode', 'Dựng đồ hoạ trên nền trong suốt rồi ghép lên video nền có sẵn.'],
      ] },
    ],
  },
];

/* ---------------------------------------------------------------------------
   RENDER
--------------------------------------------------------------------------- */

// Inline formatting: escape first, then re-introduce the two marks we allow. The order matters —
// doing it the other way round would let content inject tags.
function fmt(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\*([^*]+)\*/g, '<i>$1</i>');
}

const NOTE_META = {
  tip: ['💡', 'Mẹo'], warn: ['⚠️', 'Lưu ý'], cost: ['💰', 'Chi phí'], key: ['⌨️', 'Phím tắt'],
};

const BLOCK = {
  h: (b) => `<h4 class="gd-h4">${fmt(b.text)}</h4>`,
  p: (b) => `<p class="gd-p">${fmt(b.text)}</p>`,
  where: (b) => `<div class="gd-where">📍 ${fmt(b.text)}</div>`,
  list: (b) => `<ul class="gd-ul">${b.items.map((x) => `<li>${fmt(x)}</li>`).join('')}</ul>`,
  steps: (b) => `<ol class="gd-steps">${b.items.map((x) => `<li><div class="gd-st-n">${fmt(x.n)}</div><div class="gd-st-t">${fmt(x.t)}</div></li>`).join('')}</ol>`,
  defs: (b) => `<dl class="gd-defs">${b.items.map(([k, v]) => `<div class="gd-def"><dt>${fmt(k)}</dt><dd>${fmt(v)}</dd></div>`).join('')}</dl>`,
  keys: (b) => `<dl class="gd-defs gd-keys">${b.items.map(([k, v]) => `<div class="gd-def"><dt><kbd>${esc(k)}</kbd></dt><dd>${fmt(v)}</dd></div>`).join('')}</dl>`,
  grid: (b) => `<div class="gd-cards">${b.items.map((x) => `<div class="gd-card"><span class="gd-card-i">${x.i}</span><div class="gd-card-t">${fmt(x.t)}</div><div class="gd-card-d">${fmt(x.d)}</div></div>`).join('')}</div>`,
  note: (b) => {
    const [ic, label] = NOTE_META[b.kind] || NOTE_META.tip;
    return `<div class="gd-note ${b.kind}"><span class="gd-note-i">${ic}</span><div><b class="gd-note-l">${label}</b> ${fmt(b.text)}</div></div>`;
  },
  go: (b) => `<div class="gd-go">${b.items.map((x) => `<button class="btn sm" data-act="${esc(x.act)}"${x.arg ? ` data-arg="${esc(x.arg)}"` : ''}>${esc(x.label)}</button>`).join('')}</div>`,
};

function renderSection(s, i) {
  const body = s.blocks.map((b) => (BLOCK[b.t] ? BLOCK[b.t](b) : '')).join('');
  return `<section class="gd-sec" id="gd-${s.id}">
    <header class="gd-sec-h">
      <span class="gd-sec-ic">${s.ic}</span>
      <div>
        <div class="gd-sec-num">${String(i + 1).padStart(2, '0')} · ${esc(s.grp)}</div>
        <h3 class="gd-sec-t">${esc(s.title)}</h3>
      </div>
    </header>
    ${s.lede ? `<p class="gd-lede">${fmt(s.lede)}</p>` : ''}
    ${body}
  </section>`;
}

/* ---------------------------------------------------------------------------
   SEARCH
   Vietnamese without diacritics has to match Vietnamese with them: nobody types "phụ đề"
   into a filter box, they type "phu de".
--------------------------------------------------------------------------- */
// NFD strips the marks, so "phu de" matches "phụ đề", "resume" matches "résumé" and "sluzba"
// matches "служба" is NOT what happens — Cyrillic, Thai and CJK have no marks to strip and simply
// pass through unchanged, which is the right answer for all three. đ has no decomposition of its
// own, so it needs its own line.
const flat = (s) => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\u0111/g, 'd');

function haystack(s) {
  const parts = [s.title, s.grp, s.lede || ''];
  for (const b of s.blocks) {
    if (b.text) parts.push(b.text);
    if (b.t) parts.push(b.t);
    for (const x of b.items || []) {
      if (Array.isArray(x)) parts.push(...x);
      else if (typeof x === 'string') parts.push(x);
      else parts.push(x.n || '', x.t || '', x.d || '', x.label || '');
    }
  }
  return flat(parts.join(' '));
}

// The chapters actually being shown: the Vietnamese source, or a translated copy laid over the
// SAME shape (see scripts/i18n-extract-guide.mjs), so a translated manual can never have a
// different set of chapters, blocks or jump buttons from the Vietnamese one.
let CHAPTERS = SECTIONS;
let HAY = new Map(SECTIONS.map((s) => [s.id, haystack(s)]));

function rehydrate(flatText) {
  const clone = JSON.parse(JSON.stringify(SECTIONS));
  for (const [path, value] of Object.entries(flatText || {})) {
    if (typeof value !== 'string') continue;
    const parts = path.split('.');
    let node = clone;
    for (let i = 0; i < parts.length - 1 && node; i++) node = node[parts[i]];
    if (node) node[parts[parts.length - 1]] = value;
  }
  return clone;
}

async function loadChapters() {
  if (uiLang() === 'vi') return;
  try {
    const res = await fetch(`/locales/guide.${uiLang()}.json`, { cache: 'no-cache' });
    if (!res.ok) return;                       // no translated manual yet — Vietnamese still reads
    CHAPTERS = rehydrate(await res.json());
    HAY = new Map(CHAPTERS.map((s) => [s.id, haystack(s)]));
  } catch { /* offline: the authored manual is already here */ }
}

/* ---------------------------------------------------------------------------
   BOOT
--------------------------------------------------------------------------- */

// Screens the guide can open for you. Dynamic import keeps this module out of every other
// module's import graph — the guide knows about the app, the app does not know about the guide.
const ACTIONS = {
  page: (arg) => switchPage(arg),
  settings: async () => (await import('../features/settings.js')).openSettings(),
  voices: async () => (await import('../features/voicepicker.js')).openVoicePicker(),
  brandkit: async () => (await import('../features/brandkit.js')).openBrandEditor(),
  channels: async () => {
    const m = await import('../features/channels.js');
    m.renderChannelList();
    $('#channelModal').classList.add('open');
  },
  assistant: () => $('#heroAutopilot')?.click(),
  tasks: () => $('#heroTasks')?.click(),
};

let built = false;

export function initGuide() {
  registerPageHook('tutorials', build);
}

async function build() {
  if (built) return;
  built = true;
  await loadChapters();

  const groups = [...new Set(CHAPTERS.map((s) => s.grp))];
  $('#gdNav').innerHTML = groups.map((g) => `
    <div class="gd-nav-g">${esc(g)}</div>
    ${CHAPTERS.filter((s) => s.grp === g).map((s) => `
      <a class="gd-nav-i" href="#gd-${s.id}" data-id="${s.id}"><span>${s.ic}</span>${esc(s.title)}</a>`).join('')}
  `).join('');
  $('#gdBody').innerHTML = CHAPTERS.map(renderSection).join('');

  // Nav clicks scroll inside .page (the app's scroll container), not the window.
  $('#gdNav').addEventListener('click', (e) => {
    const a = e.target.closest('.gd-nav-i');
    if (!a) return;
    e.preventDefault();
    document.getElementById('gd-' + a.dataset.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  $('#gdBody').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (b) ACTIONS[b.dataset.act]?.(b.dataset.arg);
  });

  // Two-tier search. "phụ đề" appears in fifteen chapters and is the NAME of one — showing all
  // fifteen answers nothing. So a title match wins outright, and the chapters that merely mention
  // the word are offered on a second line rather than dumped into the results.
  const search = $('#gdSearch');
  let wide = false;
  const runSearch = () => {
    const q = flat(search.value.trim());
    const byTitle = q ? CHAPTERS.filter((s) => flat(s.title + ' ' + s.grp).includes(q)) : [];
    const byBody = q ? CHAPTERS.filter((s) => HAY.get(s.id).includes(q)) : CHAPTERS;
    const show = new Set((!q || wide || !byTitle.length ? byBody : byTitle).map((s) => s.id));
    for (const s of CHAPTERS) {
      const on = show.has(s.id);
      document.getElementById('gd-' + s.id)?.classList.toggle('hidden', !on);
      $(`.gd-nav-i[data-id="${s.id}"]`)?.classList.toggle('hidden', !on);
    }
    const rest = byBody.length - show.size;
    $('#gdMore').classList.toggle('hidden', rest <= 0);
    $('#gdMore').textContent = `Còn ${rest} chương khác có nhắc tới “${search.value.trim()}” — bấm để xem`;
    $('#gdEmpty').classList.toggle('hidden', !q || show.size > 0);
    $('#gdCount').textContent = q ? `${show.size} chương khớp` : `${CHAPTERS.length} chương`;
  };
  search.addEventListener('input', () => { wide = false; runSearch(); });
  $('#gdMore').addEventListener('click', () => { wide = true; runSearch(); });
  runSearch();

  // Scrollspy: the sidebar always shows where you are.
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      $$('.gd-nav-i').forEach((a) => a.classList.toggle('on', a.dataset.id === en.target.id.slice(3)));
    }
  }, { root: $('#page-tutorials'), rootMargin: '-10% 0px -80% 0px' });
  $$('.gd-sec').forEach((s) => io.observe(s));
}
