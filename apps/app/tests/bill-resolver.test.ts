import { describe, expect, test } from 'bun:test'
import { parseBillMarkdown, resolveBillOrder } from '../server/utils/chat/bill-resolver'
import type { RequestedOrderItem } from '../server/utils/chat/bill-resolver'

const headers = [
  'Mã khách hàng',
  'Tên khách hàng',
  'Bảng giá',
  'Mã hàng',
  'Tên hàng',
  'ĐVT',
  'Thời gian',
  'Số lượng',
  'Đơn giá',
  'Giảm giá',
  'Giá bán',
  'Ghi chú hàng hóa',
]

const customer = ['VAT_BG4_Laph1', 'CF LapH - Trương Định', 'BG4']
const billRows = [
  [...customer, 'boduo-xoai', 'BODUO Mứt Xoài 1,3Kg', 'Hộp', '01/07/2026', '1', '122000', '', '122000', ''],
  [...customer, 'dao-lon', 'Đào Lon Thái To BODDOB 820gr', 'Lon', '01/07/2026', '1', '26500', '', '26500', ''],
  [...customer, 'cozy-dao', 'Trà Cozy Đào túi lọc (25 gói x 2g)', 'Hộp', '01/07/2026', '1', '36000', '', '36000', ''],
  [...customer, 'cam-say', 'Cam Sấy Khô', 'Lạng', '01/07/2026', '2', '29000', '', '29000', ''],
  [...customer, 'cot-dua', 'Nước Cốt Dừa Wonderfarm 400ml', '', '01/07/2026', '1', '29000', '', '29000', ''],
  [...customer, 'cot-dua', 'Nước Cốt Dừa Wonderfarm 400ml', '', '08/07/2026', '1', '30000', '', '30000', ''],
  // Exact duplicate: parser must discard this row before frequency decisions.
  [...customer, 'cot-dua', 'Nước Cốt Dừa Wonderfarm 400ml', '', '08/07/2026', '1', '30000', '', '30000', ''],
  [...customer, 'cot-dua', 'Nước Cốt Dừa Wonderfarm 400ml', 'Lon', '31/12/2026', '', '29000', '', '29000', ''],
  [...customer, 'richs', 'Kem Béo Thực Vật Richs (454G) - Hàng Lạnh', 'Thùng/24 Hộp', '01/07/2026', '1', '705000', '', '705000', ''],
  [...customer, 'agar', 'Thạch Agar Chuandai Nguyên Vị 3.05Kg', '', '01/07/2026', '1', '247000', '', '247000', ''],
  [...customer, 'tra-lai', 'Lục Trà Lài Lộc Phát 1Kg', 'CẬP NHẬT', '01/07/2026', '1', '152000', '', '152000', ''],
  ['KH004610', 'Doris Coffee & Tea House', 'BG4', 'richs-a', 'Richs A', 'Hộp', '01/07/2026', '1', '100000', '', '100000', ''],
  ['KH004611', 'Doris Coffee & Tea House', 'BG4', 'richs-b', 'Richs B', 'Hộp', '01/07/2026', '1', '100000', '', '100000', ''],
]

const markdownRow = (values: string[]) => `| ${values.join(' | ')} |`
const billText = [
  markdownRow(headers),
  `|:${headers.map(() => '---').join('|')}|`,
  ...billRows.map(markdownRow),
].join('\n')
const index = parseBillMarkdown(billText)

const trươngĐịnhItems: RequestedOrderItem[] = [
  { lineId: '1', rawName: 'Mứt xoài', requestedQuantity: 1, requestedUnit: 'Hộp' },
  { lineId: '2', rawName: 'Đào lon', requestedQuantity: 1, requestedUnit: 'Lon' },
  { lineId: '3', rawName: 'Trà đào cozy', requestedQuantity: 1, requestedUnit: 'Hộp' },
  { lineId: '4', rawName: 'Cam sấy khô', requestedQuantity: 200, requestedUnit: 'gr' },
  { lineId: '5', rawName: 'Cốt dừa', requestedQuantity: 4, requestedUnit: 'Lon' },
  { lineId: '6', rawName: 'Richs', requestedQuantity: 12, requestedUnit: 'Hộp' },
  { lineId: '7', rawName: 'Thạch agar', requestedQuantity: 1, requestedUnit: 'Hộp' },
  { lineId: '8', rawName: 'Trà lài', requestedQuantity: 1, requestedUnit: 'kg' },
]

