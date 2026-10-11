/**
 * nlsearchParamsSchema.test.ts — 검색 파라미터 외부화(A-3) 순수 스키마 테스트
 * 핵심 계약: 설정이 비어 있거나 망가져도 결과는 "코드 기본값 = 현재 값"과 같다.
 */
import { describe, it, expect } from 'vitest'
import { createIndex } from '$lib/server/searchEngine/core/createIndex'
import {
  PRODUCT_INDEX_CONFIG,
  buildProductDocs,
  type ProductDoc,
} from '$lib/server/searchEngine/adapters/productSearchDocs'
import { CRAZYLOG_INDEX_CONFIG } from '$lib/server/searchEngine/adapters/crazylogSearchDocs'
import {
  DEFAULT_NLSEARCH_PARAMS,
  sanitizeNlsearchParams,
  validateNlsearchParams,
  resolveProductIndexConfig,
  resolveCrazylogIndexConfig,
} from '$lib/server/searchEngine/adapters/nlsearchParamsSchema'
import golden from '../../fixtures/productSearchGolden.json'

describe('기본값 = 현재 코드 값', () => {
  it('기본 파라미터로 만든 설정은 기존 설정과 동일하다', () => {
    expect(resolveProductIndexConfig(DEFAULT_NLSEARCH_PARAMS)).toEqual(PRODUCT_INDEX_CONFIG)
    expect(resolveCrazylogIndexConfig(DEFAULT_NLSEARCH_PARAMS)).toEqual(CRAZYLOG_INDEX_CONFIG)
  })

  it('기본 설정으로 만든 인덱스의 검색 결과가 기존과 같다', () => {
    const docs = buildProductDocs(golden as Record<string, unknown>[])
    const a = createIndex<ProductDoc>(PRODUCT_INDEX_CONFIG, docs)
    const b = createIndex<ProductDoc>(resolveProductIndexConfig(DEFAULT_NLSEARCH_PARAMS), docs)
    for (const q of ['소니 카메라', '렌즈', 'Sony A7S3', '풀프레임']) {
      const ra = a.search(q, { fuzzy: 0.2, prefix: true, limit: 20 }).map((r) => [r.document.id, r.score])
      const rb = b.search(q, { fuzzy: 0.2, prefix: true, limit: 20 }).map((r) => [r.document.id, r.score])
      expect(rb).toEqual(ra)
    }
  })

  it('의미 점수 항목은 기본 꺼짐', () => {
    expect(DEFAULT_NLSEARCH_PARAMS.semantic).toEqual({ weight: 0, recommend: false, shadow: false })
  })
})

describe('sanitizeNlsearchParams — 읽을 때는 항상 안전한 값', () => {
  it('null·문자열·배열 등 이상한 입력은 기본값', () => {
    for (const bad of [null, undefined, 'x', 3, []]) {
      expect(sanitizeNlsearchParams(bad)).toEqual(DEFAULT_NLSEARCH_PARAMS)
    }
  })

  it('범위 밖 값은 범위 안으로 맞추고, 숫자가 아니면 기본값', () => {
    const p = sanitizeNlsearchParams({
      product: { boost: { name: -3, brand: 999, caption: 'abc', keywords_text: NaN }, fuzzy: 9 },
      semantic: { weight: 5, recommend: 'yes', shadow: 1 },
    })
    expect(p.product.boost.name).toBe(0)
    expect(p.product.boost.brand).toBe(20)
    expect(p.product.boost.caption).toBe(DEFAULT_NLSEARCH_PARAMS.product.boost.caption)
    expect(p.product.boost.keywords_text).toBe(DEFAULT_NLSEARCH_PARAMS.product.boost.keywords_text)
    expect(p.product.fuzzy).toBe(0.5)
    expect(p.semantic.weight).toBe(1)
    expect(p.semantic.recommend).toBe(false)
    expect(p.semantic.shadow).toBe(false)
  })

  it('일부만 있으면 나머지는 기본값으로 채운다', () => {
    const p = sanitizeNlsearchParams({ product: { boost: { name: 7 } } })
    expect(p.product.boost.name).toBe(7)
    expect(p.product.boost.brand).toBe(DEFAULT_NLSEARCH_PARAMS.product.boost.brand)
    expect(p.crazylog).toEqual(DEFAULT_NLSEARCH_PARAMS.crazylog)
  })
})

describe('validateNlsearchParams — 저장할 때는 범위 밖을 거절', () => {
  it('정상 값은 통과', () => {
    const r = validateNlsearchParams({ product: { boost: { name: 6 } } })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.params.product.boost.name).toBe(6)
  })

  it('범위 밖·숫자 아님·알 수 없는 키는 오류 목록과 함께 거절', () => {
    const r = validateNlsearchParams({
      product: { boost: { name: -1, foo: 3, brand: 'x' }, fuzzy: 2 },
      semantic: { weight: 1.5 },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors.length).toBeGreaterThanOrEqual(5)
      expect(r.errors.join('\n')).toContain('product.boost.name')
      expect(r.errors.join('\n')).toContain('product.boost.foo')
    }
  })

  it('객체가 아니면 거절', () => {
    expect(validateNlsearchParams('x').ok).toBe(false)
    expect(validateNlsearchParams(null).ok).toBe(false)
  })
})

describe('resolve*IndexConfig — 파라미터 반영', () => {
  it('boost·fuzzy·prefix가 설정에 반영되고 검색 칸·저장 칸은 그대로', () => {
    const p = sanitizeNlsearchParams({ product: { boost: { name: 9 }, fuzzy: 0.1, prefix: false } })
    const c = resolveProductIndexConfig(p)
    expect(c.boost.name).toBe(9)
    expect(c.defaultFuzzy).toBe(0.1)
    expect(c.defaultPrefix).toBe(false)
    expect(c.searchFields).toEqual(PRODUCT_INDEX_CONFIG.searchFields)
    expect(c.storeFields).toEqual(PRODUCT_INDEX_CONFIG.storeFields)
  })
})
