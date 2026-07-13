# Mộc Trà order-agent prompt and tool contract

This contract was derived from a complete parse of one synchronized `BILL.md`
snapshot, not from a small row sample. The runtime file is dynamic: it must be
read from `files/bill/BILL.md` in the current sandbox snapshot after source
upload and sync. It must never be bundled as a Nitro/server build asset.

## What the analyzed snapshot requires

- 11,602 data rows: 389 static price rows dated `31/12/2026` and 11,213
  real-history rows dated from `02/01/2026` through `08/07/2026`.
- 25 distinct customer-code/name pairs. A display name is not always unique;
  `Doris Coffee & Tea House`, for example, has two customer codes.
- 4,194 rows have no ĐVT, including 178 static rows. A product name ending in
  `1Kg` is not evidence that the catalog unit is `Túi 1Kg`.
- 84 product names map to more than one raw SKU. A global product-name match is
  therefore not enough to select a customer's variant.
- 3,422 exact duplicate extra rows. Frequency calculations must deduplicate
  before counting.
- 42 negative quantities represent reversal/return-like rows and must not be
  preference or current-price evidence.
- 48 non-numeric quantities include `CẬP NHẬT - BÁO KHÁCH`, `dùng loại này`,
  `N.Thùng`, and threshold rules. They are business instructions, not orders.
- 149 rows say `Hỏi lại giá`; 24 say `Báo tăng`; 32 contain an update/customer
  notification rule. A numeric `Giá bán` on one of these rows is not a final,
  silent approval to bill.
- Two static rows have no numeric selling price and use the quantity/note fields
  as customer aliases (`TRÀ ĐẶC BIỆT`, `TRÀ LÀI`). They must remain pending.
- Raw SKU prefixes change over time (`(ĐG)boduo-xoai` vs
  `(ĐG-BB)boduo-xoai`). Static fallback should bridge by resolved standardized
  product plus price-list scope, not require raw-SKU equality.

Consequently, shell grep output must not be the business-logic API. The model
should never choose customer, SKU, price, or ĐVT from raw Markdown rows.

## Recommended tool flow

Initial order:

1. `resolve_bill_order` exactly once.
2. If the customer is unresolved, ask one customer clarification and stop.
3. Otherwise call `present_order` exactly once with `orderDraft` returned by the
   resolver, including pending lines.

Follow-up confirmation/change:

1. Call `resolve_bill_order` with `draftId` and candidate/confirmation IDs.
2. Call `present_order` exactly once with the new returned `orderDraft`.

Do not call `bash`, `bash_batch`, `web_search`, or one calculator tool per item
for an order workflow. Parsing, matching, precedence, unit conversion, and
arithmetic belong inside `resolve_bill_order`.

On every resolver execution, load and parse `files/bill/BILL.md` directly from
the current sandbox. Do not cache its contents across calls. When source sync
selects a new snapshot, invalidate sessions created from the previous snapshot.

## Copy-paste system prompt

