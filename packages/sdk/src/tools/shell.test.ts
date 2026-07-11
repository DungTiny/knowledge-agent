import { describe, expect, test } from 'bun:test'
import { consumeShellBudget, type ShellToolBudget } from './shell'

describe('shell tool budget', () => {
  test('shares one hard limit across shell tools', () => {
    const budget: ShellToolBudget = { used: 0, max: 2 }

    expect(consumeShellBudget(budget)).toBeNull()
    expect(consumeShellBudget(budget)).toBeNull()
    expect(consumeShellBudget(budget)).toContain('budget exhausted after 2 calls')
    expect(budget.used).toBe(2)
  })

  test('is unlimited when no budget is configured', () => {
    expect(consumeShellBudget()).toBeNull()
  })
})
