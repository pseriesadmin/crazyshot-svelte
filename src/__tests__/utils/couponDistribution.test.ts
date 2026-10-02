import { describe, it, expect } from 'vitest'
import {
  splitDistributionTargets, countStatuses, buildConfirmMessage, formatResultSummary, statusLabel,
} from '$lib/utils/couponDistribution'

describe('수동 지급 대상 입력 파싱', () => {
  it('줄바꿈·쉼표 구분, 공백 제거, 대소문자 무시 중복 제거, 입력 순서 유지', () => {
    expect(splitDistributionTargets(' A@x.com\nb@x.com,\n\na@X.com ,c@x.com ')).toEqual(['A@x.com', 'b@x.com', 'c@x.com'])
    expect(splitDistributionTargets('   \n ')).toEqual([])
  })
})

describe('사전 조회 확인창 문구 (B-8)', () => {
  it('보유 회원이 섞이면 신고 예시 문구 + [제외하고 지급]', () => {
    const c = countStatuses(['will_issue', 'will_issue', 'already_held'])
    const r = buildConfirmMessage(c)
    expect(r.kind).toBe('confirm')
    expect(r.message).toBe('입력 3명 중 1명은 이미 이 쿠폰을 보유하고 있습니다. 보유 회원을 제외하고 2명에게 지급할까요?')
    expect(r.confirmLabel).toBe('제외하고 지급')
  })
  it('이미 사용한 회원도 보유로 안내', () => {
    const r = buildConfirmMessage(countStatuses(['will_issue', 'already_used']))
    expect(r.message).toContain('입력 2명 중 1명은 이미 이 쿠폰을 보유')
  })
  it('전원 보유면 실행을 막는다', () => {
    const r = buildConfirmMessage(countStatuses(['already_held', 'already_used']))
    expect(r.kind).toBe('blocked')
    expect(r.message).toBe('모든 대상자가 이미 보유 중이라 지급할 대상이 없습니다.')
  })
  it('없는 회원만이면 막고, 보유+없음 혼합이면 사유를 합쳐 안내', () => {
    expect(buildConfirmMessage(countStatuses(['not_found'])).message).toBe('일치하는 회원이 없어 지급할 대상이 없습니다.')
    const mix = buildConfirmMessage(countStatuses(['already_held', 'not_found']))
    expect(mix.kind).toBe('blocked')
    expect(mix.message).toBe('지급할 대상이 없습니다. (이미 보유 1명 · 회원 없음 1명)')
  })
  it('보유자가 없으면 단순 확인, 회원 없음은 제외 안내', () => {
    const r = buildConfirmMessage(countStatuses(['will_issue', 'not_found']))
    expect(r.kind).toBe('confirm')
    expect(r.message).toBe('1명에게 지급할까요? (회원 없음 1명은 제외)')
    expect(r.confirmLabel).toBe('지급')
  })
})

describe('지급 결과 요약', () => {
  it('실제 결과대로 표기 — 신고 예시', () => {
    expect(formatResultSummary(countStatuses(['issued', 'issued', 'already_held']))).toBe('지급 2명 / 이미 보유 1명 / 회원 없음 0명')
  })
  it('이미 사용은 이미 보유에 합산, 상태 라벨', () => {
    expect(formatResultSummary(countStatuses(['already_used', 'already_held', 'not_found']))).toBe('지급 0명 / 이미 보유 2명 / 회원 없음 1명')
    expect(statusLabel('issued')).toBe('지급됨')
    expect(statusLabel('already_used')).toBe('이미 사용')
  })
})

describe('총 발행 개수 한도 초과(limit_reached) — Migration 623', () => {
  it('집계: limit_reached는 별도 카운트로 센다', () => {
    const c = countStatuses(['will_issue', 'limit_reached', 'limit_reached', 'already_held'])
    expect(c.issuable).toBe(1)
    expect(c.limitReached).toBe(2)
    expect(c.alreadyHeld).toBe(1)
    expect(c.notFound).toBe(0)
  })
  it('전원 한도 초과면 지급을 막고 사유를 안내한다', () => {
    const r = buildConfirmMessage(countStatuses(['limit_reached', 'limit_reached']))
    expect(r.kind).toBe('blocked')
    expect(r.message).toBe('총 발행 개수 한도에 도달해 더 이상 지급할 수 없습니다.')
  })
  it('일부만 지급 가능하면 한도 초과 인원을 안내문에 덧붙인다', () => {
    const r = buildConfirmMessage(countStatuses(['will_issue', 'will_issue', 'limit_reached']))
    expect(r.kind).toBe('confirm')
    expect(r.message).toBe('2명에게 지급할까요? (총 발행 개수 한도로 1명은 지급 불가)')
  })
  it('결과 요약·라벨: 한도 초과가 있을 때만 요약에 붙는다', () => {
    expect(formatResultSummary(countStatuses(['issued', 'already_held']))).toBe('지급 1명 / 이미 보유 1명 / 회원 없음 0명')
    expect(formatResultSummary(countStatuses(['issued', 'limit_reached']))).toBe('지급 1명 / 이미 보유 0명 / 회원 없음 0명 / 발행 한도 초과 1명')
    expect(statusLabel('limit_reached')).toBe('발행 한도 초과')
  })
})