describe('BILL.md deterministic resolver', () => {
  test('parses the schema and deduplicates exact repeated rows', () => {
    expect(index.rows).toHaveLength(billRows.length - 1)
    expect(index.customers).toHaveLength(3)
  })

  test('resolves an address-style customer query to the exact branch code', () => {
    const result = resolveBillOrder(index, {
      draftId: crypto.randomUUID(),
      customerQuery: '04 Trương Định',
      items: trươngĐịnhItems,
    })

    expect(result.customer).toMatchObject({
      status: 'resolved',
      code: 'VAT_BG4_Laph1',
      name: 'CF LapH - Trương Định',
    })
  })

  test('uses customer history, latest price, static unit fallback, and server-side conversion', () => {
    const result = resolveBillOrder(index, {
      draftId: crypto.randomUUID(),
      customerQuery: '04 Trương Định',
      items: trươngĐịnhItems,
    })

    expect(result.lines[0]).toMatchObject({
      status: 'resolved',
      matched: { productName: 'BODUO Mứt Xoài 1,3Kg' },
      resolved: { unit: 'Hộp', unitPrice: 122_000, lineTotal: 122_000 },
    })
    expect(result.lines[4]).toMatchObject({
      status: 'resolved',
      matched: { productName: 'Nước Cốt Dừa Wonderfarm 400ml' },
      resolved: { unitPrice: 30_000, lineTotal: 120_000 },
    })
    expect(result.lines[5]).toMatchObject({
      status: 'resolved',
      matched: { productName: 'Kem Béo Thực Vật Richs (454G) - Hàng Lạnh' },
      resolved: { quantity: 0.5, unit: 'Thùng/24 Hộp', lineTotal: 352_500 },
    })
    expect(result.lines[6]).toMatchObject({
      status: 'resolved',
      resolved: { unit: 'Túi 3.05Kg', unitPrice: 247_000 },
    })
    expect(result.lines[7]).toMatchObject({ status: 'needs_unit_confirmation' })
    expect(result.orderDraft).toMatchObject({ totalAmount: 962_000, pendingCount: 1 })
  })

  test('applies only a resolver-issued confirmation ID to revise a pending line', () => {
    const draftId = crypto.randomUUID()
    const initial = resolveBillOrder(index, {
      draftId,
      customerQuery: '04 Trương Định',
      items: trươngĐịnhItems,
    })
    const { confirmationId } = (initial.lines[7]!.confirmations[0]!)

    const revised = resolveBillOrder(index, {
      draftId,
      customerQuery: '04 Trương Định',
      items: trươngĐịnhItems,
      confirmations: [{ lineId: '8', confirmationId }],
    })

    expect(revised.lines[7]).toMatchObject({
      status: 'resolved',
      resolved: { quantity: 1, unit: 'kg', unitPrice: 152_000, lineTotal: 152_000 },
    })
    expect(revised.orderDraft).toMatchObject({ totalAmount: 1_114_000, pendingCount: 0 })
  })

  test('does not merge customers that share the same display name', () => {
    const result = resolveBillOrder(index, {
      draftId: crypto.randomUUID(),
      customerQuery: 'Doris Coffee & Tea House',
      items: [{ lineId: '1', rawName: 'Richs', requestedQuantity: 1, requestedUnit: 'Hộp' }],
    })

    expect(result.customer.status).toBe('ambiguous')
    expect(result.customer.candidates.map(candidate => candidate.code).sort()).toEqual(['KH004610', 'KH004611'])
    expect(result.orderDraft).toBeNull()
  })
})

