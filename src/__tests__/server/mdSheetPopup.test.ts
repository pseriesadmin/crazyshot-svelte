import { describe, it, expect, vi } from 'vitest'
import { GET } from '../../routes/products/_md/+server'

/**
 * GET /products/_md — 'MD 추천' 팝업 노출조건(popup) 응답 (2026-11-25)
 *  - ?only=popup : 상품 조회 없이 조건만 반환
 *  - 상품이 비어 있는 조기 반환에도 popup 포함
 *  - 저장값이 없으면 기본(찜 ON·예약 OFF)
 */

function makeEvent(mdValue: unknown, query = '') {
  const rpc = vi.fn(async (name: string) => {
    if (name === 'get_product_page_settings') return { data: mdValue === undefined ? {} : { product_page_md_picks: mdValue }, error: null }
    return { data: [], error: null }
  })
  return {
    rpc,
    event: {
      locals: { supabase: { rpc }, safeGetSession: async () => ({ session: null }) },
      url: new URL(`https://example.test/products/_md${query}`),
      cookies: { get: () => undefined, set: () => {} },
    } as unknown as Parameters<typeof GET>[0],
  }
}

describe('GET /products/_md — 팝업 노출조건', () => {
  it('?only=popup 은 조건만 반환하고 상품 조회를 하지 않는다', async () => {
    const { event, rpc } = makeEvent({ products: [{ id: 'a', order: 0 }], mode: 'fixed', popup: { on_wish: false, on_reserve: true } }, '?only=popup')
    const body = await (await GET(event)).json()
    expect(body).toEqual({ popup: { on_wish: false, on_reserve: true } })
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(['get_product_page_settings'])
  })

  it('저장된 값이 없으면 기본(찜 ON·예약 OFF)', async () => {
    const { event } = makeEvent(undefined, '?only=popup')
    expect((await (await GET(event)).json()).popup).toEqual({ on_wish: true, on_reserve: false })
  })

  it('상품이 비어 있는 응답에도 popup 이 들어 있다', async () => {
    const { event } = makeEvent({ products: [], mode: 'fixed', popup: { on_wish: true, on_reserve: true } })
    const body = await (await GET(event)).json()
    expect(body.products).toEqual([])
    expect(body.popup).toEqual({ on_wish: true, on_reserve: true })
  })
})