```text
Bạn là trợ lý lên đơn Mộc Trà. Với đơn hàng, nguồn sự thật duy nhất là kết quả
từ tool resolve_bill_order. Bạn không được tự đọc BILL.md, tự grep, tìm web,
đoán khách hàng, đoán SKU, đoán ĐVT, đoán giá hoặc tự tính thành tiền.
Tool luôn đọc BILL.md từ sandbox snapshot hiện đang được sync; không tái sử dụng
dữ liệu của đơn trước hoặc snapshot cũ.

NHẬN DIỆN ĐƠN HÀNG
- Một tin nhắn là yêu cầu lên/sửa đơn khi có ít nhất một dòng tên hàng kèm số
  lượng + đơn vị và có một dòng nhận diện khách hàng; không bắt buộc phải có
  cụm từ "lên đơn".
- "Done" chỉ là dấu kết thúc nhập liệu, không phải tên khách hàng hay sản phẩm.

LUỒNG BẮT BUỘC
1. Đơn mới: gọi resolve_bill_order đúng một lần với customerQuery và toàn bộ
   items đúng như người dùng nhập.
2. Nếu customer.status là ambiguous hoặc not_found: hỏi đúng một câu để chọn
   khách hàng; không gọi present_order.
3. Nếu customer đã resolved: gọi present_order đúng một lần, truyền nguyên văn
   orderDraft do resolve_bill_order trả về. Không sửa tên, mã, ĐVT, giá, số
   lượng quy đổi, thành tiền, cảnh báo hoặc tổng tiền.
4. Dòng needs_confirmation vẫn phải xuất hiện trong present_order với
   unitPrice/lineTotal = null và note đúng từ tool.
5. Khi người dùng xác nhận hoặc yêu cầu thay đổi: gọi lại resolve_bill_order với
   draftId hiện tại và candidateId/confirmationId tương ứng. Không dựng lại đơn
   từ trí nhớ hội thoại và không giữ unitPrice:null nếu tool đã trả resolved.
6. Sau present_order, dừng. Không trình lại cùng một đơn lần thứ hai trong cùng
   lượt và không lặp đơn dưới dạng Markdown.

QUY TẮC KHÔNG ĐƯỢC VI PHẠM
- Mã khách hàng là khóa chính. Không trộn lịch sử giữa các chi nhánh hoặc hai
  mã có cùng tên hiển thị.
- Lịch sử thực chỉ gồm ngày khác 31/12/2026 và số lượng số học > 0, sau khi loại
  bỏ dòng trùng. Số lượng âm, rỗng hoặc dạng chữ không phải bằng chứng sở thích.
- Dòng 31/12/2026 là bảng giá/quy tắc tĩnh: chỉ dùng sau khi SKU/biến thể đã được
  xác định từ khách hàng hoặc để đưa ra lựa chọn xác nhận. Không dùng nó để đoán
  khách thường mua loại nào.
- "dùng loại này" ưu tiên hơn tần suất. "Hỏi lại giá" và "Báo tăng" tạo xác
  nhận giá; "CẬP NHẬT - BÁO KHÁCH" tạo cảnh báo bắt buộc trên dòng hàng.
- Không suy ĐVT từ tên hàng. Tên có "1Kg" không đồng nghĩa ĐVT "Túi 1Kg".
- requestedUnit phải là đơn vị nguyên gốc người dùng nói, ví dụ "Hộp", không
  được đổi thành chuỗi mô tả như "hộp (1,3kg)".
- Mọi phép đổi thùng/lốc/khối lượng và mọi phép tính tiền do tool thực hiện.

PHẢN HỒI
- Nếu đã gọi present_order: chỉ trả một câu ngắn "Đơn đã được chuẩn bị để xác
  nhận." Không lặp chi tiết đơn trong text.
- Nếu cần xác nhận: hỏi đúng các candidate/confirmation mà tool trả về; không tự
  tạo thêm lựa chọn.
```

## `resolve_bill_order` input schema

```ts
const requestedItemSchema = z.object({
  lineId: z.string().min(1),
  rawName: z.string().min(1),
  requestedQuantity: z.number().positive(),
  requestedUnit: z.string().min(1),
})

const selectionSchema = z.object({
  lineId: z.string().min(1),
  candidateId: z.string().min(1),
})

const confirmationSchema = z.object({
  lineId: z.string().min(1),
  confirmationId: z.string().min(1),
})

const resolveBillOrderInputSchema = z.object({
  // Required for a new draft; omitted when draftId is supplied.
  customerQuery: z.string().min(1).optional(),
  items: z.array(requestedItemSchema).min(1).max(50).optional(),

  // Required for a revision. The server loads the prior structured draft.
  draftId: z.string().uuid().optional(),

  // IDs must come from the resolver's previous output. The model cannot submit
  // arbitrary SKU, unit, or price values as a "confirmation".
  selections: z.array(selectionSchema).default([]),
  confirmations: z.array(confirmationSchema).default([]),
}).superRefine((value, ctx) => {
  const isNew = value.customerQuery && value.items
  const isRevision = value.draftId
  if (!isNew && !isRevision) {
    ctx.addIssue({ code: 'custom', message: 'Provide customerQuery+items or draftId' })
  }
})
```

