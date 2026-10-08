import { describe, it, expect } from 'vitest'
import {
  buildReviewsTextMap,
  MAX_REVIEW_CHARS_PER_PRODUCT,
} from '$lib/server/searchEngine/adapters/productSearchIndex'

/**
 * L-1 (2026-10-08) — 후기 RPC 결과 → 상품별 후기 텍스트 맵 (순수 함수)
 * 대상: productSearchIndex.ts buildReviewsTextMap
 *
 * 케이스:
 *   1. 빈 배열 → 빈 맵
 *   2. 배열이 아닌 입력(null·undefined·객체·문자열) → 빈 맵 (예외 없음)
 *   3. 정상 행 → product_id별 텍스트·건수
 *   4. 필드가 null/타입 불일치/빈 문자열인 행은 건너뜀 (나머지 행은 정상 처리)
 *   5. review_count가 없거나 잘못되면 1건으로 간주
 *   6. 같은 product_id가 중복되면 텍스트를 이어붙이고 건수를 합산
 *   7. 상품당 텍스트는 MAX_REVIEW_CHARS_PER_PRODUCT(2000자)에서 절단
 */

describe('buildReviewsTextMap', () => {
  it('빈 배열이면 빈 맵', () => {
    expect(buildReviewsTextMap([]).size).toBe(0)
  })

  it('배열이 아닌 입력은 빈 맵 (예외 없음)', () => {
    for (const bad of [null, undefined, {}, 'text', 42]) {
      expect(buildReviewsTextMap(bad).size).toBe(0)
    }
  })

  it('정상 행은 product_id별 텍스트와 건수를 담는다', () => {
    const map = buildReviewsTextMap([
      { product_id: 'p1', review_count: 2, review_text: '배터리 오래가요 선명해요' },
      { product_id: 'p2', review_count: 1, review_text: '가볍고 좋아요' },
    ])
    expect(map.size).toBe(2)
    expect(map.get('p1')).toEqual({ text: '배터리 오래가요 선명해요', count: 2 })
    expect(map.get('p2')).toEqual({ text: '가볍고 좋아요', count: 1 })
  })

  it('잘못된 행은 건너뛰고 나머지는 처리한다', () => {
    const map = buildReviewsTextMap([
      null,
      'string-row',
      { product_id: null, review_text: '무시', review_count: 1 },
      { product_id: '', review_text: '무시', review_count: 1 },
      { product_id: 'p1', review_text: null, review_count: 1 },
      { product_id: 'p1', review_text: '   ', review_count: 1 },
      { product_id: 7, review_text: '숫자 id', review_count: 1 },
      { product_id: 'ok', review_text: '정상 후기', review_count: 3 },
    ])
    expect(map.size).toBe(1)
    expect(map.get('ok')).toEqual({ text: '정상 후기', count: 3 })
  })

  it('review_count가 없거나 잘못되면 1건으로 간주한다', () => {
    const map = buildReviewsTextMap([
      { product_id: 'a', review_text: '텍스트' },
      { product_id: 'b', review_text: '텍스트', review_count: -3 },
      { product_id: 'c', review_text: '텍스트', review_count: 'many' },
      { product_id: 'd', review_text: '텍스트', review_count: 2.9 },
    ])
    expect(map.get('a')?.count).toBe(1)
    expect(map.get('b')?.count).toBe(1)
    expect(map.get('c')?.count).toBe(1)
    expect(map.get('d')?.count).toBe(2)
  })

  it('같은 product_id가 중복되면 텍스트를 이어붙이고 건수를 합산한다', () => {
    const map = buildReviewsTextMap([
      { product_id: 'p1', review_count: 2, review_text: '첫째' },
      { product_id: 'p1', review_count: 3, review_text: '둘째' },
    ])
    expect(map.get('p1')).toEqual({ text: '첫째 둘째', count: 5 })
  })

  it('상품당 텍스트는 최대 길이에서 절단한다', () => {
    const long = '가'.repeat(MAX_REVIEW_CHARS_PER_PRODUCT + 500)
    const map = buildReviewsTextMap([{ product_id: 'p1', review_count: 1, review_text: long }])
    expect(map.get('p1')?.text.length).toBe(MAX_REVIEW_CHARS_PER_PRODUCT)
    // 중복 병합 후에도 상한 유지
    const merged = buildReviewsTextMap([
      { product_id: 'p1', review_count: 1, review_text: '가'.repeat(1500) },
      { product_id: 'p1', review_count: 1, review_text: '나'.repeat(1500) },
    ])
    expect(merged.get('p1')?.text.length).toBe(MAX_REVIEW_CHARS_PER_PRODUCT)
  })
})
