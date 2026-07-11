import { describe, expect, test } from 'bun:test'
import { validateShellCommand } from '@savoir/sdk'
import { buildOrderLookupCommands, parseOrderLookupRequest } from '../server/utils/chat/order-context'

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

  test('builds bounded customer-and-product grep commands', () => {
    const commands = buildOrderLookupCommands({
      customer: 'CF Laph Quốc Học',
      products: ['Mứt xoài', 'Richs'],
    })

    expect(commands).toHaveLength(2)
    expect(commands[0]).toContain('grep -n -i -F \'CF\' files/bill/BILL.md')
    expect(commands[0]).toContain('grep -i -F \'Quốc\'')
    expect(commands[0]).toContain('grep -i -F \'Mứt\'')
    expect(commands[0]).toContain('grep -i -F \'xoài\'')
    expect(commands[1]).toContain('grep -i -F \'Richs\'')
    expect(commands.every(command => validateShellCommand(command).ok)).toBe(true)
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
