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
