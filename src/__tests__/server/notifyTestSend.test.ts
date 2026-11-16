// CMS 푸시알림 '테스트 발송' (2026-11-16) — 모든 알림 유형이 발송 경로를 갖고, 대상은 CMS 직원 계정으로 제한되는지
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { NOTIFY_SPECS } from '$lib/utils/notifyTemplate'
import { CUSTOMER_LIFECYCLE_PUSH_COPY } from '$lib/server/push'
import { TEST_SEND_TYPES } from '$lib/server/notifyTestSend'

const sender = readFileSync('src/lib/server/notifyTestSend.ts', 'utf8')
const page = readFileSync('src/routes/cms/set/push/+page.server.ts', 'utf8')

describe('테스트 발송 — 알림 목록 전체', () => {
  it('설정 화면의 모든 알림 유형이 대상에 포함된다', () => {
    expect(TEST_SEND_TYPES).toEqual(NOTIFY_SPECS.map((s) => s.notifyType))
  })
  it('모든 유형이 예약 기준(푸시 문구 보유) 또는 직접 발송 정의 중 하나를 가진다', () => {
    const missing = TEST_SEND_TYPES.filter((t) => !(t in CUSTOMER_LIFECYCLE_PUSH_COPY) && !new RegExp(`^  ${t}: \\{`, 'm').test(sender))
    expect(missing).toEqual([])
  })
})

describe('테스트 발송 — 안전 장치', () => {
  const action = page.slice(page.indexOf('sendTestNotice: async'), page.indexOf('updatePushConfig: async'))
  it('설정 권한(매니저 이상)을 확인한다', () => {
    expect(action).toContain('hasSettingsAccess(cmsRole)')
  })
  it('대상은 CMS 직원 계정으로만 제한한다(일반 고객 불가)', () => {
    expect(action).toContain('!t.cms_role')
  })
  it('탈퇴 처리된 계정에는 보내지 않는다', () => {
    expect(action).toContain('withdrawal_status')
  })
  it('같은 날 문자 중복 판정을 우회하고 실제 허브 경로를 쓴다', () => {
    expect(sender).toContain('forceSms: true')
    expect(sender).toContain('sendReservationLifecyclePush(')
  })
})
