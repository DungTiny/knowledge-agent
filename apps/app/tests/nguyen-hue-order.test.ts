import { describe, expect, test } from 'bun:test'
import { parseBillMarkdown, resolveBillOrder } from '../server/utils/chat/bill-resolver'

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
const markdownRow = (cells: Array<string | number>) => `| ${cells.join(' | ')} |`
const customer = ['FB_2480', '111 Nguyễn Huệ', 'Bảng giá chung']
const row = (...[sku, name, unit, date, quantity, price]: [string, string, string, string, number, number]) =>
  [...customer, sku, name, unit, date, quantity, price, 0, price, '']

const rows = [
  row('coffee', 'Cà Phê S (Chinh Phục) - Trung Nguyên', 'Kg', '30/06/2026', 5, 150_000),
  row('condensed', 'Sữa Đặc NSPN XANH BIỂN 1.284kg', 'Thùng/12 Hộp', '30/06/2026', 1, 645_000),
  // The newer row is a case, but every six-unit purchase is the retail Hộp variant.
  row('fresh-case', 'Sữa Tươi Vinamilk KHÔNG Đường 1L', 'Thùng/12 Hộp', '24/06/2026', 1, 420_000),
  row('fresh-box', 'Sữa Tươi Vinamilk KHÔNG Đường 1L', 'Hộp', '16/06/2026', 6, 36_000),
  row('fresh-case', 'Sữa Tươi Vinamilk KHÔNG Đường 1L', 'Thùng/12 Hộp', '31/05/2026', 1, 420_000),
  row('fresh-box', 'Sữa Tươi Vinamilk KHÔNG Đường 1L', 'Hộp', '20/04/2026', 6, 36_000),
  row('yogurt-case', 'Sữa Chua Vinamilk Có Đường 100G', 'Thùng/48 Hộp', '30/06/2026', 1, 280_000),
  row('yogurt-pack', 'Sữa Chua Vinamilk Có Đường 100G', 'Lốc/4 Hộp', '08/05/2026', 6, 25_000),
  row('richs', 'Kem Béo Thực Vật Richs (454G) - Hàng Lạnh', 'Hộp', '30/06/2026', 4, 30_000),
  row('base', 'Kem Topping Base - Hàng Lạnh', 'Hộp', '30/06/2026', 1, 84_000),
]
const index = parseBillMarkdown([
  markdownRow(headers),
  `|:${headers.map(() => '---').join('|')}|`,
  ...rows.map(markdownRow),
].join('\n'))

describe('111 Nguyễn Huệ shorthand order', () => {
  test('matches the six image lines and resolves the colloquial lốc as Hộp from repeated history', () => {
    const specs: Array<[string, number, string]> = [
      ['trung nguyên', 5, 'kg'],
      ['sữa đặc', 1, 'thùng'],
      ['sữa tươi ko đường', 6, 'lốc'],
      ['sữa chua', 1, 'thùng'],
      ['richs', 3, ''],
      ['base', 1, ''],
    ]
    const items = specs.map(([rawName, requestedQuantity, requestedUnit], position) => ({
      lineId: String(position + 1),
      rawName,
      requestedQuantity,
      requestedUnit,
    }))

    const result = resolveBillOrder(index, {
      draftId: crypto.randomUUID(),
      customerQuery: '111 nguyễn huệ',
      items,
    })

    expect(result.resolutionStatus).toBe('resolved')
    expect(result.lines.every(line => line.status === 'resolved')).toBe(true)
    expect(result.lines[2]).toMatchObject({
      matched: { productName: 'Sữa Tươi Vinamilk KHÔNG Đường 1L' },
      evidence: { unitSource: 'history_quantity_pattern' },
      resolved: { quantity: 6, unit: 'Hộp', unitPrice: 36_000, lineTotal: 216_000 },
    })
    expect(result.lines.map(line => line.resolved?.lineTotal)).toEqual([
      750_000,
      645_000,
      216_000,
      280_000,
      90_000,
      84_000,
    ])
    expect(result.orderDraft).toMatchObject({
      customerCode: 'FB_2480',
      totalQuantity: 17,
      totalAmount: 2_065_000,
      pendingCount: 0,
    })
  })
})
