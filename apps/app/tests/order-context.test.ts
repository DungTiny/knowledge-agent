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
