/* eslint-disable security/detect-non-literal-fs-filename, security/detect-non-literal-regexp -- 테스트가 소스 파일을 스캔하는 용도(고정된 프로젝트 경로, 사용자 입력 없음) */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MENU_GUARDED_ENDPOINTS, MENU_GUARDED_SHARED_ENDPOINTS, MENU_GUARDED_ACTION_FILES } from '$lib/server/menuAccessMap'

/**
 * 1단계 1e — 고객목록(customers.list) 메뉴 권한 서버 집행 (2026-10-05)
 *  A. 고객 서류 API(approve-doc·revoke-doc-approval·upload-doc) → customers.list 단독 (doc-url은 기존 게이트 유지)
 *  B. 고객 정보 조회 API(inquiries·coupons·summary) → 상담 채팅 고객패널과 공용: consulting.chat 또는 customers.list
 *  C. /cms/customers 서버 액션 6개 → customers.list
 */
const ROOT = process.cwd()
const read = (p: string) => readFileSync(join(ROOT, p), 'utf-8')
function firstStatementAfter(src: string, re: RegExp): string | undefined {
  const m = src.match(re)
  if (!m) return undefined
  return src.slice(m.index! + m[0].length).split('\n').find((l) => l.trim() !== '' && !l.trim().startsWith('//'))?.trim()
}

const STRICT = "const denied = await requireMenuAccessApi(locals, 'customers.list')"
const ANY = "const denied = await requireAnyMenuAccessApi(locals, ['consulting.chat', 'customers.list'])"

describe('A 고객 서류 API (customers.list 단독)', () => {
  for (const f of ['approve-doc', 'revoke-doc-approval', 'upload-doc']) {
    it(`${f} POST: 첫 문장이 게이트`, () => {
      const src = read(`src/routes/api/cms/${f}/+server.ts`)
      expect(src).toContain("import { requireMenuAccessApi } from '$lib/server/requireMenuAccess'")
      expect(firstStatementAfter(src, /export const POST\b[^\n]*=>\s*\{\n/)).toBe(STRICT)
    })
  }
  it('doc-url GET: 기존 customers.list 게이트 유지', () => {
    expect(read('src/routes/api/cms/customers/[id]/doc-url/+server.ts')).toContain("requireMenuAccessApi(locals, 'customers.list')")
  })
})

describe('B 고객 정보 조회 API (상담 채팅 고객패널 공용)', () => {
  for (const f of ['inquiries']) { // coupons·summary는 2-A(Stephen Q0)에서 상담 단독으로 좁힘 — menuStage2Guard.test.ts
    it(`customers/[id]/${f} GET: 첫 문장이 any-of 게이트`, () => {
      const src = read(`src/routes/api/cms/customers/[id]/${f}/+server.ts`)
      expect(src).toContain("import { requireAnyMenuAccessApi } from '$lib/server/requireMenuAccess'")
      expect(firstStatementAfter(src, /export const GET\b[^\n]*=>\s*\{\n/)).toBe(ANY)
    })
  }
})

describe('D 고객 상세 패널 탭 데이터 조회(cms/customers/*/+server.ts, customers.list 단독)', () => {
  for (const d of ['addresses', 'chat-sessions', 'credit-audit', 'points', 'profile-settings', 'rentals', 'subscription-payments', 'subscriptions']) {
    it(`customers/${d} GET: 첫 문장이 게이트`, () => {
      const src = read(`src/routes/cms/customers/${d}/+server.ts`)
      expect(src).toContain("import { requireMenuAccessApi } from '$lib/server/requireMenuAccess'")
      expect(firstStatementAfter(src, /export const GET\b[^\n]*=>\s*\{\n/)).toBe(STRICT)
    })
  }
})

describe('C /cms/customers 서버 액션', () => {
  const src = read('src/routes/cms/customers/+page.server.ts')
  it('import', () => expect(src).toContain("import { requireMenuAccessAction } from '$lib/server/requireMenuAccess'"))
  for (const a of ['toggleBlacklist', 'cancelSubscription', 'updateCustomerInfo', 'adjustScore', 'grantCustomerPoints', 'deleteCustomer']) {
    it(`${a}: 첫 문장이 게이트`, () => {
      expect(firstStatementAfter(src, new RegExp(`${a}: async \\([^\\n]*=>\\s*\\{\\n`))).toBe(
        "const denied = await requireMenuAccessAction(locals, 'customers.list')",
      )
    })
  }
})

describe('E 레거시 회원 일괄 등록(/cms/customers/legacy-import) 서버 액션 — 화면은 경로 접두사로 customers.list를 따르지만 액션은 우회 가능했음', () => {
  const src = read('src/routes/cms/customers/legacy-import/+page.server.ts')
  for (const a of ['preview', 'confirm']) {
    it(`${a}: 첫 문장이 게이트`, () => {
      expect(src).toContain("import { requireMenuAccessAction } from '$lib/server/requireMenuAccess'")
      expect(firstStatementAfter(src, new RegExp(`${a}: async \\([^\\n]*=>\\s*\\{\\n`))).toBe(
        "const denied = await requireMenuAccessAction(locals, 'customers.list')",
      )
    })
  }
})

describe('매핑표 등록', () => {
  it('customers.list API·공용·액션', () => {
    const dirs = MENU_GUARDED_ENDPOINTS['customers.list']?.dirs ?? []
    for (const d of ['approve-doc', 'revoke-doc-approval', 'upload-doc']) expect(dirs).toContain(`src/routes/api/cms/${d}`)
    expect(dirs).toContain('src/routes/api/cms/customers/[id]/doc-url')
    for (const d of ['addresses', 'chat-sessions', 'credit-audit', 'points', 'profile-settings', 'rentals', 'subscription-payments', 'subscriptions']) expect(dirs).toContain(`src/routes/cms/customers/${d}`)
    const shared = MENU_GUARDED_SHARED_ENDPOINTS.find((s) => s.menuKeys.join() === 'consulting.chat,customers.list')
    expect(shared?.dirs).toEqual(['src/routes/api/cms/customers/[id]/inquiries'])
    expect(MENU_GUARDED_ACTION_FILES.some((a) => a.menuKey === 'customers.list' && a.file === 'src/routes/cms/customers/legacy-import/+page.server.ts')).toBe(true)
    expect(MENU_GUARDED_ACTION_FILES.some((a) => a.menuKey === 'customers.list' && a.file === 'src/routes/cms/customers/+page.server.ts')).toBe(true)
  })
})
