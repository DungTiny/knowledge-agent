import { describe, expect, test } from 'bun:test'
import { normalizeRequestedOrderItem, parseBillMarkdown, resolveBillOrder } from '../server/utils/chat/bill-resolver'
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

const markdownRow = (cells: Array<string | number>) => `| ${cells.join(' | ')} |`
// Compact fixture helper; production APIs do not use positional arguments.
/* eslint-disable max-params */
const row = (
  customer: [string, string, string],
  sku: string,
  name: string,
  unit: string,
  date: string,
  quantity: number,
  price: number,
) => [...customer, sku, name, unit, date, quantity, price, 0, price, '']
/* eslint-enable max-params */

const house: [string, string, string] = ['Ancuu_726', '43 House CF', 'Bảng giá chung']
const grams: [string, string, string] = ['FB_8074', '18Grams Cafe', 'Bảng giá chung']
const hue: [string, string, string] = ['FB_2480', '111 Nguyễn Huệ', 'Bảng giá chung']
const binh: [string, string, string] = ['VAT_KH-lc-36', 'Anh Bình Lăng Cô', 'Bảng giá chung']
const anPhuoc: [string, string, string] = ['KH003977', 'An Phước Food & Drink', 'Bảng giá An Phước']
const catalogCustomer: [string, string, string] = ['KH009999', 'Khách danh mục khác', 'Bảng giá khác']

const index = parseBillMarkdown([
  markdownRow(headers),
  `|:${headers.map(() => '---').join('|')}|`,
  markdownRow(row(house, '(ĐG-CK)BOTFRAPPE', 'Bột Frappe Fr33 Luave 1Kg', 'Gói', '08/07/2026', 1, 152_000)),
  markdownRow(row(house, '(ĐG-CK)3QTALINH', 'Trân Châu 3Q Talinh Trắng', 'Bì', '08/07/2026', 1, 42_000)),
  markdownRow(row(house, '(KĐG)VOT', 'Vợt Múc Trân Châu/ Thạch Cỡ Nhỏ', 'Cái', '18/03/2026', 1, 20_000)),
  markdownRow(row(house, '(ĐG-CK)GFDUA', 'Syrup Golden Farm Dừa 520ml', 'Chai', '08/07/2026', 1, 51_000)),
  markdownRow(row(grams, '(ĐG-CK)OSTCAM', 'Sinh Tố Bốn Mùa Osterberg Nha Đam & Cam', 'Chai', '04/07/2026', 1, 123_000)),
  markdownRow(row(hue, '(ĐG-CK)LY500', 'Ly Nhựa Đế Bằng 500Ml - Hunufa', 'Thùng', '30/06/2026', 1, 590_000)),
  markdownRow(row(hue, '(ĐG-CK)LY360', 'Ly Nhựa Đế Bằng 360Ml - Hunufa', 'Thùng', '30/06/2026', 1, 520_000)),
  markdownRow(row(hue, '(ĐG-CK)NAP93', 'Nắp Cầu PET 93cc Hunufa', 'Thùng', '30/06/2026', 1, 410_000)),
  markdownRow(row(hue, '(ĐG-CK)CFS', 'Cà Phê S (Chinh Phục) - Trung Nguyên', 'Kg', '30/06/2026', 5, 150_000)),
  markdownRow(row(binh, '(ĐG-CK)RICHS', 'Kem Béo Thực Vật Richs (454G) - Hàng Lạnh', 'Thùng/24 Hộp', '02/07/2026', 1, 705_000)),
  markdownRow(row(binh, '(ĐG-CK)COTDUA', 'Nước Cốt Dừa Wonderfarm 400ml', 'Thùng/24 Lon', '02/07/2026', 1, 680_000)),
  markdownRow(row(binh, '(ĐG-CK)MATCHA100', 'Bột Matcha Trà Xanh 100g', 'Gói', '02/07/2026', 1, 82_000)),
  markdownRow(row(binh, '(ĐG-CK)TRADAO', 'Trà Cozy Đào Hòa Tan 16 Tép', 'Hộp', '02/07/2026', 5, 33_000)),
  markdownRow(row(anPhuoc, '(ĐG-CK)BIDAO', 'Nước Cốt Bí Đao Miki 2L', 'Can', '01/07/2026', 1, 241_000)),
  markdownRow(row(catalogCustomer, '(ĐG-CK)STOIHONG', 'Sinh Tố Berrino Ổi Hồng 1000Ml', 'Chai', '07/07/2026', 1, 115_000)),
].join('\n'))

