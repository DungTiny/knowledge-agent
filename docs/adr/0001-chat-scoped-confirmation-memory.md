# 0001. Bộ nhớ xác nhận phạm vi chat cho resolver đơn hàng

Date: 2026-07-13

## Status

Accepted

## Context

Mỗi tin nhắn "lên đơn" mới tạo một Draft mới với state rỗng. Mọi Xác nhận và
Lựa chọn của staff (chi nhánh, alias sản phẩm, ĐVT 1:1, giá) chỉ sống trong
Draft đó (KV key `order:draft:${chatId}:${draftId}`), nên staff đặt lại cùng
một đơn — kể cả trong cùng chat — bị hỏi lại toàn bộ từ đầu. Transcript thực tế
cho thấy đơn Doris Coffee & Tea House bị hỏi lại y hệt lần đầu: chọn chi nhánh,
xác nhận ĐVT "chai" cho 4 sản phẩm, cung cấp lại tên đầy đủ cho 2 sản phẩm.

Ba phương án được cân nhắc:

1. **Không nhớ gì (hiện trạng)** — deterministic thuần, an toàn tuyệt đối,
   nhưng staff xác nhận lặp vô hạn.
2. **Kiến thức bền vững** — lưu vĩnh viễn mọi xác nhận (business override
   store, được contract §5.4 dự trù). Đỡ hỏi nhất nhưng một xác nhận sai/lỗi
   thời ô nhiễm mọi chat về sau, và cần quy trình duyệt/version riêng.
3. **Bộ nhớ phạm vi chat** — xác nhận dùng lại cho các Draft sau trong cùng
   chat; chat mới sạch hoàn toàn.

## Decision

Chọn phương án 3: Bộ nhớ xác nhận phạm vi chat, với các quy tắc phạm vi và
vô hiệu sau:

- **Chi nhánh**: Lựa chọn chi nhánh (ví dụ Doris → KH004610) tự áp dụng cho
  đơn sau trong chat, nhưng draft phải hiển thị rõ nguồn gốc ("dùng chi nhánh
  đã chọn trước đó trong chat") để staff thấy và đổi được.
- **Alias sản phẩm**: gắn theo (mã khách hàng, tên gọi tắt). Không bao giờ
  dùng chung giữa các khách, kể cả trong cùng chat — khách khác có thể quen
  mua hãng khác cho cùng tên gọi.
- **ĐVT mapping**: gắn theo sản phẩm (canonical SKU), toàn chat. Đóng gói là
  thuộc tính sản phẩm, không phải sở thích khách.
- **Xác nhận giá**: nhớ trong chat nhưng gắn theo đúng giá trị đã duyệt.
  Resolver tính ra giá khác (snapshot mới) → xác nhận cũ tự vô hiệu, hỏi lại.
- **Precedence**: bằng chứng BILL.md luôn thắng bộ nhớ. Bộ nhớ chỉ lấp chỗ
  dữ liệu thiếu — nhất quán với chuỗi ưu tiên ĐVT hiện có, nơi `confirmedUnit`
  đứng cuối (`bill-resolver.ts`).

## Consequences

- Đặt lại cùng đơn trong cùng chat không còn bị hỏi lại các xác nhận đã chốt;
  chat mới vẫn hỏi từ đầu (chấp nhận, đổi lấy an toàn giữa các phiên).
- Confirmation ID hiện gắn theo `lineId` trong Draft nên không tái dùng trực
  tiếp được; bộ nhớ chat cần key ổn định riêng (mã khách + tên gọi, canonical
  SKU, giá trị giá) và phải được áp dụng phía server trong resolver — model
  không phải trust boundary.
- Mọi dòng/khách được resolve nhờ bộ nhớ chat phải mang provenance hiển thị
  cho staff, cùng nguyên tắc với evidence source hiện có.
- Phương án bền vững (contract §5.4) không bị loại vĩnh viễn: bộ nhớ chat là
  bước trung gian; nâng cấp lên business override có duyệt là mở rộng, không
  phải đảo ngược.
