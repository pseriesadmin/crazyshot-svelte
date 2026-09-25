import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * /api/cms 파일 8종 — 세션 없음 401 / CMS 역할 없음 403 / 역할 있음 통과
 */

vi.mock('$env/dynamic/private', () => ({ env: { SUPABASE_SERVICE_ROLE_KEY: 'k' } }))
vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'k' }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://test.supabase.co' }))
vi.mock('$lib/env/supabasePublic', () => ({ getSupabaseUrl: () => 'https://test.supabase.co' }))

const adminFrom = vi.fn()
const adminUpload = vi.fn().mockResolvedValue({ error: null })
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (...a: unknown[]) => adminFrom(...a),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    storage: {
      from: () => ({
        upload: adminUpload,
        remove: vi.fn().mockResolvedValue({ error: null }),
        getPublicUrl: () => ({ data: { publicUrl: 'https://x/y' } }),
      }),
    },
  }),
}))
vi.mock('$lib/server/searchEngine/adapters/productSearchIndex', () => ({
  getProductSearchIndex: async () => ({ search: () => [] }),
}))

const profileRef: { cms_role: string | null } = { cms_role: null }
vi.mock('$lib/server/cmsProfile', () => ({
  fetchCmsProfileByAuthId: async () => ({ cms_role: profileRef.cms_role, name: 'n' }),
}))

function makeLocals(hasSession: boolean, role: string | null) {
  profileRef.cms_role = role
  const chain: Record<string, unknown> = {}
  const q = () => chain
  Object.assign(chain, {
    select: q, eq: q, single: async () => ({ data: { cms_role: role }, error: null }),
    maybeSingle: async () => ({ data: { cms_role: role }, error: null }),
    insert: q, update: q,
  })
  return {
    safeGetSession: async () => ({ session: hasSession ? { user: { id: 'u1' } } : null }),
    supabase: { from: () => chain, rpc: async () => ({ data: {}, error: null }) },
  }
}

async function statusOf(fn: () => Promise<Response>): Promise<number> {
  try {
    return (await fn()).status
  } catch (e) {
    const s = (e as { status?: number }).status
    if (typeof s === 'number') return s
    throw e
  }
}

function webp(): File { return new File(['x'], 'a.webp', { type: 'image/webp' }) }
function uploadForm(productId: string, type?: string): Request {
  const fd = new FormData()
  if (type) fd.append('type', type)
  fd.append('product_id', productId)
  fd.append('thumb', webp())
  fd.append('large', webp())
  return new Request('https://x/api/cms/upload', { method: 'POST', body: fd })
}
function fileForm(): Request {
  const fd = new FormData()
  fd.append('file', new File(['x'], 'a.png', { type: 'image/png' }))
  return new Request('https://x', { method: 'POST', body: fd })
}
const jsonReq = (m: string, b: unknown) =>
  new Request('https://x', { method: m, body: JSON.stringify(b), headers: { 'content-type': 'application/json' } })

type Case = { name: string; call: (locals: ReturnType<typeof makeLocals>) => Promise<number> }

const cases: Case[] = [
  {
    name: 'assets POST',
    call: async (l) => { const m = await import('../../routes/api/cms/assets/+server'); return statusOf(() => m.POST({ request: jsonReq('POST', { product_id: 'p' }), locals: l } as never) as Promise<Response>) },
  },
  {
    name: 'assets/[id] PATCH',
    call: async (l) => { const m = await import('../../routes/api/cms/assets/[id]/+server'); return statusOf(() => m.PATCH({ params: { id: '1' }, request: jsonReq('PATCH', { asset_code: 'a' }), locals: l } as never) as Promise<Response>) },
  },
  {
    name: 'upload POST(상품)',
    call: async (l) => { const m = await import('../../routes/api/cms/upload/+server'); return statusOf(() => m.POST({ request: uploadForm('11111111-1111-1111-1111-111111111111'), locals: l } as never) as Promise<Response>) },
  },
  {
    name: 'upload DELETE(상품 경로)',
    call: async (l) => { const m = await import('../../routes/api/cms/upload/+server'); return statusOf(() => m.DELETE({ request: jsonReq('DELETE', { largeUrl: 'https://test.supabase.co/storage/v1/object/public/product-images/11111111-1111-1111-1111-111111111111/large_a.webp' }), locals: l } as never) as Promise<Response>) },
  },
  {
    name: 'members/hero-banner POST',
    call: async (l) => { const m = await import('../../routes/api/cms/members/hero-banner/+server'); return statusOf(() => m.POST({ request: fileForm(), locals: l } as never) as Promise<Response>) },
  },
  {
    name: 'help/hero-bg POST',
    call: async (l) => { const m = await import('../../routes/api/cms/help/hero-bg/+server'); return statusOf(() => m.POST({ request: fileForm(), locals: l } as never) as Promise<Response>) },
  },
  {
    name: 'home/hero-banner POST',
    call: async (l) => { const m = await import('../../routes/api/cms/home/hero-banner/+server'); return statusOf(() => m.POST({ request: fileForm(), locals: l } as never) as Promise<Response>) },
  },
  {
    name: 'mobile-search-rank GET',
    call: async (l) => { const m = await import('../../routes/api/cms/mobile-search-rank/+server'); return statusOf(() => m.GET({ url: new URL('https://x/?q=a'), locals: l } as never) as Promise<Response>) },
  },
  {
    name: 'segment/refresh POST',
    call: async (l) => { const m = await import('../../routes/api/cms/segment/refresh/+server'); return statusOf(() => m.POST({ locals: l } as never) as Promise<Response>) },
  },
]

