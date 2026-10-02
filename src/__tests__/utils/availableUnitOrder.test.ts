import { describe, it, expect } from 'vitest'
import { sortUnitsByCode, pickLowestUnit } from '$lib/utils/availableUnitOrder'

const u = (id: string, product_code: string | null) => ({ id, product_code })

describe('availableUnitOrder', () => {
  it('품번 오름차순으로 정렬한다 (DB 반환 순서와 무관)', () => {
    const sorted = sortUnitsByCode([
      u('a', 'CSCRCCR0020031'), u('b', 'CSCRCCR0020036'), u('c', 'CSCRCCR0020025'), u('d', 'CSCRCCR0020001'),
    ])
    expect(sorted.map(x => x.product_code)).toEqual([
      'CSCRCCR0020001', 'CSCRCCR0020025', 'CSCRCCR0020031', 'CSCRCCR0020036',
    ])
  })

  it('숫자를 인식해 정렬한다 (2 < 10)', () => {
    const sorted = sortUnitsByCode([u('a', 'X10'), u('b', 'X2')])
    expect(sorted.map(x => x.product_code)).toEqual(['X2', 'X10'])
  })

  it('코드 없는 유닛은 맨 뒤로 보낸다', () => {
    const sorted = sortUnitsByCode([u('a', null), u('b', 'CS0002'), u('c', 'CS0001')])
    expect(sorted.map(x => x.id)).toEqual(['c', 'b', 'a'])
  })

  it('원본 배열을 변경하지 않는다', () => {
    const src = [u('a', 'CS0002'), u('b', 'CS0001')]
    sortUnitsByCode(src)
    expect(src[0].id).toBe('a')
  })

  it('pickLowestUnit은 가장 낮은 순번을 고르고, 비어 있으면 null', () => {
    expect(pickLowestUnit([u('a', 'CS0040'), u('b', 'CS0001'), u('c', 'CS0025')])?.id).toBe('b')
    expect(pickLowestUnit([])).toBeNull()
    expect(pickLowestUnit([u('a', null), u('b', 'CS0003')])?.id).toBe('b')
  })
})
