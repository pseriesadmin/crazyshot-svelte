import { describe, it, expect } from 'vitest'
import {
  RETURN_NOTICE_ADMIN_PUSH_STAGES,
  RETURN_NOTICE_BUTTON_LABEL,
  RETURN_NOTICE_NOTIFY_TYPE,
  RETURN_NOTICE_STAGES,
  RETURN_SUBMIT_RULES,
  isReturnNoticeStage,
  mediaItemLabel,
  returnSubmitPath,
  toReturnSubmitMethod,
} from '$lib/utils/returnNotice'
import { nextLabel, nextStatus } from '$lib/utils/rentalTransition'

describe('반납 방식별 단계 알림 정의 (Migration #722)', () => {
  it('모든 단계가 알림 유형·버튼 라벨을 가진다', () => {
    for (const s of RETURN_NOTICE_STAGES) {
      expect(RETURN_NOTICE_NOTIFY_TYPE[s]).toMatch(/^return_notice_/)
      expect(RETURN_NOTICE_BUTTON_LABEL[s]).toBeTruthy()
    }
  })

  it('운영자 푸시는 퀵 안내 단계(3시간 전)에서만 나간다', () => {
    expect(RETURN_NOTICE_ADMIN_PUSH_STAGES).toEqual(['quick_5h'])
  })

  it('DB 단계 문자열만 단계로 인정한다', () => {
    expect(isReturnNoticeStage('courier')).toBe(true)
    expect(isReturnNoticeStage('locker_2h')).toBe(true)
    expect(isReturnNoticeStage('visit')).toBe(false)
  })

  it('반납 제출 화면 경로', () => {
    expect(returnSubmitPath(4688)).toBe('/account/rental/4688/return-submit')
  })
})

describe('반납 방식 → 제출 방식 매핑', () => {
  it('택배류·퀵·무인함만 제출 대상, 방문·미지정은 제외', () => {
    expect(toReturnSubmitMethod('epost')).toBe('courier')
    expect(toReturnSubmitMethod('delivery')).toBe('courier')
    expect(toReturnSubmitMethod('crazydelivery')).toBe('courier')
    expect(toReturnSubmitMethod('airport')).toBe('courier')
    expect(toReturnSubmitMethod('quick')).toBe('quick')
    expect(toReturnSubmitMethod('locker')).toBe('locker')
    expect(toReturnSubmitMethod('visit')).toBeNull()
    expect(toReturnSubmitMethod(null)).toBeNull()
  })

  it('방식별 요건: 택배=사진+체크리스트, 무인함=사진+무인함 정보, 퀵=확인만', () => {
    expect(RETURN_SUBMIT_RULES.courier).toEqual({ photosRequired: true, checklist: true, lockerInfo: false })
    expect(RETURN_SUBMIT_RULES.locker).toEqual({ photosRequired: true, checklist: false, lockerInfo: true })
    expect(RETURN_SUBMIT_RULES.quick).toEqual({ photosRequired: false, checklist: false, lockerInfo: false })
  })

  it('사진 항목 라벨', () => {
    expect(mediaItemLabel('body')).toBe('본체 사진')
    expect(mediaItemLabel('unknown_key')).toBe('unknown_key')
  })
})

describe('운영자 확인 버튼 문구 (전환 결과는 불변)', () => {
  it('반납요청 상태: 택배류=집하지 회수 확인 / 무인함=무인함 회수 확인 / 그 외=반납 처리', () => {
    expect(nextLabel('return_requested', null, 'epost')).toBe('집하지 회수 확인')
    expect(nextLabel('return_requested', null, 'crazydelivery')).toBe('집하지 회수 확인')
    expect(nextLabel('return_requested', null, 'locker')).toBe('무인함 회수 확인')
    expect(nextLabel('return_requested', null, 'quick')).toBe('반납 처리')
  })

  it('전환 규칙은 그대로: 반납요청 → returned, 방문 대여중 → returned 직행', () => {
    expect(nextStatus('return_requested', null, 'locker')).toBe('returned')
    expect(nextStatus('in_use', null, 'visit')).toBe('returned')
    expect(nextStatus('in_use', null, 'locker')).toBe('return_requested')
  })
})
