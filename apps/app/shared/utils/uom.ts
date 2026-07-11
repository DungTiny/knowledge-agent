/**
 * Unit-of-measure (ĐVT) handling for customer orders.
 *
 * Price lists use pack-size units like "Thùng/24 Hộp", "Thùng /50gói",
 * "Thùng (100 cuộn)", "Lốc/4 Hộp": the listed price is for ONE container
 * (Thùng/Lốc) holding N sub-units (Hộp/gói/cuộn/xâu). Customers often order
 * in sub-units ("12 hộp Richs"), so billing must convert to catalog units
 * deterministically — the model is never trusted with this arithmetic.
 *
 * Two softer mismatches are also handled here so lines are not flagged pending
 * for no reason:
 *   - Synonym units — customers say "hộp" for a product listed as "Lon".
 *   - Measure units — a product listed as "Túi 1Kg" ordered as "1kg" / "500g".
 *   - Plain measures — a product listed by "Lạng" ordered as grams (100g = 1 lạng).
 */

export interface PackSpec {
  /** Container unit, e.g. "Thùng", "Lốc" */
  container: string
  /** Number of sub-units per container, e.g. 24 */
  count: number
  /** Sub-unit, e.g. "Hộp", "gói", "cuộn" — may be empty when the ĐVT omits it */
  subUnit: string
}

// Matches "Thùng/24 Hộp", "Thùng /50gói", "Thùng (100 cuộn)", "Lốc/4 Hộp"
const PACK_SPEC_RE = /^(.+?)\s*[/(]\s*(\d+)\s*([^)/]*?)\s*\)?$/

export function parsePackSpec(unit: string | null | undefined): PackSpec | null {
  if (!unit) return null
  const match = unit.trim().match(PACK_SPEC_RE)
  if (!match) return null
  const count = Number(match[2])
  if (!Number.isInteger(count) || count <= 0) return null
  return { container: match[1]!.trim(), count, subUnit: (match[3] ?? '').trim() }
}

