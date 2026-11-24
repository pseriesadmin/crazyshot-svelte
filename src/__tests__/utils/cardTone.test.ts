import { describe, it, expect } from 'vitest'
import { CARD_TONES, normalizeCardTone } from '$lib/utils/cardTone'

describe('normalizeCardTone', () => {
  it('허용된 3종만 통과', () => {
    for (const t of CARD_TONES) expect(normalizeCardTone(t)).toBe(t)
  })
  it('그 외 값·없음은 null(기존 모습)', () => {
    expect(normalizeCardTone('red')).toBeNull()
    expect(normalizeCardTone('')).toBeNull()
    expect(normalizeCardTone(undefined)).toBeNull()
    expect(normalizeCardTone(null)).toBeNull()
    expect(normalizeCardTone(1)).toBeNull()
    expect(normalizeCardTone({ tone: 'white' })).toBeNull()
  })
})