The tool should be created with access to the real latest user message and must
verify that `customerQuery`, item text, and selected confirmation IDs are
consistent with that message/draft. Model arguments are not a trust boundary.

## `resolve_bill_order` output schema

```ts
type ResolutionStatus =
  | 'resolved'
  | 'needs_customer_confirmation'
  | 'needs_product_confirmation'
  | 'needs_unit_confirmation'
  | 'needs_price_confirmation'
  | 'not_found'

interface ResolveBillOrderOutput {
  draftId: string
  source: {
    path: 'files/bill/BILL.md'
    snapshotId: string
    rowCount: number
  }
  customer: {
    status: 'resolved' | 'ambiguous' | 'not_found'
    code?: string
    name?: string
    candidateIds: string[]
  }
  lines: Array<{
    lineId: string
    status: ResolutionStatus
    request: {
      rawName: string
      requestedQuantity: number
      requestedUnit: string
    }
    matched?: {
      sku: string
      canonicalSku: string
      productName: string
    }
    evidence: {
      selectionSource: 'exact' | 'positive_history' | 'static_rule' | 'staff_confirmation'
      priceSource?: 'latest_positive_history' | 'static_price' | 'staff_confirmation'
      unitSource?: 'history' | 'static_price' | 'business_override' | 'staff_confirmation'
      rowDates: string[]
    }
    candidates: Array<{
      candidateId: string
      sku: string
      productName: string
      reason: string
    }>
    confirmations: Array<{
      confirmationId: string
      kind: 'unit' | 'price' | 'customer_notice'
      label: string
      reason: string
    }>
    resolved?: {
      quantity: number
      unit: string
      catalogPrice: number
      unitPrice: number
      lineTotal: number
      unitConfirmed?: boolean
    }
    warning?: string
  }>
  orderDraft: {
    customerName: string
    customerCode?: string
    items: Array<{
      name: string
      sku?: string
      orderedQuantity: number
      orderedUnit: string
      quantity: number
      unit: string
      unitConfirmed?: boolean
      catalogPrice?: number
      unitPrice: number | null
      lineTotal: number | null
      note?: string
    }>
    totalQuantity: number
    totalAmount: number
    pendingCount: number
  } | null
}
```

## Deterministic resolver rules

### 1. Parse and normalize once

- Validate exactly these 12 columns: `Mã khách hàng`, `Tên khách hàng`,
  `Bảng giá`, `Mã hàng`, `Tên hàng`, `ĐVT`, `Thời gian`, `Số lượng`, `Đơn giá`,
  `Giảm giá`, `Giá bán`, `Ghi chú hàng hóa`.
- Cache the parsed index by file SHA-256 or mtime.
- Unicode-normalize and accent-fold only for matching. Always return original
  spelling from the row.
- Deduplicate identical rows before recency/frequency calculations.

### 2. Resolve customer before products

Precedence:

1. Exact `Mã khách hàng`.
2. Exact normalized `Tên khách hàng` if it maps to one code.
3. Unique all-token name match after removing standalone address numbers such
   as `04` from `04 Trương Định`.
4. Otherwise return customer candidates; never merge codes.

### 3. Resolve variant only inside the customer scope

- Preference evidence is a deduplicated row for the resolved customer code,
  date other than `31/12/2026`, and numeric quantity `> 0`.
- Match exact SKU/name first, then deterministic all-token name matching and an
  explicit alias dictionary. Do not use unconstrained semantic guessing.
- The alias dictionary (`PRODUCT_TOKEN_SYNONYMS` in `bill-resolver.ts`) maps
  confirmed customer vocabulary to catalog tokens: `siro` → `syrup`, so
  "1 siro vải" / "2 siro đào" match `Syrup Davinci Vải/Đào 750ml`. The agent
  passes `rawName` exactly as entered; the mapping runs server-side only.
- A `dùng loại này` static rule wins.
- If a generic request matches one positive-history variant, select it.
- If multiple variants remain and recency/frequency disagree, return candidates
  instead of guessing.
- After the standardized product is known, static lookup may bridge raw SKU
  prefix changes by normalized standardized product name within the correct
  customer/price-list scope.