export function normalizeUnit(unit: string): string {
  return unit.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * Units that mean the same thing for pricing (1:1, same price). Groups are
 * transitive: "hộp" = "lon" and "lon" = "hũ" collapse into one group.
 * Confirmed with the business — extend deliberately, a wrong pair mis-bills.
 */
const UNIT_SYNONYMS: string[][] = [
  ['hộp', 'lon', 'hũ'],
  ['gói', 'túi'],
  ['chai', 'lọ'],
]

/** True when two unit names are the same or belong to the same synonym group. */
export function unitsEquivalent(a: string, b: string): boolean {
  const na = normalizeUnit(a)
  const nb = normalizeUnit(b)
  if (na === nb) return true
  return UNIT_SYNONYMS.some(group => group.includes(na) && group.includes(nb))
}

type Dimension = 'mass' | 'volume'

/** Measure units → (dimension, factor to a common base: grams for mass, ml for volume). */
const MEASURE_FACTORS: Record<string, { dimension: Dimension, toBase: number }> = {
  kg: { dimension: 'mass', toBase: 1000 },
  g: { dimension: 'mass', toBase: 1 },
  gr: { dimension: 'mass', toBase: 1 },
  gam: { dimension: 'mass', toBase: 1 },
  gram: { dimension: 'mass', toBase: 1 },
  lạng: { dimension: 'mass', toBase: 100 },
  lang: { dimension: 'mass', toBase: 100 },
  l: { dimension: 'volume', toBase: 1000 },
  lit: { dimension: 'volume', toBase: 1000 },
  lít: { dimension: 'volume', toBase: 1000 },
  ml: { dimension: 'volume', toBase: 1 },
}

function measureFactor(unit: string): { dimension: Dimension, toBase: number } | null {
  return MEASURE_FACTORS[normalizeUnit(unit)] ?? null
}

export interface SizedUnit {
  /** Bare unit name without the size, e.g. "Túi" from "Túi 1Kg" */
  base: string
  /** Size expressed in the common base (grams / ml), null when the ĐVT has no measure */
  measureBase: number | null
  dimension: Dimension | null
}

// Matches "Túi 1Kg", "Gói 1kg", "Lon 400ml", "Chai 1.5L" — an optional name then a number + measure unit.
const SIZED_UNIT_RE = /^(.*?)\s*(\d+(?:[.,]\d+)?)\s*([a-zà-ỹ]+)\.?$/i

/** Split a catalog unit like "Túi 1Kg" into its base name and its size in a common base. */
export function parseSizedUnit(unit: string): SizedUnit {
  const trimmed = unit.trim()
  const match = trimmed.match(SIZED_UNIT_RE)
  if (match) {
    const factor = measureFactor(match[3]!)
    if (factor) {
      const value = Number(match[2]!.replace(',', '.'))
      if (Number.isFinite(value) && value > 0) {
        return { base: match[1]!.trim() || trimmed, measureBase: value * factor.toBase, dimension: factor.dimension }
      }
    }
  }
  return { base: trimmed, measureBase: null, dimension: null }
}

export interface ResolveOrderLineInput {
  /** ĐVT exactly as written in the price list, e.g. "Thùng/24 Hộp" */
  catalogUnit: string
  /** Giá bán for ONE catalog unit */
  catalogPrice: number
  /** Quantity the customer asked for */
  requestedQuantity: number
  /** Unit the customer used, e.g. "Hộp". Undefined = ordered in catalog unit */
  requestedUnit?: string
}

export type ResolveOrderLineResult =
  | {
    ok: true
    /** Billed quantity in catalog units (may be fractional, e.g. 0.5) */
    quantity: number
    unit: string
    unitPrice: number
    lineTotal: number
    /** Human-readable conversion, e.g. "12 Hộp = 0.5 × Thùng/24 Hộp" */
    conversion: string
  }
  | { ok: false, warning: string }

/** Whole or half containers only. Returns the snapped quantity, or null if it isn't a 0.5 multiple. */
function toHalfStep(quantity: number): number | null {
  const doubled = quantity * 2
  const rounded = Math.round(doubled)
  if (Math.abs(doubled - rounded) > 1e-9) return null
  return rounded / 2
}

function resolved(quantity: number, catalogUnit: string, catalogPrice: number, conversion: string): ResolveOrderLineResult {
  return { ok: true, quantity, unit: catalogUnit, unitPrice: catalogPrice, lineTotal: Math.round(quantity * catalogPrice), conversion }
}

/**
 * Deterministic conversion + pricing for one order line.
 *
 * Resolution order: order in the catalog unit (or a synonym / the container
 * name) → pack sub-unit conversion ("Thùng/24 Hộp") → sized measure conversion
 * ("Túi 1Kg" ordered as kg/g) → plain measure conversion (grams to Lạng/KG).
 * Anything that doesn't cleanly convert to a
 * whole or half container returns ok:false so the caller marks it pending
 * instead of guessing.
 */
export function resolveOrderLine(input: ResolveOrderLineInput): ResolveOrderLineResult {
  const { catalogUnit, catalogPrice, requestedQuantity, requestedUnit } = input

  if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0) {
    return { ok: false, warning: `Cần xác nhận: số lượng không hợp lệ (${requestedQuantity})` }
  }
  if (!Number.isFinite(catalogPrice) || catalogPrice < 0) {
    return { ok: false, warning: `Cần xác nhận: đơn giá không hợp lệ (${catalogPrice})` }
  }

  const pack = parsePackSpec(catalogUnit)
  const sized = pack ? null : parseSizedUnit(catalogUnit)

  // 1. Ordered directly in the catalog unit, a synonym of it, or the container name.
  const orderedInCatalogUnit = !requestedUnit
    || unitsEquivalent(requestedUnit, catalogUnit)
    || (pack !== null && unitsEquivalent(requestedUnit, pack.container))
    || (sized !== null && unitsEquivalent(requestedUnit, sized.base))
  if (orderedInCatalogUnit) {
    return resolved(requestedQuantity, catalogUnit, catalogPrice, `${requestedQuantity} ${catalogUnit}`)
  }

  // 2. Pack sub-unit conversion, e.g. 12 Hộp of "Thùng/24 Hộp".
  if (pack && pack.subUnit && unitsEquivalent(requestedUnit!, pack.subUnit)) {
    const quantity = toHalfStep(requestedQuantity / pack.count)
    if (quantity === null) {
      return { ok: false, warning: `Cần xác nhận: ${requestedQuantity} ${requestedUnit} lẻ so với quy cách ${catalogUnit} (chỉ bán nguyên hoặc nửa ${pack.container.toLowerCase()})` }
    }
    return resolved(quantity, catalogUnit, catalogPrice, `${requestedQuantity} ${requestedUnit} = ${quantity} × ${catalogUnit}`)
  }

  // 3. Measure conversion, e.g. 500g of "Túi 1Kg".
  if (sized && sized.measureBase !== null) {
    const factor = measureFactor(requestedUnit!)
    if (factor && factor.dimension === sized.dimension) {
      const quantity = toHalfStep((requestedQuantity * factor.toBase) / sized.measureBase)
      if (quantity === null) {
        return { ok: false, warning: `Cần xác nhận: ${requestedQuantity}${requestedUnit} lẻ so với quy cách ${catalogUnit} (chỉ bán nguyên hoặc nửa ${sized.base.toLowerCase()})` }
      }
      return resolved(quantity, catalogUnit, catalogPrice, `${requestedQuantity}${requestedUnit} = ${quantity} × ${catalogUnit}`)
    }
  }

  // 4. Plain catalog measure conversion, e.g. 200gr = 2 Lạng.
  const catalogMeasure = measureFactor(catalogUnit)
  const requestedMeasure = measureFactor(requestedUnit!)
  if (catalogMeasure && requestedMeasure && catalogMeasure.dimension === requestedMeasure.dimension) {
    const quantity = toHalfStep((requestedQuantity * requestedMeasure.toBase) / catalogMeasure.toBase)
    if (quantity === null) {
      return { ok: false, warning: `Cần xác nhận: ${requestedQuantity}${requestedUnit} lẻ so với đơn vị ${catalogUnit} (chỉ hỗ trợ bước 0.5 ${catalogUnit.toLowerCase()})` }
    }
    return resolved(quantity, catalogUnit, catalogPrice, `${requestedQuantity}${requestedUnit} = ${quantity} ${catalogUnit}`)
  }

  return { ok: false, warning: `Cần xác nhận: đơn vị "${requestedUnit}" không khớp quy cách "${catalogUnit}"` }
}

