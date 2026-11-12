import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * 파트너 권한 정책 결정 소스 가드 (2026-11-11, Stephen)
 *  1. 파트너 ON(예약변경 및 취소) = 신청대기 취소만 / 취소 확인(confirm-cancel)은 매니저 이상
 *  2. 파트너는 패널 '결제정보'·'계약서' 탭 접근 불가(화면 숨김 + 해당 API 매니저 이상) — 대여정보·고객정보·검수·알림발송은 가능
 *  3. 파트너의 상담 세션 삭제·배너 삭제 불가(매니저 이상)
 * 동작 자체의 단위 시험은 partnerCancelGuard.test.ts, 여기서는 게이트가 지워지지 않았는지 소스로 지킨다.
 */
const read = (p: string) => readFileSync(p, 'utf8')

describe('정책 2 — 결제정보·계약서 탭: 화면', () => {
  const panel = read('src/lib/components/cms/RentalDetailPanel.svelte')
  it("파트너면 payment·contract 탭을 숨긴다(역할은 cmsRole prop 또는 레이아웃 데이터)", () => {
    expect(panel).toContain("const PARTNER_HIDDEN_TABS = ['payment', 'contract'] as const")
    expect(panel).toMatch(/panelRole === 'partner' \? \[\.\.\.hiddenTabs, \.\.\.PARTNER_HIDDEN_TABS\]/)
    expect(panel).toContain('.filter((t) => !effectiveHiddenTabs.includes(t.id))')
  })
  it('대여정보·고객정보·검수·알림발송 탭은 파트너에게 숨기지 않는다', () => {
    const m = panel.match(/PARTNER_HIDDEN_TABS = \[([^\]]*)\]/)
    expect(m?.[1]).toBeDefined()
    for (const keep of ['rental', 'customer', 'inspection', 'sms']) expect(m?.[1]).not.toContain(keep)
  })
  it('숨긴 탭은 초기 탭·활성 탭으로도 열리지 않는다', () => {
    expect(panel).toContain('!effectiveHiddenTabs.includes(initialTab)')
    expect(panel).toContain('if (effectiveHiddenTabs.includes(activeTab)) activeTab')
  })
  it('신청대기 [예약취소] 버튼 2곳은 취소 권한이 없으면 비활성이다', () => {
    expect((panel.match(/disabled=\{isSubmitting \|\| !canChangeOrCancelReservation\}/g) ?? []).length).toBe(2)
  })
})

