/**
 * partnerReassignLockerAccess.test.ts — 재고 재배정·무인보관함 배정정보 파트너 확대 (2026-11-27, Stephen 확정)
 *  A1 hasCmsStaffAccess: partner·manager·superadmin 만 true, 빈값·알 수 없는 값은 false
 *  A2 재배정 API(본체·결합·옵션)와 무인보관함 API 는 이 기준으로 막고, 매니저 전용 검사(hasSettingsAccess)로 되돌아가지 않는다
 *  A3 상품 추가·삭제(POST·DELETE)는 그대로 매니저 이상 + 정책 차단
 *  A4 패널: 무인보관함 편집·보기는 파트너 이상, 재배정 버튼 문구는 '상품 재고 재배정'
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { hasCmsStaffAccess, hasSettingsAccess } from '$lib/utils/cmsPermissions'

const read = (p: string): string => readFileSync(p, 'utf-8')
const base = 'src/routes/api/cms/reservations/[id]/'

describe('A1 hasCmsStaffAccess', () => {
  it('CMS 직원 3등급만 true', () => {
    expect(['partner', 'manager', 'superadmin'].map(hasCmsStaffAccess)).toEqual([true, true, true])
    expect(['', 'user', 'admin', 'Partner'].map(hasCmsStaffAccess)).toEqual([false, false, false, false])
  })
  it('설정 권한(매니저 이상)과는 별개 — 파트너는 설정 권한 없음', () => {
    expect(hasSettingsAccess('partner')).toBe(false)
    expect(hasCmsStaffAccess('partner')).toBe(true)
  })
})

describe('A2 재배정·무인보관함 API 게이트', () => {
  const staffOnly = [
    'available-units/+server.ts',
    'bundles/available/+server.ts',
    'options/assets/available/+server.ts',
    'locker-password/test-send/+server.ts',
  ]
  it.each(staffOnly)('%s 는 hasCmsStaffAccess 만 쓴다', (f) => {
    const s = read(base + f)
    expect(s).toContain('hasCmsStaffAccess(cmsRole)')
    expect(s).not.toContain('hasSettingsAccess')
  })
  it('bundles·locker-password 도 hasCmsStaffAccess 만', () => {
    for (const f of ['bundles/+server.ts', 'locker-password/+server.ts']) {
      const s = read(base + f)
      expect(s, f).toContain('hasCmsStaffAccess(cmsRole)')
      expect(s, f).not.toContain('hasSettingsAccess(')
    }
  })
  it('options/assets: PATCH 는 직원 전원, 조회의 보정 배정(쓰기)은 매니저 이상 유지', () => {
    const s = read(base + 'options/assets/+server.ts')
    expect(s).toMatch(/if \(hasSettingsAccess\(cmsRole\)\) \{[\s\S]{0,200}cms_ensure_reservation_option_assets/)
    expect(s).toContain("if (!hasCmsStaffAccess(cmsRole)) return json({ error: '권한이 없습니다.' }, { status: 403 })")
  })
})

describe('A3 상품 추가·삭제는 그대로 매니저 이상', () => {
  it('products: POST·DELETE 는 hasSettingsAccess, PATCH 만 직원 전원', () => {
    const s = read(base + 'products/+server.ts')
    expect(s.match(/hasSettingsAccess\(cmsRole\)/g)?.length).toBe(2)
    const patch = s.slice(s.indexOf('export const PATCH'))
    expect(patch).toContain('hasCmsStaffAccess(cmsRole)')
    expect(patch).not.toContain('hasSettingsAccess(cmsRole)')
  })
})

describe('A4 패널', () => {
  const panel = read('src/lib/components/cms/RentalDetailPanel.svelte')
  it('무인보관함 편집·보기 권한은 파트너 이상', () => {
    expect(panel).toContain("canManageLocker = $derived(hasCmsStaffAccess(cmsRole ?? '') || hasCmsStaffAccess(lockerEditRole ?? ''))")
    expect(panel).toContain('lockerReadOnly = $derived(!canManageLocker)')
  })
  it("재배정 버튼 문구는 '상품 재고 재배정'", () => {
    expect(panel).toContain("'닫기' : '상품 재고 재배정'")
  })
})

describe('A5 모바일 대여현황 무인보관함 편집 (2026-11-27)', () => {
  const mobile = read('src/routes/cms/mobile/rentals/+page.svelte')
  const panel = read('src/lib/components/cms/RentalDetailPanel.svelte')
  it('모바일은 lockerEditRole 만 넘기고 cmsRole(매니저 전용 기능)은 넘기지 않는다', () => {
    expect(mobile).toContain('lockerEditRole={data.cmsRole}')
    expect(mobile).not.toMatch(/\bcmsRole=\{/)
  })
  it('패널이 lockerEditRole 을 받아 편집 권한에 반영한다', () => {
    expect(panel).toContain('lockerEditRole?: string | null')
    expect(panel).toContain("hasCmsStaffAccess(lockerEditRole ?? '')")
  })
})
