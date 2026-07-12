import { parsePackSpec, parseSizedUnit, resolveOrderLine } from '../../../shared/utils/uom'

export const BILL_STATIC_DATE = '31/12/2026'

const BILL_HEADERS = [
  'Mã khách hàng',
  'Tên khách hàng',
  'Bảng giá',
  'Mã hàng',
  'Tên hàng',
  'ĐVT',
  'Thời gian',
  'Số lượng',
  'Đơn giá',
  'Giảm giá',
  'Giá bán',
  'Ghi chú hàng hóa',
] as const

type BillHeader = typeof BILL_HEADERS[number]

export interface BillRow extends Record<BillHeader, string> {
  rowNumber: number
}

export interface BillIndex {
  rows: BillRow[]
  customers: Array<{ code: string, name: string }>
}

export interface RequestedOrderItem {
  lineId: string
  rawName: string
  requestedQuantity: number
  requestedUnit: string
}

export interface BillOrderSelection {
  lineId: string
  candidateId: string
}

export interface BillOrderConfirmation {
  lineId: string
  confirmationId: string
}

export interface ResolveBillOrderRequest {
  draftId: string
  customerQuery: string
  items: RequestedOrderItem[]
  selections?: BillOrderSelection[]
  confirmations?: BillOrderConfirmation[]
}

export type BillLineStatus =
  | 'resolved'
  | 'needs_product_confirmation'
  | 'needs_unit_confirmation'
  | 'needs_price_confirmation'
  | 'not_found'

export interface ResolvedBillLine {
  lineId: string
  status: BillLineStatus
  request: RequestedOrderItem
  matched?: { sku: string, canonicalSku: string, productName: string }
  evidence: {
    selectionSource?: 'positive_history' | 'static_price' | 'staff_confirmation'
    priceSource?: 'latest_positive_history' | 'static_price'
    unitSource?: 'history' | 'static_price' | 'business_override' | 'staff_confirmation'
    rowDates: string[]
  }
  candidates: Array<{ candidateId: string, sku: string, productName: string, reason: string }>
  confirmations: Array<{ confirmationId: string, kind: 'unit' | 'price', label: string, reason: string }>
  resolved?: { quantity: number, unit: string, catalogPrice: number, unitPrice: number, lineTotal: number }
  warning?: string
}

export interface ResolvedOrderDraft {
  customerName: string
  customerCode?: string
  items: Array<{
    name: string
    sku?: string
    orderedQuantity: number
    orderedUnit: string
    quantity: number
    unit: string
    unitPrice: number | null
    lineTotal: number | null
    note?: string
  }>
  totalQuantity: number
  totalAmount: number
  pendingCount: number
}

export interface ResolveBillOrderOutput {
  resolutionStatus: 'resolved' | 'needs_confirmation'
  draftId: string
  source: { path: 'files/bill/BILL.md', rowCount: number, snapshotId?: string }
  customer: {
    status: 'resolved' | 'ambiguous' | 'not_found'
    code?: string
    name?: string
    candidates: Array<{ candidateId: string, code: string, name: string }>
  }
  lines: ResolvedBillLine[]
  orderDraft: ResolvedOrderDraft | null
}

const BUSINESS_UNIT_OVERRIDES = [{ productTokens: ['thach', 'agar', 'chuandai'], unit: 'Túi 3.05Kg' },]

const PLAIN_UNITS = new Set([
  'hop',
  'lon',
  'hu',
  'goi',
  'tui',
  'chai',
  'lo',
  'thung',
  'loc',
  'lang',
  'kg',
  'g',
  'gr',
  'ml',
  'l',
  'lit',
  'bi',
  'banh',
  'phong',
  'cuon',
  'xau',
])

export function normalizeBillText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function tokens(value: string): string[] {
  return normalizeBillText(value).split(/\s+/).filter(Boolean)
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function parseNumber(value: string): number | null {
  if (!/^-?\d+(?:[.,]\d+)?$/.test(value.trim())) return null
  const parsed = Number(value.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

function parseDate(value: string): number {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!match) return 0
  return Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1]))
}

function rowKey(row: BillRow): string {
  return BILL_HEADERS.map(header => row[header]).join('\u001f')
}

