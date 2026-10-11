/**
 * TDD: 상품 이력·고객 분류 새로고침 API는 DB 함수를 서버 권한(service_role)으로 호출한다 (2026-10-12, Migration #698 선행 조건)
 * 이유: 이 함수들은 호출자 확인이 없어 일반 로그인 사용자 권한을 닫아야 하는데, 지금 두 API가 로그인 사용자 세션(locals.supabase)으로 호출하고 있어
 *       권한을 닫으면 CMS 상품 이력·고객 분류 새로고침이 멈춘다. 코드를 먼저 서버 권한으로 바꾼 뒤에 DB를 잠근다.
 * 접근 검사(메뉴 권한·cms_role)는 그대로 유지되어야 한다.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const historySrc = readFileSync('src/routes/api/cms/product-history/+server.ts', 'utf-8')
const segmentSrc = readFileSync('src/routes/api/cms/segment/refresh/+server.ts', 'utf-8')

describe('상품 이력 API', () => {
  it('RPC를 로그인 사용자 세션(locals.supabase)으로 호출하지 않는다', () => {
    expect(historySrc).not.toMatch(/locals\.supabase/)
  })
  it('서버 권한 클라이언트(SERVICE_ROLE_KEY)를 쓴다', () => {
    expect(historySrc).toMatch(/SUPABASE_SERVICE_ROLE_KEY/)
  })
  it('기존 접근 검사(메뉴 권한·세션·cms_role)가 유지된다', () => {
    expect(historySrc.match(/requireAnyMenuAccessApi\(locals, \['rental\.history', 'rental\.reservation'\]\)/g)?.length).toBe(4)
    expect(historySrc.match(/requireCmsRole\(/g)!.length).toBeGreaterThanOrEqual(5) // 정의 1 + 핸들러 4
  })
  it('작성자·수정자 ID는 항상 세션 사용자로 넣는다(요청 값 불신)', () => {
    expect(historySrc.match(/p_user_id: session\.user\.id/g)?.length).toBe(3)
  })
})

describe('고객 분류 새로고침 API', () => {
  it('RPC를 로그인 사용자 세션(locals.supabase)으로 호출하지 않는다', () => {
    expect(segmentSrc).not.toMatch(/locals\.supabase/)
  })
  it('서버 권한 클라이언트를 쓰고 cms_role 검사를 유지한다', () => {
    expect(segmentSrc).toMatch(/SUPABASE_SERVICE_ROLE_KEY/)
    expect(segmentSrc).toMatch(/cms_role/)
    expect(segmentSrc).toMatch(/Forbidden/)
  })
})
