import { describe, it, expect } from 'vitest'
import {
  NOTIFY_VARIABLES, getNotifySpec, applyNotifyTemplate, findUnknownVariables, validateNotifyMessage,
} from '$lib/utils/notifyTemplate'
import { trackingNoticeText } from '$lib/utils/trackingNotice'

/** 반출·운송장 알림의 택배사·운송장 번호 (2026-10-27) — 변수 카탈로그·치환·줄 생략·기본 문구 */

describe('택배사·운송장번호 변수', () => {
  it('TN-1 카탈로그에 두 변수가 있고 반출·운송장 알림에서만 쓸 수 있다', () => {
    expect(NOTIFY_VARIABLES.택배사.sample).toBeTruthy()
    expect(NOTIFY_VARIABLES.운송장번호.sample).toBeTruthy()
    for (const t of ['shipment_notify', 'tracking_notify']) {
      expect(getNotifySpec(t)?.vars).toEqual(expect.arrayContaining(['택배사', '운송장번호']))
    }
    for (const t of ['reservation_approval', 'return_remind', 'reservation_cancelled', 'dhero_place_guide']) {
      expect(getNotifySpec(t)?.vars).not.toContain('택배사')
      expect(findUnknownVariables(t, '{{택배사}}')).toEqual(['택배사'])
    }
    expect(findUnknownVariables('tracking_notify', '{{택배사}} {{운송장번호}}')).toEqual([])
  })

  it('TN-2 기본 문구에 택배사·운송장 번호 줄이 있고 저장 검증을 통과한다', () => {
    for (const t of ['shipment_notify', 'tracking_notify']) {
      const spec = getNotifySpec(t)
      expect(spec?.defaultMessage).toContain('{{택배사}}')
      expect(spec?.defaultMessage).toContain('{{운송장번호}}')
      expect(validateNotifyMessage(t, spec?.defaultMessage ?? '').ok).toBe(true)
    }
  })
})

describe('applyNotifyTemplate — 택배사·운송장번호가 비면 그 줄을 뺀다', () => {
  const tpl = '{{상품명}} 운송장 번호가 등록됐어요.\n택배사: {{택배사}}\n운송장 번호: {{운송장번호}}'
  it('TN-3 둘 다 있으면 세 줄 모두', () => {
    expect(applyNotifyTemplate(tpl, { 상품명: 'FX3', 택배사: '두발히어로', 운송장번호: 'T-1' }))
      .toBe('FX3 운송장 번호가 등록됐어요.\n택배사: 두발히어로\n운송장 번호: T-1')
  })
  it('TN-4 값이 없으면 해당 줄만 빠진다(빈 "택배사:" 줄을 남기지 않는다)', () => {
    expect(applyNotifyTemplate(tpl, { 상품명: 'FX3' })).toBe('FX3 운송장 번호가 등록됐어요.')
    expect(applyNotifyTemplate(tpl, { 상품명: 'FX3', 운송장번호: 'T-1' })).toBe('FX3 운송장 번호가 등록됐어요.\n운송장 번호: T-1')
  })
  it('TN-5 다른 변수가 든 줄은 값이 없어도 기존처럼 유지된다(회귀 없음)', () => {
    expect(applyNotifyTemplate('{{상품명}} 수령 {{수령일시}}', { 상품명: 'FX3' })).toBe('FX3 수령')
  })
})

describe('trackingNoticeText', () => {
  it('TN-6 택배사·번호를 줄로 만든다(있는 것만)', () => {
    expect(trackingNoticeText('두발히어로', 'T-1')).toBe('택배사: 두발히어로\n운송장 번호: T-1')
    expect(trackingNoticeText(null, 'T-1')).toBe('운송장 번호: T-1')
    expect(trackingNoticeText('두발히어로', null)).toBe('')
    expect(trackingNoticeText('  ', '  ')).toBe('')
  })
})
