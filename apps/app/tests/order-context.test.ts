import { describe, expect, test } from 'bun:test'
import { parseOrderLookupRequest } from '../server/utils/chat/order-context'

describe('order context preloader', () => {
  test('parses customer and line items from a Vietnamese order', () => {
    const request = parseOrderLookupRequest([
      {
        id: 'message-1',
        role: 'user',
        parts: [
          {
            type: 'text',
            text: `hãy lên đơn

Mứt xoài 1 hộp
Đào lon 1 lon
Cam sấy khô 200gr
Richs 12 hộp
Trà lài 1kg

CF Laph Quốc Học

Done`,
          }
        ],
      }
    ])

    expect(request).toEqual({
      customer: 'CF Laph Quốc Học',
      products: ['Mứt xoài', 'Đào lon', 'Cam sấy khô', 'Richs', 'Trà lài'],
    })
  })

  test('detects a pasted itemized order without an explicit lên đơn phrase', () => {
    const request = parseOrderLookupRequest([
      {
        id: 'message-structural-order',
        role: 'user',
        parts: [
          {
            type: 'text',
            text: `Cốt dừa Wonderfarm 5hộp
Đào hồng wonderful 1 lon
Chunky vải hoa hồng 1kg

04 trương định

Done`,
          }
        ],
      },
    ])

    expect(request).toEqual({
      customer: '04 trương định',
      products: ['Cốt dừa Wonderfarm', 'Đào hồng wonderful', 'Chunky vải hoa hồng'],
    })
  })

  test('parses quantity-first shorthand lines and preserves all 16 products', () => {
    const request = parseOrderLookupRequest([
      {
        id: 'message-cong-duc',
        role: 'user',
        parts: [
          {
            type: 'text',
            text: `Anh Công Đức FB
1 thùng bột béo
1 thùng sữa tươi
10kg đường
1 bột kem trứng brulee
1 hộp rau câu
1 sinh tố đào
5 rich
1 base
1 bột mole dưa lưới
5 trân châu đen
1 siro dâu dingfong
1 siro vải dinhfong
1 siro mảng cầu đậm đặc
1 siro chanh dây đậm đặc
1 siro thơm đậm đặc
1 cái vợt múc trân châu`,
          }
        ],
      },
    ])

    expect(request).toEqual({
      customer: 'Anh Công Đức FB',
      products: [
        'bột béo',
        'sữa tươi',
        'đường',
        'bột kem trứng brulee',
        'rau câu',
        'sinh tố đào',
        'rich',
        'base',
        'bột mole dưa lưới',
        'trân châu đen',
        'siro dâu dingfong',
        'siro vải dinhfong',
        'siro mảng cầu đậm đặc',
        'siro chanh dây đậm đặc',
        'siro thơm đậm đặc',
        'vợt múc trân châu',
      ],
    })
  })

  test('extracts an inline customer and splits multiple plus-separated items', () => {
    const request = parseOrderLookupRequest([
      {
        id: 'message-nguyen-hue',
        role: 'user',
        parts: [
          {
            type: 'text',
            text: `lên đơn cho 111 nguyễn huệ

5kg trung nguyên
1 thùng sữa đặc
6 lốc sữa tươi ko đường
1 thùng sữa chua
3 richs + 1 base

kết quả`,
          }
        ],
      },
    ])

    expect(request).toEqual({
      customer: '111 nguyễn huệ',
      products: ['trung nguyên', 'sữa đặc', 'sữa tươi ko đường', 'sữa chua', 'richs', 'base'],
    })
  })

  test('ignores non-order chat messages', () => {
    expect(parseOrderLookupRequest([
      {
        id: 'message-2',
        role: 'user',
        parts: [{ type: 'text', text: 'Richs có giá bao nhiêu?' }],
      }
    ])).toBeNull()
  })
})
