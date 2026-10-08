import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { CONTRACT_SIGN_TIMEOUT_MS, contractSignRemainingMinutes, contractSignRemainingSeconds, formatCountdown, isContractSignUrgent, CONTRACT_SIGN_URGENT_SECONDS } from '$lib/utils/holdContractTimer'

const NOW = new Date('2026-10-08T12:00:00Z').getTime()
const sentAgo = (min: number) => new Date(NOW - min * 60_000).toISOString()
const row = (over: Partial<{ status: string; signing_sent_at: string | null; payment_confirmed_at: string | null }> = {}) => ({
  status: 'hold', signing_sent_at: sentAgo(10), payment_confirmed_at: null, ...over,
})

describe('contractSignRemainingMinutes — 계약 발송 후 잔여 제한 시간(분)', () => {
  it('발송 직후는 60분, 10분 지나면 50분', () => {
    expect(contractSignRemainingMinutes(row({ signing_sent_at: sentAgo(0) }), NOW)).toBe(60)
    expect(contractSignRemainingMinutes(row(), NOW)).toBe(50)
  })

  it('남은 시간이 분 단위로 떨어지지 않으면 올림한다(30초 남음 → 1분, 29분 59초 남음 → 30분)', () => {
    expect(contractSignRemainingMinutes(row({ signing_sent_at: new Date(NOW - 59.5 * 60_000).toISOString() }), NOW)).toBe(1)
    expect(contractSignRemainingMinutes(row({ signing_sent_at: new Date(NOW - 30 * 60_000 - 1000).toISOString() /* 29분 59초 남음 → 30 */ }), NOW)).toBe(30)
  })

  it('정확히 1시간이 지났거나 넘으면 null(종료 → 숨김)', () => {
    expect(contractSignRemainingMinutes(row({ signing_sent_at: sentAgo(60) }), NOW)).toBeNull()
    expect(contractSignRemainingMinutes(row({ signing_sent_at: sentAgo(61) }), NOW)).toBeNull()
    expect(contractSignRemainingMinutes(row({ signing_sent_at: sentAgo(600) }), NOW)).toBeNull()
  })

  it('59분 59초 지난 시점은 아직 1분이 남은 것으로 본다', () => {
    expect(contractSignRemainingMinutes(row({ signing_sent_at: new Date(NOW - (60 * 60_000 - 1000)).toISOString() }), NOW)).toBe(1)
  })

  it('타이머가 없는 경우는 null: 발송 전, 결제 완료, hold가 아닌 상태, 잘못된 시각', () => {
    expect(contractSignRemainingMinutes(row({ signing_sent_at: null }), NOW)).toBeNull()
    expect(contractSignRemainingMinutes(row({ payment_confirmed_at: sentAgo(1) }), NOW)).toBeNull()
    for (const status of ['confirmed', 'cancelled', 'expired', 'in_use', 'pending']) {
      expect(contractSignRemainingMinutes(row({ status }), NOW), status).toBeNull()
    }
    expect(contractSignRemainingMinutes(row({ signing_sent_at: 'not-a-date' }), NOW)).toBeNull()
  })

  it('서명은 끝났지만 결제 전인 hold도 만료 기준은 그대로이므로 계속 표시한다(DB 함수는 서명 여부를 보지 않는다)', () => {
    expect(contractSignRemainingMinutes(row({ signing_sent_at: sentAgo(20) }), NOW)).toBe(40)
  })
})

describe('DB 제한 시간과 화면 상수 일치', () => {
  it('상수는 1시간이다', () => {
    expect(CONTRACT_SIGN_TIMEOUT_MS).toBe(3_600_000)
  })

  it('가장 최근 release_reservation_hold 마이그레이션의 제한 시간이 화면 상수와 같다(바꿀 때 함께 고치도록)', () => {
    const dir = 'supabase/migrations'
    const files = readdirSync(dir).filter((f) => /_676_hold_contract_sign_timeout/.test(f))
    expect(files).toHaveLength(1)
    const sql = readFileSync(`${dir}/${files[0]}`, 'utf8')
    expect(sql).toContain("INTERVAL ''1 hour''")
  })
})

