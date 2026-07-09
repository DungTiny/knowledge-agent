import { db, schema } from '@nuxthub/db'
import { blob } from 'hub:blob'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { renderOrderBillPdf } from '../../../utils/pdf/order-bill'
import type { PostOrderPdfBody, PostOrderPdfResponse } from '#shared/types/chat'
import type { PresentOrderUIToolInvocation } from '#shared/utils/tools/present-order'

const paramsSchema = z.object({
  id: z.string().min(1, 'Missing chat ID'),
})

const bodySchema = z.object({
  messageId: z.string().min(1),
  toolCallId: z.string().min(1),
})

function generatePathname(username: string, chatId: string): string {
  const suffix = crypto.randomUUID().slice(0, 8)
  return `${username}/${chatId}/bill-${suffix}.pdf`
}

export default defineEventHandler(async (event) => {
  const requestLog = useLogger(event)
  const { user } = await requireUserSession(event)
  const { id: chatId } = await getValidatedRouterParams(event, paramsSchema.parse)
  const { messageId, toolCallId } = await readValidatedBody<PostOrderPdfBody>(event, bodySchema.parse)

  requestLog.set({ chatId, messageId, toolCallId })

  const chat = await db.query.chats.findFirst({
    where: () => and(
      eq(schema.chats.id, chatId),
      eq(schema.chats.userId, user.id),
    ),
  })
  if (!chat) {
    throw createError({ statusCode: 404, statusMessage: 'Chat not found', data: { why: 'No chat exists with this ID for your user account', fix: 'Verify the chat ID is correct' } })
  }

  const message = await db.query.messages.findFirst({
    where: () => and(
      eq(schema.messages.id, messageId),
      eq(schema.messages.chatId, chatId),
    ),
  })
  if (!message) {
    throw createError({ statusCode: 404, statusMessage: 'Message not found', data: { why: 'No message exists with this ID in this chat', fix: 'Verify the message ID is correct' } })
  }

  // Source of truth is the tool output stored in the DB, never client-supplied numbers.
  const parts = (message.parts ?? []) as Array<{ type: string, toolCallId?: string, state?: string, output?: unknown }>
  const toolPart = parts.find(p => p.type === 'tool-present_order' && p.toolCallId === toolCallId) as PresentOrderUIToolInvocation | undefined

  if (!toolPart || toolPart.state !== 'output-available' || !toolPart.output) {
    throw createError({ statusCode: 400, statusMessage: 'Order data not found', data: { why: 'The referenced tool call has no resolved order output', fix: 'Regenerate the order in chat before confirming' } })
  }

  const order = toolPart.output

  if (order.pendingCount > 0) {
    throw createError({ statusCode: 400, statusMessage: 'Order has unresolved lines', data: { why: `${order.pendingCount} line(s) still need staff confirmation`, fix: 'Resolve all pending lines before generating the bill PDF' } })
  }

  const pdfBytes = await renderOrderBillPdf(order)

  const pathname = generatePathname(user.username ?? user.id, chatId)
  await blob.put(pathname, Buffer.from(pdfBytes), { contentType: 'application/pdf' })

  const filename = `bill-${order.customerName}.pdf`

  const [inserted] = await db.insert(schema.messages).values({
    chatId,
    role: 'assistant',
    parts: [
      {
        type: 'file',
        url: `/api/upload/${pathname}`,
        mediaType: 'application/pdf',
        filename,
      }
    ],
    source: 'web',
  }).returning()

  if (!inserted) {
    throw createError({ statusCode: 500, statusMessage: 'Failed to save PDF message', data: { why: 'The database insert did not return the new message row', fix: 'Try again or check server logs for database errors' } })
  }

  requestLog.set({ outcome: 'success', pdfPathname: pathname })

  return inserted satisfies PostOrderPdfResponse
})
