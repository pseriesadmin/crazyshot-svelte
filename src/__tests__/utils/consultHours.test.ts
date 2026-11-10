import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  CONSULT_NOTICE_MAX,
  sanitizeConsultNotice,
  validateConsultHours,
  parseConsultHours,
  isWithinConsultWindow,
  activeConsultNotice,
} from '$lib/utils/consultHours'

describe('sanitizeConsultNotice — 한글·영문·숫자·특수문자 50자', () => {
  it('허용 문자는 그대로 둔다', () => {
    expect(sanitizeConsultNotice('상담 시간 안내 ABC 123 !?.,~()')).toBe('상담 시간 안내 ABC 123 !?.,~()')
    expect(sanitizeConsultNotice('ㅋㅋ ㅏ')).toBe('ㅋㅋ ㅏ')
  })
  it('줄바꿈·이모지·한자·일본어는 제거한다', () => {
    expect(sanitizeConsultNotice('가\n나')).toBe('가나')
    expect(sanitizeConsultNotice('안녕😀하세요')).toBe('안녕하세요')
    expect(sanitizeConsultNotice('漢字かな')).toBe('')
  })
  it('50자로 자른다', () => {
    expect(sanitizeConsultNotice('가'.repeat(80))).toHaveLength(CONSULT_NOTICE_MAX)
  })
})

describe('validateConsultHours', () => {
  const ok = { message: '지금은 상담 시간이 아니에요', start: '22:00', end: '09:00' }
  it('정상 값 통과(공백 정리)', () => {
    const v = validateConsultHours({ ...ok, message: '  안내  ' })
    expect(v).toEqual({ ok: true, value: { message: '안내', start: '22:00', end: '09:00' } })
  })
  it('빈 문구·51자·허용 외 문자 거절', () => {
    expect(validateConsultHours({ ...ok, message: '  ' }).ok).toBe(false)
    expect(validateConsultHours({ ...ok, message: '가'.repeat(51) }).ok).toBe(false)
    expect(validateConsultHours({ ...ok, message: '안내😀' }).ok).toBe(false)
  })
  it('시각 형식 오류·시작=종료 거절', () => {
    expect(validateConsultHours({ ...ok, start: '9:00' }).ok).toBe(false)
    expect(validateConsultHours({ ...ok, end: '24:00' }).ok).toBe(false)
    expect(validateConsultHours({ ...ok, start: '', end: '' }).ok).toBe(false)
    expect(validateConsultHours({ ...ok, start: '10:00', end: '10:00' }).ok).toBe(false)
  })
  it('저장값 해석: 형식이 어긋나면 null', () => {
    expect(parseConsultHours(ok)).toEqual(ok)
    expect(parseConsultHours({ message: '', start: '22:00', end: '09:00' })).toBeNull()
    expect(parseConsultHours(null)).toBeNull()
  })
})

describe('isWithinConsultWindow — [시작, 종료) · 자정 넘김', () => {
  const m = (h: number, min = 0): number => h * 60 + min
  it('같은 날 구간', () => {
    expect(isWithinConsultWindow(m(12), '12:00', '13:00')).toBe(true)
    expect(isWithinConsultWindow(m(12, 59), '12:00', '13:00')).toBe(true)
    expect(isWithinConsultWindow(m(13), '12:00', '13:00')).toBe(false)
    expect(isWithinConsultWindow(m(11, 59), '12:00', '13:00')).toBe(false)
  })
  it('자정을 넘기는 구간(22:00~09:00)', () => {
    expect(isWithinConsultWindow(m(23), '22:00', '09:00')).toBe(true)
    expect(isWithinConsultWindow(m(0), '22:00', '09:00')).toBe(true)
    expect(isWithinConsultWindow(m(8, 59), '22:00', '09:00')).toBe(true)
    expect(isWithinConsultWindow(m(9), '22:00', '09:00')).toBe(false)
    expect(isWithinConsultWindow(m(21, 59), '22:00', '09:00')).toBe(false)
  })
})

describe('activeConsultNotice — 한국 시각 기준', () => {
  const cfg = { message: '야간 안내', start: '22:00', end: '09:00' }
  it('UTC 13:30 = KST 22:30 → 노출', () => {
    expect(activeConsultNotice(cfg, new Date('2026-11-10T13:30:00Z'))).toBe('야간 안내')
  })
  it('UTC 03:00 = KST 12:00 → 미노출', () => {
    expect(activeConsultNotice(cfg, new Date('2026-11-10T03:00:00Z'))).toBeNull()
  })
  it('설정 없음 → 미노출', () => {
    expect(activeConsultNotice(null)).toBeNull()
  })
})

describe('배선 — 소스 점검', () => {
  const server = readFileSync('src/routes/cms/set/push/+page.server.ts', 'utf8')
  const api = readFileSync('src/routes/api/chat/consult-notice/+server.ts', 'utf8')
  it('저장 액션: 매니저 이상 + 서버 재검증 + 감사로그', () => {
    const i = server.indexOf('updateConsultHours: async')
    expect(i).toBeGreaterThan(-1)
    const body = server.slice(i, i + 2600)
    expect(body).toMatch(/hasSettingsAccess\(cmsRole\)/)
    expect(body).toMatch(/validateConsultHours/)
    expect(body).toMatch(/insertCmsAdminAuditLog/)
  })
  it('고객 메시지 경로: 노출 시간대면 문구를 보내되 빠른답변·AI 흐름은 막지 않는다', () => {
    const msg = readFileSync('src/routes/api/chat/message/+server.ts', 'utf8')
    const i = msg.indexOf('activeConsultNotice(await getConsultHours')
    expect(i).toBeGreaterThan(-1)
    expect(i).toBeLessThan(msg.indexOf('1-a. 하이브리드 자동답변'))
    expect(i).toBeGreaterThan(msg.indexOf('const isManualMode'))
    const body = msg.slice(i, msg.indexOf('1-a. 하이브리드 자동답변'))
    expect(body).toMatch(/evaluateAdminEngaged/)
    expect(body).toMatch(/sender_type: 'ai'/)
    expect(body).toMatch(/alreadySent/)
    expect(body).toMatch(/\.eq\('updated_at', seenAt\)/) // 동시 메시지는 한 건만 선점
    expect(body).not.toMatch(/return json\(/) // 안내 후에도 기존 자동답변 흐름으로 이어진다
  })
  it('고객용 API는 접속지별 호출 횟수를 제한한다', () => {
    expect(api).toMatch(/createRateLimiter\(30, 60_000\)/)
    expect(api).toMatch(/status: 429/)
  })
  it('고객용 API는 시간 설정을 내려보내지 않고 문구만 돌려준다', () => {
    expect(api).toMatch(/activeConsultNotice/)
    expect(api).not.toMatch(/start:|end:/)
  })
})
