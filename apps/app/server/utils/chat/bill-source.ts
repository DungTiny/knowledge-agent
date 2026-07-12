import { getOrCreateSandbox } from '../sandbox/manager'

export const BILL_SANDBOX_PATH = 'files/bill/BILL.md'
const BILL_READ_TIMEOUT_MS = 30_000
const MAX_BILL_BYTES = 16 * 1024 * 1024

export interface SandboxFileReader {
  readFileToBuffer: (
    file: { path: string, cwd?: string },
    options?: { signal?: AbortSignal },
  ) => Promise<Buffer | null>
}

export interface SandboxBillSource {
  content: string
  path: typeof BILL_SANDBOX_PATH
  sessionId: string
  snapshotId: string
}

export async function readBillMarkdown(
  sandbox: SandboxFileReader,
  signal: AbortSignal = AbortSignal.timeout(BILL_READ_TIMEOUT_MS),
): Promise<string> {
  const content = await sandbox.readFileToBuffer(
    { path: BILL_SANDBOX_PATH, cwd: '/vercel/sandbox' },
    { signal },
  )

  if (!content) {
    throw new Error(
      `${BILL_SANDBOX_PATH} was not found in the current sandbox snapshot. Upload the source and sync the sandbox before creating an order.`,
    )
  }
  if (content.byteLength > MAX_BILL_BYTES) {
    throw new Error(`${BILL_SANDBOX_PATH} exceeds the ${MAX_BILL_BYTES / 1024 / 1024}MB resolver limit`)
  }

  return content.toString('utf8')
}

export async function loadBillFromSandbox(sessionId?: string): Promise<SandboxBillSource> {
  const active = await getOrCreateSandbox(sessionId)
  return {
    content: await readBillMarkdown(active.sandbox),
    path: BILL_SANDBOX_PATH,
    sessionId: active.sessionId,
    snapshotId: active.session.snapshotId,
  }
}
