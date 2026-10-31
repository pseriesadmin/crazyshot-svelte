import { describe, it, expect } from 'vitest'
import {
  NOTIFY_SPECS,
  applyNotifyTemplate,
  classifySms,
  estimateNotifyMessage,
  findUnknownVariables,
  getNotifySpec,
  smsByteLength,
  smsTypeToConfigType,
  renderLockerGuideMessage,
  validateNotifyMessage,
} from '$lib/utils/notifyTemplate'

describe('applyNotifyTemplate — 변수 치환', () => {
  it('변수를 값으로 바꾼다', () => {
    expect(applyNotifyTemplate('{{고객이름}}님, {{상품명}} 준비됐어요.', { 고객이름: '홍길동', 상품명: 'FX3' })).toBe('홍길동님, FX3 준비됐어요.')
  })
  it('{{ 공백 }} 표기도 같은 변수로 본다', () => {
    expect(applyNotifyTemplate('{{ 상품명 }} 안내', { 상품명: 'FX3' })).toBe('FX3 안내')
  })
  it('값이 없는 변수는 빈 문자열이 되고 연속 공백이 정리된다', () => {
    expect(applyNotifyTemplate('안녕하세요 {{고객이름}} 반갑습니다', {})).toBe('안녕하세요 반갑습니다')
  })
  it('줄바꿈은 유지하고 줄별로 정리한다', () => {
    expect(applyNotifyTemplate('첫째 줄  \n  둘째 줄', {})).toBe('첫째 줄\n둘째 줄')
  })
})

describe('smsByteLength / classifySms', () => {
  it('한글 2바이트·ASCII 1바이트·줄바꿈 2바이트(보수적)', () => {
    expect(smsByteLength('가a')).toBe(3)
    expect(smsByteLength('a\nb')).toBe(4)
  })
  it('90바이트 이하는 SMS, 초과는 LMS, 2000 초과는 OVER', () => {
    expect(classifySms(90)).toBe('SMS')
    expect(classifySms(91)).toBe('LMS')
    expect(classifySms(2000)).toBe('LMS')
    expect(classifySms(2001)).toBe('OVER')
  })
})

describe('카탈로그', () => {
  it('설정 행 32종이 모두 정의돼 있고 기본 문구의 변수는 전부 허용 변수다', () => {
    expect(NOTIFY_SPECS).toHaveLength(32)
    for (const spec of NOTIFY_SPECS) {
      expect(findUnknownVariables(spec.notifyType, spec.defaultMessage)).toEqual([])
    }
  })
  it('문자 대상은 sms.ts 문자 유형과 대응한다', () => {
    expect(smsTypeToConfigType('contract_link')).toBe('contract_sent')
    expect(smsTypeToConfigType('contract_signed')).toBe('contract_signed_customer')
    expect(smsTypeToConfigType('contract_reshare')).toBeNull()
    expect(smsTypeToConfigType('return_remind')).toBe('return_remind')
    expect(getNotifySpec('return_remind')?.sms).toBe(true)
    expect(getNotifySpec('event_coupon_issued')?.sms).toBe(false) // 광고성 — 문자 연동 제외
  })
})

describe('validateNotifyMessage', () => {
  it('빈 문장은 기본 문구 복원이라 통과', () => {
    expect(validateNotifyMessage('return_remind', '   ').ok).toBe(true)
  })
  it('유형에 허용되지 않은 변수는 거절', () => {
    const r = validateNotifyMessage('chat_unanswered', '{{상품명}} 안내')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('{{상품명}}')
  })
  it('닫히지 않은 변수 표시는 거절', () => {
    expect(validateNotifyMessage('return_remind', '{{상품명 안내').ok).toBe(false)
  })
  it('제어·방향 문자는 거절', () => {
    expect(validateNotifyMessage('return_remind', '안내‭').ok).toBe(false)
    expect(validateNotifyMessage('return_remind', '안내\u0007').ok).toBe(false)
  })
  it('문자 대상 유형은 이모지 거절, 푸시 전용은 허용', () => {
    expect(validateNotifyMessage('return_remind', '반납 안내 🎉').ok).toBe(false)
    expect(validateNotifyMessage('rental_complete', '이용해주셔서 감사합니다 🎉').ok).toBe(true)
  })
  it('90바이트 초과는 저장은 되고 경고만(LMS)', () => {
    const r = validateNotifyMessage('return_remind', '{{상품명}} 반납예정일이 다가와요. 반납 방법과 반납 장소, 영업시간을 꼭 확인해 주세요. 늦으면 연체료가 발생할 수 있어요.')
    expect(r.ok).toBe(true)
    expect(r.smsKind).toBe('LMS')
    expect(r.warnings.length).toBe(1)
  })
  it('2000바이트 초과는 문자 대상에서 거절', () => {
    const r = validateNotifyMessage('return_remind', '가'.repeat(999))
    expect(r.ok).toBe(false)
    expect(r.error).toContain('2000')
  })
  it('최악 길이 추정에 접두어와 자동 링크 분이 포함된다', () => {
    const est = estimateNotifyMessage('return_remind', '안내')
    expect(est.worstText.startsWith('[크레이지샷] 안내')).toBe(true)
    expect(est.smsBytes).toBeGreaterThan(smsByteLength('[크레이지샷] 안내'))
  })
})

