import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { NOTIFY_TYPE_LABEL } from '$lib/utils/smsDelivery'
import { smsNotifyTypesForCard } from '$lib/utils/smsCardTypes'

// 본인증명 등록요청 문자도 예약 상세 '알림발송' 탭에 보이도록 sms_notification_logs에 기록한다(2026-10-17, A안)
const helper = readFileSync('src/lib/server/identityDocRequest.ts', 'utf-8')
const mig = readFileSync('supabase/migrations/20261017010000_721_sms_dedup_allow_identity_request.sql', 'utf-8')

describe('본인증명 등록요청 문자 발송 기록', () => {
  it('발송 성공·실패를 identity_request로 기록하고 솔라피에 예약번호·유형을 심는다', () => {
    expect(helper).toContain("notify_type: 'identity_request'")
    expect(helper).toContain("'sent'")
    expect(helper).toContain("'failed'")
    expect(helper).toContain("notifyType: 'identity_request'")
  })
  it('지정 예약이 없으면 취소·만료를 뺀 최근 예약에 연결하고 예약이 없으면 기록을 생략한다', () => {
    expect(helper).toContain("'(cancelled,expired)'")
    expect(helper).toContain('if (reservationId == null) return')
  })
  it('같은 날 재요청 기록이 고유 인덱스에 막히지 않도록 인덱스에서 제외한다', () => {
    expect(mig).toContain("'identity_request'")
  })
  it('탭 라벨·관리자 카드 매핑에 등록', () => {
    expect(NOTIFY_TYPE_LABEL.identity_request).toBe('본인증명 등록요청')
    expect(smsNotifyTypesForCard('identity_request')).toEqual(['identity_request'])
  })
})