describe('예약목록 화면 배선(소스 점검)', () => {
  const src = readFileSync('src/routes/cms/reservation/+page.svelte', 'utf8')

  it('잔여 시간은 마운트 후 값이 생긴 뒤에만, 타이머가 없거나 종료(null)면 렌더하지 않는다', () => {
    expect(src).toContain("import { contractSignRemainingSeconds, formatCountdown, isContractSignUrgent } from '$lib/utils/holdContractTimer'")
    expect(src).toContain('let nowMs = $state<number | null>(null)')
    expect(src).toContain('{@const remainSec = nowMs !== null ? contractSignRemainingSeconds(row, nowMs) : null}')
    expect(src.match(/\{#if remainSec !== null\}/g)).toHaveLength(2) // 계약발송·서명완료(결제 전) 배지 안
  })

  it('잔여 시간은 배지(.status-badge) 안 우측에 들어간다', () => {
    expect(src).toMatch(/>계약발송\{#if remainSec !== null\}<span class="badge-remain"[^>]*>\{formatCountdown\(remainSec\)\}<\/span>\{\/if\}<\/span>/)
    expect(src).not.toContain('class="hold-remain"')
  })

  it('잔여 10분 이하(임박)면 가장 진한 레드 토큰(--cs-red)으로 강조하고 배지 두 곳 모두 적용한다', () => {
    expect(src.match(/class:badge-remain-urgent=\{isContractSignUrgent\(remainSec\)\}/g)).toHaveLength(2)
    expect(src).toMatch(/\.badge-remain-urgent \{[^}]*color: var\(--cs-red\)[;\s]/)
  })

  it('잔여 시간 글자는 배지 글자(12px)보다 한 단계 작은 토큰(--text-pc-tag-11)을 쓴다', () => {
    expect(src).toMatch(/\.badge-remain \{[^}]*font: var\(--text-pc-tag-11\)/)
  })

  it('1초마다 갱신(실시간 카운트다운)하고 정리(clearInterval)한다', () => {
    expect(src).toContain('setInterval(() => { nowMs = Date.now() }, 1000)')
    expect(src).toContain('clearInterval(timer)')
  })

  it('관리자 예약목록(CMS) 화면에만 있고 고객 화면에는 쓰이지 않는다', () => {
    const files = ['src/routes/account/rental/+page.svelte', 'src/routes/contract/[token]/+page.svelte']
    for (const f of files) {
      try { expect(readFileSync(f, 'utf8')).not.toContain('holdContractTimer') } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e }
    }
  })
})

describe('실시간 카운트다운 — 초 단위·분:초 표기', () => {
  it('남은 초는 올림이고 1초씩 줄어든다', () => {
    expect(contractSignRemainingSeconds(row({ signing_sent_at: sentAgo(0) }), NOW)).toBe(3600)
    expect(contractSignRemainingSeconds(row({ signing_sent_at: sentAgo(0) }), NOW + 1000)).toBe(3599)
    expect(contractSignRemainingSeconds(row({ signing_sent_at: sentAgo(0) }), NOW + 3_599_000)).toBe(1)
    expect(contractSignRemainingSeconds(row({ signing_sent_at: sentAgo(0) }), NOW + 3_599_500)).toBe(1)
  })

  it('1시간이 지나는 순간 null(숨김)이다', () => {
    expect(contractSignRemainingSeconds(row({ signing_sent_at: sentAgo(0) }), NOW + 3_600_000)).toBeNull()
    expect(contractSignRemainingSeconds(row({ signing_sent_at: sentAgo(0) }), NOW + 3_601_000)).toBeNull()
  })

  it('분 단위 값과 초 단위 값이 같은 기준이다(분 = 초/60 올림)', () => {
    for (const ms of [1, 999, 1000, 59_999, 60_000, 61_000, 3_599_999]) {
      const r = row({ signing_sent_at: new Date(NOW - (3_600_000 - ms)).toISOString() })
      const sec = contractSignRemainingSeconds(r, NOW)!
      expect(contractSignRemainingMinutes(r, NOW)).toBe(Math.ceil(sec / 60))
    }
  })

  it('formatCountdown은 분:초 두 자리로 표기한다', () => {
    expect(formatCountdown(3600)).toBe('60:00')
    expect(formatCountdown(3599)).toBe('59:59')
    expect(formatCountdown(61)).toBe('01:01')
    expect(formatCountdown(5)).toBe('00:05')
    expect(formatCountdown(0)).toBe('00:00')
    expect(formatCountdown(-3)).toBe('00:00')
  })

  it('타이머가 없는 행은 초 단위도 null이다', () => {
    expect(contractSignRemainingSeconds(row({ signing_sent_at: null }), NOW)).toBeNull()
    expect(contractSignRemainingSeconds(row({ payment_confirmed_at: sentAgo(1) }), NOW)).toBeNull()
    expect(contractSignRemainingSeconds(row({ status: 'cancelled' }), NOW)).toBeNull()
  })
})

describe('임박(잔여 10분 이하) 판정', () => {
  it('기준은 600초이고 정확히 10:00도 임박이다', () => {
    expect(CONTRACT_SIGN_URGENT_SECONDS).toBe(600)
    expect(isContractSignUrgent(601)).toBe(false)
    expect(isContractSignUrgent(600)).toBe(true)
    expect(isContractSignUrgent(599)).toBe(true)
    expect(isContractSignUrgent(1)).toBe(true)
  })

  it('발송 50분 경과(잔여 10:00)부터 임박, 49분 59초 경과(잔여 10:01)는 아니다', () => {
    const at = (ms: number) => contractSignRemainingSeconds(row({ signing_sent_at: new Date(NOW - ms).toISOString() }), NOW)!
    expect(isContractSignUrgent(at(50 * 60_000))).toBe(true)
    expect(isContractSignUrgent(at(49 * 60_000 + 59_000))).toBe(false)
  })
})
