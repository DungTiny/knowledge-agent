import { describe, expect, test } from 'bun:test'
import { normalizeOrder, parsePackSpec, parseSizedUnit, resolveOrderLine, unitsEquivalent } from '../shared/utils/uom'

describe('parsePackSpec', () => {
  test('parses "Thùng/24 Hộp"', () => {
    expect(parsePackSpec('Thùng/24 Hộp')).toEqual({ container: 'Thùng', count: 24, subUnit: 'Hộp' })
  })

  test('parses "Thùng/12 Hộp"', () => {
    expect(parsePackSpec('Thùng/12 Hộp')).toEqual({ container: 'Thùng', count: 12, subUnit: 'Hộp' })
  })

  test('parses "Lốc/4 Hộp"', () => {
    expect(parsePackSpec('Lốc/4 Hộp')).toEqual({ container: 'Lốc', count: 4, subUnit: 'Hộp' })
  })

  test('parses "Thùng /50gói" (irregular spacing)', () => {
    expect(parsePackSpec('Thùng /50gói')).toEqual({ container: 'Thùng', count: 50, subUnit: 'gói' })
  })

  test('parses "Thùng (100 cuộn)" (parenthesized)', () => {
    expect(parsePackSpec('Thùng (100 cuộn)')).toEqual({ container: 'Thùng', count: 100, subUnit: 'cuộn' })
  })

  test('parses "Thùng/20 xâu"', () => {
    expect(parsePackSpec('Thùng/20 xâu')).toEqual({ container: 'Thùng', count: 20, subUnit: 'xâu' })
  })

  test('returns null for plain units', () => {
    expect(parsePackSpec('Hộp')).toBeNull()
    expect(parsePackSpec('Thùng')).toBeNull()
    expect(parsePackSpec('Gói 1kg')).toBeNull()
    expect(parsePackSpec('')).toBeNull()
    expect(parsePackSpec(null)).toBeNull()
    expect(parsePackSpec(undefined)).toBeNull()
  })
})

describe('resolveOrderLine', () => {
  // The bug that started this: Richs "Thùng/24 Hộp" at 705,000đ, customer wants 12 hộp
  test('12 hộp of Thùng/24 Hộp → 0.5 thùng, 352,500đ', () => {
    const result = resolveOrderLine({
      catalogUnit: 'Thùng/24 Hộp',
      catalogPrice: 705_000,
      requestedQuantity: 12,
      requestedUnit: 'Hộp',
    })
    expect(result).toEqual({
      ok: true,
      quantity: 0.5,
      unit: 'Thùng/24 Hộp',
      unitPrice: 705_000,
      lineTotal: 352_500,
      conversion: '12 Hộp = 0.5 × Thùng/24 Hộp',
    })
  })

  test('24 hộp of Thùng/24 Hộp → 1 thùng, full price', () => {
    const result = resolveOrderLine({
      catalogUnit: 'Thùng/24 Hộp',
      catalogPrice: 705_000,
      requestedQuantity: 24,
      requestedUnit: 'hộp',
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.quantity).toBe(1)
      expect(result.lineTotal).toBe(705_000)
    }
  })

  test('4 hộp of Lốc/4 Hộp → 1 lốc', () => {
    const result = resolveOrderLine({
      catalogUnit: 'Lốc/4 Hộp',
      catalogPrice: 25_000,
      requestedQuantity: 4,
      requestedUnit: 'Hộp',
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.quantity).toBe(1)
      expect(result.lineTotal).toBe(25_000)
    }
  })

  test('ordered in container unit passes through', () => {
    const result = resolveOrderLine({
      catalogUnit: 'Thùng/12 Hộp',
      catalogPrice: 435_000,
      requestedQuantity: 2,
      requestedUnit: 'Thùng',
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.quantity).toBe(2)
      expect(result.lineTotal).toBe(870_000)
    }
  })

  test('no requested unit = catalog unit', () => {
    const result = resolveOrderLine({
      catalogUnit: 'Hộp',
      catalogPrice: 122_000,
      requestedQuantity: 3,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.quantity).toBe(3)
      expect(result.lineTotal).toBe(366_000)
    }
  })

  test('odd sub-unit quantity (10 of 24) needs confirmation', () => {
    const result = resolveOrderLine({
      catalogUnit: 'Thùng/24 Hộp',
      catalogPrice: 705_000,
      requestedQuantity: 10,
      requestedUnit: 'Hộp',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.warning).toContain('lẻ so với quy cách')
    }
  })

  test('mismatched unit needs confirmation', () => {
    const result = resolveOrderLine({
      catalogUnit: 'Thùng/24 Hộp',
      catalogPrice: 705_000,
      requestedQuantity: 2,
      requestedUnit: 'Gói',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.warning).toContain('không khớp quy cách')
    }
  })

  test('rejects zero/negative quantity', () => {
    expect(resolveOrderLine({ catalogUnit: 'Hộp', catalogPrice: 1000, requestedQuantity: 0 }).ok).toBe(false)
    expect(resolveOrderLine({ catalogUnit: 'Hộp', catalogPrice: 1000, requestedQuantity: -2 }).ok).toBe(false)
  })
})

