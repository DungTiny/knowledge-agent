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
const customer = ['KH006868', 'Alo Coffee PVang', 'Bảng giá chung']
const row = (...[sku, name, unit, date, quantity, price]: [string, string, string, string, number, number]) =>
  [...customer, sku, name, unit, date, quantity, price, 0, price, '']

const rows = [
  row('trinh-mc', 'Syrup Trinh Mãng Cầu 600Ml', '', '08/07/2026', 1, 55_000),
  row('trinh-dao', 'Syrup Trinh Đào 600Ml', '', '08/07/2026', 1, 55_000),
  row('trinh-vai', 'Syrup Trinh Vải 600Ml', '', '08/07/2026', 1, 55_000),
  row('gf-oi', 'Syrup Golden Farm Ổi 520ml', '', '08/07/2026', 1, 51_000),
  row('gf-chanh', 'Syrup Golden Farm Chanh 520ml', '', '08/07/2026', 1, 51_000),
  row('dingfong-dd', 'Syrup Thái Dingfong Đường Đen', 'Chai', '08/07/2026', 2, 63_000),
  row('nu-hoang', 'Đường Đen Nữ Hoàng 1kg', 'Gói', '08/07/2026', 1, 50_000),
  row('cozy-dao', 'Trà Cozy Đào túi lọc (25 gói x 2g)', 'Hộp', '08/07/2026', 5, 36_000),
  row('dao-lon', 'Đào Lon Thái To BODDOB 820gr', 'Lon', '08/07/2026', 2, 28_000),
  row('vai-lon', 'Vải Lon Ngâm Lotusfood', 'Lon', '08/07/2026', 2, 34_000),
  row('berrino-vai', 'Sinh Tố Berrino Vải 1000Ml', '', '08/07/2026', 1, 124_000),
  row('berrino-dao', 'Sinh Tố Berrino Đào 1000Ml', '', '08/07/2026', 2, 90_000),
  row('berrino-xoai', 'Sinh Tố Berrino Xoài 1000Ml', '', '08/07/2026', 1, 91_000),
  row('berrino-mc', 'Sinh Tố Berrino Mãng Cầu 1000Ml', '', '08/07/2026', 2, 110_000),
  row('ong-to', 'Ống Hút Trân Châu Trắng Túi OPP 400gram', 'Bì', '08/07/2026', 5, 30_000),
  // Same product name, two packaging variants: quantity history must select Bì.
  row('ong-nho', 'Ống Hút CF Trắng Thẳng P6 Túi OPP 400gram', 'Thùng', '07/07/2026', 1, 285_000),
  row('ong-nho', 'Ống Hút CF Trắng Thẳng P6 Túi OPP 400gram', 'Bì', '28/06/2026', 5, 30_000),
  row('richs', 'Kem Béo Thực Vật Richs (454G) - Hàng Lạnh', 'Thùng/24 Hộp', '08/07/2026', 1, 705_000),
  // Bibi is the repeated recent choice; Sea has more purchases, but only old ones.
  row('bibi', 'Trân Châu 3Q Bibi Jelly Trắng', 'Thùng/6 Gói', '08/07/2026', 1, 280_000),
  row('bibi', 'Trân Châu 3Q Bibi Jelly Trắng', 'Thùng/6 Gói', '02/07/2026', 1, 280_000),
  row('sea', 'Trân Châu 3Q Sea Trắng', 'Thùng/6 Gói', '31/05/2026', 1, 275_000),
  row('sea', 'Trân Châu 3Q Sea Trắng', 'Thùng/6 Gói', '24/05/2026', 1, 275_000),
  row('sea', 'Trân Châu 3Q Sea Trắng', 'Thùng/6 Gói', '17/05/2026', 1, 275_000),
  row('kem-trung', 'Bột Kem Trứng Vàng Búp Bê Lotusfood 1kg', '', '08/07/2026', 1, 140_000),
  // Exported suffix form must beat the older per-lạng variant.
  row('dua-vun', 'Vụn Dừa Nướng DEDU Nam Phát - 500G', '500gram (gói)', '08/07/2026', 1, 135_000),
  row('dua-vun', 'Vụn Dừa Nướng DEDU Nam Phát - 500G', '1 Lạng', '01/05/2026', 1, 35_000),
  row('matcha', 'Bột Matcha Trà Xanh EverStyle Mũ Đỏ', '500gr', '08/07/2026', 1, 365_000),
  row('mang-sua', 'Bột Màng Sữa Vị Muối Biển Eurodeli', 'Gói', '30/06/2026', 1, 262_000),
  row('bao-anh', 'Hồng Trà Túi Lọc Bảo Anh 200gr', '', '08/07/2026', 10, 27_000),
  row('indo', 'Bột Sữa Indo', 'Gói', '08/07/2026', 4, 76_000),
  row('indo', 'Bột Sữa Indo', 'Gói', '01/07/2026', 3, 76_000),
  row('gf-nhiet-doi', 'Syrup Đậm Đặc GF Nhiệt Đới 700ml', '', '08/07/2026', 1, 63_000),
  row('pudding-km', 'Bột Pudding Mole Khoai Môn 1Kg', 'Gói', '08/07/2026', 1, 217_000),
  row('dingfong-xoai', 'Syrup Thái Dingfong Xoài', '', '08/07/2026', 1, 63_000),
  row('cacao', 'Bột Cacao Luave 500gr', '', '08/07/2026', 1, 159_000),
  row('thai-xanh', 'Trà Thái Xanh Chatramue 200gr', 'Gói', '08/07/2026', 1, 65_000),
  row('gelatine', 'Bột Gelatine Đức EWALD', 'Lạng', '08/07/2026', 2, 32_000),
]