const baoKhachCustomer = ['BK001', 'Cửa Hàng Báo Khách', 'BG9']
const baoKhachRows = [
  // (a) đã báo 09.05.26, có đơn mua lại SAU ngày báo cùng giá → coi như khách đã đồng ý
  [...baoKhachCustomer, 'sua-abc', 'Sữa Đặc ABC 380g', 'Hộp', '31/12/2026', '', '100000', '', '100000', 'CẬP NHẬT - BÁO KHÁCH 09.05.26'],
  [...baoKhachCustomer, 'sua-abc', 'Sữa Đặc ABC 380g', 'Hộp', '10/06/2026', '1', '100000', '', '100000', ''],
  // (b) đã báo 09.05.26 nhưng đơn gần nhất TRƯỚC ngày báo → chưa mua lại, cần báo lại giá
  [...baoKhachCustomer, 'tra-q', 'Trà Q 1Kg', 'Hộp', '31/12/2026', '', '152000', '', '152000', 'CẬP NHẬT - BÁO KHÁCH 09.05.26'],
  [...baoKhachCustomer, 'tra-q', 'Trà Q 1Kg', 'Hộp', '01/04/2026', '1', '152000', '', '152000', ''],
  // (c) CẬP NHẬT - BÁO KHÁCH nhưng note không có ngày → giữ cảnh báo chung, vẫn resolve
  [...baoKhachCustomer, 'cafe-r', 'Cà Phê R 500g', 'Hộp', '31/12/2026', '', '50000', '', '50000', 'CẬP NHẬT - BÁO KHÁCH'],
  [...baoKhachCustomer, 'cafe-r', 'Cà Phê R 500g', 'Hộp', '01/07/2026', '1', '50000', '', '50000', ''],
]
const baoKhachIndex = parseBillMarkdown([
  markdownRow(headers),
  `|:${headers.map(() => '---').join('|')}|`,
  ...baoKhachRows.map(markdownRow),
].join('\n'))
const baoKhachItems: RequestedOrderItem[] = [
  { lineId: 'a', rawName: 'Sữa Đặc ABC', requestedQuantity: 1, requestedUnit: 'Hộp' },
  { lineId: 'b', rawName: 'Trà Q', requestedQuantity: 1, requestedUnit: 'Hộp' },
  { lineId: 'c', rawName: 'Cà Phê R', requestedQuantity: 1, requestedUnit: 'Hộp' },
]

describe('CẬP NHẬT - BÁO KHÁCH decision', () => {
  test('resolves silently when the customer repurchased after the notified date at the same price', () => {
    const result = resolveBillOrder(baoKhachIndex, {
      draftId: crypto.randomUUID(),
      customerQuery: 'BK001',
      items: baoKhachItems,
    })

    expect(result.lines[0]).toMatchObject({
      status: 'resolved',
      resolved: { unitPrice: 100_000 },
    })
    expect(result.lines[0]!.warning).toContain('mua lại')
  })

  test('needs price confirmation when there is no repurchase after the notified date', () => {
    const draftId = crypto.randomUUID()
    const initial = resolveBillOrder(baoKhachIndex, {
      draftId,
      customerQuery: 'BK001',
      items: baoKhachItems,
    })

    expect(initial.lines[1]!.status).toBe('needs_price_confirmation')
    const confirmation = initial.lines[1]!.confirmations.find(entry => entry.kind === 'price')
    expect(confirmation).toBeDefined()

    const revised = resolveBillOrder(baoKhachIndex, {
      draftId,
      customerQuery: 'BK001',
      items: baoKhachItems,
      confirmations: [{ lineId: 'b', confirmationId: confirmation!.confirmationId }],
    })

    expect(revised.lines[1]).toMatchObject({
      status: 'resolved',
      resolved: { unitPrice: 152_000 },
    })
  })

  test('keeps the generic warning when the note has no notified date', () => {
    const result = resolveBillOrder(baoKhachIndex, {
      draftId: crypto.randomUUID(),
      customerQuery: 'BK001',
      items: baoKhachItems,
    })

    expect(result.lines[2]).toMatchObject({ status: 'resolved' })
    expect(result.lines[2]!.warning).toBe('⚠️ Bảng giá ghi CẬP NHẬT - BÁO KHÁCH')
  })
})

const noUnitCustomer = ['NU001', 'Cửa Hàng Không ĐVT', 'BG10']
const noUnitRows = [
  // ĐVT column blank, but the packaging + size is written into the product name.
  [...noUnitCustomer, 'mut-chunky', 'Mứt Chunky Vải, Hoa Hồng Túi 1Kg', '', '01/07/2026', '1', '177000', '', '177000', ''],
]
const noUnitIndex = parseBillMarkdown([
  markdownRow(headers),
  `|:${headers.map(() => '---').join('|')}|`,
  ...noUnitRows.map(markdownRow),
].join('\n'))

