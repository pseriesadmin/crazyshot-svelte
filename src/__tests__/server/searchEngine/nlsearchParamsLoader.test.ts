/**
 * nlsearchParamsLoader.test.ts — A-3 로더 fail-open 계약
 * 설정 행이 없거나 읽기 실패·예외여도 코드 기본값을 돌려주고, DB 값은 sanitize해서 쓴다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const state: { result: { data: unknown; error: { message: string } | null } | 'throw' } = {
  result: { data: null, error: null },
}

vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'http://localhost' }))
vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'x' }))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (state.result === 'throw') throw new Error('boom')
            return state.result
          },
        }),
      }),
    }),
  }),
}))

import { loadNlsearchSettings } from '$lib/server/searchEngine/adapters/nlsearchParams'
import { DEFAULT_NLSEARCH_PARAMS } from '$lib/server/searchEngine/adapters/nlsearchParamsSchema'

describe('loadNlsearchSettings', () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}))

  it('행이 없으면 기본값', async () => {
    state.result = { data: null, error: null }
    const r = await loadNlsearchSettings()
    expect(r.params).toEqual(DEFAULT_NLSEARCH_PARAMS)
    expect(r.version).toBe(0)
  })

  it('조회 오류·예외여도 기본값(fromDb=false)', async () => {
    state.result = { data: null, error: { message: 'x' } }
    expect((await loadNlsearchSettings()).fromDb).toBe(false)
    state.result = 'throw'
    const r = await loadNlsearchSettings()
    expect(r.params).toEqual(DEFAULT_NLSEARCH_PARAMS)
    expect(r.fromDb).toBe(false)
  })

  it('DB 값은 범위 안으로 맞춰 사용하고 버전을 돌려준다', async () => {
    state.result = { data: { params: { product: { boost: { name: 99 } } }, version: 4 }, error: null }
    const r = await loadNlsearchSettings()
    expect(r.params.product.boost.name).toBe(20)
    expect(r.version).toBe(4)
  })
})