const index = parseBillMarkdown([
  markdownRow(headers),
  `|:${headers.map(() => '---').join('|')}|`,
  ...rows.map(markdownRow),
].join('\n'))

describe('Alo Coffee PVang shorthand order', () => {
  test('resolves all 30 lines with customer-specific product and package history', () => {
    const specs: Array<[string, number, string]> = [
      ['siro mãng cầu', 3, ''],
      ['siro đào', 1, ''],
      ['siro vải', 1, ''],
      ['siro ổi Hồng', 2, ''],
      ['siro chanh', 1, ''],
      ['đường đen', 2, 'chai'],
      ['đường đen', 1, 'bi'],
      ['đào túi', 5, 'hộp'],
      ['đào', 2, 'lon'],
      ['vải', 2, 'lon'],
      ['sto vải', 1, ''],
      ['sto đào', 2, ''],
      ['sto xoài', 1, ''],
      ['sto mãng cầu', 2, ''],
      ['ống hút to', 5, ''],
      ['ống hút nhỏ', 5, ''],
      ['rích lùn', 1, 'thung'],
      ['trân châu trắng', 1, 'thung'],
      ['bột kem trứng', 1, 'bi'],
      ['dừa khô vụn', 1, 'bi'],
      ['bột matcha', 1, 'bi'],
      ['bột màng sữa vị muối biển', 1, 'bi'],
      ['bảo anh', 10, 'goi'],
      ['bột béo trà sữa', 4, 'goi'],
      ['siro trái cây', 1, ''],
      ['puding khoai môn', 1, ''],
      ['siro xoài', 1, ''],
      ['bột cacao', 1, 'bi'],
      ['Trà Thái Xanh Chatramue', 1, 'g'],
      ['Bột Gelatine Đức EWALD', 3, 'lạng'],
    ]
    const items = specs.map(([rawName, requestedQuantity, requestedUnit], position) => ({
      lineId: String(position + 1), rawName, requestedQuantity, requestedUnit,
    }))

    const result = resolveBillOrder(index, {
      draftId: crypto.randomUUID(), customerQuery: 'Alo Coffee PVang', items,
    })

    expect(result.lines.filter(line => line.status !== 'resolved').map(line => ({
      lineId: line.lineId, status: line.status, warning: line.warning, candidates: line.candidates,
    }))).toEqual([])
    expect(result.resolutionStatus).toBe('resolved')
    expect(result.lines).toHaveLength(30)
    expect(result.lines.every(line => line.status === 'resolved')).toBe(true)
    expect(result.lines[11]!.matched?.productName).toBe('Sinh Tố Berrino Đào 1000Ml')
    expect(result.lines[15]).toMatchObject({ resolved: { unit: 'Bì', unitPrice: 30_000, lineTotal: 150_000 } })
    expect(result.lines[17]!.matched?.productName).toBe('Trân Châu 3Q Bibi Jelly Trắng')
    expect(result.lines[19]).toMatchObject({ resolved: { unit: 'Gói 500gram', unitPrice: 135_000 } })
    expect(result.lines[28]).toMatchObject({ resolved: { unit: 'Gói', unitPrice: 65_000 } })
    expect(result.orderDraft).toMatchObject({ totalQuantity: 64, totalAmount: 4_947_000, pendingCount: 0 })
  })
})
