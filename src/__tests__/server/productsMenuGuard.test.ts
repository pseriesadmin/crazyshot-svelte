/* eslint-disable security/detect-non-literal-fs-filename, security/detect-non-literal-regexp -- 테스트가 소스 파일을 스캔하는 용도(고정된 프로젝트 경로·상수 패턴, 사용자 입력 없음) */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 1단계 1d — 상품 메뉴 서버 집행 (2026-10-05)
 *  A. /cms/products 서버 액션 8개              → products.list
 *  B. /cms/products/new 서버 액션 create        → products.new
 *  C. /cms/products/[id]/detail GET (선택 전환 전용 조회) → products.list
 *  D. api/cms/products/{category-options,[id]/option-links} GET (예약 패널 상품찾기 모달 전용) → rental.reservation (Stephen 확정 2026-10-05)
 *  ※ 1d 범위 밖: search-suggestions·api/cms/upload(여러 화면·고객 경로 겸용), product-history(1c any-of 유지 — Stephen 확정)
 */

vi.mock('$env/dynamic/private', () => ({ env: { SUPABASE_SERVICE_ROLE_KEY: 'k' } }))
vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'k' }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://t.supabase.co', PUBLIC_SUPABASE_ANON_KEY: 'anon' }))
vi.mock('$lib/env/supabasePublic', () => ({ getSupabaseUrl: () => 'https://t.supabase.co' }))

const createClientSpy = vi.fn()
vi.mock('@supabase/supabase-js', () => ({ createClient: (...a: unknown[]) => createClientSpy(...a) }))

const apiGuard = vi.fn()
const actionGuard = vi.fn()
vi.mock('$lib/server/requireMenuAccess', () => ({
  requireMenuAccessApi: (...a: unknown[]) => apiGuard(...a),
  requireMenuAccessAction: (...a: unknown[]) => actionGuard(...a),
}))

const LIST_PAGE = 'src/routes/cms/products/+page.server'
const NEW_PAGE = 'src/routes/cms/products/new/+page.server'
const DETAIL = 'src/routes/cms/products/[id]/detail/+server'
const LIST_ACTIONS = [
  'retryProductCode', 'retryCodeSeries', 'reassignCodeSeries', 'toggleStatus', 'updateSection',
  'deleteProduct', 'deleteSelectedInventory', 'cloneProduct',
]
// 위 8개 외에 새 액션이 추가되면 아래 전수 검사(소스의 actions 키 전체)가 게이트 누락을 잡는다.

const FINDER_APIS = [
  'src/routes/api/cms/products/category-options/+server',
  'src/routes/api/cms/products/[id]/option-links/+server',
]

const ROOT = process.cwd()
const read = (file: string) => readFileSync(join(ROOT, `${file}.ts`), 'utf-8')

function firstStatementAfter(src: string, re: RegExp): { found: boolean; first: string | undefined } {
  const m = src.match(re)
  if (!m) return { found: false, first: undefined }
  const after = src.slice(m.index! + m[0].length)
  return { found: true, first: after.split('\n').find((l) => l.trim() !== '' && !l.trim().startsWith('//'))?.trim() }
}

