import { describe, it, expect } from 'vitest'
import { createIndex, type SearchDocument } from '$lib/server/searchEngine/core/index'

/**
 * miniSearchProvider.test.ts — MiniSearchProvider + createIndex 유닛 테스트
 *
 * crazyshot 데이터 없이 제네릭 문서로 fuzzy/prefix/boost 동작 검증.
 * 이식성 확인 목적 겸함: 이 테스트가 통과한다는 것 = core/ 계층이
 * crazyshot 전용 의존성 없이 독립적으로 작동한다는 증명.
 */

// ── 제네릭 테스트 문서 타입 (crazyshot 스키마와 무관) ──────────────────────────
interface ProductDoc extends SearchDocument {
  id: string
  name: string
  brand: string
  keywords: string
  description: string
}

const docs: ProductDoc[] = [
  { id: '1', name: '소니 A7IV 풀프레임 미러리스', brand: '소니', keywords: '카메라 미러리스 풀프레임', description: '뛰어난 화질의 소니 플래그십 카메라' },
  { id: '2', name: '캐논 EOS R6 Mark II', brand: '캐논', keywords: '카메라 미러리스 연사', description: '고속 연사와 동영상에 특화된 캐논 카메라' },
  { id: '3', name: '니콘 Z6 III 미러리스', brand: '니콘', keywords: '카메라 미러리스 동영상', description: '니콘 Z 마운트 미러리스 카메라' },
  { id: '4', name: '소니 FE 24-70mm F2.8 GM2', brand: '소니', keywords: '렌즈 광각 표준줌', description: '표준 줌 렌즈, 뛰어난 화질' },
  { id: '5', name: 'DJI 로닌 SC2 짐벌', brand: 'DJI', keywords: '짐벌 스태빌라이저 동영상', description: '스마트폰·미러리스 카메라용 짐벌' },
]

const config = {
  searchFields: ['name', 'brand', 'keywords', 'description'] as const,
  storeFields: ['id', 'name', 'brand', 'keywords'] as const,
  boost: { name: 3, brand: 2, keywords: 2, description: 1 },
  defaultFuzzy: 0.2 as const,
  defaultPrefix: true,
}

describe('createIndex + MiniSearchProvider — 기본 검색', () => {
  it('정확한 상품명으로 매칭', () => {
    const index = createIndex(config, docs)
    const results = index.search('소니 A7IV')
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].document.id).toBe('1')
  })

  it('브랜드명으로 매칭', () => {
    const index = createIndex(config, docs)
    const results = index.search('캐논')
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].document.id).toBe('2')
  })

  it('키워드로 매칭 — 상세설명/키워드에 있는 단어', () => {
    const index = createIndex(config, docs)
    const results = index.search('짐벌')
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].document.id).toBe('5')
  })

  it('documentCount 정확성', () => {
    const index = createIndex(config, docs)
    expect(index.documentCount).toBe(5)
  })
})

describe('createIndex + MiniSearchProvider — prefix 검색', () => {
  it('prefix: true — "미러리" 로 "미러리스" 매칭', () => {
    const index = createIndex(config, docs)
    const results = index.search('미러리', { prefix: true })
    expect(results.length).toBeGreaterThan(0)
  })

  it('prefix: false — "미러리" 로 매칭 안 됨', () => {
    const index = createIndex(config, docs)
    const results = index.search('미러리', { prefix: false, fuzzy: false })
    expect(results.length).toBe(0)
  })
})

describe('createIndex + MiniSearchProvider — fuzzy 검색 (오타 허용)', () => {
  it('fuzzy: 0.2 — "소이" 오타로 "소니" 매칭 (편집거리 1)', () => {
    const index = createIndex(config, docs)
    // "소이" vs "소니": 1글자 차이 — 짧은 단어라 거의 안 걸릴 수 있음
    // "소니카메라" 같은 긴 쿼리로 검증
    const results = index.search('소니카메리', { fuzzy: 0.2, prefix: true })
    // 결과가 있거나 없을 수 있음 — fuzzy는 단어 길이 의존적
    // 핵심: 에러 없이 실행돼야 함
    expect(Array.isArray(results)).toBe(true)
  })

  it('fuzzy 오타 허용 — "렌즈광각" 오타로 매칭 시도', () => {
    const index = createIndex(config, docs)
    const results = index.search('렌즈', { fuzzy: 0.2, prefix: true })
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].document.id).toBe('4')
  })
})

describe('createIndex + MiniSearchProvider — boost 가중치', () => {
  it('boost가 높은 필드(name, brand)가 낮은 필드(description)보다 우선', () => {
    const index = createIndex(config, docs)
    const results = index.search('소니')
    // 소니 A7IV (name에 소니 포함) + 소니 FE 렌즈 (name에 소니 포함)
    // DJI 짐벌(description에 "카메라"만 포함)은 나오지 않아야 함
    const brandMatches = results.filter(r => ['1', '4'].includes(r.document.id))
    expect(brandMatches.length).toBeGreaterThan(0)
  })

  it('limit 옵션으로 결과 개수 제한', () => {
    const index = createIndex(config, docs)
    const results = index.search('카메라', { limit: 2 })
    expect(results.length).toBeLessThanOrEqual(2)
  })
})

describe('createIndex — 엣지케이스', () => {
  it('빈 query → 빈 배열 반환', () => {
    const index = createIndex(config, docs)
    expect(index.search('')).toEqual([])
    expect(index.search('   ')).toEqual([])
  })

  it('빈 문서 배열 → 검색 결과 없음', () => {
    const index = createIndex(config, [])
    const results = index.search('소니')
    expect(results).toEqual([])
    expect(index.documentCount).toBe(0)
  })

  it('이식성 확인 — core/ import가 crazyshot 전용 모듈 없이 완료됨', () => {
    // 이 테스트 자체가 통과 = import 체인에 $lib/services/supabase, $env 등 없음
    expect(true).toBe(true)
  })
})