beforeEach(() => { adminFrom.mockReset(); profileRef.cms_role = null })

describe.each(cases)('$name', ({ call }) => {
  it('(i) 세션 없음 → 401', async () => {
    expect(await call(makeLocals(false, null))).toBe(401)
  })
  it('(j) CMS 역할 없음 → 403', async () => {
    expect(await call(makeLocals(true, null))).toBe(403)
  })
})

describe('upload — 고객 크레이지로그 첨부 경로 보존', () => {
  it('비CMS 사용자가 log/ 경로로 업로드 → 403 아님', async () => {
    const m = await import('../../routes/api/cms/upload/+server')
    const s = await statusOf(() => m.POST({ request: uploadForm('log/abc'), locals: makeLocals(true, null) } as never) as Promise<Response>)
    expect(s).toBe(200)
  })
  it('비CMS 사용자가 label 업로드 → 403', async () => {
    const m = await import('../../routes/api/cms/upload/+server')
    const fd = new FormData()
    fd.append('type', 'label'); fd.append('asset_id', '1'); fd.append('image', webp())
    const s = await statusOf(() => m.POST({ request: new Request('https://x', { method: 'POST', body: fd }), locals: makeLocals(true, null) } as never) as Promise<Response>)
    expect(s).toBe(403)
  })
  it('(k) CMS 역할 있으면 상품 업로드 통과', async () => {
    const m = await import('../../routes/api/cms/upload/+server')
    adminFrom.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) })
    const s = await statusOf(() => m.POST({ request: uploadForm('11111111-1111-1111-1111-111111111111'), locals: makeLocals(true, 'partner') } as never) as Promise<Response>)
    expect(s).toBe(200)
  })
})

describe('upload POST — log/ 경로 우회 시도 차단(비CMS 사용자)', () => {
  const bypass = ['log/../11111111-1111-1111-1111-111111111111', 'log/%2e%2e/11111111-1111-1111-1111-111111111111', 'log/a?x=1', 'log/a#b', 'log\\..\\x']
  it.each(bypass)('product_id=%s → 403', async (pid) => {
    const m = await import('../../routes/api/cms/upload/+server')
    const s = await statusOf(() => m.POST({ request: uploadForm(pid), locals: makeLocals(true, null) } as never) as Promise<Response>)
    expect(s).toBe(403)
  })
})

describe('upload DELETE — log/ 경로 우회 시도 차단(비CMS 사용자)', () => {
  const P = 'https://test.supabase.co/storage/v1/object/public/product-images/'
  const PID = '11111111-1111-1111-1111-111111111111'
  const bypass: Array<[string, string]> = [
    ['log/../상품ID 경로 탈출', `${P}log/../${PID}/large_a.webp`],
    ['URL 인코딩된 탈출', `${P}log/%2e%2e/${PID}/large_a.webp`],
    ['쿼리에 /product-images/log/ 삽입', `${P}${PID}/large_a.webp?x=/product-images/log/`],
    ['프래그먼트에 /product-images/log/ 삽입', `${P}${PID}/large_a.webp#/product-images/log/`],
    ['역슬래시 경로', `${P}log\\..\\${PID}/large_a.webp`],
  ]
  it.each(bypass)('%s → 403', async (_n, url) => {
    const m = await import('../../routes/api/cms/upload/+server')
    const s = await statusOf(() => m.DELETE({ request: jsonReq('DELETE', { largeUrl: url }), locals: makeLocals(true, null) } as never) as Promise<Response>)
    expect(s).toBe(403)
  })
  it('정상 log/ 경로는 비CMS 사용자도 403이 아님(고객 크레이지로그 첨부 삭제 보존)', async () => {
    const m = await import('../../routes/api/cms/upload/+server')
    const s = await statusOf(() => m.DELETE({ request: jsonReq('DELETE', { largeUrl: `${P}log/abc/large_a.webp` }), locals: makeLocals(true, null) } as never) as Promise<Response>)
    expect(s).not.toBe(403)
  })
})

describe('(k) 역할 있음 → 기존 동작 유지', () => {
  it('mobile-search-rank: partner → 200', async () => {
    const m = await import('../../routes/api/cms/mobile-search-rank/+server')
    const r = await m.GET({ url: new URL('https://x/?q=a'), locals: makeLocals(true, 'partner') } as never) as Response
    expect(r.status).toBe(200)
  })
  it('segment/refresh: manager → success', async () => {
    const m = await import('../../routes/api/cms/segment/refresh/+server')
    const r = await m.POST({ locals: makeLocals(true, 'manager') } as never) as Response
    expect((await r.json()).success).toBe(true)
  })
})
