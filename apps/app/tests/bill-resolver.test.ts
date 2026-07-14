import { describe, expect, test } from 'bun:test'
import { collectChatMemory, customerQueryKey, emptyChatOrderMemory, normalizeBillText, parseBillMarkdown, resolveBillOrder } from '../server/utils/chat/bill-resolver'
import { mergeRequestedOrderItems, resolveBillOrderInputSchema } from '../server/utils/chat/resolve-bill-order-tool'
import type { ChatOrderMemory, RequestedOrderItem } from '../server/utils/chat/bill-resolver'

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
  ['KH004610', 'Doris Coffee & Tea House', 'BG4', 'ber-oi', 'Sinh Tố Berrino Ổi Hồng 1000ml', '', '05/07/2026', '1', '108000', '', '108000', ''],
  ['KH004611', 'Doris Coffee & Tea House', 'BG4', 'richs-b', 'Richs B', 'Hộp', '01/07/2026', '1', '100000', '', '100000', ''],
]

const markdownRow = (values: string[]) => `| ${values.join(' | ')} |`
const billText = [
  markdownRow(headers),
  `|:${headers.map(() => '---').join('|')}|`,
  ...billRows.map(markdownRow),
].join('\n')
const index = parseBillMarkdown(billText)

describe('resolve_bill_order input', () => {
  test('defaults an omitted customer unit to empty instead of forcing the model to guess', () => {
    const parsed = resolveBillOrderInputSchema.parse({
      customerQuery: 'Anh Công Đức FB',
      items: [{ lineId: '1', rawName: 'sinh tố đào', requestedQuantity: 1 }],
    })

    expect(parsed.items?.[0]?.requestedUnit).toBe('')
  })

  test('merges corrected revision lines without dropping resolved draft items', () => {
    const current: RequestedOrderItem[] = [
      { lineId: '1', rawName: 'bí đao miki', requestedQuantity: 2, requestedUnit: '' },
      { lineId: '2', rawName: 'rich', requestedQuantity: 5, requestedUnit: '' },
      { lineId: '3', rawName: 'mứt ổi', requestedQuantity: 1, requestedUnit: '' },
    ]
    const correction: RequestedOrderItem = {
      lineId: '3', rawName: 'sinh tố berrino ổi hồng', requestedQuantity: 1, requestedUnit: '',
    }
    const merged = mergeRequestedOrderItems(current, [correction])

    expect(merged).toHaveLength(3)
    expect(merged.map(item => item.rawName)).toEqual(['bí đao miki', 'rich', 'sinh tố berrino ổi hồng'])
  })
})

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

  test('offers a same-price-list candidate for a new product and requires its reference price confirmation', () => {
    const draftId = crypto.randomUUID()
    const item = { lineId: 'new', rawName: 'sinh tố berrino ổi hồng', requestedQuantity: 1, requestedUnit: '' }
    const initial = resolveBillOrder(index, {
      draftId,
      customerQuery: '04 Trương Định',
      items: [item],
    })

    expect(initial.lines[0]).toMatchObject({
      status: 'needs_product_confirmation',
      candidates: [{ productName: 'Sinh Tố Berrino Ổi Hồng 1000ml' }],
    })
    const { candidateId } = initial.lines[0]!.candidates[0]!

    const selected = resolveBillOrder(index, {
      draftId,
      customerQuery: '04 Trương Định',
      items: [item],
      selections: [{ lineId: 'new', candidateId }],
    })
    expect(selected.lines[0]).toMatchObject({
      status: 'needs_price_confirmation',
      matched: { productName: 'Sinh Tố Berrino Ổi Hồng 1000ml' },
      evidence: { selectionSource: 'staff_confirmation', priceSource: 'global_reference' },
    })
    const priceConfirmationId = selected.lines[0]!.confirmations.find(entry => entry.kind === 'price')!.confirmationId

    const confirmed = resolveBillOrder(index, {
      draftId,
      customerQuery: '04 Trương Định',
      items: [item],
      selections: [{ lineId: 'new', candidateId }],
      confirmations: [{ lineId: 'new', confirmationId: priceConfirmationId }],
    })
    expect(confirmed.lines[0]).toMatchObject({
      status: 'resolved',
      resolved: { quantity: 1, unit: 'Đơn vị', unitPrice: 108_000, lineTotal: 108_000 },
    })
  })

  test('does not guess a new product from an unrelated shorthand', () => {
    const result = resolveBillOrder(index, {
      draftId: crypto.randomUUID(),
      customerQuery: '04 Trương Định',
      items: [{ lineId: 'new', rawName: 'mứt ổi', requestedQuantity: 1, requestedUnit: '' }],
    })

    expect(result.lines[0]).toMatchObject({ status: 'not_found', candidates: [] })
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
  // The bug: the resolver flagged "1 bao" of a "Gói" product pending but issued no
  // confirmationId, so no staff confirmation could ever clear it — the order looped.
  test('offers a 1:1 unit confirmation instead of a dead-end pending line', () => {
    const result = resolveBillOrder(mismatchIndex, {
      draftId: crypto.randomUUID(),
      customerQuery: 'MC001',
      items: [{ lineId: '1', rawName: 'Trân châu trắng', requestedQuantity: 1, requestedUnit: 'bao' }],
    })

    const line = result.lines[0]!
    expect(line.status).toBe('needs_unit_confirmation')
    expect(line.confirmations).toHaveLength(1)
    expect(line.confirmations[0]).toMatchObject({ kind: 'unit' })
    expect(line.confirmations[0]!.confirmationId).toBeTruthy()
  })

  test('resolves the line 1:1 once staff sends the confirmationId back', () => {
    const draftId = crypto.randomUUID()
    const items = [{ lineId: '1', rawName: 'Trân châu trắng', requestedQuantity: 2, requestedUnit: 'bao' }]
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

const congDucCustomer = ['FB_8509', 'Anh Công Đức FB', 'Bảng giá chung']
const congDucRows = [
  [...congDucCustomer, 'bot-bone-thung', 'Bột sữa B One', 'Thùng/12 Gói', '28/06/2026', '1', '850000', '', '850000', ''],
  [...congDucCustomer, 'sua-vinamilk', 'Sữa Tươi Vinamilk KHÔNG Đường 1L', 'Thùng/12 Hộp', '05/07/2026', '1', '420000', '', '420000', ''],
  [...congDucCustomer, 'sua-vinamilk', 'Sữa Tươi Vinamilk KHÔNG Đường 1L', 'Thùng/12 Hộp', '01/07/2026', '1', '420000', '', '420000', ''],
  [...congDucCustomer, 'sua-gau', 'Sữa Tươi GẤU NESTLE Không Đường 140ml', 'Lốc/12 Lon', '03/07/2026', '1', '125000', '', '125000', ''],
  [...congDucCustomer, 'duong-trang', 'Đường Trắng', '10KG', '03/07/2026', '1', '195000', '', '195000', ''],
  [...congDucCustomer, 'duong-trang', 'Đường Trắng', '10KG', '26/06/2026', '1', '195000', '', '195000', ''],
  [...congDucCustomer, 'duong-den', 'Đường Đen Hàn Quốc Beksul', 'Gói', '21/06/2026', '2', '53000', '', '53000', ''],
  // Regression: one-edit matching must not turn "đường" into "muỗng".
  [...congDucCustomer, 'muong-trang', 'Muỗng Nhựa Trắng 100 Cái', 'Gói', '06/07/2026', '1', '25000', '', '25000', ''],
  [...congDucCustomer, 'kem-trung-flago', 'Bột Kem Trứng Búp Bê Vàng - Hiệu Flago', 'Kg', '19/05/2026', '1', '155000', '', '155000', ''],
  [...congDucCustomer, 'kem-trung-lotus', 'Bột Kem Trứng Vàng Búp Bê Lotusfood 1kg', '', '14/06/2026', '1', '140000', '', '140000', ''],
  // The dated increase was accepted by the 19/05 purchase above.
  ['FB_8509', 'Anh Công Đức FB', 'Anh Công Đức FB', 'kem-trung-flago', 'Bột Kem Trứng Búp Bê Vàng - Hiệu Flago', 'Kg', '31/12/2026', '', '160000', '5000', '155000', 'Báo Tăng - 12.05.26'],
  [...congDucCustomer, 'rau-cau-padme', 'Bột Rau Câu Padme', 'Hộp', '03/07/2026', '1', '48000', '', '48000', ''],
  [...congDucCustomer, 'sinh-to-dao', 'Sinh Tố Berrino Đào 1000Ml', '', '01/07/2026', '1', '89500', '', '89500', ''],
  [...congDucCustomer, 'richs', 'Kem Béo Thực Vật Richs (454G) - Hàng Lạnh', 'Hộp', '03/07/2026', '5', '30000', '', '30000', ''],
  [...congDucCustomer, 'base', 'Kem Topping Base - Hàng Lạnh', 'Hộp', '03/07/2026', '1', '84000', '', '84000', ''],
  [...congDucCustomer, 'mole-dua-luoi', 'Bột Pudding Mole Dưa Lưới 1Kg', 'Gói', '03/06/2026', '1', '205000', '', '205000', ''],
  [...congDucCustomer, 'tran-chau-den', '1Kg Trân Châu Hàng Huy (2.5) - Đường Đen', 'Gói', '03/07/2026', '5', '33000', '', '33000', ''],
  [...congDucCustomer, 'dingfong-dau', 'Syrup Thái Dingfong Strawberry ( DÂU )', '', '28/06/2026', '1', '63000', '', '63000', ''],
  [...congDucCustomer, 'dingfong-vai', 'Syrup Thái Dingfong Lychee ( Vải )', '', '28/06/2026', '1', '63000', '', '63000', ''],
  [...congDucCustomer, 'gf-mang-cau', 'Syrup Đậm Đặc GF Mãng Cầu 700ml', '', '28/06/2026', '1', '63000', '', '63000', ''],
  [...congDucCustomer, 'gf-chanh-day', 'Syrup Đậm Đặc GF Chanh Dây 700ml', '', '05/06/2026', '1', '63000', '', '63000', ''],
  [...congDucCustomer, 'gf-thom', 'Syrup Đậm Đặc GF Thơm (Dứa) 700ml', '', '21/06/2026', '1', '63000', '', '63000', ''],
  [...congDucCustomer, 'vot-nho', 'Vợt Múc Trân Châu/ Thạch Cỡ Nhỏ', '', '18/03/2026', '2', '20000', '', '20000', ''],
]
const congDucIndex = parseBillMarkdown([
  markdownRow(headers),
  `|:${headers.map(() => '---').join('|')}|`,
  ...congDucRows.map(markdownRow),
].join('\n'))

describe('Anh Công Đức FB shorthand order', () => {
  test('resolves all 16 lines from customer history without inventing omitted units', () => {
    const specs: Array<[string, number, string]> = [
      ['bột béo', 1, 'Thùng'],
      ['sữa tươi', 1, 'Thùng'],
      ['đường', 10, 'kg'],
      ['bột kem trứng brulee', 1, ''],
      ['rau câu', 1, 'Hộp'],
      ['sinh tố đào', 1, ''],
      ['rich', 5, ''],
      ['base', 1, ''],
      ['bột mole dưa lưới', 1, ''],
      ['trân châu đen', 5, ''],
      ['siro dâu dingfong', 1, ''],
      ['siro vải dinhfong', 1, ''],
      ['siro mảng cầu đậm đặc', 1, ''],
      ['siro chanh dây đậm đặc', 1, ''],
      ['siro thơm đậm đặc', 1, ''],
      ['vợt múc trân châu', 1, 'Cái'],
    ]
    const items = specs.map(([rawName, requestedQuantity, requestedUnit], index) => ({
      lineId: String(index + 1),
      rawName,
      requestedQuantity,
      requestedUnit,
    }))

    const result = resolveBillOrder(congDucIndex, {
      draftId: crypto.randomUUID(),
      customerQuery: 'Anh Công Đức FB',
      items,
    })

    expect(result.resolutionStatus).toBe('resolved')
    expect(result.lines.every(line => line.status === 'resolved')).toBe(true)
    expect(result.lines.map(line => line.matched?.productName)).toEqual([
      'Bột sữa B One',
      'Sữa Tươi Vinamilk KHÔNG Đường 1L',
      'Đường Trắng',
      'Bột Kem Trứng Búp Bê Vàng - Hiệu Flago',
      'Bột Rau Câu Padme',
      'Sinh Tố Berrino Đào 1000Ml',
      'Kem Béo Thực Vật Richs (454G) - Hàng Lạnh',
      'Kem Topping Base - Hàng Lạnh',
      'Bột Pudding Mole Dưa Lưới 1Kg',
      '1Kg Trân Châu Hàng Huy (2.5) - Đường Đen',
      'Syrup Thái Dingfong Strawberry ( DÂU )',
      'Syrup Thái Dingfong Lychee ( Vải )',
      'Syrup Đậm Đặc GF Mãng Cầu 700ml',
      'Syrup Đậm Đặc GF Chanh Dây 700ml',
      'Syrup Đậm Đặc GF Thơm (Dứa) 700ml',
      'Vợt Múc Trân Châu/ Thạch Cỡ Nhỏ',
    ])
    expect(result.lines.map(line => line.resolved?.unitPrice)).toEqual([
      850_000,
      420_000,
      195_000,
      155_000,
      48_000,
      89_500,
      30_000,
      84_000,
      205_000,
      33_000,
      63_000,
      63_000,
      63_000,
      63_000,
      63_000,
      20_000,
    ])
    expect(result.lines[2]!.candidates.map(candidate => candidate.productName)).not.toContain('Muỗng Nhựa Trắng 100 Cái')
    expect(result.lines[3]).toMatchObject({ status: 'resolved', evidence: { priceSource: 'latest_positive_history' } })
    expect(result.lines[5]).toMatchObject({ status: 'resolved', evidence: { unitSource: 'implicit_each' } })
    expect(result.lines[15]).toMatchObject({ status: 'resolved', evidence: { unitSource: 'business_override' } })
    expect(result.orderDraft).toMatchObject({ totalQuantity: 24, totalAmount: 2_696_500, pendingCount: 0 })
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

// ADR 0001: chat-scoped confirmation memory. Confirmations from earlier drafts
// in the same chat are reused; BILL.md evidence always beats the memory.
const chatMemory = (partial: Partial<ChatOrderMemory>): ChatOrderMemory => ({
  customerSelections: [],
  productAliases: [],
  unitMappings: [],
  priceConfirmations: [],
  ...partial,
})

const memCustomer = ['MEM01', 'Trà Sữa Mộng Mơ', 'BG12']
const memRows = [
  // Two white-pearl brands where recency (Talinh) and frequency (Zion) disagree
  // → a generic "trân châu trắng" request is ambiguous without memory.
  [...memCustomer, 'tc-zion', 'Trân Châu 3Q Zion Trắng', 'Thùng/6 Gói', '01/07/2026', '1', '290000', '', '290000', ''],
  [...memCustomer, 'tc-zion', 'Trân Châu 3Q Zion Trắng', 'Thùng/6 Gói', '02/07/2026', '1', '290000', '', '290000', ''],
  [...memCustomer, 'tc-talinh', 'Trân Châu Talinh Trắng', 'Thùng/6 Gói', '05/07/2026', '2', '280000', '', '280000', ''],
  // Staff shorthand "rich lùn" shares no full token with this name → not_found without an alias.
  [...memCustomer, 'richs-lun', 'Kem Béo Thực Vật Richs (454G) - Hàng Lạnh', 'Thùng/24 Hộp', '03/07/2026', '1', '705000', '', '705000', ''],
  // No catalog ĐVT anywhere and no unit in the name → unit must come from staff.
  [...memCustomer, 'sinh-to-vai', 'Sinh Tố Bốn Mùa Osterberg Vải', '', '02/07/2026', '1', '135000', '', '135000', ''],
  // Static price note flags a price confirmation on every order.
  [...memCustomer, 'bot-x', 'Bột Sương Sáo X', 'Gói', '01/07/2026', '1', '40000', '', '40000', ''],
  [...memCustomer, 'bot-x', 'Bột Sương Sáo X', 'Gói', '31/12/2026', '', '40000', '', '40000', 'Hỏi lại giá'],
  // Valid catalog ĐVT exists → memory must never override it.
  [...memCustomer, 'sua-chua-y', 'Sữa Chua Uống Y', 'Hộp', '01/07/2026', '1', '20000', '', '20000', ''],
]
const memIndex = parseBillMarkdown([
  markdownRow(headers),
  `|:${headers.map(() => '---').join('|')}|`,
  ...memRows.map(markdownRow),
].join('\n'))

describe('chat-scoped confirmation memory (ADR 0001)', () => {
  test('resolves an ambiguous branch name from a remembered selection, with visible provenance', () => {
    const result = resolveBillOrder(index, {
      draftId: crypto.randomUUID(),
      customerQuery: 'Doris Coffee & Tea House',
      items: [{ lineId: '1', rawName: 'Richs A', requestedQuantity: 1, requestedUnit: 'Hộp' }],
      chatMemory: chatMemory({
        // canonicalized query key: accents folded, coffee → cafe
        customerSelections: [{ queryKey: 'doris cafe tea house', customerCode: 'KH004610' }],
      }),
    })

    expect(result.customer).toMatchObject({ status: 'resolved', code: 'KH004610' })
    expect(result.orderDraft?.customerNote).toContain('trong chat')
  })

  test('a remembered branch that BILL.md no longer lists falls back to asking', () => {
    const result = resolveBillOrder(index, {
      draftId: crypto.randomUUID(),
      customerQuery: 'Doris Coffee & Tea House',
      items: [{ lineId: '1', rawName: 'Richs A', requestedQuantity: 1, requestedUnit: 'Hộp' }],
      chatMemory: chatMemory({
        customerSelections: [{ queryKey: 'doris cafe tea house', customerCode: 'KH999999' }],
      }),
    })

    expect(result.customer.status).toBe('ambiguous')
  })

  test('a remembered per-customer alias resolves a shorthand that matches no tokens', () => {
    const result = resolveBillOrder(memIndex, {
      draftId: crypto.randomUUID(),
      customerQuery: 'MEM01',
      items: [{ lineId: '1', rawName: 'rich lùn', requestedQuantity: 1, requestedUnit: 'Thùng' }],
      chatMemory: chatMemory({
        productAliases: [
          {
            customerCode: 'MEM01',
            aliasKey: normalizeBillText('rich lùn'),
            productKey: normalizeBillText('Kem Béo Thực Vật Richs (454G) - Hàng Lạnh'),
          }
        ],
      }),
    })

    expect(result.lines[0]).toMatchObject({
      status: 'resolved',
      matched: { productName: 'Kem Béo Thực Vật Richs (454G) - Hàng Lạnh' },
      evidence: { selectionSource: 'chat_memory' },
      resolved: { quantity: 1, unit: 'Thùng/24 Hộp', unitPrice: 705_000, lineTotal: 705_000 },
    })
    expect(result.orderDraft!.items[0]!.note).toContain('trong chat')
  })

  test('an alias picks between ambiguous variants only for the customer it was confirmed for', () => {
    const items: RequestedOrderItem[] = [{ lineId: '1', rawName: 'trân châu trắng', requestedQuantity: 1, requestedUnit: 'Thùng' },]
    const zionAlias = (customerCode: string) => chatMemory({
      productAliases: [
        {
          customerCode,
          aliasKey: normalizeBillText('trân châu trắng'),
          productKey: normalizeBillText('Trân Châu 3Q Zion Trắng'),
        }
      ],
    })

    const withAlias = resolveBillOrder(memIndex, {
      draftId: crypto.randomUUID(),
      customerQuery: 'MEM01',
      items,
      chatMemory: zionAlias('MEM01'),
    })
    expect(withAlias.lines[0]).toMatchObject({
      status: 'resolved',
      matched: { productName: 'Trân Châu 3Q Zion Trắng' },
      evidence: { selectionSource: 'chat_memory' },
    })

    const otherCustomerAlias = resolveBillOrder(memIndex, {
      draftId: crypto.randomUUID(),
      customerQuery: 'MEM01',
      items,
      chatMemory: zionAlias('KH_OTHER'),
    })
    expect(otherCustomerAlias.lines[0]!.status).toBe('needs_product_confirmation')
  })

  test('a remembered 1:1 unit fills a missing catalog ĐVT for the exact requested unit only', () => {
    const memory = chatMemory({
      unitMappings: [
        {
          productKey: normalizeBillText('Sinh Tố Bốn Mùa Osterberg Vải'),
          requestedUnitKey: normalizeBillText('chai'),
          kind: 'requested-1to1',
        }
      ],
    })

    const matching = resolveBillOrder(memIndex, {
      draftId: crypto.randomUUID(),
      customerQuery: 'MEM01',
      items: [{ lineId: '1', rawName: 'Sinh tố bốn mùa osterberg vải', requestedQuantity: 2, requestedUnit: 'chai' }],
      chatMemory: memory,
    })
    expect(matching.lines[0]).toMatchObject({
      status: 'resolved',
      evidence: { unitSource: 'chat_memory' },
      resolved: { quantity: 2, unit: 'chai', unitPrice: 135_000, lineTotal: 270_000 },
    })
    expect(matching.orderDraft!.items[0]!.note).toContain('trong chat')

    const otherUnit = resolveBillOrder(memIndex, {
      draftId: crypto.randomUUID(),
      customerQuery: 'MEM01',
      items: [{ lineId: '1', rawName: 'Sinh tố bốn mùa osterberg vải', requestedQuantity: 2, requestedUnit: 'lon' }],
      chatMemory: memory,
    })
    expect(otherUnit.lines[0]!.status).toBe('needs_unit_confirmation')
  })

  test('a remembered requested-equals-catalog mapping applies only while the catalog unit is unchanged', () => {
    const mapping = (catalogUnitKey: string) => chatMemory({
      unitMappings: [
        {
          productKey: normalizeBillText('Trân Châu 3Q Talinh Trắng'),
          requestedUnitKey: normalizeBillText('bao'),
          kind: 'requested-equals-catalog',
          catalogUnitKey,
        }
      ],
    })
    const items: RequestedOrderItem[] = [{ lineId: '1', rawName: 'Trân châu trắng', requestedQuantity: 2, requestedUnit: 'bao' },]

    const current = resolveBillOrder(mismatchIndex, {
      draftId: crypto.randomUUID(),
      customerQuery: 'MC001',
      items,
      chatMemory: mapping(normalizeBillText('Gói')),
    })
    expect(current.lines[0]).toMatchObject({
      status: 'resolved',
      evidence: { unitSource: 'chat_memory' },
      resolved: { quantity: 2, unit: 'Gói', unitPrice: 45_000, lineTotal: 90_000, unitConfirmed: true },
    })

    const staleCatalog = resolveBillOrder(mismatchIndex, {
      draftId: crypto.randomUUID(),
      customerQuery: 'MC001',
      items,
      chatMemory: mapping(normalizeBillText('Túi')),
    })
    expect(staleCatalog.lines[0]!.status).toBe('needs_unit_confirmation')
  })

  test('a remembered price confirmation applies only while the computed price is identical', () => {
    const priceMemory = (price: number) => chatMemory({
      priceConfirmations: [
        {
          customerCode: 'BK001',
          productKey: normalizeBillText('Trà Q 1Kg'),
          price,
        }
      ],
    })

    const samePrice = resolveBillOrder(baoKhachIndex, {
      draftId: crypto.randomUUID(),
      customerQuery: 'BK001',
      items: [{ lineId: 'b', rawName: 'Trà Q', requestedQuantity: 1, requestedUnit: 'Hộp' }],
      chatMemory: priceMemory(152_000),
    })
    expect(samePrice.lines[0]).toMatchObject({
      status: 'resolved',
      resolved: { unitPrice: 152_000 },
    })
    expect(samePrice.orderDraft!.items[0]!.note).toContain('trong chat')

    const changedPrice = resolveBillOrder(baoKhachIndex, {
      draftId: crypto.randomUUID(),
      customerQuery: 'BK001',
      items: [{ lineId: 'b', rawName: 'Trà Q', requestedQuantity: 1, requestedUnit: 'Hộp' }],
      chatMemory: priceMemory(150_000),
    })
    expect(changedPrice.lines[0]!.status).toBe('needs_price_confirmation')
  })

  test('a remembered price confirmation also clears a "Hỏi lại giá" flag at the same price', () => {
    const result = resolveBillOrder(memIndex, {
      draftId: crypto.randomUUID(),
      customerQuery: 'MEM01',
      items: [{ lineId: '1', rawName: 'Bột sương sáo', requestedQuantity: 1, requestedUnit: 'Gói' }],
      chatMemory: chatMemory({
        priceConfirmations: [
          {
            customerCode: 'MEM01',
            productKey: normalizeBillText('Bột Sương Sáo X'),
            price: 40_000,
          }
        ],
      }),
    })

    expect(result.lines[0]).toMatchObject({
      status: 'resolved',
      resolved: { unitPrice: 40_000, lineTotal: 40_000 },
    })
  })

  test('catalog evidence always beats memory: a 1:1 unit never overrides an existing catalog ĐVT', () => {
    const result = resolveBillOrder(memIndex, {
      draftId: crypto.randomUUID(),
      customerQuery: 'MEM01',
      items: [{ lineId: '1', rawName: 'Sữa chua uống Y', requestedQuantity: 1, requestedUnit: 'chai' }],
      chatMemory: chatMemory({
        unitMappings: [
          {
            productKey: normalizeBillText('Sữa Chua Uống Y'),
            requestedUnitKey: normalizeBillText('chai'),
            kind: 'requested-1to1',
          }
        ],
      }),
    })

    expect(result.lines[0]!.status).toBe('needs_unit_confirmation')
    expect(result.lines[0]!.evidence.unitSource).toBe('history')
  })
})

describe('collectChatMemory', () => {
  test('records a staff branch selection under the original ambiguous query', () => {
    const request = {
      customerQuery: 'Doris Coffee & Tea House',
      items: [{ lineId: '1', rawName: 'Richs A', requestedQuantity: 1, requestedUnit: 'Hộp' }],
      selections: [{ lineId: '$customer', candidateId: 'customer:KH004610' }],
      confirmations: [],
    }
    const output = resolveBillOrder(index, { draftId: crypto.randomUUID(), ...request })
    expect(output.customer.status).toBe('resolved')

    const memory = collectChatMemory({ memory: emptyChatOrderMemory(), request, output })

    expect(memory.customerSelections).toContainEqual({
      queryKey: customerQueryKey('Doris Coffee & Tea House'),
      customerCode: 'KH004610',
    })
  })

  test('records the branch under the previous query when staff replied with the code instead', () => {
    const request = {
      customerQuery: 'KH004610',
      items: [{ lineId: '1', rawName: 'Richs A', requestedQuantity: 1, requestedUnit: 'Hộp' }],
      selections: [],
      confirmations: [],
    }
    const output = resolveBillOrder(index, { draftId: crypto.randomUUID(), ...request })

    const memory = collectChatMemory({
      memory: emptyChatOrderMemory(),
      previousQuery: 'Doris Coffee & Tea House',
      request,
      output,
    })

    expect(memory.customerSelections).toContainEqual({
      queryKey: customerQueryKey('Doris Coffee & Tea House'),
      customerCode: 'KH004610',
    })
  })

  test('records an alias when staff rename a shorthand line to a resolvable product', () => {
    const request = {
      customerQuery: 'MEM01',
      items: [{ lineId: '1', rawName: 'Kem Béo Thực Vật Richs', requestedQuantity: 1, requestedUnit: 'Thùng' }],
      selections: [],
      confirmations: [],
    }
    const output = resolveBillOrder(memIndex, { draftId: crypto.randomUUID(), ...request })
    expect(output.lines[0]!.status).toBe('resolved')

    const memory = collectChatMemory({
      memory: emptyChatOrderMemory(),
      previousItems: [{ lineId: '1', rawName: 'rich lùn', requestedQuantity: 1, requestedUnit: 'Thùng' }],
      request,
      output,
    })

    expect(memory.productAliases).toContainEqual({
      customerCode: 'MEM01',
      aliasKey: normalizeBillText('rich lùn'),
      productKey: normalizeBillText('Kem Béo Thực Vật Richs (454G) - Hàng Lạnh'),
    })
  })

  test('records an alias when staff select a candidate for an ambiguous shorthand', () => {
    const items = [{ lineId: '1', rawName: 'trân châu trắng', requestedQuantity: 1, requestedUnit: 'Thùng' }]
    const pending = resolveBillOrder(memIndex, { draftId: crypto.randomUUID(), customerQuery: 'MEM01', items })
    const zion = pending.lines[0]!.candidates.find(candidate => candidate.productName.includes('Zion'))!

    const request = {
      customerQuery: 'MEM01',
      items,
      selections: [{ lineId: '1', candidateId: zion.candidateId }],
      confirmations: [],
    }
    const output = resolveBillOrder(memIndex, { draftId: crypto.randomUUID(), ...request })
    expect(output.lines[0]!.matched?.productName).toBe('Trân Châu 3Q Zion Trắng')

    const memory = collectChatMemory({ memory: emptyChatOrderMemory(), request, output })

    expect(memory.productAliases).toContainEqual({
      customerCode: 'MEM01',
      aliasKey: normalizeBillText('trân châu trắng'),
      productKey: normalizeBillText('Trân Châu 3Q Zion Trắng'),
    })
  })

  test('records a 1:1 unit confirmation as a product-level unit mapping', () => {
    const items = [{ lineId: '1', rawName: 'Sinh tố bốn mùa osterberg vải', requestedQuantity: 1, requestedUnit: 'chai' }]
    const pending = resolveBillOrder(memIndex, { draftId: crypto.randomUUID(), customerQuery: 'MEM01', items })
    const { confirmationId } = pending.lines[0]!.confirmations[0]!

    const request = { customerQuery: 'MEM01', items, selections: [], confirmations: [{ lineId: '1', confirmationId }] }
    const output = resolveBillOrder(memIndex, { draftId: crypto.randomUUID(), ...request })
    expect(output.lines[0]!.status).toBe('resolved')

    const memory = collectChatMemory({ memory: emptyChatOrderMemory(), request, output })

    expect(memory.unitMappings).toContainEqual({
      productKey: normalizeBillText('Sinh Tố Bốn Mùa Osterberg Vải'),
      requestedUnitKey: normalizeBillText('chai'),
      kind: 'requested-1to1',
    })
  })

  test('records a requested-equals-catalog confirmation with the catalog unit it was made against', () => {
    const items = [{ lineId: '1', rawName: 'Trân châu trắng', requestedQuantity: 2, requestedUnit: 'bao' }]
    const pending = resolveBillOrder(mismatchIndex, { draftId: crypto.randomUUID(), customerQuery: 'MC001', items })
    const { confirmationId } = pending.lines[0]!.confirmations[0]!

    const request = { customerQuery: 'MC001', items, selections: [], confirmations: [{ lineId: '1', confirmationId }] }
    const output = resolveBillOrder(mismatchIndex, { draftId: crypto.randomUUID(), ...request })
    expect(output.lines[0]!.status).toBe('resolved')

    const memory = collectChatMemory({ memory: emptyChatOrderMemory(), request, output })

    expect(memory.unitMappings).toContainEqual({
      productKey: normalizeBillText('Trân Châu 3Q Talinh Trắng'),
      requestedUnitKey: normalizeBillText('bao'),
      kind: 'requested-equals-catalog',
      catalogUnitKey: normalizeBillText('Gói'),
    })
  })

  test('records an approved price with its exact value', () => {
    const items = [{ lineId: 'b', rawName: 'Trà Q', requestedQuantity: 1, requestedUnit: 'Hộp' }]
    const pending = resolveBillOrder(baoKhachIndex, { draftId: crypto.randomUUID(), customerQuery: 'BK001', items })
    const confirmation = pending.lines[0]!.confirmations.find(entry => entry.kind === 'price')!

    const request = {
      customerQuery: 'BK001',
      items,
      selections: [],
      confirmations: [{ lineId: 'b', confirmationId: confirmation.confirmationId }],
    }
    const output = resolveBillOrder(baoKhachIndex, { draftId: crypto.randomUUID(), ...request })
    expect(output.lines[0]!.status).toBe('resolved')

    const memory = collectChatMemory({ memory: emptyChatOrderMemory(), request, output })

    expect(memory.priceConfirmations).toContainEqual({
      customerCode: 'BK001',
      productKey: normalizeBillText('Trà Q 1Kg'),
      price: 152_000,
    })
  })

  test('re-confirming overwrites instead of duplicating an entry', () => {
    const request = {
      customerQuery: 'Doris Coffee & Tea House',
      items: [{ lineId: '1', rawName: 'Richs A', requestedQuantity: 1, requestedUnit: 'Hộp' }],
      selections: [{ lineId: '$customer', candidateId: 'customer:KH004611' }],
      confirmations: [],
    }
    const output = resolveBillOrder(index, { draftId: crypto.randomUUID(), ...request })
    const existing = emptyChatOrderMemory()
    existing.customerSelections.push({ queryKey: customerQueryKey('Doris Coffee & Tea House'), customerCode: 'KH004610' })

    const memory = collectChatMemory({ memory: existing, request, output })

    expect(memory.customerSelections).toHaveLength(1)
    expect(memory.customerSelections[0]).toMatchObject({ customerCode: 'KH004611' })
  })
})