function dedupeRows(rows: BillRow[]): BillRow[] {
  const seen = new Set<string>()
  return rows.filter((row) => {
    const key = rowKey(row)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function parseBillMarkdown(markdown: string): BillIndex {
  const tableLines = markdown
    .split(/\r?\n/)
    .map((line, index) => ({ line, rowNumber: index + 1 }))
    .filter(({ line }) => line.startsWith('|') && !line.startsWith('|:'))

  if (tableLines.length === 0) throw new Error('BILL.md does not contain a Markdown table')

  const headers = tableLines[0]!.line.split('|').slice(1, -1).map(value => value.trim())
  if (headers.length !== BILL_HEADERS.length || BILL_HEADERS.some((header, index) => headers[index] !== header)) {
    throw new Error(`BILL.md header mismatch: expected ${BILL_HEADERS.join(', ')}`)
  }

  const parsedRows = tableLines.slice(1).map(({ line, rowNumber }): BillRow => {
    const values = line.split('|').slice(1, -1).map(value => value.trim())
    if (values.length !== BILL_HEADERS.length) {
      throw new Error(`Malformed BILL.md row ${rowNumber}: expected ${BILL_HEADERS.length} columns, got ${values.length}`)
    }
    return {
      rowNumber,
      ...Object.fromEntries(BILL_HEADERS.map((header, index) => [header, values[index] ?? ''])),
    } as BillRow
  })

  const rows = dedupeRows(parsedRows)
  const customerMap = new Map<string, { code: string, name: string }>()
  for (const row of rows) {
    const code = row['Mã khách hàng']
    const name = row['Tên khách hàng']
    if (code && name) customerMap.set(`${code}\u001f${name}`, { code, name })
  }

  return { rows, customers: [...customerMap.values()] }
}

function customerCandidateId(code: string): string {
  return `customer:${encodeURIComponent(code)}`
}

function productCandidateId(lineId: string, productName: string): string {
  return `product:${encodeURIComponent(lineId)}:${encodeURIComponent(normalizeBillText(productName))}`
}

function canonicalSku(sku: string): string {
  const stripped = sku.replace(/^(?:\([^)]*\))+/, '')
  return normalizeBillText(stripped || sku)
}

function resolveCustomer(index: BillIndex, query: string, selections: Map<string, string>) {
  const selected = selections.get('$customer')
  if (selected) {
    const match = index.customers.find(customer => customerCandidateId(customer.code) === selected)
    if (match) return { status: 'resolved' as const, customer: match, candidates: [] }
  }

  const normalizedQuery = normalizeBillText(query)
  const exactCode = index.customers.filter(customer => normalizeBillText(customer.code) === normalizedQuery)
  if (exactCode.length === 1) return { status: 'resolved' as const, customer: exactCode[0]!, candidates: [] }

  const exactName = index.customers.filter(customer => normalizeBillText(customer.name) === normalizedQuery)
  if (exactName.length === 1) return { status: 'resolved' as const, customer: exactName[0]!, candidates: [] }

  const queryTokens = tokens(query).filter(token => !/^\d+$/.test(token))
  const matches = index.customers.filter((customer) => {
    const normalizedName = normalizeBillText(customer.name)
    return queryTokens.length > 0 && queryTokens.every(token => normalizedName.includes(token))
  })

  if (matches.length === 1) return { status: 'resolved' as const, customer: matches[0]!, candidates: [] }
  return {
    status: matches.length > 1 ? 'ambiguous' as const : 'not_found' as const,
    customer: undefined,
    candidates: matches.map(customer => ({
      candidateId: customerCandidateId(customer.code),
      ...customer,
    })),
  }
}

function isPositiveHistory(row: BillRow): boolean {
  const quantity = parseNumber(row['Số lượng'])
  return row['Thời gian'] !== BILL_STATIC_DATE && quantity !== null && quantity > 0
}

function productMatches(row: BillRow, rawName: string): boolean {
  const queryTokens = tokens(rawName)
  if (queryTokens.length === 0) return false
  const haystack = `${normalizeBillText(row['Tên hàng'])} ${normalizeBillText(row['Mã hàng'])}`
  return queryTokens.every(token => haystack.includes(token))
}

function isValidCatalogUnit(unit: string): boolean {
  if (!unit.trim()) return false
  if (parsePackSpec(unit)) return true
  const sized = parseSizedUnit(unit)
  if (sized.measureBase !== null) return true
  return PLAIN_UNITS.has(normalizeBillText(unit))
}

function businessUnitOverride(productName: string): string | null {
  const normalized = normalizeBillText(productName)
  return BUSINESS_UNIT_OVERRIDES.find(override =>
    override.productTokens.every(token => normalized.includes(token)),
  )?.unit ?? null
}

function staticRowsForCustomer(index: BillIndex, customerCode: string): BillRow[] {
  const customerHistory = index.rows.filter(row => row['Mã khách hàng'] === customerCode && row['Thời gian'] !== BILL_STATIC_DATE)
  const priceLists = new Set(customerHistory.map(row => row['Bảng giá']).filter(Boolean))
  return index.rows.filter(row =>
    row['Thời gian'] === BILL_STATIC_DATE
    && (row['Mã khách hàng'] === customerCode || (row['Bảng giá'] !== '' && priceLists.has(row['Bảng giá']))),
  )
}

function latestRows(rows: BillRow[]): BillRow[] {
  if (rows.length === 0) return []
  const sorted = [...rows].sort((a, b) => parseDate(b['Thời gian']) - parseDate(a['Thời gian']))
  const latestDate = sorted[0]!['Thời gian']
  return sorted.filter(row => row['Thời gian'] === latestDate)
}

function warningText(rows: BillRow[]): string {
  return rows.map(row => `${row['Số lượng']} ${row['Giảm giá']} ${row['Ghi chú hàng hóa']}`).join(' ')
}

function resolveLine(index: BillIndex, item: RequestedOrderItem, options: {
  customerCode: string
  selectedCandidateId?: string
  confirmedIds: Set<string>
}): ResolvedBillLine {
  const { customerCode, selectedCandidateId, confirmedIds } = options
  const historyScope = dedupeRows(index.rows.filter(row => row['Mã khách hàng'] === customerCode && isPositiveHistory(row)))
  const staticScope = dedupeRows(staticRowsForCustomer(index, customerCode))
  const historyMatches = historyScope.filter(row => productMatches(row, item.rawName))
  const staticMatches = staticScope.filter(row => productMatches(row, item.rawName))
  const candidateRows = historyMatches.length > 0 ? historyMatches : staticMatches
  const candidateGroups = new Map<string, BillRow[]>()
  for (const row of candidateRows) {
    const key = normalizeBillText(row['Tên hàng'])
    const group = candidateGroups.get(key) ?? []
    group.push(row)
    candidateGroups.set(key, group)
  }

  const candidates = [...candidateGroups.values()].map((rows) => {
    const newest = [...rows].sort((a, b) => parseDate(b['Thời gian']) - parseDate(a['Thời gian']))[0]!
    return {
      candidateId: productCandidateId(item.lineId, newest['Tên hàng']),
      sku: newest['Mã hàng'],
      productName: newest['Tên hàng'],
      reason: historyMatches.length > 0 ? 'Có trong lịch sử mua thực của khách hàng' : 'Chỉ có trong bảng giá tĩnh',
    }
  })

  let selectedProduct: string | undefined
  let selectionSource: ResolvedBillLine['evidence']['selectionSource']
  if (selectedCandidateId) {
    const selected = candidates.find(candidate => candidate.candidateId === selectedCandidateId)
    if (selected) {
      selectedProduct = selected.productName
      selectionSource = 'staff_confirmation'
    }
  }
  if (!selectedProduct && candidateGroups.size === 1) {
    selectedProduct = candidates[0]!.productName
    selectionSource = historyMatches.length > 0 ? 'positive_history' : 'static_price'
  }
  if (!selectedProduct) {
    const exact = candidates.filter(candidate => normalizeBillText(candidate.productName) === normalizeBillText(item.rawName))
    if (exact.length === 1) {
      selectedProduct = exact[0]!.productName
      selectionSource = historyMatches.length > 0 ? 'positive_history' : 'static_price'
    }
  }
  if (!selectedProduct && historyMatches.length > 0 && candidateGroups.size > 1) {
    const ranked = [...candidateGroups.values()]
      .map(rows => ({
        productName: rows[0]!['Tên hàng'],
        count: rows.length,
        latest: Math.max(...rows.map(row => parseDate(row['Thời gian']))),
      }))
      .sort((a, b) => b.latest - a.latest || b.count - a.count)
    const [first, second] = ranked
    // Auto-select only when both recency and deduplicated frequency agree.
    // Otherwise the generic request remains ambiguous and needs staff input.
    if (first && second && first.latest > second.latest && first.count > second.count) {
      selectedProduct = first.productName
      selectionSource = 'positive_history'
    }
  }

  if (!selectedProduct) {
    const warning = candidates.length > 0
      ? `Cần xác nhận sản phẩm cho "${item.rawName}"`
      : `Không tìm thấy sản phẩm "${item.rawName}" trong lịch sử/bảng giá của khách hàng`
    return {
      lineId: item.lineId,
      status: candidates.length > 0 ? 'needs_product_confirmation' : 'not_found',
      request: item,
      evidence: { rowDates: [] },
      candidates,
      confirmations: [],
      warning,
    }
  }

  const productKey = normalizeBillText(selectedProduct)
  const productHistory = historyScope.filter(row => normalizeBillText(row['Tên hàng']) === productKey)
  const productStatic = staticScope.filter(row => normalizeBillText(row['Tên hàng']) === productKey)
  const newestHistoryRows = latestRows(productHistory)
  const newest = newestHistoryRows[0] ?? productStatic[0]!
  const sku = newest['Mã hàng']
  const matched = { sku, canonicalSku: canonicalSku(sku), productName: newest['Tên hàng'] }

  const historyPrices = unique(newestHistoryRows.map(row => parseNumber(row['Giá bán'])).filter((price): price is number => price !== null && price > 0))
  const staticPrices = unique(productStatic.map(row => parseNumber(row['Giá bán'])).filter((price): price is number => price !== null && price > 0))
  const price = historyPrices.length === 1
    ? historyPrices[0]!
    : historyPrices.length === 0 && staticPrices.length === 1 ? staticPrices[0]! : null
  const priceSource = historyPrices.length === 1
    ? 'latest_positive_history' as const
    : price !== null ? 'static_price' as const : undefined

  const priceConfirmationId = `price:${encodeURIComponent(item.lineId)}:use-current`
  const flags = warningText(productStatic)
  const priceNeedsConfirmation = /hỏi\s*lại\s*giá|báo\s*tăng/i.test(flags)
    && !confirmedIds.has(priceConfirmationId)

  const historyUnitRow = [...productHistory]
    .sort((a, b) => parseDate(b['Thời gian']) - parseDate(a['Thời gian']))
    .find(row => isValidCatalogUnit(row['ĐVT']))
  const staticUnitRow = productStatic.find(row => isValidCatalogUnit(row['ĐVT']))
  const overrideUnit = businessUnitOverride(selectedProduct)
  const unitConfirmationId = `unit:${encodeURIComponent(item.lineId)}:requested-1to1`
  const confirmedUnit = confirmedIds.has(unitConfirmationId) ? item.requestedUnit : null
  const unit = historyUnitRow?.['ĐVT'] ?? staticUnitRow?.['ĐVT'] ?? overrideUnit ?? confirmedUnit
  const unitSource = historyUnitRow
    ? 'history' as const
    : staticUnitRow ? 'static_price' as const
    : overrideUnit ? 'business_override' as const
    : confirmedUnit ? 'staff_confirmation' as const : undefined

  const confirmations: ResolvedBillLine['confirmations'] = []
  if (!unit) {
    confirmations.push({
      confirmationId: unitConfirmationId,
      kind: 'unit',
      label: `Dùng ${item.requestedUnit} làm ĐVT 1:1 cho ${selectedProduct}`,
      reason: 'BILL.md không có ĐVT hợp lệ cho sản phẩm này',
    })
  }
  if (priceNeedsConfirmation) {
    confirmations.push({
      confirmationId: priceConfirmationId,
      kind: 'price',
      label: price === null ? 'Xác nhận lại giá' : `Xác nhận dùng giá ${price.toLocaleString('vi-VN')}đ`,
      reason: 'Bảng giá có ghi chú Hỏi lại giá/Báo tăng',
    })
  }

  const base = {
    lineId: item.lineId,
    request: item,
    matched,
    evidence: {
      selectionSource,
      priceSource,
      unitSource,
      rowDates: unique(productHistory.map(row => row['Thời gian'])).slice(0, 5),
    },
    candidates,
    confirmations,
  }

  if (price === null || priceNeedsConfirmation) {
    const warning = price === null ? 'Cần xác nhận giá bán' : 'Cần xác nhận giá theo ghi chú bảng giá'
    return { ...base, status: 'needs_price_confirmation', warning }
  }
  if (!unit) {
    return { ...base, status: 'needs_unit_confirmation', warning: `Cần xác nhận ĐVT cho ${selectedProduct}` }
  }

  const calculated = resolveOrderLine({
    productName: selectedProduct,
    catalogUnit: unit,
    catalogPrice: price,
    requestedQuantity: item.requestedQuantity,
    requestedUnit: item.requestedUnit,
  })
  if (!calculated.ok) {
    return { ...base, status: 'needs_unit_confirmation', warning: calculated.warning }
  }

  const resolved = {
    quantity: calculated.quantity,
    unit: calculated.unit,
    catalogPrice: price,
    unitPrice: calculated.unitPrice,
    lineTotal: calculated.lineTotal,
  }

  if (/cập\s*nhật\s*-?\s*báo\s*khách/i.test(flags)) {
    const notified = flags.match(/(\d{1,2})[./](\d{1,2})[./](\d{2,4})/)
    if (!notified) {
      // Note flags an update but records no notified date → keep the generic notice.
      return { ...base, status: 'resolved', resolved, warning: '⚠️ Bảng giá ghi CẬP NHẬT - BÁO KHÁCH' }
    }
    const [notifiedLabel] = notified
    const year = Number(notified[3]!) < 100 ? Number(notified[3]!) + 2000 : Number(notified[3]!)
    const notifiedDate = Date.UTC(year, Number(notified[2]!) - 1, Number(notified[1]!))
    const repurchased = productHistory.some(row =>
      parseDate(row['Thời gian']) >= notifiedDate && parseNumber(row['Giá bán']) === price)
    if (repurchased) {
      return { ...base, status: 'resolved', resolved, warning: `✅ Đã báo khách ${notifiedLabel}, khách đã mua lại — dùng giá hiện tại` }
    }
    const notifiedConfirmationId = `notified:${encodeURIComponent(item.lineId)}:confirmed`
    if (confirmedIds.has(notifiedConfirmationId)) {
      return { ...base, status: 'resolved', resolved, warning: `✅ Đã xác nhận báo khách ${notifiedLabel}, dùng giá hiện tại` }
    }
    return {
      ...base,
      status: 'needs_price_confirmation',
      confirmations: [
        ...base.confirmations,
        {
          confirmationId: notifiedConfirmationId,
          kind: 'price' as const,
          label: `Xác nhận đã báo khách, dùng giá ${price.toLocaleString('vi-VN')}đ`,
          reason: `CẬP NHẬT - đã báo khách ${notifiedLabel} nhưng chưa có đơn mua lại sau đó`,
        },
      ],
      warning: `⚠️ CẬP NHẬT - đã báo khách ${notifiedLabel} nhưng chưa mua lại, cần báo lại giá`,
    }
  }

  return { ...base, status: 'resolved', resolved }
}

export function resolveBillOrder(index: BillIndex, request: ResolveBillOrderRequest): ResolveBillOrderOutput {
  const selections = new Map((request.selections ?? []).map(selection => [selection.lineId, selection.candidateId]))
  const confirmationsByLine = new Map<string, Set<string>>()
  for (const confirmation of request.confirmations ?? []) {
    const set = confirmationsByLine.get(confirmation.lineId) ?? new Set<string>()
    set.add(confirmation.confirmationId)
    confirmationsByLine.set(confirmation.lineId, set)
  }

  const customerResolution = resolveCustomer(index, request.customerQuery, selections)
  if (!customerResolution.customer) {
    return {
      resolutionStatus: 'needs_confirmation',
      draftId: request.draftId,
      source: { path: 'files/bill/BILL.md', rowCount: index.rows.length },
      customer: {
        status: customerResolution.status,
        candidates: customerResolution.candidates,
      },
      lines: [],
      orderDraft: null,
    }
  }

  const { customer } = customerResolution
  const lines = request.items.map(item => resolveLine(index, item, {
    customerCode: customer.code,
    selectedCandidateId: selections.get(item.lineId),
    confirmedIds: confirmationsByLine.get(item.lineId) ?? new Set(),
  }))

  const draftItems = lines.map((line) => {
    const { resolved } = line
    return {
      name: line.matched?.productName ?? line.request.rawName,
      ...(line.matched?.sku ? { sku: line.matched.sku } : {}),
      orderedQuantity: line.request.requestedQuantity,
      orderedUnit: line.request.requestedUnit,
      quantity: resolved?.quantity ?? 0,
      unit: resolved?.unit ?? '',
      unitPrice: resolved?.unitPrice ?? null,
      lineTotal: resolved?.lineTotal ?? null,
      ...(line.warning ? { note: line.warning } : {}),
    }
  })
  const orderDraft: ResolvedOrderDraft = {
    customerName: customer.name,
    customerCode: customer.code,
    items: draftItems,
    totalQuantity: Math.round(draftItems.reduce((sum, item) => sum + item.quantity, 0) * 1000) / 1000,
    totalAmount: draftItems.reduce((sum, item) => sum + (item.lineTotal ?? 0), 0),
    pendingCount: draftItems.filter(item => item.lineTotal === null).length,
  }

  return {
    resolutionStatus: orderDraft.pendingCount > 0 ? 'needs_confirmation' : 'resolved',
    draftId: request.draftId,
    source: { path: 'files/bill/BILL.md', rowCount: index.rows.length },
    customer: { status: 'resolved', code: customer.code, name: customer.name, candidates: [] },
    lines,
    orderDraft,
  }
}
