# Mộc Trà Order Agent

Ngữ cảnh lên đơn hàng Mộc Trà: staff nhập đơn bằng ngôn ngữ tự nhiên, resolver
đối chiếu BILL.md để chốt khách hàng, sản phẩm, ĐVT và giá một cách deterministic.

## Language

**Draft (Đơn nháp)**:
Một đơn hàng đang được resolve, định danh bằng `draftId`. Mỗi tin nhắn đặt đơn
mới tạo một Draft mới; sửa/xác nhận là revision trên cùng Draft.
_Avoid_: order session, bill nháp

**Xác nhận (Confirmation)**:
Câu trả lời của staff cho một câu hỏi mà resolver đưa ra (ĐVT 1:1, giá, đã báo
khách). Staff chỉ được chọn từ ID resolver cấp, không tự nộp giá trị thay thế.
_Avoid_: approval, override thủ công

**Lựa chọn (Selection)**:
Việc staff chọn một ứng viên cụ thể — chi nhánh khách hàng hoặc biến thể sản
phẩm — trong danh sách candidate resolver trả về.
_Avoid_: confirmation (dành cho ĐVT/giá)

**Bộ nhớ chat (Chat memory)**:
Các Xác nhận và Lựa chọn đã chốt trong một chat, được dùng lại cho các Draft
sau của cùng chat đó. Không bao giờ mang sang chat khác. Bằng chứng từ BILL.md
luôn thắng Bộ nhớ chat — bộ nhớ chỉ lấp chỗ dữ liệu thiếu.
_Avoid_: learning, global alias

**Xác nhận giá (Price confirmation)**:
Việc staff duyệt một mức giá cụ thể khi bảng giá có cờ "Hỏi lại giá"/"Báo
tăng"/"CẬP NHẬT - BÁO KHÁCH". Trong Bộ nhớ chat, nó gắn với đúng giá trị giá
đã duyệt: giá tính ra thay đổi thì xác nhận cũ tự vô hiệu và phải hỏi lại.
_Avoid_: chốt giá vĩnh viễn, phê duyệt đơn

**Alias sản phẩm (Product alias)**:
Tên gọi tắt của staff đã được xác nhận ứng với một sản phẩm cụ thể ("trân châu
trắng" = Trân Châu 3Q Zion Trắng). Luôn gắn với một khách hàng cụ thể — không
bao giờ dùng chung giữa các khách, kể cả trong cùng chat.
_Avoid_: synonym toàn cục, shorthand chung

**ĐVT mapping (Unit mapping)**:
ĐVT do staff xác nhận cho một sản phẩm khi bảng giá thiếu hoặc lệch đơn vị.
Gắn với sản phẩm (canonical SKU), không gắn với khách hàng — trong Bộ nhớ chat,
mọi khách đặt cùng sản phẩm đều dùng lại được.
_Avoid_: alias (dành cho tên gọi sản phẩm)

**Chi nhánh (Branch)**:
Một mã khách hàng (`Mã khách hàng`) riêng biệt dưới cùng một tên hiển thị.
Mã khách hàng là khóa chính; không trộn lịch sử giữa các Chi nhánh. Lựa chọn
Chi nhánh được dùng lại trong chat nhưng phải hiển thị rõ nguồn gốc trên draft.
_Avoid_: store, địa điểm
