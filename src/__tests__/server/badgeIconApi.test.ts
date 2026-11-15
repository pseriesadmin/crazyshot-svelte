import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * /api/cms/badges/icon — 배지 SVG 업로드·삭제 API
 *  - 세션 없음 401 / CMS 역할 없음 403 / partner 403(매니저 이상만) / manager 통과
 *  - 업로드는 정화된 SVG 만 저장(스크립트·이벤트·외부 이미지 제거), 부적격 SVG 는 저장하지 않고 400
 *  - 삭제는 우리 업로드 경로 형식만 허용
 */
vi.mock('$env/dynamic/private', () => ({ env: { SUPABASE_SERVICE_ROLE_KEY: 'k' } }))
vi.mock('$lib/env/supabasePublic', () => ({ getSupabaseUrl: () => 'https://test.supabase.co' }))
vi.mock('$lib/server/requireMenuAccess', () => ({ requireMenuAccessApi: async () => null }))

const upload = vi.fn()
const remove = vi.fn()
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    storage: {
      from: () => ({
        upload: (...a: unknown[]) => upload(...a),
        remove: (...a: unknown[]) => remove(...a),
        getPublicUrl: (p: string) => ({ data: { publicUrl: `https://test.supabase.co/storage/v1/object/public/badge-icons/${p}` } }),
      }),
    },
  }),
}))

const profileRef: { cms_role: string | null } = { cms_role: null }
vi.mock('$lib/server/cmsProfile', () => ({
  fetchCmsProfileByAuthId: async () => ({ cms_role: profileRef.cms_role, name: 'n' }),
}))

function locals(hasSession: boolean, role: string | null) {
  profileRef.cms_role = role
  return { safeGetSession: async () => ({ session: hasSession ? { user: { id: 'u1' } } : null }), supabase: {} }
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

const GOOD = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="#f00"/></svg>'
const EVIL = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" onload="alert(1)"><script>alert(1)</script><rect width="24" height="24" onclick="x()"/><image href="https://evil.example/p.png"/></svg>'

function form(svg: string): Request {
  const fd = new FormData()
  fd.append('file', new File([svg], 'a.svg', { type: 'image/svg+xml' }))
  return new Request('https://x/api/cms/badges/icon', { method: 'POST', body: fd })
}
const del = (path: unknown) =>
  new Request('https://x', { method: 'DELETE', body: JSON.stringify({ path }), headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  upload.mockReset().mockResolvedValue({ error: null })
  remove.mockReset().mockResolvedValue({ error: null })
})

describe('배지 SVG 업로드 API — 권한', () => {
  it('세션 없음 401, 직원 아님 403, partner 403(매니저 이상만)', async () => {
    const m = await import('../../routes/api/cms/badges/icon/+server')
    expect(await statusOf(() => m.POST({ request: form(GOOD), locals: locals(false, null) } as never) as Promise<Response>)).toBe(401)
    expect(await statusOf(() => m.POST({ request: form(GOOD), locals: locals(true, null) } as never) as Promise<Response>)).toBe(401)
    expect(await statusOf(() => m.POST({ request: form(GOOD), locals: locals(true, 'partner') } as never) as Promise<Response>)).toBe(403)
    expect(await statusOf(() => m.DELETE({ request: del('badges/123e4567-e89b-12d3-a456-426614174000.svg'), locals: locals(true, 'partner') } as never) as Promise<Response>)).toBe(403)
    expect(upload).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
  })

  it('manager 는 업로드·삭제할 수 있다', async () => {
    const m = await import('../../routes/api/cms/badges/icon/+server')
    expect(await statusOf(() => m.POST({ request: form(GOOD), locals: locals(true, 'manager') } as never) as Promise<Response>)).toBe(200)
    expect(await statusOf(() => m.DELETE({ request: del('badges/123e4567-e89b-12d3-a456-426614174000.svg'), locals: locals(true, 'manager') } as never) as Promise<Response>)).toBe(200)
  })
})

describe('배지 SVG 업로드 API — 저장 내용', () => {
  it('악성 요소는 정화된 뒤에만 저장된다', async () => {
    const m = await import('../../routes/api/cms/badges/icon/+server')
    const res = (await m.POST({ request: form(EVIL), locals: locals(true, 'manager') } as never)) as Response
    expect(res.status).toBe(200)
    const [path, blob] = upload.mock.calls[0] as [string, Blob]
    expect(path).toMatch(/^badges\/[0-9a-f-]{36}\.svg$/)
    const stored = await blob.text()
    expect(stored).toContain('viewBox="0 0 24 24"')
    expect(stored.toLowerCase()).not.toMatch(/script|onload|onclick|evil\.example|<image/)
    const body = (await res.json()) as { url: string }
    expect(body.url).toContain('/badge-icons/badges/')
  })

  it('viewBox 없음·SVG 아님·200KB 초과는 저장하지 않고 400', async () => {
    const m = await import('../../routes/api/cms/badges/icon/+server')
    const L = locals(true, 'manager')
    expect(await statusOf(() => m.POST({ request: form('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'), locals: L } as never) as Promise<Response>)).toBe(400)
    expect(await statusOf(() => m.POST({ request: form('<html></html>'), locals: L } as never) as Promise<Response>)).toBe(400)
    expect(await statusOf(() => m.POST({ request: form(GOOD.replace('</svg>', `<!--${'a'.repeat(250 * 1024)}--></svg>`)), locals: L } as never) as Promise<Response>)).toBe(400)
    expect(upload).not.toHaveBeenCalled()
  })

  it('정사각이 아닌 비율의 SVG 도 저장한다', async () => {
    const m = await import('../../routes/api/cms/badges/icon/+server')
    expect(await statusOf(() => m.POST({ request: form('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 24"><rect width="60" height="24"/></svg>'), locals: locals(true, 'manager') } as never) as Promise<Response>)).toBe(200)
    expect(upload).toHaveBeenCalledTimes(1)
  })

  it('삭제는 업로드 경로 형식만 허용한다(경로 조작 거절)', async () => {
    const m = await import('../../routes/api/cms/badges/icon/+server')
    const L = locals(true, 'manager')
    for (const bad of ['../x.svg', 'badges/../a.svg', 'product-images/a.webp', 'badges/abc.svg', '', null]) {
      expect(await statusOf(() => m.DELETE({ request: del(bad), locals: L } as never) as Promise<Response>), String(bad)).toBe(400)
    }
    expect(remove).not.toHaveBeenCalled()
  })
})
