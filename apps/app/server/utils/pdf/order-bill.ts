import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import type { PresentOrderUIToolInvocation } from '#shared/utils/tools/present-order'

type OrderOutput = NonNullable<PresentOrderUIToolInvocation['output']>

const PAGE_WIDTH = 595.28 // A4 portrait, points
const PAGE_HEIGHT = 841.89
const MARGIN = 40
const ROW_HEIGHT = 22
const HEADER_HEIGHT = 26

const COLUMNS = [
  { key: 'stt', label: 'STT', width: 28 },
  { key: 'name', label: 'Tên hàng', width: 170 },
  { key: 'sku', label: 'Mã hàng', width: 65 },
  { key: 'quantity', label: 'SL', width: 30 },
  { key: 'unit', label: 'ĐVT', width: 45 },
  { key: 'unitPrice', label: 'Giá bán', width: 75 },
  { key: 'lineTotal', label: 'Thành tiền', width: 90 },
] as const

function formatVnd(value: number | null): string {
  if (value === null) return '—'
  return value.toLocaleString('vi-VN')
}

async function loadFonts(doc: PDFDocument) {
  doc.registerFontkit(fontkit)
  const storage = useStorage('assets:server')
  const [regularBytes, boldBytes] = await Promise.all([
    storage.getItemRaw('fonts/NotoSans-Regular.ttf'),
    storage.getItemRaw('fonts/NotoSans-Bold.ttf'),
  ])
  if (!regularBytes || !boldBytes) {
    throw new Error('Order bill fonts not found in server assets (fonts/NotoSans-Regular.ttf, fonts/NotoSans-Bold.ttf)')
  }
  const regular = await doc.embedFont(regularBytes as Uint8Array, { subset: true })
  const bold = await doc.embedFont(boldBytes as Uint8Array, { subset: true })
  return { regular, bold }
}

interface DrawState {
  page: PDFPage
  y: number
  doc: PDFDocument
}

function newPage(doc: PDFDocument): PDFPage {
  return doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
}

function drawTableHeader(state: DrawState, bold: PDFFont) {
  let x = MARGIN
  state.page.drawRectangle({
    x: MARGIN,
    y: state.y - HEADER_HEIGHT,
    width: PAGE_WIDTH - MARGIN * 2,
    height: HEADER_HEIGHT,
    color: rgb(0.92, 0.92, 0.92),
  })
  for (const col of COLUMNS) {
    state.page.drawText(col.label, {
      x: x + 4,
      y: state.y - HEADER_HEIGHT + 8,
      size: 9,
      font: bold,
      color: rgb(0.1, 0.1, 0.1),
    })
    x += col.width
  }
  state.y -= HEADER_HEIGHT
}

function ensureSpace(state: DrawState, bold: PDFFont, needed: number) {
  if (state.y - needed < MARGIN + 60) {
    state.page = newPage(state.doc)
    state.y = PAGE_HEIGHT - MARGIN
    drawTableHeader(state, bold)
  }
}

export async function renderOrderBillPdf(order: OrderOutput): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const { regular, bold } = await loadFonts(doc)

  const page = newPage(doc)
  const state: DrawState = { page, y: PAGE_HEIGHT - MARGIN, doc }

  state.page.drawText('HÓA ĐƠN BÁN HÀNG', { x: MARGIN, y: state.y - 18, size: 16, font: bold })
  state.y -= 34

  const dateStr = new Date().toLocaleDateString('vi-VN')
  state.page.drawText(`Khách hàng: ${order.customerName}${order.customerCode ? ` (${order.customerCode})` : ''}`, {
    x: MARGIN, y: state.y, size: 10, font: regular,
  })
  state.page.drawText(`Ngày: ${dateStr}`, {
    x: PAGE_WIDTH - MARGIN - 100, y: state.y, size: 10, font: regular,
  })
  state.y -= 24

  drawTableHeader(state, bold)

  order.items.forEach((item, index) => {
    ensureSpace(state, bold, ROW_HEIGHT)

    let x = MARGIN
    const rowValues: Record<string, string> = {
      stt: String(index + 1),
      name: item.name,
      sku: item.sku ?? '—',
      quantity: String(item.quantity),
      unit: item.unit,
      unitPrice: formatVnd(item.unitPrice),
      lineTotal: formatVnd(item.lineTotal),
    }

    for (const col of COLUMNS) {
      const text = rowValues[col.key] ?? ''
      const truncated = text.length > 28 ? `${text.slice(0, 27)}…` : text
      state.page.drawText(truncated, {
        x: x + 4,
        y: state.y - ROW_HEIGHT + 7,
        size: 9,
        font: regular,
        color: item.unitPrice === null ? rgb(0.6, 0.15, 0.1) : rgb(0.15, 0.15, 0.15),
      })
      x += col.width
    }

    if (item.note) {
      state.y -= ROW_HEIGHT
      ensureSpace(state, bold, 14)
      state.page.drawText(`  ${item.note}`, {
        x: MARGIN + 4,
        y: state.y - 12,
        size: 8,
        font: regular,
        color: rgb(0.6, 0.15, 0.1),
      })
      state.y -= 14
    } else {
      state.y -= ROW_HEIGHT
    }
  })

  state.y -= 10
  ensureSpace(state, bold, 60)

  state.page.drawText(`Tổng số lượng: ${order.totalQuantity}`, {
    x: MARGIN, y: state.y, size: 10, font: regular,
  })
  state.y -= 16
  state.page.drawText(
    `Tổng tiền hàng${order.pendingCount > 0 ? ` (chưa gồm ${order.pendingCount} dòng chưa xác nhận)` : ''}: ${formatVnd(order.totalAmount)} VND`,
    { x: MARGIN, y: state.y, size: 11, font: bold },
  )

  return doc.save()
}
