/* eslint-disable security/detect-non-literal-fs-filename -- 테스트가 소스 파일을 스캔하는 용도(고정된 프로젝트 경로, 사용자 입력 없음) */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 2-C(Stephen 권장안 2026-10-06): /api/cms/upload — 고객 크레이지로그 첨부(log/ 경로)는 무게이트(고객 기능),
 * 그 외 경로(상품 이미지·자산 라벨·콘텐츠 에디터 등)는 업로드를 쓰는 화면들의 메뉴 중 하나라도 허용일 때만.
 */
vi.mock('$env/dynamic/private', () => ({ env: { SUPABASE_SERVICE_ROLE_KEY: 'k' } }))
vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'k' }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://t.supabase.co' }))
vi.mock('$lib/env/supabasePublic', () => ({ getSupabaseUrl: () => 'https://t.supabase.co' }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => { throw new Error('storage reached') } }))
vi.mock('$lib/server/getCmsRoleForAction', () => ({ getCmsRoleForAction: async () => 'manager' }))

const anyGuard = vi.fn()
vi.mock('$lib/server/requireMenuAccess', () => ({ requireAnyMenuAccessApi: (...a: unknown[]) => anyGuard(...a) }))

import { UPLOAD_MENU_KEYS } from '$lib/server/uploadMenuKeys'
import { DELETE } from '../../routes/api/cms/upload/+server'

const src = readFileSync(join(process.cwd(), 'src/routes/api/cms/upload/+server.ts'), 'utf-8')
const BASE = 'https://t.supabase.co/storage/v1/object/public/product-images/'
const del = (path: string) =>
  DELETE({ request: new Request('http://x', { method: 'DELETE', body: JSON.stringify({ largeUrl: BASE + path }) }), locals: { safeGetSession: async () => ({ session: { user: { id: 'u' } } }) } } as never)

describe('업로드 허용 메뉴 키', () => {
  it('업로드를 쓰는 CMS 화면 메뉴를 모두 포함(누락 시 해당 화면 업로드가 막힘)', () => {
    for (const k of ['products.list', 'products.new', 'rental.reservation', 'rental.history', 'rental.contracts', 'consulting.qna', 'subscription.list', 'subscription.new']) {
      expect(UPLOAD_MENU_KEYS).toContain(k)
    }
  })
})

describe('소스 스캔', () => {
  it('POST·DELETE 모두 log/ 예외가 아닐 때만 any-of 게이트', () => {
    expect(src).toContain("import { requireAnyMenuAccessApi } from '$lib/server/requireMenuAccess'")
    const gate = 'const denied = await requireAnyMenuAccessApi(locals, UPLOAD_MENU_KEYS)'
    for (const cond of ['isCustomerLogUpload', 'isCustomerLogPath']) {
      const at = src.indexOf(`if (!${cond}) {`)
      expect(at, cond).toBeGreaterThan(-1)
      expect(src.slice(at, at + 400)).toContain(gate)
    }
  })
})

describe('DELETE 동작', () => {
  beforeEach(() => anyGuard.mockReset())
  it('상품 이미지 경로: 게이트 거부 시 그 응답을 그대로 반환', async () => {
    anyGuard.mockResolvedValue(new Response(JSON.stringify({ error: 'denied' }), { status: 403 }))
    const res = (await del('abc/large_1.webp')) as Response
    expect(res.status).toBe(403)
    expect(anyGuard).toHaveBeenCalledWith(expect.anything(), UPLOAD_MENU_KEYS)
  })
  it('고객 크레이지로그 경로(log/): 게이트를 거치지 않는다', async () => {
    await expect(del('log/u1/large_1.webp')).rejects.toThrow() // 게이트 통과 후 storage 단계(mock이 throw)까지 도달
    expect(anyGuard).not.toHaveBeenCalled()
  })
  it('경로 탈출(log/../)은 log 예외가 아니므로 게이트 적용', async () => {
    anyGuard.mockResolvedValue(new Response('{}', { status: 403 }))
    const res = (await del('log/../abc/large_1.webp')) as Response
    expect(res.status).toBe(403)
    expect(anyGuard).toHaveBeenCalled()
  })
})