describe('unitsEquivalent', () => {
  test('synonym groups match both directions', () => {
    expect(unitsEquivalent('hộp', 'Lon')).toBe(true)
    expect(unitsEquivalent('Lon', 'hộp')).toBe(true)
    expect(unitsEquivalent('lon', 'hũ')).toBe(true)
    expect(unitsEquivalent('hộp', 'hũ')).toBe(true) // transitive
    expect(unitsEquivalent('gói', 'Túi')).toBe(true)
    expect(unitsEquivalent('chai', 'lọ')).toBe(true)
  })

  test('identical units match', () => {
    expect(unitsEquivalent('Thùng', 'thùng')).toBe(true)
  })

  test('unrelated units do not match', () => {
    expect(unitsEquivalent('hộp', 'gói')).toBe(false)
    expect(unitsEquivalent('chai', 'lon')).toBe(false)
  })
})

describe('parseSizedUnit', () => {
  test('splits "Túi 1Kg" into base + mass', () => {
    expect(parseSizedUnit('Túi 1Kg')).toEqual({ base: 'Túi', measureBase: 1000, dimension: 'mass' })
  })

  test('splits "Lon 400ml" into base + volume', () => {
    expect(parseSizedUnit('Lon 400ml')).toEqual({ base: 'Lon', measureBase: 400, dimension: 'volume' })
  })

  test('splits "Chai 1.5L" with decimal', () => {
    expect(parseSizedUnit('Chai 1.5L')).toEqual({ base: 'Chai', measureBase: 1500, dimension: 'volume' })
  })

  test('plain unit has no measure', () => {
    expect(parseSizedUnit('Hộp')).toEqual({ base: 'Hộp', measureBase: null, dimension: null })
  })
})

