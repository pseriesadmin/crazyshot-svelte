import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * GET /api/cms/customers/[id]/doc-url — CMS 서류 서명 URL 발급 (2026-10-03, 서류 비공개 전환 B1)
 * 완료기준: 권한(세션·manager 이상)·입력 검증을 통과해야만 서명하고, 대상 파일은 서버가 DB에서 결정하며, 열람이 감사로그에 남는다
 */
vi.mock('@sveltejs/kit', () => ({
  json: (data: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, data }),
}))
vi.mock('$env/dynamic/private', () => ({ env: { SUPABASE_SERVICE_ROLE_KEY: 'service-key' } }))
vi.mock('$lib/env/supabasePublic', () => ({ getSupabaseUrl: () => 'https://example.supabase.co' }))

const roleRef: { role: string | null } = { role: 'manager' }
vi.mock('$lib/server/getCmsRoleForAction', () => ({ getCmsRoleForAction: async () => roleRef.role }))

const menuDenied: { res: unknown } = { res: null }
vi.mock('$lib/server/requireMenuAccess', () => ({ requireMenuAccessApi: async () => menuDenied.res }))

const audit = vi.fn(async () => {})
vi.mock('$lib/server/cmsAdminAuditLog', () => ({ insertCmsAdminAuditLog: (...a: unknown[]) => audit(...(a as [])) }))

const profileRef: { row: Record<string, unknown> | null; error: { message: string } | null } = { row: null, error: null }
const createSignedUrl = vi.fn()
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profileRef.row, error: profileRef.error }) }) }) }),
    storage: { from: () => ({ createSignedUrl }) },
  }),
}))

const { GET } = await import('../../routes/api/cms/customers/[id]/doc-url/+server')

const UID = '6a8f8ee1-ce6e-462f-b7eb-2bd8e0000000'
const P1 = `${UID}/identity_a.png`
const P2 = `${UID}/identity_b.pdf`
type R = { status: number; data: { ok: boolean; url?: string; isPdf?: boolean; error?: string } }

function call(qs: string, opts: { session?: boolean; id?: string } = {}) {
  return GET({
    params: { id: opts.id ?? UID },
    url: new URL(`https://x.test/api/cms/customers/${opts.id ?? UID}/doc-url?${qs}`),
    locals: { safeGetSession: async () => ({ session: opts.session === false ? null : { user: { id: 'admin-uid' } } }) },
  } as unknown as Parameters<typeof GET>[0]) as unknown as Promise<R>
}

describe('GET /api/cms/customers/[id]/doc-url', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    roleRef.role = 'manager'
    menuDenied.res = null
    profileRef.error = null
    profileRef.row = {
      identity_doc_url: [`https://x.supabase.co/storage/v1/object/public/user-documents/${P1}`, P2],
      foreign_doc_url: `${UID}/foreign_legacy.jpg`,
      foreign_doc_urls: null,
    }
    createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://signed/ok' }, error: null })
  })

  it('세션 없음 401 / 역할 없음·partner 403 — 서명하지 않는다', async () => {
    expect((await call('type=identity&index=0', { session: false })).status).toBe(401)
    roleRef.role = null
    expect((await call('type=identity&index=0')).status).toBe(403)
    roleRef.role = 'partner'
    expect((await call('type=identity&index=0')).status).toBe(403)
    expect(createSignedUrl).not.toHaveBeenCalled()
  })

  it('고객목록 메뉴 권한이 OFF로 잠긴 manager는 거부되고 서명하지 않는다(메뉴 오버레이)', async () => {
    menuDenied.res = { status: 403, data: { error: '메뉴 접근 권한이 없습니다' } }
    const r = await call('type=identity&index=0')
    expect(r.status).toBe(403)
    expect(createSignedUrl).not.toHaveBeenCalled()
  })

  it('잘못된 입력은 400', async () => {
    expect((await call('type=identity&index=0', { id: 'not-a-uuid' })).status).toBe(400)
    expect((await call('type=other&index=0')).status).toBe(400)
    expect((await call('type=identity&index=-1')).status).toBe(400)
    expect((await call('type=identity&index=abc')).status).toBe(400)
    expect((await call('type=identity&index=99')).status).toBe(400)
    expect(createSignedUrl).not.toHaveBeenCalled()
  })

  it('공개 URL로 저장된 값(전환 전)도 경로로 해석해 60초 서명 + 감사로그', async () => {
    const r = await call('type=identity&index=0&download=M1_identity_1')
    expect(r.status).toBe(200)
    expect(r.data).toMatchObject({ ok: true, url: 'https://signed/ok', isPdf: false })
    expect(createSignedUrl).toHaveBeenCalledWith(P1, 60, { download: 'M1_identity_1.png' })
    expect(audit).toHaveBeenCalledTimes(1)
  })

  it('경로로 저장된 값(전환 후)·PDF 판정', async () => {
    const r = await call('type=identity&index=1')
    expect(r.data.isPdf).toBe(true)
    expect(createSignedUrl).toHaveBeenCalledWith(P2, 60, undefined)
  })

  it('외국인 레거시 스칼라(foreign_doc_urls 비어 있음)도 index 0으로 열람', async () => {
    const r = await call('type=foreign&index=0')
    expect(r.status).toBe(200)
    expect(createSignedUrl).toHaveBeenCalledWith(`${UID}/foreign_legacy.jpg`, 60, undefined)
  })

  it('없는 순번·타 사용자 폴더 경로·사용자 없음은 404, 서명하지 않는다', async () => {
    expect((await call('type=identity&index=5')).status).toBe(404)
    profileRef.row = { identity_doc_url: ['99999999-9999-4999-8999-999999999999/identity_x.png'], foreign_doc_url: null, foreign_doc_urls: null }
    expect((await call('type=identity&index=0')).status).toBe(404)
    profileRef.row = null
    expect((await call('type=identity&index=0')).status).toBe(404)
    expect(createSignedUrl).not.toHaveBeenCalled()
  })

  it('다운로드 파일명은 안전 문자만 남긴다(헤더 주입·경로 문자 제거)', async () => {
    await call(`type=identity&index=0&download=${encodeURIComponent('a/../b"\r\nX: y')}`)
    const opt = createSignedUrl.mock.calls[0][2] as { download: string }
    expect(opt.download).toMatch(/^[A-Za-z0-9._-]+\.png$/)
  })

  it('서명 실패 시 500', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    createSignedUrl.mockResolvedValue({ data: null, error: { message: 'boom' } })
    expect((await call('type=identity&index=0')).status).toBe(500)
    err.mockRestore()
  })
})
