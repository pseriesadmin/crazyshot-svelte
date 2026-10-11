/**
 * embeddingUtils.test.ts — D-1 외부 임베딩 비교 도구의 순수 보조 함수
 */
import { describe, it, expect } from 'vitest'
import {
  averageSims, buildEmbeddingRequest, dot, fakeEmbed, normalizeSims, parseEmbeddingResponse,
} from '../../../../scripts/nlsearch/embedding-utils'

describe('buildEmbeddingRequest', () => {
  it('공백을 정리하고 길이를 제한하며 빈 입력은 거절', () => {
    const r = buildEmbeddingRequest('m', ['  a   b  ', 'x'.repeat(10)], 5)
    expect(r.input).toEqual(['a b', 'xxxxx'])
    expect(() => buildEmbeddingRequest('m', ['a', '   '])).toThrow()
  })
})

describe('parseEmbeddingResponse', () => {
  it('index 순서로 복원하고 L2 정규화한다', () => {
    const out = parseEmbeddingResponse({ data: [{ index: 1, embedding: [0, 2] }, { index: 0, embedding: [3, 4] }] }, 2)
    expect(Array.from(out[0])).toEqual([0.6000000238418579, 0.800000011920929])
    expect(Array.from(out[1])).toEqual([0, 1])
  })
  it('개수·형식·차원 오류는 예외', () => {
    expect(() => parseEmbeddingResponse({ data: [] }, 1)).toThrow()
    expect(() => parseEmbeddingResponse({ data: [{ index: 5, embedding: [1] }] }, 1)).toThrow()
    expect(() => parseEmbeddingResponse({ data: [{ index: 0, embedding: [1, 2] }, { index: 1, embedding: [1] }] }, 2)).toThrow()
    expect(() => parseEmbeddingResponse(null, 1)).toThrow()
  })
})

describe('normalizeSims', () => {
  it('평균+표준편차 이상만 남기고 최댓값은 1, 통과분은 0.3 이상', () => {
    const m = new Map<string, number>([['a', 0.9], ['b', 0.3], ['c', 0.31], ['d', 0.29], ['e', 0.3], ['f', 0.32]])
    const n = normalizeSims(m)
    expect([...n.keys()]).toEqual(['a'])
    expect(n.get('a')).toBe(1)
  })
  it('점수가 평평하거나 문서가 적으면 아무것도 통과시키지 않는다(잡음 방지)', () => {
    expect(normalizeSims(new Map([['a', 0.5], ['b', 0.5], ['c', 0.5]])).size).toBe(0)
    expect(normalizeSims(new Map([['a', 0.9], ['b', 0.1]])).size).toBe(0)
  })
})

describe('averageSims / fakeEmbed', () => {
  it('없는 쪽은 0으로 평균', () => {
    const r = averageSims(new Map([['a', 1]]), new Map([['a', 0.5], ['b', 1]]))
    expect(r.get('a')).toBe(0.75)
    expect(r.get('b')).toBe(0.5)
  })
  it('fakeEmbed는 결정적이고 정규화돼 있다', () => {
    expect(Array.from(fakeEmbed('카메라 렌즈'))).toEqual(Array.from(fakeEmbed('카메라 렌즈')))
    expect(dot(fakeEmbed('카메라 렌즈'), fakeEmbed('카메라 렌즈'))).toBeCloseTo(1, 5)
  })
})