describe('무인보관함 이용 안내 전용 변수 (2026-10-11)', () => {
  it('locker_guide는 무인함번호·무인함비밀번호·중앙현관비밀번호·반납기한 변수를 허용한다', () => {
    const msg = '{{상품명}} {{무인함번호}}번함 비밀번호 {{무인함비밀번호}} / 중앙현관 {{중앙현관비밀번호}} / 반납 {{반납기한}}'
    expect(validateNotifyMessage('locker_guide', msg).ok).toBe(true)
    expect(applyNotifyTemplate(msg, { 상품명: 'Sony PXW-Z90', 무인함번호: '1', 무인함비밀번호: '*8821', 중앙현관비밀번호: '0418*', 반납기한: '2026-10-10 14:00' }))
      .toBe('Sony PXW-Z90 1번함 비밀번호 *8821 / 중앙현관 0418* / 반납 2026-10-10 14:00')
  })
  it('다른 알림에서는 비밀번호 변수를 쓸 수 없다(저장 거절)', () => {
    expect(validateNotifyMessage('reservation_approval', '{{무인함비밀번호}}').ok).toBe(false)
    expect(validateNotifyMessage('return_remind', '{{중앙현관비밀번호}}').ok).toBe(false)
  })
})

describe('renderLockerGuideMessage — 값이 없는 부분은 문장에서 뺀다 (2026-10-11)', () => {
  const tpl = getNotifySpec('locker_guide')!.defaultMessage
  const full = { 상품명: 'Sony PXW-Z90', 무인함번호: '1', 무인함비밀번호: '*8821', 중앙현관비밀번호: '0418*' }

  it('기본 문구: 함 번호·비밀번호·중앙현관 줄이 모두 채워진다', () => {
    expect(renderLockerGuideMessage(tpl, full)).toBe("Sony PXW-Z90 무인보관함 이용 1번함 비밀번호는 '*8821'입니다.\n중앙현관 비밀번호: 0418*")
  })
  it('중앙현관 비밀번호가 없으면 그 줄이 빠진다', () => {
    expect(renderLockerGuideMessage(tpl, { ...full, 중앙현관비밀번호: undefined })).toBe("Sony PXW-Z90 무인보관함 이용 1번함 비밀번호는 '*8821'입니다.")
  })
  it('무인함 번호가 없으면(옛 저장분) "번함" 부분이 빠진다', () => {
    expect(renderLockerGuideMessage(tpl, { ...full, 무인함번호: undefined })).toBe("Sony PXW-Z90 무인보관함 이용 비밀번호는 '*8821'입니다.\n중앙현관 비밀번호: 0418*")
  })
  it('기본 문구는 문자 규격(이모지 없음·2000바이트 이내)을 통과한다', () => {
    expect(validateNotifyMessage('locker_guide', tpl).ok).toBe(true)
    expect(getNotifySpec('locker_guide')?.sms).toBe(true)
  })
  it('문자 대상 알림에 링크(http·www)가 있으면 저장은 되고 경고가 붙는다', () => {
    const r = validateNotifyMessage('return_remind', '{{상품명}} 안내 https://example.com 확인')
    expect(r.ok).toBe(true)
    expect(r.warnings.some((w) => w.includes('링크'))).toBe(true)
    expect(validateNotifyMessage('return_remind', '자세히 www.example.com').warnings.some((w) => w.includes('링크'))).toBe(true)
  })
  it('링크가 없거나 푸시 전용 알림이면 링크 경고가 없다', () => {
    expect(validateNotifyMessage('return_remind', '{{상품명}} 반납 안내').warnings.some((w) => w.includes('링크'))).toBe(false)
    expect(validateNotifyMessage('rental_complete', '감사합니다 https://example.com').warnings.some((w) => w.includes('링크'))).toBe(false)
  })
  it('http 링크는 자동 첨부 생략, 도메인·www만 있으면 자동 첨부가 한 번 더 붙는다고 각각 정확히 안내한다', () => {
    const http = validateNotifyMessage('return_remind', '확인 https://example.com').warnings.join(' ')
    expect(http).toContain('생략')
    const domain = validateNotifyMessage('return_remind', '자세한 건 crazyshot.kr 에서').warnings.join(' ')
    expect(domain).toContain('두 번')
    expect(domain).not.toContain('생략')
    const www = validateNotifyMessage('return_remind', '확인 www.example.com').warnings.join(' ')
    expect(www).toContain('두 번')
  })
  it('대문자 HTTP는 sms.ts가 자동 링크를 붙이므로 두 번 안내(생략 아님)', () => {
    const upper = validateNotifyMessage('return_remind', '확인 HTTP://EXAMPLE.COM').warnings.join(' ')
    expect(upper).toContain('두 번')
  })
  it('무인보관함은 별도 조립이라 링크 경고 대상이 아니다', () => {
    expect(validateNotifyMessage('locker_guide', '{{상품명}} crazyshot.kr').warnings.some((w) => w.includes('주소'))).toBe(false)
  })
})

