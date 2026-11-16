import { describe, it, expect, vi } from 'vitest'
import { loadCardKeywordMap, MAX_CARD_KEYWORD_PRODUCT_IDS } from '$lib/server/productCardKeywords'

function clientReturning(result: { data: unknown; error: unknown }) {
  const inFn = vi.fn().mockResolvedValue(result)
  const select = vi.fn().mockReturnValue({ in: inFn })
  const from = vi.fn().mockReturnValue({ select })
  return { client: { from }, from, select, inFn }
}

describe('loadCardKeywordMap — 고객 카드 노출 키워드 일괄 조회', () => {
  it('id 중복·빈값을 제거하고 1회만 조회, 문자열 키워드만 최대 3개로 돌려준다', async () => {
    const { client, from, inFn } = clientReturning({
      data: [
        { id: 'a', card_keywords: ['1', 2, '', '2', '3', '4'] },
        { id: 'b', card_keywords: [] },
        { id: 'c', card_keywords: null },
      ],
      error: null,
    })
    const map = await loadCardKeywordMap(client, ['a', 'a', 'b', 'c', '', null, undefined])
    expect(from).toHaveBeenCalledTimes(1)
    expect(inFn).toHaveBeenCalledWith('id', ['a', 'b', 'c'])
    expect(map).toEqual({ a: ['1', '2', '3'] })
  })

  it('조회 대상이 없으면 DB 를 부르지 않는다', async () => {
    const { client, from } = clientReturning({ data: [], error: null })
    expect(await loadCardKeywordMap(client, [null, ''])).toEqual({})
    expect(from).not.toHaveBeenCalled()
  })

  it(`id 는 최대 ${MAX_CARD_KEYWORD_PRODUCT_IDS}개까지만 조회한다`, async () => {
    const { client, inFn } = clientReturning({ data: [], error: null })
    await loadCardKeywordMap(client, Array.from({ length: MAX_CARD_KEYWORD_PRODUCT_IDS + 50 }, (_, i) => `id-${i}`))
    expect((inFn.mock.calls[0][1] as string[]).length).toBe(MAX_CARD_KEYWORD_PRODUCT_IDS)
  })

  it('오류 응답·비배열 응답·예외는 빈 객체(화면은 칩 없이 정상)', async () => {
    expect(await loadCardKeywordMap(clientReturning({ data: null, error: { message: 'x' } }).client, ['a'])).toEqual({})
    expect(await loadCardKeywordMap(clientReturning({ data: { not: 'array' }, error: null }).client, ['a'])).toEqual({})
    const throwing = { from: () => { throw new Error('boom') } }
    expect(await loadCardKeywordMap(throwing, ['a'])).toEqual({})
  })
})