function item(lineId: string, rawName: string, requestedQuantity = 1, requestedUnit = ''): RequestedOrderItem {
  return { lineId, rawName, requestedQuantity, requestedUnit }
}

describe('E2E report shorthand safety regressions', () => {
  test('43 House shorthand surfaces exact history candidates instead of guessing or returning not found', () => {
    const items = [
      item('1', 'bột frap'),
      item('2', 'bì thạch trân châu trắng', 1, ''),
      item('3', 'sr dừa'),
    ]
    const initial = resolveBillOrder(index, {
      draftId: crypto.randomUUID(), customerQuery: '43 House CF', items,
    })

    expect(initial.lines.map(line => line.status)).toEqual([
      'needs_product_confirmation',
      'needs_product_confirmation',
      'needs_product_confirmation',
    ])
    expect(initial.lines.map(line => line.candidates[0])).toMatchObject([
      { sku: '(ĐG-CK)BOTFRAPPE', productName: 'Bột Frappe Fr33 Luave 1Kg', unit: 'Gói', unitPrice: 152_000, rowDate: '08/07/2026' },
      { sku: '(ĐG-CK)3QTALINH', productName: 'Trân Châu 3Q Talinh Trắng', unit: 'Bì', unitPrice: 42_000, rowDate: '08/07/2026' },
      { sku: '(ĐG-CK)GFDUA', productName: 'Syrup Golden Farm Dừa 520ml', unit: 'Chai', unitPrice: 51_000, rowDate: '08/07/2026' },
    ])
    expect(initial.lines[1]!.candidates).toHaveLength(1)
    expect(initial.lines[2]!.candidates).toHaveLength(1)
    expect(initial.orderDraft).toMatchObject({ pendingCount: 3, totalAmount: 0 })

    const selected = resolveBillOrder(index, {
      draftId: initial.draftId,
      customerQuery: '43 House CF',
      items,
      selections: initial.lines.map(line => ({ lineId: line.lineId, candidateId: line.candidates[0]!.candidateId })),
    })
    expect(selected.lines.every(line => line.status === 'resolved')).toBe(true)
    expect(selected.orderDraft?.items.every(resolvedItem => resolvedItem.candidates === undefined)).toBe(true)
  })

  test('18Grams common mứt wording exposes the exact Osterberg history row for accounting confirmation', () => {
    const result = resolveBillOrder(index, {
      draftId: crypto.randomUUID(),
      customerQuery: '18Grams Cafe',
      items: [item('1', 'mứt cam nha đam osteberg')],
    })

    expect(result.lines[0]).toMatchObject({
      status: 'needs_product_confirmation',
      candidates: [
        {
          sku: '(ĐG-CK)OSTCAM',
          productName: 'Sinh Tố Bốn Mùa Osterberg Nha Đam & Cam',
          unit: 'Chai',
          unitPrice: 123_000,
          rowDate: '04/07/2026',
        }
      ],
    })
  })

  test('111 Nguyễn Huệ bundle and chữ S wording remain pending with exact customer-history choices', () => {
    const result = resolveBillOrder(index, {
      draftId: crypto.randomUUID(),
      customerQuery: '111 Nguyễn Huệ',
      items: [item('1', 'ly cao + nắp', 1, 'thùng'), item('2', 'cafe chữ s', 5, 'kg')],
    })

    expect(result.lines[0]!.status).toBe('needs_product_confirmation')
    expect(result.lines[0]!.candidates.map(candidate => candidate.sku).sort()).toEqual(['(ĐG-CK)LY360', '(ĐG-CK)LY500', '(ĐG-CK)NAP93',])
    expect(result.lines[1]).toMatchObject({
      status: 'needs_product_confirmation',
      candidates: [{ sku: '(ĐG-CK)CFS', unit: 'Kg', unitPrice: 150_000, rowDate: '30/06/2026' }],
    })

    const splitByModel = resolveBillOrder(index, {
      draftId: crypto.randomUUID(),
      customerQuery: '111 Nguyễn Huệ',
      items: [item('1', 'ly cao', 1, 'thùng'), item('2', 'ly thấp', 1, 'thùng')],
    })
    expect(splitByModel.lines.map(line => line.status)).toEqual([
      'needs_product_confirmation',
      'needs_product_confirmation',
    ])
    expect(splitByModel.lines.every(line => line.candidates.length === 2)).toBe(true)
  })

  test('normalizes leading packaging words but keeps trà as part of the product name', () => {
    expect(normalizeRequestedOrderItem(item('1', 'thùng rich'))).toMatchObject({ rawName: 'rich', requestedUnit: 'thùng' })
    expect(normalizeRequestedOrderItem(item('2', 'thùng cốt dừa'))).toMatchObject({ rawName: 'cốt dừa', requestedUnit: 'thùng' })
    expect(normalizeRequestedOrderItem(item('3', 'trà đào', 5, 'trà'))).toMatchObject({ rawName: 'trà đào', requestedUnit: '' })
  })

  test('100g matcha requires an exact pack conversion confirmation and never suggests 1g = 1 pack', () => {
    const orderItem = item('matcha', '100g bột matcha', 100, 'g')
    const initial = resolveBillOrder(index, {
      draftId: crypto.randomUUID(), customerQuery: 'Anh Bình Lăng Cô', items: [orderItem],
    })

    expect(initial.lines[0]).toMatchObject({
      status: 'needs_unit_confirmation',
      catalogPrice: 82_000,
      confirmations: [{ kind: 'unit' }],
    })
    const confirmation = initial.lines[0]!.confirmations[0]!
    expect(confirmation.label).toContain('100g = 1 Gói')
    expect(confirmation.label).toContain('82.000đ/Gói')
    expect(confirmation.reason).toContain('02/07/2026')
    expect(confirmation.label).not.toContain('1 g = 1 Gói')

    const confirmed = resolveBillOrder(index, {
      draftId: initial.draftId,
      customerQuery: 'Anh Bình Lăng Cô',
      items: [orderItem],
      confirmations: [{ lineId: 'matcha', confirmationId: confirmation.confirmationId }],
    })
    expect(confirmed.lines[0]).toMatchObject({
      status: 'resolved',
      resolved: { quantity: 1, unit: 'Gói', unitPrice: 82_000, lineTotal: 82_000, unitConfirmed: true },
    })
  })

  test('offers a similar global-catalog product for staff selection without treating it as customer history', () => {
    const items = [item('oi-hong', 'Sinh tố Berrino ổi hồng 1000 ml', 1, 'chai')]
    const initial = resolveBillOrder(index, {
      draftId: crypto.randomUUID(), customerQuery: 'An Phước Food & Drink', items,
    })

    expect(initial.lines[0]).toMatchObject({
      status: 'needs_product_confirmation',
      candidates: [
        {
          sku: '(ĐG-CK)STOIHONG',
          productName: 'Sinh Tố Berrino Ổi Hồng 1000Ml',
          unit: 'Chai',
          unitPrice: 115_000,
          rowDate: '07/07/2026',
        },
      ],
    })
    const candidate = initial.lines[0]!.candidates[0]!
    expect(candidate.reason).toContain('danh mục chung')
    expect(candidate.reason).toContain('không phải lịch sử mua của khách')

    const selected = resolveBillOrder(index, {
      draftId: initial.draftId,
      customerQuery: 'An Phước Food & Drink',
      items,
      selections: [{ lineId: 'oi-hong', candidateId: candidate.candidateId }],
    })
    expect(selected.lines[0]).toMatchObject({
      status: 'needs_price_confirmation',
      matched: { sku: '(ĐG-CK)STOIHONG', productName: 'Sinh Tố Berrino Ổi Hồng 1000Ml' },
      catalogPrice: 115_000,
      confirmations: [{ kind: 'price' }],
    })
    const priceConfirmation = selected.lines[0]!.confirmations[0]!
    expect(priceConfirmation.label).toContain('115.000đ')

    const confirmed = resolveBillOrder(index, {
      draftId: initial.draftId,
      customerQuery: 'An Phước Food & Drink',
      items,
      selections: [{ lineId: 'oi-hong', candidateId: candidate.candidateId }],
      confirmations: [{ lineId: 'oi-hong', confirmationId: priceConfirmation.confirmationId }],
    })
    expect(confirmed.lines[0]).toMatchObject({
      status: 'resolved',
      resolved: { quantity: 1, unit: 'Chai', unitPrice: 115_000, lineTotal: 115_000 },
    })
  })
})