/** 소스의 `export const actions` 블록 안 최상위(2칸 들여쓰기) 액션 이름 전체 */
function actionNames(src: string): string[] {
  const start = src.indexOf('export const actions')
  const block = src.slice(start)
  return [...block.matchAll(/^ {2}([A-Za-z]+): async \(/gm)].map((m) => m[1])
}

describe('소스 스캔 — 진입부 첫 문장이 게이트', () => {
  it('A 상품목록 서버 액션: 소스의 모든 액션이 products.list 게이트로 시작', () => {
    const src = read(LIST_PAGE)
    expect(src).toContain("import { requireMenuAccessAction } from '$lib/server/requireMenuAccess'")
    const names = actionNames(src)
    for (const a of LIST_ACTIONS) expect(names, `${a} 액션 선언 없음`).toContain(a)
    expect(names.length).toBeGreaterThanOrEqual(8)
    for (const a of names) {
      const r = firstStatementAfter(src, new RegExp(`^ {2}${a}: async \\([^)]*\\) => \\{\\n`, 'm'))
      expect(r.found, `${a} 선언 없음`).toBe(true)
      expect(r.first, a).toBe("const denied = await requireMenuAccessAction(locals, 'products.list')")
    }
  })

  it('B 상품등록 서버 액션: 모든 액션이 products.new 게이트로 시작', () => {
    const src = read(NEW_PAGE)
    expect(src).toContain("import { requireMenuAccessAction } from '$lib/server/requireMenuAccess'")
    const names = actionNames(src)
    expect(names).toContain('create')
    for (const a of names) {
      const r = firstStatementAfter(src, new RegExp(`^ {2}${a}: async \\([^)]*\\) => \\{\\n`, 'm'))
      expect(r.found, `${a} 선언 없음`).toBe(true)
      expect(r.first, a).toBe("const denied = await requireMenuAccessAction(locals, 'products.new')")
    }
  })

  it('C 상품 상세 조회 GET: 진입부 첫 문장이 products.list API 게이트', () => {
    const src = read(DETAIL)
    expect(src).toContain("import { requireMenuAccessApi } from '$lib/server/requireMenuAccess'")
    const r = firstStatementAfter(src, /export const GET\b[^\n]*=>\s*\{\n/)
    expect(r.found).toBe(true)
    expect(r.first).toBe("const denied = await requireMenuAccessApi(locals, 'products.list')")
  })

  for (const f of FINDER_APIS) {
    it(`D ${f.replace('src/routes/api/cms/', '')} GET: 첫 문장이 rental.reservation API 게이트`, () => {
      const src = read(f)
      expect(src).toContain("import { requireMenuAccessApi } from '$lib/server/requireMenuAccess'")
      const r = firstStatementAfter(src, /export const GET\b[^\n]*=>\s*\{\n/)
      expect(r.found).toBe(true)
      expect(r.first).toBe("const denied = await requireMenuAccessApi(locals, 'rental.reservation')")
    })
  }
})

describe('동작 — 게이트 거부 시 즉시 거부, 세션·DB 조회 없음', () => {
  beforeEach(() => {
    apiGuard.mockReset()
    actionGuard.mockReset()
    createClientSpy.mockReset()
  })

  it('A·B 서버 액션: 거부 시 fail 403이 그대로 반환되고 DB 조회 없음', async () => {
    const { fail } = await import('@sveltejs/kit')
    const targets: [string, string][] = [
      ['../../routes/cms/products/+page.server', 'products.list'],
      ['../../routes/cms/products/new/+page.server', 'products.new'],
    ]
    for (const [path, key] of targets) {
      const mod = (await import(/* @vite-ignore */ path)) as { actions: Record<string, (e: unknown) => Promise<unknown>> }
      for (const a of Object.keys(mod.actions)) {
        actionGuard.mockReset().mockResolvedValue(fail(403, { error: 'denied' }))
        createClientSpy.mockClear()
        const safeGetSession = vi.fn()
        const locals = { safeGetSession, supabase: { from: vi.fn(), rpc: vi.fn() } }
        const request = new Request('http://x', { method: 'POST', body: new FormData() })
        const res = (await mod.actions[a]({ locals, request })) as { status: number }
        expect(res.status, `${key}:${a}`).toBe(403)
        expect(actionGuard, a).toHaveBeenCalledWith(locals, key)
        expect(safeGetSession, a).not.toHaveBeenCalled()
        expect(createClientSpy, a).not.toHaveBeenCalled()
      }
    }
  })

  it('C 상품 상세 GET: 거부 → 403 응답 그대로, 세션·DB 조회 없음', async () => {
    apiGuard.mockResolvedValue(new Response(JSON.stringify({ error: 'denied' }), { status: 403 }))
    const mod = (await import('../../routes/cms/products/[id]/detail/+server')) as { GET: (e: unknown) => Promise<Response> }
    const safeGetSession = vi.fn()
    const locals = { safeGetSession, supabase: { from: vi.fn() } }
    const res = await mod.GET({ locals, params: { id: 'x' } })
    expect(res.status).toBe(403)
    expect(apiGuard).toHaveBeenCalledWith(locals, 'products.list')
    expect(safeGetSession).not.toHaveBeenCalled()
    expect(createClientSpy).not.toHaveBeenCalled()
  })

  for (const f of FINDER_APIS) {
    it(`D ${f.replace('src/routes/api/cms/', '')} GET: 거부 → 403, 인증·DB 조회 없음`, async () => {
      apiGuard.mockResolvedValue(new Response(JSON.stringify({ error: 'denied' }), { status: 403 }))
      const mod = (await import(/* @vite-ignore */ `../../../${f}`)) as { GET: (e: unknown) => Promise<Response> }
      const safeGetSession = vi.fn()
      const locals = { safeGetSession, supabase: { from: vi.fn(), rpc: vi.fn() } }
      const res = await mod.GET({ locals, params: { id: 'x' }, url: new URL('http://x/api') })
      expect(res.status).toBe(403)
      expect(apiGuard).toHaveBeenCalledWith(locals, 'rental.reservation')
      expect(safeGetSession).not.toHaveBeenCalled()
      expect(createClientSpy).not.toHaveBeenCalled()
    })
  }
})
