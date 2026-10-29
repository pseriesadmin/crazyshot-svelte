/* eslint-disable security/detect-non-literal-fs-filename -- 테스트가 소스 파일을 스캔하는 용도(고정된 프로젝트 경로, 사용자 입력 없음) */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * /api/cms/product-manuals — 상품설명서(PDF) 업로드 서명 발급(POST) · 등록 전 임시 파일 삭제(DELETE)
 * 큰 PDF는 서버 본문 한도(약 4.5MB) 때문에 서버를 거치지 않고 저장소로 직접 올린다 → 서버는 권한 확인 후 서명만 발급.
 */
vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'k' }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://t.supabase.co' }))
vi.mock('$lib/server/getCmsRoleForAction', () => ({ getCmsRoleForAction: async () => 'manager' }))

const guard = vi.fn()
vi.mock('$lib/server/requireMenuAccess', () => ({ requireAnyMenuAccessApi: (...a: unknown[]) => guard(...a) }))

const state = {
  product: { id: 'p', parent_product_id: null, manual_files: [] } as null | { id: string; parent_product_id: string | null; manual_files: unknown[] },
  signedPath: '',
  removed: [] as string[],
  used: [] as unknown[],
  usedError: false,
}
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: state.product, error: null }) }),
        contains: () => ({ limit: async () => (state.usedError ? { data: null, error: { message: 'x' } } : { data: state.used, error: null }) }),
      }),
    }),
    storage: {
      from: () => ({
        createSignedUploadUrl: async (path: string) => {
          state.signedPath = path
          return { data: { path, token: 'tok' }, error: null }
        },
        remove: async (paths: string[]) => {
          state.removed.push(...paths)
          return { data: [], error: null }
        },
      }),
    },
  }),
}))

import { POST, DELETE } from '../../routes/api/cms/product-manuals/+server'

const PID = '3f2b8c1e-4d5a-4e6f-8a7b-9c0d1e2f3a4b'
const U1 = 'aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb'
const locals = { safeGetSession: async () => ({ session: { user: { id: 'u' } } }) }
const noSession = { safeGetSession: async () => ({ session: null }) }

const call = (fn: typeof POST | typeof DELETE, body: unknown, l: unknown = locals) =>
  fn({ request: new Request('http://x', { method: 'POST', body: JSON.stringify(body) }), locals: l } as never) as Promise<Response>

beforeEach(() => {
  guard.mockReset()
  guard.mockResolvedValue(null)
  state.product = { id: PID, parent_product_id: null, manual_files: [] }
  state.signedPath = ''
  state.removed = []
  state.used = []
  state.usedError = false
})

describe('소스 스캔 — 메뉴 권한', () => {
  const src = readFileSync(join(process.cwd(), 'src/routes/api/cms/product-manuals/+server.ts'), 'utf-8')
  it('상품목록·상품등록 중 하나라도 허용일 때만(any-of) 통과', () => {
    expect(src).toContain("requireAnyMenuAccessApi(locals, ['products.list', 'products.new'])")
  })
})

describe('POST — 서명 발급', () => {
  it('세션이 없으면 401', async () => {
    const res = await call(POST, { content_type: 'application/pdf', size: 100, product_id: PID }, noSession)
    expect(res.status).toBe(401)
  })
  it('메뉴 권한 거부 응답은 그대로 반환', async () => {
    guard.mockResolvedValue(new Response('{}', { status: 403 }))
    const res = await call(POST, { content_type: 'application/pdf', size: 100, product_id: PID })
    expect(res.status).toBe(403)
  })
  it('PDF가 아니면 400, 10MB 초과도 400', async () => {
    expect((await call(POST, { content_type: 'image/png', size: 100, product_id: PID })).status).toBe(400)
    expect((await call(POST, { content_type: 'application/pdf', size: 11 * 1024 * 1024, product_id: PID })).status).toBe(400)
  })
  it('기존 상품: 상품 폴더 경로로 서명 발급', async () => {
    const res = await call(POST, { content_type: 'application/pdf', size: 1000, product_id: PID })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.token).toBe('tok')
    expect(body.path.startsWith(`${PID}/`)).toBe(true)
    expect(body.path.endsWith('.pdf')).toBe(true)
  })
  it('존재하지 않는 상품 404 · 재고(자식) 상품 400 · 이미 10개면 400', async () => {
    state.product = null
    expect((await call(POST, { content_type: 'application/pdf', size: 1000, product_id: PID })).status).toBe(404)
    state.product = { id: PID, parent_product_id: 'x', manual_files: [] }
    expect((await call(POST, { content_type: 'application/pdf', size: 1000, product_id: PID })).status).toBe(400)
    state.product = { id: PID, parent_product_id: null, manual_files: Array.from({ length: 10 }, () => ({})) }
    expect((await call(POST, { content_type: 'application/pdf', size: 1000, product_id: PID })).status).toBe(400)
  })
  it('product_id 형식이 uuid가 아니면 400', async () => {
    expect((await call(POST, { content_type: 'application/pdf', size: 1000, product_id: '../etc' })).status).toBe(400)
  })
  it('등록 전(상품 없음): temp_id 범위 경로로 발급, temp_id 형식 오류는 400', async () => {
    const ok = await call(POST, { content_type: 'application/pdf', size: 1000, temp_id: 'abc123_xyz' })
    expect(ok.status).toBe(200)
    expect((await ok.json()).path.startsWith('temp/abc123_xyz/')).toBe(true)
    expect((await call(POST, { content_type: 'application/pdf', size: 1000, temp_id: '../x' })).status).toBe(400)
    expect((await call(POST, { content_type: 'application/pdf', size: 1000 })).status).toBe(400)
  })
})

describe('DELETE — 등록 전 임시 파일만 삭제', () => {
  it('temp/ 경로는 저장소에서 삭제', async () => {
    const path = `temp/abc123_xyz/${U1}.pdf`
    const res = await call(DELETE, { path })
    expect(res.status).toBe(200)
    expect(state.removed).toEqual([path])
  })
  it('이미 상품에 연결된 temp 경로는 409로 거절(저장된 설명서 보호)하고 저장소를 건드리지 않는다', async () => {
    state.used = [{ id: 'p1' }]
    const res = await call(DELETE, { path: `temp/abc123_xyz/${U1}.pdf` })
    expect(res.status).toBe(409)
    expect(state.removed).toEqual([])
  })
  it('연결 여부를 확인하지 못하면 지우지 않는다(500)', async () => {
    state.usedError = true
    const res = await call(DELETE, { path: `temp/abc123_xyz/${U1}.pdf` })
    expect(res.status).toBe(500)
    expect(state.removed).toEqual([])
  })
  it('이미 저장된 상품 폴더 파일은 이 경로로 못 지운다(저장 시 정리)', async () => {
    const res = await call(DELETE, { path: `${PID}/${U1}.pdf` })
    expect(res.status).toBe(400)
    expect(state.removed).toEqual([])
  })
  it('형식이 이상한 경로·세션 없음 거절', async () => {
    expect((await call(DELETE, { path: 'temp/../x.pdf' })).status).toBe(400)
    expect((await call(DELETE, { path: `temp/abc123_xyz/${U1}.pdf` }, noSession)).status).toBe(401)
  })
})
