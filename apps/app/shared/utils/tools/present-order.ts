import { tool } from 'ai'
import { z } from 'zod'
import type { UIToolInvocation } from 'ai'
import { normalizeOrder } from '../uom'
import type { OrderDraft } from '../uom'

export type PresentOrderUIToolInvocation = UIToolInvocation<typeof presentOrderTool>

/** Loads the resolver's stored orderDraft for a draftId; null when unknown/expired. */
export type LoadStoredOrderDraft = (draftId: string) => Promise<OrderDraft | null>

const orderItemSchema = z.object({
  lineId: z.string().optional().describe('Stable line id from resolve_bill_order'),
  name: z.string().describe('Standardized product name (from the catalog/history), not the customer\'s abbreviation'),
  sku: z.string().optional().describe('Product code (Mã hàng), if resolved'),
  orderedQuantity: z.number().optional().describe('Quantity exactly as the customer requested, e.g. 12 for "12 hộp". Omit only when the customer ordered in the catalog unit'),
  orderedUnit: z.string().optional().describe('Unit exactly as the customer said it, with proper diacritics, e.g. "Hộp". Omit only when the customer ordered in the catalog unit'),
  quantity: z.number().describe('Billed quantity in catalog ĐVT units — may be fractional, e.g. 0.5 for 12 hộp of a "Thùng/24 Hộp" product. Recomputed server-side from orderedQuantity/orderedUnit when provided. Use 0 for a pending line whose billed quantity is unknown — the card then shows orderedQuantity instead'),
  unit: z.string().describe('Catalog unit of measure (ĐVT) exactly as written in the price list, e.g. "Chai", "Hộp", "Thùng/24 Hộp"'),
  unitConfirmed: z.boolean().optional().describe('Staff confirmed 1 orderedUnit = 1 catalog unit (e.g. 1 bì = 1 Gói). Copy it verbatim from the resolver orderDraft; never set it yourself'),
  catalogPrice: z.number().nullable().optional().describe('Known catalog price retained from a pending line. Null/omit when the resolver has no reliable price.'),
  unitPrice: z.number().nullable().optional().describe('Giá bán for ONE catalog unit (never per sub-unit), null/omitted if this line is not yet resolved'),
  lineTotal: z.number().nullable().optional().describe('quantity * unitPrice — recomputed server-side, null/omitted if not yet resolved'),
  note: z.string().optional().describe('Reason the line is pending (e.g. "⚠️ Cần xác nhận loại") or other remark'),
  candidates: z.array(z.object({
    candidateId: z.string(),
    sku: z.string(),
    productName: z.string(),
    reason: z.string(),
    unit: z.string().optional(),
    unitPrice: z.number().optional(),
    rowDate: z.string().optional(),
  })).optional().describe('Exact resolver-issued product candidates for staff confirmation'),
  confirmations: z.array(z.object({
    confirmationId: z.string(),
    kind: z.enum(['unit', 'price']),
    label: z.string(),
    reason: z.string(),
  })).optional().describe('Exact resolver-issued unit/price confirmations'),
})

export const presentOrderInputSchema = z.object({
  draftId: z.string().uuid().optional().describe('draftId returned by resolve_bill_order. Always pass it for BILL orders — the server renders the exact stored resolver draft instead of your copy'),
  customerName: z.string().describe('Customer display name, e.g. "CF LapH - Quốc Học"'),
  customerCode: z.string().optional().describe('Customer code (Mã khách hàng), if known'),
  items: z.array(orderItemSchema).min(1),
  totalQuantity: z.number().describe('Sum of quantity across ALL lines, including pending ones — recomputed server-side'),
  totalAmount: z.number().describe('Sum of lineTotal across only the RESOLVED lines (pending lines excluded) — recomputed server-side'),
  pendingCount: z.number().int().min(0).describe('Number of lines with unitPrice/lineTotal = null — recomputed server-side'),
})

export function createPresentOrderTool(loadStoredDraft?: LoadStoredOrderDraft) {
  return tool({
    description: 'Present a structured order/bill draft to the customer service staff for confirmation. Use this INSTEAD of a markdown table whenever you have finished resolving an order\'s line items (whether or not some lines are still pending clarification). The UI renders this as an interactive card with "Đồng ý lên bill" and "Cần thay đổi" buttons. When the order came from resolve_bill_order, ALWAYS pass its draftId: the server then renders the stored resolver draft and any names/prices/totals you type here are ignored. All prices and totals are recomputed server-side from the catalog unit price and pack-size conversion.',
    inputSchema: presentOrderInputSchema,
    // The model is not a trust boundary between resolve_bill_order and this card:
    // it once re-typed a 135.000đ resolver price as 150.000đ. With a draftId the
    // stored resolver draft is rendered instead of the model's copy; without one,
    // quantities are re-derived from the ĐVT pack spec and totals recomputed.
    execute: async ({ draftId, ...input }) => {
      if (draftId && loadStoredDraft) {
        const stored = await loadStoredDraft(draftId)
        if (!stored) {
          throw new Error(`Order draft not found or expired: ${draftId} — call resolve_bill_order again and present its new orderDraft`)
        }
        // The resolver already validated units, conversions, prices and totals.
        // Rendering must never re-resolve or mutate that authoritative draft.
        return stored
      }
      return normalizeOrder({
        ...input,
        items: input.items.map(item => ({
          ...item,
          unitPrice: item.unitPrice ?? null,
          lineTotal: item.lineTotal ?? null,
        })),
      })
    },
  })
}

export const presentOrderTool = createPresentOrderTool()
