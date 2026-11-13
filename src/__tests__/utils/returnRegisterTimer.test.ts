import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  EMPTY_RETURN_REGISTER_TIMER,
  isValidReturnRegisterHours,
  parseReturnRegisterHours,
  parseReturnRegisterTimer,
  returnRegisterLabel,
} from '$lib/utils/returnRegisterTimer'
import { RETURN_NOTICE_BUTTON_LABEL, RETURN_NOTICE_NOTIFY_TYPE, RETURN_NOTICE_STAGES, RETURN_SUBMIT_LINK_TYPES, isReturnNoticeStage, returnSubmitPath } from '$lib/utils/returnNotice'

describe('반납정보 등록요청 타이머 값 해석', () => {
  it('화면 선택값: 빈 값은 해제(null), 1~24 정수만 허용, 그 밖은 undefined', () => {
    expect(parseReturnRegisterHours('')).toBeNull()
    expect(parseReturnRegisterHours(null)).toBeNull()
    expect(parseReturnRegisterHours('1')).toBe(1)
    expect(parseReturnRegisterHours('24')).toBe(24)
    expect(parseReturnRegisterHours('0')).toBeUndefined()
    expect(parseReturnRegisterHours('25')).toBeUndefined()
    expect(parseReturnRegisterHours('1.5')).toBeUndefined()
    expect(parseReturnRegisterHours('abc')).toBeUndefined()
    expect(parseReturnRegisterHours(3)).toBeUndefined()
  })

  it('저장값 해석: 어긋난 칸은 null, 없는 값은 모두 null', () => {
    expect(parseReturnRegisterTimer(null)).toEqual(EMPTY_RETURN_REGISTER_TIMER)
    expect(parseReturnRegisterTimer({ visit: 3, quick: 99, locker: 'x' })).toEqual({ visit: 3, quick: null, locker: null })
    expect(parseReturnRegisterTimer({ visit: 1, quick: 24, locker: 12 })).toEqual({ visit: 1, quick: 24, locker: 12 })
  })

  it('표기와 범위 검사', () => {
    expect(returnRegisterLabel(null)).toBe('설정 안 함')
    expect(returnRegisterLabel(5)).toBe('5시간 전')
    expect(isValidReturnRegisterHours(24)).toBe(true)
    expect(isValidReturnRegisterHours(0)).toBe(false)
  })
})

describe('등록요청 단계·링크 규칙', () => {
  it('reg_* 세 단계는 모두 return_registration 알림 유형이고 버튼 라벨이 있다', () => {
    for (const st of ['reg_visit', 'reg_quick', 'reg_locker'] as const) {
      expect(isReturnNoticeStage(st)).toBe(true)
      expect(RETURN_NOTICE_STAGES).toContain(st)
      expect(RETURN_NOTICE_NOTIFY_TYPE[st]).toBe('return_registration')
      expect(RETURN_NOTICE_BUTTON_LABEL[st]).toBe('반납정보 등록')
    }
  })

  it('푸시 링크를 등록 화면으로 보내는 유형에 return_registration·방식별 안내가 들어 있고 return_remind 는 없다', () => {
    expect(RETURN_SUBMIT_LINK_TYPES.has('return_registration')).toBe(true)
    expect(RETURN_SUBMIT_LINK_TYPES.has('return_notice_locker')).toBe(true)
    expect(RETURN_SUBMIT_LINK_TYPES.has('return_remind')).toBe(false)
    expect(returnSubmitPath(77)).toBe('/account/rental/77/return-submit')
  })
})

describe('발송 코드 연결(소스 점검)', () => {
  const read = (p: string): string => readFileSync(p, 'utf-8')

  it('문자 기본 링크: return_registration 도 반납 등록 화면 풀링크', () => {
    const sms = read('src/lib/server/sms.ts')
    expect(sms).toMatch(/case 'return_registration':[\s\S]{0,200}returnSubmitPath\(reservationId\)/)
  })

  it('푸시 링크: 반납 등록 유형이면 반납 등록 화면, 그 밖은 기존 목록', () => {
    const push = read('src/lib/server/push.ts')
    expect(push).toMatch(/RETURN_SUBMIT_LINK_TYPES\.has\(notifyType\) \? returnSubmitPath\(reservationId\) : '\/account\/rental'/)
  })

  it('채팅카드: 수동 [반납 정보 요청]·자동발송 카드도 반납 등록 화면 링크(Migration #823)', () => {
    const mig = read('supabase/migrations/20261113120000_823_return_registration_card_link.sql')
    expect(mig).toContain("WHEN p_notify_type = ''return_registration'' THEN ''/account/rental/'' || p_reservation_id::TEXT || ''/return-submit''")
    expect(mig).toContain('0c547f2b9811dc6ca121cc187be3c7a0')
  })

  it('크론: 시간이 하나라도 설정되면 claim_return_register_targets 를 두 번째 원천으로 호출', () => {
    const cron = read('src/routes/api/cron/return-notice/+server.ts')
    expect(cron).toContain("rpc: 'claim_return_register_targets'")
    expect(cron).toContain('getReturnRegisterTimer')
    expect(cron).toContain('hasRegisterTimer')
  })

  it('설정 저장 액션: manager 이상 게이트 + 감사 로그', () => {
    const srv = read('src/routes/cms/set/push/+page.server.ts')
    const start = srv.indexOf('updateReturnRegisterTimer: async')
    expect(start).toBeGreaterThan(0)
    const body = srv.slice(start, start + 2200)
    expect(body).toContain('hasSettingsAccess(cmsRole)')
    expect(body).toContain('insertCmsAdminAuditLog')
  })
})