describe('ĐVT derived from the product name when the column is blank', () => {
  test('bills "1 kg" of "... Túi 1Kg" as 1 Túi instead of stalling on a missing ĐVT', () => {
    const result = resolveBillOrder(noUnitIndex, {
      draftId: crypto.randomUUID(),
      customerQuery: 'NU001',
      items: [{ lineId: '1', rawName: 'Mứt Chunky Vải, Hoa Hồng', requestedQuantity: 1, requestedUnit: 'kg' }],
    })

    expect(result.lines[0]).toMatchObject({
      status: 'resolved',
      evidence: { unitSource: 'product_name' },
      resolved: { unit: 'Túi 1Kg', quantity: 1, unitPrice: 177_000, lineTotal: 177_000 },
    })
  })
})

// The 111 Nguyễn Huệ bug: one product name, two SKUs — retail "Hộp" and case
// "Thùng/12 Hộp". The newest row was the case SKU, so a "6 hộp" order was
// silently billed as 0.5 thùng at the case price instead of the retail SKU.
const packVariantCustomer = ['FB_2480', '111 Nguyễn Huệ', 'Bảng giá chung']
const packVariantRows = [
  [...packVariantCustomer, '(ĐG)stkd', 'Sữa Tươi Vinamilk KHÔNG Đường 1L', 'Hộp', '16/06/2026', '6', '36000', '0', '36000', ''],
  [...packVariantCustomer, '(ĐG)stkdt', 'Sữa Tươi Vinamilk KHÔNG Đường 1L', 'Thùng/12 Hộp', '24/06/2026', '1', '420000', '0', '420000', ''],
]
const packVariantIndex = parseBillMarkdown([
  markdownRow(headers),
  `|:${headers.map(() => '---').join('|')}|`,
  ...packVariantRows.map(markdownRow),
].join('\n'))

describe('same-name packaging variants (retail Hộp vs case Thùng/12 Hộp)', () => {
  test('a "hộp" order picks the retail SKU even when the case row is newer', () => {
    const result = resolveBillOrder(packVariantIndex, {
      draftId: crypto.randomUUID(),
      customerQuery: '111 Nguyễn Huệ',
      items: [{ lineId: '1', rawName: 'Sữa tươi vinamilk không đường', requestedQuantity: 6, requestedUnit: 'Hộp' }],
    })

    expect(result.lines[0]).toMatchObject({
      status: 'resolved',
      matched: { sku: '(ĐG)stkd' },
      resolved: { quantity: 6, unit: 'Hộp', unitPrice: 36_000, lineTotal: 216_000 },
    })
  })

  test('a "thùng" order picks the case SKU', () => {
    const result = resolveBillOrder(packVariantIndex, {
      draftId: crypto.randomUUID(),
      customerQuery: '111 Nguyễn Huệ',
      items: [{ lineId: '1', rawName: 'Sữa tươi vinamilk không đường', requestedQuantity: 1, requestedUnit: 'Thùng' }],
    })

    expect(result.lines[0]).toMatchObject({
      status: 'resolved',
      matched: { sku: '(ĐG)stkdt' },
      resolved: { quantity: 1, unit: 'Thùng/12 Hộp', unitPrice: 420_000, lineTotal: 420_000 },
    })
  })
})

const siroCustomer = ['SR001', 'CF Siro Đà Nẵng', 'BG11']
const siroRows = [
  [...siroCustomer, 'quynhdv', 'Syrup Davinci Vải 750ml', 'Chai', '01/07/2026', '1', '190000', '', '190000', ''],
  [...siroCustomer, 'quynhdavn', 'Syrup Davinci Đào 750ml', 'Chai', '02/07/2026', '1', '190000', '', '190000', ''],
]
const siroIndex = parseBillMarkdown([
  markdownRow(headers),
  `|:${headers.map(() => '---').join('|')}|`,
  ...siroRows.map(markdownRow),
].join('\n'))

