import { describe, expect, test } from 'bun:test'
import { BILL_SANDBOX_PATH, readBillMarkdown } from '../server/utils/chat/bill-source'
import type { SandboxFileReader } from '../server/utils/chat/bill-source'

describe('dynamic BILL.md sandbox source', () => {
  test('reads the synced file directly from the sandbox path', async () => {
    const calls: Array<{ path: string, cwd?: string }> = []
    const sandbox: SandboxFileReader = {
      readFileToBuffer: (file) => {
        calls.push(file)
        return Promise.resolve(Buffer.from('current sandbox contents'))
      },
    }

    expect(await readBillMarkdown(sandbox)).toBe('current sandbox contents')
    expect(calls).toEqual([{ path: BILL_SANDBOX_PATH, cwd: '/vercel/sandbox' }])
  })

  test('does not cache content between reads', async () => {
    let current = 'version one'
    const sandbox: SandboxFileReader = {
      readFileToBuffer: () => Promise.resolve(Buffer.from(current)),
    }

    expect(await readBillMarkdown(sandbox)).toBe('version one')
    current = 'version two'
    expect(await readBillMarkdown(sandbox)).toBe('version two')
  })

  test('reports that upload and sandbox sync are required when BILL.md is absent', async () => {
    const sandbox: SandboxFileReader = {
      readFileToBuffer: () => Promise.resolve(null),
    }

    await expect(readBillMarkdown(sandbox)).rejects.toThrow('Upload the source and sync the sandbox')
  })
})
