import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// 예약현황·대여현황 통합(2026-10-22, Stephen 확정) — 구조 점검(소스 확인)
const read = (p: string) => readFileSync(p, 'utf8')

describe('예약·대여현황 통합 — /cms/rentals 한 화면', () => {
  it('/cms/reservation 화면 요청은 쿼리를 그대로 넘겨 /cms/rentals 로 이동한다(폼 액션은 유지)', () => {
    const s = read('src/routes/cms/reservation/+page.server.ts')
    expect(s).toMatch(/throw redirect\(303, `\/cms\/rentals\$\{url\.search\}`\)/)
    expect(s).toContain('export const actions: Actions')
    for (const a of ['approveReservation', 'updateStatus', 'changeReservation']) expect(s).toContain(`${a}:`)
  })

  it('통합 화면 칩 = 임시예약·신청대기·계약대기·계약완료·배송중·대여중·반납중·검수·완료·취소·환불·CS(전체 칩 없음), 탭 메뉴(예약현황/대여현황) 없음', () => {
    const v = read('src/routes/cms/rentals/+page.svelte')
    const labels = [...v.matchAll(/\{ label: '([^']+)',\s+value: '([^']*)'/g)].map((m) => m[1])
    expect(labels).toEqual(['임시예약', '신청대기', '계약대기', '계약완료', '배송중', '대여중', '반납중', '검수', '완료', '취소·환불·CS'])
    expect(v).not.toContain('ReservationRentalTabBar')
    expect(v).toContain("hold', contractPending: true")
  })

  it('통합 로더: 예약 단계 칩은 공용 모듈(예약현황 조회 규칙), 취소·환불·CS 는 취소·만료 전부, 전체 칩은 없음(옛 status= 링크는 기본 칩으로), 기본 칩은 신청대기', () => {
    const s = read('src/routes/cms/rentals/+page.server.ts')
    expect(s).toContain("url.searchParams.get('status') ?? '') : 'hold'")
    expect(s).toContain('loadReservationStageRows')
    expect(s).toContain("['cancelled', 'expired']")
    expect(s).toContain("['completed', 'damage_claimed']") // 완료 칩 = 완료 + 파손신고
    expect(s).not.toContain('isAllView')
    expect(s).toContain("status === 'cancelled'") // 옛 '취소' 칩 값은 통합 칩으로
  })

  it('메뉴: 예약대여현황은 /cms/rentals, 옛 /cms/reservation 은 같은 권한을 따른다', () => {
    const m = read('src/lib/constants/cmsMenus.ts')
    expect(m).toContain("label: '예약대여현황', href: '/cms/rentals'")
    expect(m).toContain("{ href: '/cms/reservation', menu_key: 'rental.reservation' }")
  })
})