describe('customer vocabulary synonym: siro = syrup', () => {
  test('resolves "siro vải" and "siro đào" to the Syrup catalog rows', () => {
    const result = resolveBillOrder(siroIndex, {
      draftId: crypto.randomUUID(),
      customerQuery: 'SR001',
      items: [
        { lineId: '1', rawName: 'siro vải', requestedQuantity: 1, requestedUnit: 'Chai' },
        { lineId: '2', rawName: 'siro đào', requestedQuantity: 2, requestedUnit: 'Chai' },
      ],
    })

    expect(result.lines[0]).toMatchObject({
      status: 'resolved',
      matched: { productName: 'Syrup Davinci Vải 750ml' },
      resolved: { quantity: 1, unitPrice: 190_000, lineTotal: 190_000 },
    })
    expect(result.lines[1]).toMatchObject({
      status: 'resolved',
      matched: { productName: 'Syrup Davinci Đào 750ml' },
      resolved: { quantity: 2, unitPrice: 190_000, lineTotal: 380_000 },
    })
    expect(result.orderDraft).toMatchObject({ pendingCount: 0, totalAmount: 570_000 })
  })
})

const mismatchCustomer = ['MC001', '43 House CF', 'BG7']
const mismatchRows = [
  [...mismatchCustomer, 'tran-chau-trang', 'Trân Châu 3Q Talinh Trắng', 'Gói', '01/07/2026', '1', '45000', '', '45000', ''],
  [...mismatchCustomer, 'richs-lanh', 'Kem Béo Thực Vật Richs 454G', 'Thùng/24 Hộp', '01/07/2026', '1', '705000', '', '705000', ''],
]
const mismatchIndex = parseBillMarkdown([
  markdownRow(headers),
  `|:${headers.map(() => '---').join('|')}|`,
  ...mismatchRows.map(markdownRow),
].join('\n'))

describe('staff confirmation for a requested unit the catalog does not know', () => {
  // The bug: the resolver flagged "1 bì" of a "Gói" product pending but issued no
  // confirmationId, so no staff confirmation could ever clear it — the order looped.
  test('offers a 1:1 unit confirmation instead of a dead-end pending line', () => {
    const result = resolveBillOrder(mismatchIndex, {
      draftId: crypto.randomUUID(),
      customerQuery: 'MC001',
      items: [{ lineId: '1', rawName: 'Trân châu trắng', requestedQuantity: 1, requestedUnit: 'bì' }],
    })

    const line = result.lines[0]!
    expect(line.status).toBe('needs_unit_confirmation')
    expect(line.confirmations).toHaveLength(1)
    expect(line.confirmations[0]).toMatchObject({ kind: 'unit' })
    expect(line.confirmations[0]!.confirmationId).toBeTruthy()
  })

  test('resolves the line 1:1 once staff sends the confirmationId back', () => {
    const draftId = crypto.randomUUID()
    const items = [{ lineId: '1', rawName: 'Trân châu trắng', requestedQuantity: 2, requestedUnit: 'bì' }]
    const pending = resolveBillOrder(mismatchIndex, { draftId, customerQuery: 'MC001', items })
    const { confirmationId } = pending.lines[0]!.confirmations[0]!

    const confirmed = resolveBillOrder(mismatchIndex, {
      draftId,
      customerQuery: 'MC001',
      items,
      confirmations: [{ lineId: '1', confirmationId }],
    })

    expect(confirmed.lines[0]).toMatchObject({
      status: 'resolved',
      evidence: { unitSource: 'staff_confirmation' },
      resolved: { quantity: 2, unit: 'Gói', unitPrice: 45_000, lineTotal: 90_000 },
    })
    expect(confirmed.resolutionStatus).toBe('resolved')
    expect(confirmed.orderDraft).toMatchObject({ pendingCount: 0, totalAmount: 90_000 })
    // present_order re-normalizes the draft, so the confirmation must travel with it.
    expect(confirmed.orderDraft!.items[0]).toMatchObject({ unitConfirmed: true })
  })

  test('never offers a 1:1 mapping for a fractional pack line (would mis-bill 5 Hộp as 5 Thùng)', () => {
    const result = resolveBillOrder(mismatchIndex, {
      draftId: crypto.randomUUID(),
      customerQuery: 'MC001',
      items: [{ lineId: '1', rawName: 'Richs', requestedQuantity: 5, requestedUnit: 'Hộp' }],
    })

    expect(result.lines[0]!.status).toBe('needs_unit_confirmation')
    expect(result.lines[0]!.confirmations).toHaveLength(0)
  })
})

