import { tool } from 'ai'
import { z } from 'zod'
import type { UIToolInvocation } from 'ai'
import { normalizeOrder } from '../uom'

export type PresentOrderUIToolInvocation = UIToolInvocation<typeof presentOrderTool>

const orderItemSchema = z.object({
  name: z.string().describe('Standardized product name (from the catalog/history), not the customer\'s abbreviation'),
  sku: z.string().optional().describe('Product code (Mã hàng), if resolved'),
  orderedQuantity: z.number().optional().describe('Quantity exactly as the customer requested, e.g. 12 for "12 hộp". Omit only when the customer ordered in the catalog unit'),
  orderedUnit: z.string().optional().describe('Unit exactly as the customer said it, with proper diacritics, e.g. "Hộp". Omit only when the customer ordered in the catalog unit'),
  quantity: z.number().describe('Billed quantity in catalog ĐVT units — may be fractional, e.g. 0.5 for 12 hộp of a "Thùng/24 Hộp" product. Recomputed server-side from orderedQuantity/orderedUnit when provided'),
  unit: z.string().describe('Catalog unit of measure (ĐVT) exactly as written in the price list, e.g. "Chai", "Hộp", "Thùng/24 Hộp"'),
  unitPrice: z.number().nullable().describe('Giá bán for ONE catalog unit (never per sub-unit), null if this line is not yet resolved'),
  lineTotal: z.number().nullable().describe('quantity * unitPrice — recomputed server-side, null if not yet resolved'),
  note: z.string().optional().describe('Reason the line is pending (e.g. "⚠️ Cần xác nhận loại") or other remark'),
})

export const presentOrderTool = tool({
  description: 'Present a structured order/bill draft to the customer service staff for confirmation. Use this INSTEAD of a markdown table whenever you have finished resolving an order\'s line items (whether or not some lines are still pending clarification). The UI renders this as an interactive card with "Đồng ý lên bill" and "Cần thay đổi" buttons. All prices and totals are recomputed server-side from the catalog unit price and pack-size conversion.',
  inputSchema: z.object({
    customerName: z.string().describe('Customer display name, e.g. "CF LapH - Quốc Học"'),
    customerCode: z.string().optional().describe('Customer code (Mã khách hàng), if known'),
    items: z.array(orderItemSchema).min(1),
    totalQuantity: z.number().describe('Sum of quantity across ALL lines, including pending ones — recomputed server-side'),
    totalAmount: z.number().describe('Sum of lineTotal across only the RESOLVED lines (pending lines excluded) — recomputed server-side'),
    pendingCount: z.number().int().min(0).describe('Number of lines with unitPrice/lineTotal = null — recomputed server-side'),
  }),
  // The model's arithmetic is never trusted: quantities are re-derived from the
  // ĐVT pack spec and every total is recomputed before rendering the card/PDF.
  execute: input => normalizeOrder(input),
})
