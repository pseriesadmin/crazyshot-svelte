import { describe, it, expect, vi } from 'vitest'

/**
 * getImageUrlsForProducts — products.image_urls 배치 조회 헬퍼 단위 테스트
 *
 * 배경: 검색에서 결과가 3건 이하이면 붙는 보충 결과(MiniSearch 자연어 폴백)에는 image_urls 가 없어
 * 등록된 상품인데도 기본 이미지가 보였다(2026-11-01, bam·Rode·Sam·San). 이 헬퍼가 그 이미지를 채운다.
 */
const { getImageUrlsForProducts } = await import('$lib/server/getImageUrlsForProducts')

function makeSupabase(result: { data: unknown; error: { message: string } | null }) {
  const inFn = vi.fn().mockResolvedValue(result)
  const select = vi.fn(() => ({ in: inFn }))
  const from = vi.fn(() => ({ select }))
  return { client: { from } as never, from, select, inFn }
}

describe('getImageUrlsForProducts', () => {
  it('빈 목록이면 조회 없이 빈 객체', async () => {
    const m = makeSupabase({ data: [], error: null })
    expect(await getImageUrlsForProducts(m.client, [])).toEqual({})
    expect(await getImageUrlsForProducts(m.client, ['', ''])).toEqual({})
    expect(m.from).not.toHaveBeenCalled()
  })

  it('products 의 id·image_urls 만 조회하고 중복 id 는 한 번만 보낸다', async () => {
    const m = makeSupabase({ data: [], error: null })
    await getImageUrlsForProducts(m.client, ['a', 'b', 'a'])
    expect(m.from).toHaveBeenCalledWith('products')
    expect(m.select).toHaveBeenCalledWith('id, image_urls')
    expect(m.inFn).toHaveBeenCalledWith('id', ['a', 'b'])
  })

  it('image_urls 배열을 id 기준 맵으로 만든다', async () => {
    const m = makeSupabase({
      data: [
        { id: 'a', image_urls: ['https://x/1.jpg', 'https://x/2.jpg'] },
        { id: 'b', image_urls: ['https://x/3.jpg'] },
      ],
      error: null,
    })
    expect(await getImageUrlsForProducts(m.client, ['a', 'b'])).toEqual({
      a: ['https://x/1.jpg', 'https://x/2.jpg'],
      b: ['https://x/3.jpg'],
    })
  })

  it('이미지가 없거나(빈 배열·null·문자열이 아닌 값) 형식이 틀린 상품은 맵에 키가 없다', async () => {
    const m = makeSupabase({
      data: [
        { id: 'a', image_urls: [] },
        { id: 'b', image_urls: null },
        { id: 'c', image_urls: ['', '  ', 5, 'https://x/ok.jpg'] },
        { id: 'd', image_urls: 'not-an-array' },
      ],
      error: null,
    })
    expect(await getImageUrlsForProducts(m.client, ['a', 'b', 'c', 'd'])).toEqual({ c: ['https://x/ok.jpg'] })
  })

  it('조회 오류는 빈 객체로 흘려보내 검색을 막지 않는다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const m = makeSupabase({ data: null, error: { message: 'boom' } })
    expect(await getImageUrlsForProducts(m.client, ['a'])).toEqual({})
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