describe('정책 2 — 결제정보·계약서 탭: 서버(API)는 매니저 이상', () => {
  const files = [
    'src/routes/api/cms/reservations/[id]/payment/+server.ts',
    'src/routes/api/cms/reservations/[id]/payment/pg-status/+server.ts',
    'src/routes/api/cms/reservations/[id]/order-coupons/+server.ts',
    'src/routes/api/cms/reservations/[id]/late-fees/+server.ts',
    'src/routes/api/cms/contracts/[id]/compare-file/+server.ts',
    'src/routes/api/cms/contracts/[id]/final-pdf/+server.ts',
    'src/routes/api/cms/contracts/[id]/final-pdf-status/+server.ts',
    'src/routes/api/cms/contracts/[id]/preview-pdf/+server.ts',
    'src/routes/api/cms/contracts/[id]/seal/+server.ts',
    'src/routes/api/cms/contracts/[id]/content/+server.ts',
  ]
  for (const f of files) {
    it(`${f.replace('src/routes/api/cms/', '')} — 정책 결정 표식과 hasSettingsAccess 게이트`, () => {
      const s = read(f)
      expect(s).toContain('정책 결정 2026-11-11(Stephen)')
      expect(s).toMatch(/hasSettingsAccess\(cmsRole\)/)
    })
  }
  // 같은 파일의 POST·PUT 에 이미 같은 문자열이 있는 파일은 GET 블록만 잘라 검사한다(GET 게이트 한 줄만 지워도 잡히도록 — sp3 3회차 MINOR-1)
  for (const f of ['src/routes/api/cms/reservations/[id]/payment/+server.ts', 'src/routes/api/cms/reservations/[id]/late-fees/+server.ts']) {
    it(`${f.replace('src/routes/api/cms/', '')} — GET 핸들러 안에 매니저 이상 게이트`, () => {
      const s = read(f)
      const start = s.indexOf('export const GET')
      const next = s.indexOf('export const ', start + 10)
      const get = s.slice(start, next === -1 ? undefined : next)
      expect(get).toMatch(/if \(!hasSettingsAccess\(cmsRole\)\) return json\(/)
    })
  }
  it('계약서 내용 조회는 서명 완료 여부와 무관하게 매니저 이상만(2026-08-20 완화를 대체)', () => {
    const s = read('src/routes/api/cms/contracts/[id]/content/+server.ts')
    expect(s).not.toContain('!hasSettingsAccess(cmsRole) && !signing')
  })
})

describe('정책 1 — 취소 권한', () => {
  it('취소 확인(confirm-cancel)은 매니저 이상만', () => {
    const s = read('src/routes/api/cms/reservations/[id]/confirm-cancel/+server.ts')
    expect(s).toMatch(/if \(!hasSettingsAccess\(cmsRole\)\) return json\(\{ ok: false/)
  })
  it('고객 취소 확인 버튼은 파트너에게 비활성이다(서버가 항상 403이라 눌러도 실패하므로)', () => {
    const panel = read('src/lib/components/cms/RentalDetailPanel.svelte')
    expect(panel).toContain('disabled={isConfirmingCancel || confirmCancelDone || !canChangeOrCancelReservation || !canManagePaymentAndLocker}')
  })
  it('파트너 취소 경로가 rental.change_cancel 을 확인한다', () => {
    const s = read('src/routes/cms/reservation/+page.server.ts')
    const partnerBranch = s.slice(s.indexOf('── partner 경로'))
    expect(partnerBranch.indexOf("'rental.change_cancel'")).toBeGreaterThan(-1)
    expect(partnerBranch.indexOf("'rental.change_cancel'")).toBeLessThan(partnerBranch.indexOf("'cancel_unpaid_reservations_for_partner'"))
    // 파트너 분기가 상태 전환 RPC 를 직접 부르지 않는다(검사와 취소는 DB 함수 한 번 — Migration 810)
    expect(partnerBranch.slice(0, partnerBranch.indexOf('cancelledSiblingIds = siblingIds'))).not.toContain("rpc('update_reservation_status'")
  })
})

describe('정책 3 — 상담 세션 삭제·배너 삭제는 매니저 이상', () => {
  it('상담 세션 DELETE', () => {
    const s = read('src/routes/api/chat/sessions/[id]/+server.ts')
    expect(s).toMatch(/if \(!hasSettingsAccess\(p\.cms_role\)\) return json/)
  })
  for (const f of ['src/routes/api/cms/help/hero-bg/+server.ts', 'src/routes/api/cms/members/hero-banner/+server.ts', 'src/routes/api/cms/home/hero-banner/+server.ts']) {
    it(`${f.replace('src/routes/api/cms/', '')} DELETE`, () => {
      const s = read(f)
      const del = s.slice(s.indexOf('export const DELETE'))
      expect(del).toContain('if (!hasSettingsAccess(delRole)) throw error(403')
      expect(del.indexOf('hasSettingsAccess(delRole)')).toBeLessThan(del.indexOf('storage.from(BUCKET).remove'))
    })
  }
})

describe('정책 — 연체료·옵션 단가는 파트너 노출 불가 / DB 원자 취소 함수 존재', () => {
  it('옵션 단가는 파트너에게 0 으로 내려간다', () => {
    const s = read('src/routes/api/cms/reservations/[id]/options/+server.ts')
    expect(s).toContain('unit_price:   hasSettingsAccess(cmsRole) ? (r.unit_price as number) : 0')
  })
  it('Migration 810: 서버 전용(service_role) + 행 잠금 + 결제 흔적 검사', () => {
    const sql = read('supabase/migrations/20261111100000_810_partner_cancel_unpaid.sql')
    expect(sql).toContain('FOR UPDATE')
    expect(sql).toContain('payment_confirmed_at IS NOT NULL')
    expect(sql).toContain('FROM payment_transactions pt')
    expect(sql).toContain('REVOKE EXECUTE ON FUNCTION public.cancel_unpaid_reservations_for_partner(bigint, bigint[]) FROM anon, authenticated;')
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.cancel_unpaid_reservations_for_partner(bigint, bigint[]) TO service_role;')
  })
})
