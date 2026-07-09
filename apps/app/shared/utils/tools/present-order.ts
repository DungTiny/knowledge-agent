import { tool } from 'ai'
import { z } from 'zod'
import type { UIToolInvocation } from 'ai'

export type PresentOrderUIToolInvocation = UIToolInvocation<typeof presentOrderTool>

const orderItemSchema = z.object({
  name: z.string().describe('Standardized product name (from the catalog/history), not the customer\'s abbreviation'),
  sku: z.string().optional().describe('Product code (Mã hàng), if resolved'),
  quantity: z.number().describe('Quantity ordered'),
  unit: z.string().describe('Unit of measure (ĐVT), e.g. "Chai", "Hộp", "Gói"'),
  unitPrice: z.number().nullable().describe('Giá bán (customer price), null if this line is not yet resolved'),
  lineTotal: z.number().nullable().describe('quantity * unitPrice, null if not yet resolved'),
  note: z.string().optional().describe('Reason the line is pending (e.g. "⚠️ Cần xác nhận loại") or other remark'),
})

export const presentOrderTool = tool({
  description: 'Present a structured order/bill draft to the customer service staff for confirmation. Use this INSTEAD of a markdown table whenever you have finished resolving an order\'s line items (whether or not some lines are still pending clarification). The UI renders this as an interactive card with "Đồng ý lên bill" and "Cần thay đổi" buttons.',
  inputSchema: z.object({
    customerName: z.string().describe('Customer display name, e.g. "CF LapH - Quốc Học"'),
    customerCode: z.string().optional().describe('Customer code (Mã khách hàng), if known'),
    items: z.array(orderItemSchema).min(1),
    totalQuantity: z.number().describe('Sum of quantity across ALL lines, including pending ones'),
    totalAmount: z.number().describe('Sum of lineTotal across only the RESOLVED lines (pending lines excluded)'),
    pendingCount: z.number().int().min(0).describe('Number of lines with unitPrice/lineTotal = null'),
  }),
  execute: (input) => input,
})
