import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { validateShellCommand } from '@savoir/sdk'
import { buildOrderLookupCommands, parseOrderLookupRequest } from '../server/utils/chat/order-context'

const repoRoot = join(import.meta.dir, '../../..')

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
    expect(commands[0]).toContain('grep -n -i -F -e \'CF\' files/bill/BILL.md')
    expect(commands[0]).toContain('-e \'Quốc\'')
    expect(commands[0]).toContain('-e \'Mứt\'')
    expect(commands[0]).toContain('-e \'xoài\'')
    expect(commands[1]).toContain('-e \'Richs\'')
    expect(commands.every(command => validateShellCommand(command).ok)).toBe(true)
  })

  test('drops house-number tokens from the customer filter', () => {
    // "04 trương định" is an address — "04" only matches dates like 04/07/2026
    // in BILL.md and poisons every product lookup.
    const commands = buildOrderLookupCommands({
      customer: '04 trương định',
      products: ['Cốt dừa Wonderfarm'],
    })

    expect(commands).toHaveLength(1)
    expect(commands[0]).not.toContain('\'04\'')
    expect(commands[0]).toContain('-e \'trương\'')
    expect(commands[0]).toContain('-e \'định\'')
  })

  test('adds case variants so grep matches Title Case rows without Unicode -i folding', () => {
    // grep -i does not case-fold non-ASCII letters (đ ≠ Đ) under BSD grep or a
    // C locale, so lowercase input must also search the bill's Title Case form.
    const commands = buildOrderLookupCommands({
      customer: '04 trương định',
      products: ['đào hồng wonderful'],
    })

    expect(commands[0]).toContain('-e \'Trương\'')
    expect(commands[0]).toContain('-e \'Định\'')
    expect(commands[0]).toContain('-e \'Đào\'')
    expect(commands[0]).toContain('-e \'Hồng\'')
    // ASCII-only words fold fine with -i, no variants needed
    expect(commands[0]).toContain('-e \'wonderful\'')
    expect(commands[0]).not.toContain('-e \'Wonderful\'')
    expect(commands.every(command => validateShellCommand(command).ok)).toBe(true)
  })

  test('built commands find the real Trương Định rows in BILL.md', () => {
    const request = parseOrderLookupRequest([
      {
        id: 'message-3',
        role: 'user',
        parts: [
          {
            type: 'text',
            text: `hãy lên đơn

Cốt dừa Wonderfarm 5hộp
Đào hồng wonderful 1 lon
Chunky vải hoa hồng 1kg

04 trương định`,
          }
        ],
      }
    ])

    expect(request).toEqual({
      customer: '04 trương định',
      products: ['Cốt dừa Wonderfarm', 'Đào hồng wonderful', 'Chunky vải hoa hồng'],
    })

    for (const command of buildOrderLookupCommands(request!)) {
      const stdout = execSync(command, { cwd: repoRoot, encoding: 'utf8' })
      expect(stdout.trim()).not.toBe('')
      expect(stdout).toContain('Trương Định')
    }
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
