import { beforeEach, describe, expect, it, vi } from 'vitest'

// GET /sitemap.xml (2026-10-28) — 고정 공개 페이지 + 노출 중인 부모 상품. DB 조회가 실패해도 고정 페이지는 내려준다(fail-soft).

type Row = { id: string; slug: string | null; updated_at: string | null }
const result: { data: Row[] | null; error: { message: string } | null } = { data: [], error: null }
const calls: string[] = []

function chain() {
  const q = {
    select: (c: string) => { calls.push(`select:${c}`); return q },
    is: (c: string, v: unknown) => { calls.push(`is:${c}=${String(v)}`); return q },
    eq: (c: string, v: unknown) => { calls.push(`eq:${c}=${String(v)}`); return q },
    order: () => q,
    limit: () => Promise.resolve(result),
  }
  return q
}

vi.mock('$lib/services/supabase', () => ({
  supabase: { from: (t: string) => { calls.push(`from:${t}`); return chain() } },
}))

import { GET } from '../../routes/sitemap.xml/+server'

async function call(): Promise<Response> {
  return (await GET({} as unknown as Parameters<typeof GET>[0])) as Response
}

beforeEach(() => {
  calls.length = 0
  result.data = []
  result.error = null
})

describe('/sitemap.xml', () => {
  it('XML로 응답하고 한 시간 캐시를 건다', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/xml')
    expect(res.headers.get('cache-control')).toContain('s-maxage=3600')
  })

  it('고정 공개 페이지가 들어간다', async () => {
    const xml = await (await call()).text()
    expect(xml).toContain('<loc>https://crazyshot.kr/</loc>')
    expect(xml).toContain('<loc>https://crazyshot.kr/products</loc>')
  })

  it('노출 중인 부모 상품만 조회한다(부모·활성·옵션전용 아님·삭제 안 됨)', async () => {
    await call()
    expect(calls).toContain('from:products')
    expect(calls).toContain('is:parent_product_id=null')
    expect(calls).toContain('eq:is_active=true')
    expect(calls).toContain('eq:option_only=false')
    expect(calls).toContain('is:deleted_at=null')
  })

  it('상품은 slug 주소로, slug가 없으면 id로, 수정일을 lastmod로', async () => {
    result.data = [
      { id: 'a1', slug: 'sony-np-f770-2609', updated_at: '2026-10-20T01:00:00Z' },
      { id: 'b2', slug: null, updated_at: null },
    ]
    const xml = await (await call()).text()
    expect(xml).toContain('<loc>https://crazyshot.kr/products/sony-np-f770-2609</loc>')
    expect(xml).toContain('<lastmod>2026-10-20</lastmod>')
    expect(xml).toContain('<loc>https://crazyshot.kr/products/b2</loc>')
  })

  it('DB 오류가 나도 200으로 고정 페이지만 내려준다', async () => {
    result.data = null
    result.error = { message: 'boom' }
    const res = await call()
    expect(res.status).toBe(200)
    const xml = await res.text()
    expect(xml).toContain('<loc>https://crazyshot.kr/</loc>')
    expect(xml).not.toContain('/products/')
  })
})
