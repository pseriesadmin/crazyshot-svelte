import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * 관리자 '예약승인'(approveReservation) 성공 후 본인증명정보 등록요청 연동 (2026-10-15, Stephen 확정)
 *  - 승인 알림 발송 뒤, 예약 고객에게 requestIdentityDocRegistration(카드 + 푸시 + SMS, CMS 안내문장 반영)을 호출한다.
 *  - 서류 승인대기·승인완료·24시간 중복 판정은 헬퍼 소관 — 승인 액션은 fail-soft로 호출만 한다.
 */
const src = readFileSync(resolve(process.cwd(), 'src/routes/cms/reservation/+page.server.ts'), 'utf8')
const approve = src.slice(src.indexOf('approveReservation: async'), src.indexOf('changeReservation: async'))

describe('approveReservation → 본인증명정보 등록요청', () => {
  it('서류 미등록·미비일 때 등록요청 헬퍼를 호출하고, 예약을 확정(update_reservation_status confirmed)하지 않는다', () => {
    expect(src).toContain("import { requestIdentityDocRegistration } from '$lib/server/identityDocRequest'")
    expect(approve).toContain('requestIdentityDocRegistration(admin')
    expect(approve).not.toContain("p_new_status:     'confirmed'")
    expect(approve).not.toContain('update_reservation_status')
  })
  it('실패해도 승인 결과에 영향 없도록 try/catch로 감싼다', () => {
    const seg = approve.slice(approve.indexOf('const sendIdentityRequest'))
    expect(seg).toMatch(/try \{[\s\S]*requestIdentityDocRegistration[\s\S]*\} catch/)
  })
  it('서류 승인 완료 고객은 예약승인 시각(approved_at)을 기록하고 표준양식이 없으면 approvedManual로 끝낸다(수동 발행 가능)', () => {
    expect(approve).toContain("update({ approved_at: new Date().toISOString() })")
    expect(approve).toContain('approvedManual: true')
    expect(approve.indexOf('approved_at')).toBeLessThan(approve.indexOf('hasAutoIssueTemplate(admin)'))
  })
})
