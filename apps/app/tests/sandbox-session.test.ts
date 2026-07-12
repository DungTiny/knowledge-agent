import { describe, expect, test } from 'bun:test'
import { isSandboxSessionCurrent } from '../server/utils/sandbox/types'

describe('sandbox snapshot session freshness', () => {
  test('reuses a session created from the current snapshot', () => {
    expect(isSandboxSessionCurrent(
      { snapshotId: 'snapshot-new' },
      { snapshotId: 'snapshot-new' },
    )).toBe(true)
  })

  test('invalidates a session after source sync selects a new snapshot', () => {
    expect(isSandboxSessionCurrent(
      { snapshotId: 'snapshot-old' },
      { snapshotId: 'snapshot-new' },
    )).toBe(false)
  })
})
