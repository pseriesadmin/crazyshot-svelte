import { describe, it, expect } from 'vitest'
import { rankProductsByRelevance, parsePinId } from '$lib/utils/productSearchRanking'
import { relevanceTier } from '$lib/utils/similarNameSuggest'

const p = (id: string, name: string, brand: string | null = null, caption: string | null = null, desc: string | null = null) => ({
  id,
  name,
  brand,
  product_caption: caption,
  description: desc,
})

describe('relevanceTier (공용화 후 동일 기준 유지)', () => {
  it('상품명 시작일치 0 / 브랜드 토큰 1 / 브랜드 시작 2 / 상품명 포함 3 / 캡션 4 / 설명 5 / 불일치 6', () => {
    expect(relevanceTier(p('1', 'SET 1'), 'set')).toBe(0)
    expect(relevanceTier(p('2', 'X', 'CANON|SONY'), 'sony')).toBe(1)
    expect(relevanceTier(p('3', 'X', 'SONYX'), 'sony')).toBe(2)
    expect(relevanceTier(p('4', 'A7S3 SONY'), 'sony')).toBe(3)
    expect(relevanceTier(p('5', 'X', null, 'sony 카메라'), 'sony')).toBe(4)
    expect(relevanceTier(p('6', 'X', null, null, 'sony'), 'sony')).toBe(5)
    expect(relevanceTier(p('7', 'X'), 'sony')).toBe(6)
  })
})

describe('rankProductsByRelevance', () => {
  it('RK-1: 상품명 시작일치가 포함일치·브랜드 일치보다 앞선다', () => {
    const rows = [
      p('c', 'Zoom A7 SET'),
      p('b', 'X', 'SET'),
      p('a', 'SET 14'),
    ]
    expect(rankProductsByRelevance(rows, 'set').map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })

  it('RK-2: 같은 등급이면 일치 위치가 앞인 것, 그다음 이름이 짧은 것이 앞선다', () => {
    const rows = [
      p('late', '렌즈 후드 소니'),
      p('long', '소니 A7S3 풀프레임 카메라'),
      p('short', '소니 A7'),
    ]
    expect(rankProductsByRelevance(rows, '소니').map((r) => r.id)).toEqual(['short', 'long', 'late'])
  })

  it('RK-3: 대소문자·영문·숫자·특수문자 부분 입력도 근접도순으로 정렬한다', () => {
    const rows = [
      p('c', 'Case for (T154) ULANZI'),
      p('a', 'ULANZI Ombra XIANG II (T154)'),
      p('b', 'Light 154 pro'),
    ]
    const byParen = rankProductsByRelevance(rows, '(t154)').map((r) => r.id)
    expect(byParen[0]).toBe('c') // 위치가 앞(상품명 앞쪽 일치) — 특수문자 포함 부분 일치
    expect(byParen).toEqual(expect.arrayContaining(['a', 'c', 'b']))
    expect(rankProductsByRelevance(rows, 'ULANZI').map((r) => r.id)[0]).toBe('a')
    expect(rankProductsByRelevance(rows, '154').length).toBe(3)
  })

  it('RK-4: pin 상품은 등급과 무관하게 맨 앞이고, 나머지 순서는 근접도순 그대로다', () => {
    const rows = [
      p('x', '소니 A7'),
      p('y', '카메라 소니'),
      p('pin', '전혀 다른 이름', '소니'),
    ]
    const ranked = rankProductsByRelevance(rows, '소니', 'pin').map((r) => r.id)
    expect(ranked[0]).toBe('pin')
    expect(ranked.slice(1)).toEqual(['x', 'y'])
  })

  it('RK-5: 빈 검색어는 등급 6 동일 → 이름 가나다순(안정)', () => {
    const rows = [p('b', '나'), p('a', '가')]
    expect(rankProductsByRelevance(rows, '  ').map((r) => r.id)).toEqual(['a', 'b'])
  })

  it('RK-6: 원본 배열을 변경하지 않는다', () => {
    const rows = [p('b', '다'), p('a', '가')]
    const copy = [...rows]
    rankProductsByRelevance(rows, '가')
    expect(rows).toEqual(copy)
  })
})

describe('parsePinId', () => {
  it('UUID만 허용하고 소문자로 정규화한다', () => {
    expect(parsePinId('CF9E4927-B8D4-4526-84F0-ED42578073F7')).toBe('cf9e4927-b8d4-4526-84f0-ed42578073f7')
    expect(parsePinId('not-a-uuid')).toBeNull()
    expect(parsePinId('')).toBeNull()
    expect(parsePinId(null)).toBeNull()
  })
})