export interface OrderLineItem {
  name: string
  sku?: string
  orderedQuantity?: number
  orderedUnit?: string
  quantity: number
  unit: string
  unitPrice: number | null
  lineTotal: number | null
  note?: string
}

export interface OrderDraft {
  customerName: string
  customerCode?: string
  items: OrderLineItem[]
  totalQuantity: number
  totalAmount: number
  pendingCount: number
}

function appendNote(existing: string | undefined, added: string): string {
  return existing ? `${existing} — ${added}` : added
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

/**
 * Recompute every model-supplied number in an order draft.
 *
 * - Lines with orderedQuantity/orderedUnit get their billed quantity re-derived
 *   from the catalog ĐVT (pack spec, synonym, or measure); a failed conversion
 *   flips the line to pending (unitPrice/lineTotal = null) with a warning note.
 * - lineTotal, totalQuantity, totalAmount and pendingCount are always
 *   recomputed — the model's arithmetic is never trusted.
 */
export function normalizeOrder(order: OrderDraft): OrderDraft {
  const items = order.items.map((item): OrderLineItem => {
    if (item.unitPrice === null) {
      return { ...item, lineTotal: null }
    }

    let { quantity } = item
    if (item.orderedQuantity !== undefined && item.orderedQuantity !== null && item.orderedUnit) {
      const result = resolveOrderLine({
        catalogUnit: item.unit,
        catalogPrice: item.unitPrice,
        requestedQuantity: item.orderedQuantity,
        requestedUnit: item.orderedUnit,
      })
      if (!result.ok) {
        return { ...item, unitPrice: null, lineTotal: null, note: appendNote(item.note, `⚠️ ${result.warning}`) }
      }
      ({ quantity } = result)
    }

    return { ...item, quantity, lineTotal: Math.round(quantity * item.unitPrice) }
  })

  return {
    ...order,
    items,
    totalQuantity: round3(items.reduce((sum, item) => sum + item.quantity, 0)),
    totalAmount: items.reduce((sum, item) => sum + (item.lineTotal ?? 0), 0),
    pendingCount: items.filter(item => item.lineTotal === null).length,
  }
}