const gramsCustomer = ['FB_8074', '18Grams Cafe', 'Bảng giá chung']
const gramsRows = [
  [...gramsCustomer, '(GK)xla', 'Sữa Đặc NSPN XANH LÁ 1.284kg', 'Hộp', '04/07/2026', '2', '65000', '', '65000', ''],
  [...gramsCustomer, '(GK)xla', 'Sữa Đặc NSPN XANH LÁ 1.284kg', 'Hộp', '22/06/2026', '3', '65000', '', '65000', ''],
  // Sữa tươi: the newest purchase row carries no numeric price; the priced row
  // 12 days earlier in the customer's history is still current-price evidence.
  [...gramsCustomer, '(ĐG-BB)SP82444', 'Sữa Tươi Nguyên Chất WESTERN (Fat 3.8%)', 'Hộp', '04/07/2026', '6', '', '', '', 'giao kèm đơn'],
  [...gramsCustomer, '(ĐG-BB)SP82444', 'Sữa Tươi Nguyên Chất WESTERN (Fat 3.8%)', 'Hộp', '22/06/2026', '6', '34000', '', '34000', ''],
  // Matcha: the only priced purchase is months before the newest one. The full
  // customer history is evidence, so it still beats the static price list.
  [...gramsCustomer, '(ĐG-BB)mcha', 'Bột Matcha IMO 100gr', 'Gói', '04/07/2026', '1', '', '', '', ''],
  [...gramsCustomer, '(ĐG-BB)mcha', 'Bột Matcha IMO 100gr', 'Gói', '03/04/2026', '1', '130000', '', '130000', ''],
  [...gramsCustomer, '(ĐG-BB)mcha', 'Bột Matcha IMO 100gr', 'Gói', '31/12/2026', '', '135000', '', '135000', ''],
]
const gramsIndex = parseBillMarkdown([
  markdownRow(headers),
  `|:${headers.map(() => '---').join('|')}|`,
  ...gramsRows.map(markdownRow),
].join('\n'))

describe('customer name alias: coffee = cafe', () => {
  test('resolves "18Grams Coffee" to the 18Grams Cafe customer code', () => {
    const result = resolveBillOrder(gramsIndex, {
      draftId: crypto.randomUUID(),
      customerQuery: '18Grams Coffee',
      items: [{ lineId: '1', rawName: 'sữa tươi western', requestedQuantity: 6, requestedUnit: 'Hộp' }],
    })

    expect(result.customer).toMatchObject({ status: 'resolved', code: 'FB_8074', name: '18Grams Cafe' })
  })
})

describe('full purchase history instead of the single newest purchase date', () => {
  test('an unpriced newest purchase falls back to the newest priced row in history', () => {
    const result = resolveBillOrder(gramsIndex, {
      draftId: crypto.randomUUID(),
      customerQuery: '18Grams Coffee',
      items: [{ lineId: '1', rawName: 'sữa tươi western', requestedQuantity: 6, requestedUnit: 'Hộp' }],
    })

    expect(result.lines[0]).toMatchObject({
      status: 'resolved',
      evidence: { priceSource: 'latest_positive_history' },
      resolved: { quantity: 6, unitPrice: 34_000, lineTotal: 204_000 },
    })
  })

  test('a months-old priced purchase is still history evidence and beats the static price', () => {
    const result = resolveBillOrder(gramsIndex, {
      draftId: crypto.randomUUID(),
      customerQuery: '18Grams Coffee',
      items: [{ lineId: '1', rawName: 'matcha imo', requestedQuantity: 1, requestedUnit: 'Gói' }],
    })

    expect(result.lines[0]).toMatchObject({
      status: 'resolved',
      evidence: { priceSource: 'latest_positive_history' },
      resolved: { quantity: 1, unitPrice: 130_000, lineTotal: 130_000 },
    })
  })
})
