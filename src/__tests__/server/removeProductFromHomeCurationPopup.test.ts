import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { removeProductFromHomeCuration } from '$lib/server/removeProductFromHomeCuration'

/** 상품 삭제 시 MD 추천 설정을 다시 쓸 때, 팝업 노출조건(popup)이 사라지지 않는지 확인 (2026-11-25) */

function makeClient(mdValue: unknown) {
  const rpc = vi.fn(async () => ({ error: null }))
  const chain = (data: unknown) => {
    const c: Record<string, unknown> = {}
    c.select = () => c
    c.eq = () => c
    c.is = () => Promise.resolve({ data: [] })
    c.maybeSingle = () => Promise.resolve({ data })
    return c
  }
  const from = vi.fn((table: string) => (table === 'cms_settings' ? chain({ value: mdValue }) : chain(null)))
  return { client: { from, rpc } as unknown as SupabaseClient, rpc }
}

describe('removeProductFromHomeCuration — MD 추천 popup 보존', () => {
  it('삭제 상품만 빠지고 popup·mode 는 그대로 다시 저장된다', async () => {
    const { client, rpc } = makeClient({
      products: [{ id: 'a', order: 0 }, { id: 'b', order: 1 }],
      mode: 'random_once',
      popup: { on_wish: false, on_reserve: true },
    })
    await removeProductFromHomeCuration(client, 'a')
    const call = rpc.mock.calls.find((c) => (c as unknown[])[0] === 'upsert_product_page_setting') as unknown[] | undefined
    expect(call).toBeTruthy()
    expect((call![1] as { p_value: unknown }).p_value).toEqual({
      products: [{ id: 'b', order: 1 }],
      mode: 'random_once',
      popup: { on_wish: false, on_reserve: true },
    })
  })
})