describe('resolveOrderLine — synonyms', () => {
  // The bug: catalog "Lon", customer says "hộp" → was flagged pending
  test('5 hộp of a product listed as "Lon" → 5 Lon, full price', () => {
    const result = resolveOrderLine({
      catalogUnit: 'Lon',
      catalogPrice: 30_000,
      requestedQuantity: 5,
      requestedUnit: 'hộp',
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.quantity).toBe(5)
      expect(result.lineTotal).toBe(150_000)
    }
  })

  test('gói ordered for a "Túi" product', () => {
    const result = resolveOrderLine({ catalogUnit: 'Túi', catalogPrice: 122_000, requestedQuantity: 2, requestedUnit: 'gói' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.lineTotal).toBe(244_000)
  })

  test('synonym still works as pack sub-unit (lon of Thùng/24 Lon)', () => {
    const result = resolveOrderLine({ catalogUnit: 'Thùng/24 Lon', catalogPrice: 705_000, requestedQuantity: 12, requestedUnit: 'hộp' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.quantity).toBe(0.5)
      expect(result.lineTotal).toBe(352_500)
    }
  })
})

describe('resolveOrderLine — measure conversion', () => {
  // The bug: catalog "Túi 1Kg", customer says "1 kg" → was flagged pending
  test('1 kg of "Túi 1Kg" → 1 túi', () => {
    const result = resolveOrderLine({
      catalogUnit: 'Túi 1Kg',
      catalogPrice: 177_000,
      requestedQuantity: 1,
      requestedUnit: 'kg',
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.quantity).toBe(1)
      expect(result.lineTotal).toBe(177_000)
    }
  })

  test('2 kg of "Túi 1Kg" → 2 túi', () => {
    const result = resolveOrderLine({ catalogUnit: 'Túi 1Kg', catalogPrice: 177_000, requestedQuantity: 2, requestedUnit: 'kg' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.quantity).toBe(2)
  })

  test('500 g of "Túi 1Kg" → 0.5 túi', () => {
    const result = resolveOrderLine({ catalogUnit: 'Túi 1Kg', catalogPrice: 177_000, requestedQuantity: 500, requestedUnit: 'g' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.quantity).toBe(0.5)
      expect(result.lineTotal).toBe(88_500)
    }
  })

  test('300 g of "Túi 1Kg" is not a half-step → pending', () => {
    const result = resolveOrderLine({ catalogUnit: 'Túi 1Kg', catalogPrice: 177_000, requestedQuantity: 300, requestedUnit: 'g' })
    expect(result.ok).toBe(false)
  })

  test('mismatched dimension (ml against Túi 1Kg) → pending', () => {
    const result = resolveOrderLine({ catalogUnit: 'Túi 1Kg', catalogPrice: 177_000, requestedQuantity: 500, requestedUnit: 'ml' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.warning).toContain('không khớp quy cách')
  })

  test('ordering "túi" directly for "Túi 1Kg" passes through', () => {
    const result = resolveOrderLine({ catalogUnit: 'Túi 1Kg', catalogPrice: 177_000, requestedQuantity: 3, requestedUnit: 'túi' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.quantity).toBe(3)
  })
})

describe('normalizeOrder', () => {
  test('corrects a wrong model conversion (the Richs bug)', () => {
    // Model wrongly billed 12 hộp as 12 thùng: 12 × 705,000 = 8,460,000
    const result = normalizeOrder({
      customerName: 'CF LapH - Quốc Học',
      items: [
        {
          name: 'Kem Béo Thực Vật Richs (454G) - Hàng Lạnh',
          orderedQuantity: 12,
          orderedUnit: 'Hộp',
          quantity: 12,
          unit: 'Thùng/24 Hộp',
          unitPrice: 705_000,
          lineTotal: 8_460_000,
        },
      ],
      totalQuantity: 12,
      totalAmount: 8_460_000,
      pendingCount: 0,
    })

    expect(result.items[0]!.quantity).toBe(0.5)
    expect(result.items[0]!.lineTotal).toBe(352_500)
    expect(result.totalQuantity).toBe(0.5)
    expect(result.totalAmount).toBe(352_500)
    expect(result.pendingCount).toBe(0)
  })

  test('recomputes bad arithmetic even without ordered fields', () => {
    const result = normalizeOrder({
      customerName: 'CF LapH',
      items: [{ name: 'BODUO Mứt Xoài 1,3Kg', quantity: 3, unit: 'Hộp', unitPrice: 122_000, lineTotal: 999_999 },],
      totalQuantity: 3,
      totalAmount: 999_999,
      pendingCount: 0,
    })

    expect(result.items[0]!.lineTotal).toBe(366_000)
    expect(result.totalAmount).toBe(366_000)
  })

  test('flips unconvertible lines to pending and recounts', () => {
    const result = normalizeOrder({
      customerName: 'CF LapH',
      items: [
        {
          name: 'Kem Béo Thực Vật Richs (454G)',
          orderedQuantity: 10,
          orderedUnit: 'Hộp',
          quantity: 0.42,
          unit: 'Thùng/24 Hộp',
          unitPrice: 705_000,
          lineTotal: 296_100,
        },
        { name: 'BODUO Mứt Xoài 1,3Kg', quantity: 2, unit: 'Hộp', unitPrice: 122_000, lineTotal: 244_000 },
      ],
      totalQuantity: 2.42,
      totalAmount: 540_100,
      pendingCount: 0,
    })

    expect(result.items[0]!.unitPrice).toBeNull()
    expect(result.items[0]!.lineTotal).toBeNull()
    expect(result.items[0]!.note).toContain('⚠️')
    expect(result.pendingCount).toBe(1)
    expect(result.totalAmount).toBe(244_000)
  })

  test('keeps already-pending lines pending', () => {
    const result = normalizeOrder({
      customerName: 'CF LapH',
      items: [{ name: 'Bột Matcha Mũ Đỏ', quantity: 1, unit: 'Gói', unitPrice: null, lineTotal: null, note: '⚠️ Hỏi lại giá' },],
      totalQuantity: 1,
      totalAmount: 0,
      pendingCount: 1,
    })

    expect(result.items[0]!.lineTotal).toBeNull()
    expect(result.pendingCount).toBe(1)
    expect(result.totalAmount).toBe(0)
  })

  test('rounds fractional VND totals to whole đồng', () => {
    const result = normalizeOrder({
      customerName: 'CF LapH',
      items: [
        // 705,001 / 2 = 352,500.5 → rounds to 352,501
        { name: 'X', orderedQuantity: 12, orderedUnit: 'Hộp', quantity: 0.5, unit: 'Thùng/24 Hộp', unitPrice: 705_001, lineTotal: 0 },
      ],
      totalQuantity: 0.5,
      totalAmount: 0,
      pendingCount: 0,
    })

    expect(result.items[0]!.lineTotal).toBe(352_501)
  })
})