### 4. Resolve price

1. Latest deduplicated positive real-history row for customer + resolved
   product/variant with numeric `Giá bán > 0`.
2. If no such row exists, use a matching static price row only after the product
   is resolved. Exact customer static rows come first; an explicitly linked
   price-list family such as `Hệ Thống Laph` comes next.
3. Blank/non-numeric price is pending.
4. Relevant `Hỏi lại giá` or `Báo tăng` produces a price confirmation even
   when a number exists. `CẬP NHẬT - BÁO KHÁCH` remains a visible line warning.
5. Never use `Đơn giá - Giảm giá` arithmetic when `Giá bán` is present; `Giá
   bán` is the source field.

### 5. Resolve ĐVT and totals

1. Valid non-empty unit from latest positive history.
2. Valid static unit for the already resolved product and price-list scope.
3. Versioned business override keyed by canonical product/SKU.
4. Explicit staff confirmation stored against the draft/business override.
5. Otherwise pending. Never infer packaging from product-name weight.

When the catalog ĐVT is known but the customer ordered in a unit the resolver
cannot convert ("1 bì" of a product listed as "Gói"), the line is pending AND
the resolver issues a `unit:<lineId>:requested-equals-catalog` confirmation.
Sending that ID back bills the line 1:1 in the catalog unit and sets
`unitConfirmed: true` on the draft item, so `present_order` does not re-flag it.
A fractional pack failure ("5 Hộp" of "Thùng/24 Hộp") is never offered as a 1:1
mapping — that would bill 5 thùng. Every pending line must carry either a
candidate or a confirmation; a pending line with neither is a dead end that no
staff reply can clear.

Unit conversion and totals must run in server code. Product-specific aliases
must not become global synonyms. Wrong annotated sizes must be rejected.

## Example initial tool call

```json
{
  "customerQuery": "04 Trương Định",
  "items": [
    { "lineId": "1", "rawName": "Mứt xoài", "requestedQuantity": 1, "requestedUnit": "Hộp" },
    { "lineId": "2", "rawName": "Đào lon", "requestedQuantity": 1, "requestedUnit": "Lon" },
    { "lineId": "3", "rawName": "Trà đào cozy", "requestedQuantity": 1, "requestedUnit": "Hộp" },
    { "lineId": "4", "rawName": "Cam sấy khô", "requestedQuantity": 200, "requestedUnit": "gr" },
    { "lineId": "5", "rawName": "Cốt dừa", "requestedQuantity": 4, "requestedUnit": "Lon" },
    { "lineId": "6", "rawName": "Richs", "requestedQuantity": 12, "requestedUnit": "Hộp" },
    { "lineId": "7", "rawName": "Thạch agar", "requestedQuantity": 1, "requestedUnit": "Hộp" },
    { "lineId": "8", "rawName": "Trà lài", "requestedQuantity": 1, "requestedUnit": "kg" }
  ]
}
```

For this customer, deterministic positive-history selection resolves the known
products/prices from the newest rows. For example, `Nước Cốt Dừa Wonderfarm
400ml` is 30,000đ in the newest positive Trương Định rows; selecting the older
29,000đ row is incorrect. `Lục Trà Lài Lộc Phát 1Kg` has no reliable catalog
ĐVT in the data (`lấy lẻ hỗ trợ giá thùng` is business text, not a unit), so it
must use a versioned business override or remain pending rather than inventing
`Túi 1Kg`.

## Example revision tool call

The resolver must issue IDs for allowed confirmations. The agent sends those
IDs back; it does not submit arbitrary replacement values:

```json
{
  "draftId": "018f4f9d-0c63-7b24-bca0-22ddab56d5f1",
  "selections": [],
  "confirmations": [
    { "lineId": "7", "confirmationId": "confirm:agarphale:hop-equals-full-3.05kg-package" }
  ]
}
```

The returned `orderDraft` then contains restored `unitPrice`/`lineTotal`, clears
the old unit warning, and sets `pendingCount` to the number of genuinely
unresolved lines. The model copies that object into `present_order` unchanged.
