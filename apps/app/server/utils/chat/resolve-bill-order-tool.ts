import { tool } from 'ai'
import { z } from 'zod'
import { kv } from '@nuxthub/kv'
import { parseBillMarkdown, resolveBillOrder } from './bill-resolver'
import type { BillIndex, BillOrderConfirmation, BillOrderSelection, RequestedOrderItem, ResolvedOrderDraft } from './bill-resolver'
import type { SandboxBillSource } from './bill-source'

const requestedItemSchema = z.object({
  lineId: z.string().min(1),
  rawName: z.string().min(1),
  requestedQuantity: z.number().positive(),
  requestedUnit: z.string().min(1),
})

const selectionSchema = z.object({
  lineId: z.string().min(1),
  candidateId: z.string().min(1),
})

const confirmationSchema = z.object({
  lineId: z.string().min(1),
  confirmationId: z.string().min(1),
})

const inputSchema = z.object({
  customerQuery: z.string().min(1).optional(),
  items: z.array(requestedItemSchema).min(1).max(50).optional(),
  draftId: z.string().uuid().optional(),
  selections: z.array(selectionSchema).default([]),
  confirmations: z.array(confirmationSchema).default([]),
}).superRefine((value, ctx) => {
  if (!value.draftId && (!value.customerQuery || !value.items)) {
    ctx.addIssue({ code: 'custom', message: 'A new order requires customerQuery and items' })
  }
})

interface StoredBillDraft {
  customerQuery: string
  items: RequestedOrderItem[]
  selections: BillOrderSelection[]
  confirmations: BillOrderConfirmation[]
  // The resolver's latest output for this draft. present_order renders this
  // instead of the model's re-typed copy — the model is not a trust boundary.
  orderDraft?: ResolvedOrderDraft | null
}

function draftKey(chatId: string, draftId: string): string {
  return `order:draft:${chatId}:${draftId}`
}

/** The resolver draft stored for a draftId, for present_order; null when unknown. */
export async function loadStoredOrderDraft(chatId: string, draftId: string): Promise<ResolvedOrderDraft | null> {
  const stored = await kv.get<StoredBillDraft>(draftKey(chatId, draftId))
  return stored?.orderDraft ?? null
}

function mergeByKey<T>(current: T[], incoming: T[], key: (value: T) => string): T[] {
  const merged = new Map(current.map(value => [key(value), value]))
  for (const value of incoming) merged.set(key(value), value)
  return [...merged.values()]
}

export function createResolveBillOrderTool(
  chatId: string,
  loadBillSource: () => Promise<SandboxBillSource>,
) {
  return tool({
    description: `Resolve a complete Mộc Trà order deterministically from the current BILL.md in the synced sandbox snapshot. Use exactly once for a new itemized order and once for each revision. This tool resolves the customer, customer-scoped product variants, latest valid prices, ĐVT conversions, warnings, totals, and returns an orderDraft for present_order. Never use bash/web search or calculate order lines yourself when this tool is available.`,
    inputSchema,
    execute: async (input) => {
      const start = Date.now()
      const draftId = input.draftId ?? crypto.randomUUID()
      const key = draftKey(chatId, draftId)
      const stored = input.draftId ? await kv.get<StoredBillDraft>(key) : null
      if (input.draftId && !stored) {
        throw new Error(`Order draft not found or expired: ${input.draftId}`)
      }

      const state: StoredBillDraft = {
        customerQuery: input.customerQuery ?? stored!.customerQuery,
        items: (input.items ?? stored!.items) as RequestedOrderItem[],
        selections: mergeByKey(
          stored?.selections ?? [],
          input.selections as BillOrderSelection[],
          value => value.lineId,
        ),
        confirmations: mergeByKey(
          stored?.confirmations ?? [],
          input.confirmations as BillOrderConfirmation[],
          value => `${value.lineId}:${value.confirmationId}`,
        ),
      }

      // BILL.md is a dynamic source. Read and parse the current sandbox snapshot
      // on every tool execution instead of caching build-time or warm-instance data.
      const billSource = await loadBillSource()
      const billIndex: BillIndex = parseBillMarkdown(billSource.content)
      const output = resolveBillOrder(billIndex, {
        draftId,
        ...state,
      })
      await kv.set(key, { ...state, orderDraft: output.orderDraft })

      const summary = output.customer.status !== 'resolved'
        ? `Customer ${output.customer.status}; ${output.customer.candidates.length} candidate(s)`
        : `${output.lines.filter(line => line.status === 'resolved').length}/${output.lines.length} line(s) resolved; ${output.orderDraft?.pendingCount ?? 0} pending`

      return {
        status: 'done' as const,
        success: output.customer.status === 'resolved',
        durationMs: Date.now() - start,
        ...output,
        source: {
          ...output.source,
          path: billSource.path,
          snapshotId: billSource.snapshotId,
        },
        commands: [
          {
            title: 'Resolve BILL order',
            command: '',
            stdout: summary,
            stderr: '',
            exitCode: 0,
            success: true,
          }
        ],
      }
    },
  })
}
