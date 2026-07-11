import { tool } from 'ai'
import { z } from 'zod'
import { resolveOrderLine } from '../uom'

export const resolveOrderLineTool = tool({
  description: 'Deterministic price calculator for ONE order line. ALWAYS call this for every line after finding the product\'s Giá bán and ĐVT in the price list — NEVER do unit conversion or price arithmetic yourself. Handles pack-size units ("Thùng/24 Hộp", "Lốc/4 Hộp", "Thùng (100 cuộn)"): converts the customer\'s requested quantity into catalog units and computes the exact line total. Copy its quantity/unit/unitPrice/lineTotal verbatim into present_order.',
  inputSchema: z.object({
    productName: z.string().describe('Product name from the price list'),
    catalogUnit: z.string().describe('ĐVT exactly as written in the price list, e.g. "Thùng/24 Hộp"'),
    catalogPrice: z.number().describe('Giá bán for ONE catalog unit, from the price list'),
    requestedQuantity: z.number().describe('Quantity the customer asked for'),
    requestedUnit: z.string().optional().describe('Unit the customer used, with proper diacritics (e.g. "Hộp"). Omit if the customer ordered in the catalog unit'),
  }),
  execute: ({ productName, ...input }) => {
    const start = Date.now()
    const resolved = resolveOrderLine(input)
    const text = resolved.ok
      ? `${productName}: ${resolved.conversion} → ${resolved.lineTotal.toLocaleString('vi-VN')}đ`
      : `${productName}: ${resolved.warning} — present this line as PENDING (unitPrice/lineTotal = null) with this warning as the note`

    return {
      status: 'done' as const,
      durationMs: Date.now() - start,
      success: resolved.ok,
      text,
      ...(resolved.ok
        ? { quantity: resolved.quantity, unit: resolved.unit, unitPrice: resolved.unitPrice, lineTotal: resolved.lineTotal }
        : { warning: resolved.warning }),
      commands: [
        {
          title: `Tính giá: ${productName}`,
          command: '',
          stdout: text,
          stderr: resolved.ok ? '' : resolved.warning,
          exitCode: resolved.ok ? 0 : 1,
          success: resolved.ok,
        },
      ],
    }
  },
})
